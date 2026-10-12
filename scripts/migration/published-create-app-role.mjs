/** Only creates the production application's dedicated login. Does NOT migrate,
 * grant object privileges, alter an existing role, start apps, or activate writes.
 * node scripts/migration/published-create-app-role.mjs --env .env.auditoria-publicada.local
 *   --expected-identity <private destination-identity.json> --out <new private directory>
 * On ambiguous COMMIT, inspect role existence with the saved record; never retry blindly.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { privatePath,environment,connect,identity,assertIdentity,json,save,commitOnce } from './published-production-support.mjs';
import { qi,sha256 } from './snapshot.mjs';
const role='llaneteramulti_published_app';
const ql=value=>"'"+value.replaceAll("'","''")+"'";

export async function createPublishedRole({envFile,expectedIdentityFile,outputDirectory}){
  const expected=await json(privatePath(expectedIdentityFile));assert.equal(expected.database,'postgres','ONLY_PUBLISHED_DATABASE_ALLOWED');
  const connection=await environment(envFile,'postgres'),directory=privatePath(outputDirectory);await fs.mkdir(directory,{recursive:false});
  const client=await connect(connection,false);let commitAttempted=false,committed=false;
  try{
    assertIdentity(await identity(client,connection),expected);await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['llaneteramulti:published-app-role:v1']);
    assert.equal((await client.query('SELECT count(*)::integer AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0,'APPLICATION_ROLE_ALREADY_EXISTS_DO_NOT_ROTATE');
    const password=randomBytes(48).toString('base64url'),appURL=new URL(connection.url);appURL.username=role;appURL.password=password;
    const envPath=path.join(directory,'app.env');let text='DATABASE_URL='+appURL.toString()+'\nLLANTERA_EXPECTED_DATABASE=postgres\n';
    for(const key of ['DB_REQUIRE_SSL','DB_SSL_REJECT_UNAUTHORIZED'])if(connection.env[key]!==undefined)text+=key+'='+connection.env[key]+'\n';
    await fs.writeFile(envPath,text,{flag:'wx',mode:0o600});
    const record={role,destinationIdentity:expected,appEnv:envPath,envSha256:sha256(Buffer.from(text)),createdAt:new Date().toISOString(),
      grantsPerformed:false,applicationActivated:false,retryAutomatically:false,note:'Existing PUBLIC database privileges are unchanged. Apply will grant only the published database objects.'};
    await save(path.join(directory,'role-request.json'),record);
    await client.query(`CREATE ROLE ${qi(role)} LOGIN PASSWORD ${ql(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20`);
    const attributes=(await client.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolconnlimit,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS has_memberships FROM pg_roles r WHERE rolname=$1`,[role])).rows[0];
    assert.deepEqual(attributes,{rolname:role,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolinherit:false,rolconnlimit:20,has_memberships:false},'ROLE_ATTRIBUTES_NOT_LIMITED');
    commitAttempted=true;await commitOnce(client);committed=true;
    const exists=(await client.query('SELECT count(*)::integer AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n;assert.equal(exists,1,'ROLE_NOT_VISIBLE_AFTER_COMMIT');
    const report={created:true,role,appEnv:envPath,record:path.join(directory,'role-request.json'),grantsPerformed:false,applicationActivated:false};
    await save(path.join(directory,'complete.json'),report);return report;
  }catch(error){
    if(!commitAttempted)await client.query('ROLLBACK').catch(()=>{});
    error.safeFailure={committed,commitAttempted,commitOutcome:committed?'confirmed':commitAttempted?'unknown':'not_committed',role,
      privateDirectory:directory,retryAutomatically:false,code:String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0]??error.code??error.name};
    await save(path.join(directory,'failure.json'),error.safeFailure).catch(()=>{});throw error;
  }finally{await client.end().catch(()=>{});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){assert.ok(['--env','--expected-identity','--out'].includes(args[i])&&args[i+1],'EXPECTED_NAMED_ARGUMENTS');assert.ok(!options[args[i]],'DUPLICATE_ARGUMENT');options[args[i]]=args[i+1];}
  createPublishedRole({envFile:options['--env'],expectedIdentityFile:options['--expected-identity'],outputDirectory:options['--out']})
    .then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(JSON.stringify({failure:error.safeFailure??{code:error.code??error.name}}));process.exitCode=1;});
}
