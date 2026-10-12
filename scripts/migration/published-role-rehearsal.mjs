/** Creates a short-lived login and write gate ONLY on the explicitly approved clone.
 * No production mode. setup --env <restore.env>; cleanup --record <private record.json>.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { privateRoot,privatePath,environment,connect,save,json } from './published-production-support.mjs';
import { installWriteGate,verifyWriteGate,grantRuntimeRole } from './published-runtime.mjs';
import { qi,sha256 } from './snapshot.mjs';
import { databaseState } from './published-backup-restore.mjs';
const database='llantera_restore_7f81aa2aef5adff8e4ec6da1',oid='16831';
const gateTables=['llantas','productos','servicios','ventas','venta_items','movimientos_bodega','bodegas','app_metadata'];
const ql=value=>"'"+value.replaceAll("'","''")+"'";
async function approvedClient(envFile){
  const connection=await environment(envFile,database),client=await connect(connection,false);
  const actual=(await client.query('SELECT current_database() AS database,d.oid::text AS oid,pg_get_userbyid(datdba) AS owner,session_user AS login FROM pg_database d WHERE datname=current_database()')).rows[0];
  assert.deepEqual(actual,{database,oid,owner:'admmin',login:'admmin'},'ONLY_APPROVED_CLONE_OWNER_ALLOWED');
  const registry=await json(path.join(path.dirname(envFile),'temporary-database.json'));assert.equal(registry.database,database);assert.equal(registry.oid,oid);
  return{client,connection};
}
export async function setupRoleRehearsal(envFile){
  const{client,connection}=await approvedClient(envFile);const id=randomBytes(10).toString('hex'),role='llaneteramulti_rehearsal_'+id+'_app';
  const password=randomBytes(36).toString('base64url'),directory=privatePath(path.join(privateRoot,'published-role-rehearsal-'+id));await fs.mkdir(directory);
  let app,committed=false;
  try{
    await client.query('BEGIN');assert.equal((await client.query("SELECT to_regclass('migration_new_tires.operation_state')::text AS name")).rows[0].name,null,'GATE_ALREADY_EXISTS');
    const before=await databaseState(client);await save(path.join(directory,'before.json'),before);
    const expires=(await client.query("SELECT (clock_timestamp()+interval '90 minutes')::text AS expires")).rows[0].expires;
    await client.query(`CREATE ROLE ${qi(role)} LOGIN PASSWORD ${ql(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 6 VALID UNTIL ${ql(expires)}`);
    const applicationSha256=sha256(await fs.readFile(new URL('./published-runtime.mjs',import.meta.url)));
    await installWriteGate(client,{appRole:role,applicationSha256});const privileges=await grantRuntimeRole(client,role);
    await client.query('COMMIT');committed=true;
    const appURL=new URL(connection.url);appURL.username=role;appURL.password=password;
    const appEnv=path.join(directory,'app.env');await fs.writeFile(appEnv,'DATABASE_URL='+appURL.toString()+'\nLLANTERA_EXPECTED_DATABASE='+database+'\n',{flag:'wx'});
    const record={database,oid,role,ownerEnv:path.resolve(envFile),appEnv,applicationSha256,directory,expires,productionRole:false};await save(path.join(directory,'record.json'),record);
    app=await connect(await environment(appEnv,database),false);
    await app.query('BEGIN');await assert.rejects(()=>app.query('UPDATE public.productos SET stock=stock WHERE false'),/La escritura requiere/);await app.query('ROLLBACK');
    await client.query('BEGIN');await assert.rejects(()=>client.query('UPDATE public.productos SET stock=stock WHERE false'),/La escritura requiere/);await client.query('ROLLBACK');
    await client.query("UPDATE migration_new_tires.operation_state SET status='active',activated_at=clock_timestamp() WHERE singleton");
    await app.query('BEGIN');await app.query('UPDATE public.productos SET stock=stock WHERE false');
    await assert.rejects(()=>app.query("UPDATE migration_new_tires.operation_state SET status='blocked'"),error=>error.code==='42501');await app.query('ROLLBACK');
    await client.query('BEGIN');await assert.rejects(()=>client.query('UPDATE public.productos SET stock=stock WHERE false'),/La escritura requiere/);await client.query('ROLLBACK');
    await app.query('BEGIN');await assert.rejects(()=>app.query('CREATE TABLE public.forbidden_role_probe(id integer)'),error=>error.code==='42501');await app.query('ROLLBACK');
    await app.query('BEGIN');await assert.rejects(()=>app.query('DELETE FROM public.ventas WHERE false'),error=>error.code==='42501');await app.query('ROLLBACK');
    const gate=await verifyWriteGate(client,{appRole:role,applicationSha256,expectedStatus:'active'});
    const after=await databaseState(client);for(const[name,table]of Object.entries(before.tables))assert.equal(after.tables[name].sha256,table.sha256,'ORIGINAL_ROWS_CHANGED');
    const report={database,oid,role,appEnv,record:path.join(directory,'record.json'),gate,privileges,checks:7,originalRowsUnchanged:true,globalAdministrativePrivileges:false,
      grantsOutsideClone:false,note:'Existing PUBLIC CONNECT privileges on other databases were neither changed nor granted by this rehearsal.'};
    await save(path.join(directory,'ready.json'),report);return report;
  }catch(error){if(!committed)await client.query('ROLLBACK').catch(()=>{});error.safeFailure={committed,privateDirectory:directory,needsExplicitCleanup:committed};throw error;}
  finally{if(app)await app.end();await client.end();}
}
export async function cleanupRoleRehearsal(recordFile){
  const record=await json(privatePath(recordFile));assert.equal(record.database,database);assert.equal(record.oid,oid);assert.match(record.role,/^llaneteramulti_rehearsal_[a-f0-9]{20}_app$/);
  const{client}=await approvedClient(record.ownerEnv);
  try{
    const other=(await client.query('SELECT count(*)::integer AS n FROM pg_stat_activity WHERE usename=$1',[record.role])).rows[0].n;assert.equal(other,0,'CLOSE_REHEARSAL_APP_CONNECTIONS_FIRST');
    await client.query('BEGIN');const gate=(await client.query('SELECT app_role FROM migration_new_tires.operation_state WHERE singleton FOR UPDATE')).rows[0];assert.equal(gate.app_role,record.role);
    for(const table of gateTables)await client.query(`DROP TRIGGER enforce_published_writer ON public.${qi(table)}`);
    await client.query('DROP FUNCTION migration_new_tires.enforce_writer_gate(); DROP TABLE migration_new_tires.operation_state');
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public,migration_new_tires FROM ${qi(record.role)};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public,migration_new_tires FROM ${qi(record.role)};
      REVOKE ALL ON SCHEMA public,migration_new_tires FROM ${qi(record.role)};
      REVOKE ALL ON DATABASE ${qi(database)} FROM ${qi(record.role)}; DROP ROLE ${qi(record.role)}`);
    await client.query('COMMIT');await save(path.join(record.directory,'cleaned.json'),{cleaned:true,database,oid,role:record.role,completedAt:new Date().toISOString(),temporaryLoginDropped:true});
    return{cleaned:true,database,role:record.role,temporaryLoginDropped:true};
  }finally{await client.end();}
}
const args=process.argv.slice(2);
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=args[0];(mode==='setup'&&args[1]==='--env'?setupRoleRehearsal(args[2]):mode==='cleanup'&&args[1]==='--record'?cleanupRoleRehearsal(args[2]):Promise.reject(new Error('NAMED_ARGUMENT_REQUIRED')))
    .then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(JSON.stringify({failure:error.safeFailure??{code:error.code??error.name}}));process.exitCode=1;});
}
