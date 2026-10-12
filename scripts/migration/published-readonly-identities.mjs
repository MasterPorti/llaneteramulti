/** Read-only evidence. Does not stop apps, modify databases, or claim writers stopped. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { root,privateRoot,environment,connect,identity,save } from './published-production-support.mjs';

async function deriveOwnerEnvironment(){
  const admin=dotenv.parse(await fs.readFile(path.resolve(root,'../sistemaBodega/.env')));
  const current=dotenv.parse(await fs.readFile(path.join(root,'.env.local')));
  assert.ok(admin.DATABASE_URL&&current.DATABASE_URL,'BOTH_CONNECTIONS_REQUIRED');
  const adminURL=new URL(admin.DATABASE_URL),currentURL=new URL(current.DATABASE_URL);
  assert.equal(adminURL.hostname,currentURL.hostname,'SOURCE_HOST_MISMATCH');
  assert.equal(adminURL.port||'5432',currentURL.port||'5432','SOURCE_PORT_MISMATCH');
  assert.equal(decodeURIComponent(currentURL.pathname.slice(1)),'llaneteramulti_new_tires','LOCAL_SOURCE_DATABASE_MISMATCH');
  adminURL.pathname='/llaneteramulti_new_tires';
  const file=path.join(root,'.env.owner-new-tires.local');
  let content='DATABASE_URL='+adminURL.toString()+'\nLLANTERA_EXPECTED_DATABASE=llaneteramulti_new_tires\n';
  for(const key of ['DB_REQUIRE_SSL','DB_SSL_REJECT_UNAUTHORIZED'])if(admin[key]!==undefined)content+=key+'='+admin[key]+'\n';
  try{await fs.writeFile(file,content,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.equal(await fs.readFile(file,'utf8'),content,'EXISTING_OWNER_ENV_DIFFERS');}
  return file;
}

async function audit(label,envFile,database,directory){
  const connection=await environment(envFile,database),client=await connect(connection,true);
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly=(await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
    assert.equal(readOnly,'on','READ_ONLY_REQUIRED');
    const actual=await identity(client,connection);
    const otherConnections=(await client.query(`SELECT pid,application_name,usename AS username,client_addr::text AS client_address
      FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' ORDER BY pid`)).rows;
    const observation={checkedAt:new Date().toISOString(),readOnly:true,identity:actual,otherConnectionCount:otherConnections.length,otherConnections,
      source:'pg_stat_activity',writersStoppedEstablished:false,
      interpretation:otherConnections.length?'Other database clients were connected; this inspection did not determine which can write.':'No other client connections observed at this instant; this does not prove apps are stopped or prevent reconnection.'};
    await save(path.join(directory,label+'-identity.json'),actual);await save(path.join(directory,label+'-connections.json'),observation);
    await client.query('ROLLBACK');return{label,database,identityFile:path.join(directory,label+'-identity.json'),connectionsFile:path.join(directory,label+'-connections.json'),
      otherConnectionCount:otherConnections.length,applications:[...new Set(otherConnections.map(c=>c.application_name||'(not set)'))],writersStoppedEstablished:false};
  }finally{await client.end().catch(()=>{});}
}

export async function auditPublishedIdentities(){
  const sourceEnv=await deriveOwnerEnvironment();
  const directory=path.join(privateRoot,'published-identity-audit-'+new Date().toISOString().replaceAll(':','-')+'-'+randomBytes(4).toString('hex'));await fs.mkdir(directory);
  const results=await Promise.allSettled([
    audit('source',sourceEnv,'llaneteramulti_new_tires',directory),
    audit('destination',path.join(root,'.env.auditoria-publicada.local'),'postgres',directory),
  ]);
  const reports=results.map((r,index)=>r.status==='fulfilled'?r.value:{label:index===0?'source':'destination',failureCode:r.reason.code??String(r.reason.message).match(/[A-Z][A-Z_]{5,}/)?.[0]??r.reason.name});
  const report={directory,sourceOwnerEnv:sourceEnv,databaseChangesPerformed:false,readOnly:true,reports};await save(path.join(directory,'summary.json'),report);
  if(results.some(r=>r.status==='rejected')){const error=new Error('IDENTITY_AUDIT_INCOMPLETE');error.safeReport=report;throw error;}
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))auditPublishedIdentities()
  .then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(JSON.stringify(error.safeReport??{failure:error.code??error.name}));process.exitCode=1;});
