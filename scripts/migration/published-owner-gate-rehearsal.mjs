/** Existing-owner/version gate rehearsal, restricted to the approved clone OID 16831.
 * No role creation, deletion, alteration or grants. setup --env <restore.env>;
 * cleanup --record <private record.json>. All probe DML is rolled back.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { root,privateRoot,privatePath,environment,connect,save,json,commitOnce } from './published-production-support.mjs';
import { installWriteGate,verifyWriteGate,validateExistingRuntimeRole,applicationNameForArtifact } from './published-runtime.mjs';
import { qi,sha256 } from './snapshot.mjs';
import { databaseState } from './published-backup-restore.mjs';
import { historicalTruncateSql } from './published-merge-model.mjs';
const database='llantera_restore_7f81aa2aef5adff8e4ec6da1',oid='16831',role='admmin';
const gateTables=['llantas','productos','servicios','ventas','venta_items','movimientos_bodega','bodegas','app_metadata'];
async function approvedClient(envFile){
  const connection=await environment(envFile,database),client=await connect(connection,false);
  const actual=(await client.query('SELECT current_database() AS database,d.oid::text AS oid,pg_get_userbyid(datdba) AS owner,session_user AS login FROM pg_database d WHERE datname=current_database()')).rows[0];
  assert.deepEqual(actual,{database,oid,owner:role,login:role},'ONLY_APPROVED_CLONE_OWNER_ALLOWED');
  const registry=await json(path.join(path.dirname(envFile),'temporary-database.json'));assert.equal(registry.database,database);assert.equal(registry.oid,oid);
  return{client,connection};
}
async function rollbackProbe(client,action){await client.query('BEGIN');try{await action();}finally{await client.query('ROLLBACK');}}
export async function setupOwnerGate(envFile){
  const{client,connection}=await approvedClient(envFile),id=randomBytes(10).toString('hex');
  const directory=privatePath(path.join(privateRoot,'published-owner-gate-'+id));await fs.mkdir(directory);
  let modern,old,wrong,commitAttempted=false,committed=false;
  try{
    await client.query('BEGIN');assert.equal((await client.query("SELECT to_regclass('migration_new_tires.operation_state')::text AS name")).rows[0].name,null,'GATE_ALREADY_EXISTS');
    const before=await databaseState(client);await save(path.join(directory,'before.json'),before);await validateExistingRuntimeRole(client,role);
    const applicationSha256=sha256(await fs.readFile(path.join(root,'lib/db.ts'))),applicationName=applicationNameForArtifact(applicationSha256);
    const appEnv=path.join(directory,'app.env');let envText='DATABASE_URL='+connection.url.toString()+'\nLLANTERA_EXPECTED_DATABASE='+database+'\nLLANTERA_APPLICATION_ID='+applicationName+'\n';
    for(const key of ['DB_REQUIRE_SSL','DB_SSL_REJECT_UNAUTHORIZED'])if(connection.env[key]!==undefined)envText+=key+'='+connection.env[key]+'\n';
    await fs.writeFile(appEnv,envText,{flag:'wx',mode:0o600});
    const record={database,oid,role,ownerEnv:path.resolve(envFile),appEnv,applicationSha256,applicationName,directory,
      testArtifact:'lib/db.ts SHA256 for clone gate only; production uses its deployed artifact SHA256',roleChangesPerformed:false};await save(path.join(directory,'record.json'),record);
    await installWriteGate(client,{appRole:role,applicationSha256});commitAttempted=true;await commitOnce(client);committed=true;
    modern=await connect(connection,false,{applicationName});old=await connect(connection,false,{applicationName:''});wrong=await connect(connection,false,{applicationName:applicationNameForArtifact('0'.repeat(64))});
    const identities=await Promise.all([modern,old,wrong].map(c=>c.query("SELECT session_user AS username,current_setting('application_name') AS application_name")));
    assert.ok(identities.every(r=>r.rows[0].username===role));assert.equal(identities[0].rows[0].application_name,applicationName);assert.equal(identities[1].rows[0].application_name,'');
    let checks=0;const denied=async(c,sql,params)=>rollbackProbe(c,async()=>{await assert.rejects(()=>c.query(sql,params),e=>e.code==='P0001');checks++;});
    const harmless='UPDATE public.productos SET stock=stock WHERE false';
    await denied(modern,harmless);await denied(old,harmless);await denied(wrong,harmless);
    await client.query("UPDATE migration_new_tires.operation_state SET status='active',activated_at=clock_timestamp() WHERE singleton");
    await denied(old,harmless);await denied(wrong,harmless);
    await rollbackProbe(modern,async()=>{await modern.query(harmless);checks++;});
    const historical=(await client.query('SELECT sale_id FROM migration_new_tires.imported_sales ORDER BY sale_id LIMIT 1')).rows[0].sale_id;
    await denied(modern,'UPDATE public.ventas SET total=total WHERE id=$1',[historical]);
    await denied(modern,"UPDATE migration_new_tires.source_rows SET row_text=row_text WHERE dataset='new_tires' AND row_ordinal=1");
    // Records the intentional limit: an owner can deliberately set the marker.
    await rollbackProbe(old,async()=>{await old.query("SELECT set_config('application_name',$1,true)",[applicationName]);await old.query(harmless);checks++;});
    assert.equal((await old.query("SELECT current_setting('application_name') AS name")).rows[0].name,'');
    const gate=await verifyWriteGate(client,{appRole:role,applicationSha256,expectedStatus:'active'}),after=await databaseState(client);
    for(const[name,table]of Object.entries(before.tables))assert.equal(after.tables[name].sha256,table.sha256,'ORIGINAL_ROWS_CHANGED');
    assert.deepEqual(after.roleDependencies,before.roleDependencies,'ROLE_PRIVILEGES_OR_DEPENDENCIES_CHANGED');
    const report={database,oid,role,appEnv,record:path.join(directory,'record.json'),gate,checks,originalRowsUnchanged:true,roleChangesPerformed:false,
      sameOwnerUsedInAllSessions:true,oldApplicationWithoutMarkerBlocked:true,ownerCanIntentionallyChangeMarker:true};await save(path.join(directory,'ready.json'),report);return report;
  }catch(error){if(!commitAttempted)await client.query('ROLLBACK').catch(()=>{});error.safeFailure={committed,commitAttempted,privateDirectory:directory,needsExplicitInspection:commitAttempted,code:String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0]??error.code??error.name};throw error;}
  finally{for(const c of [modern,old,wrong,client])if(c)await c.end().catch(()=>{});}
}
export async function cleanupOwnerGate(recordFile){
  const record=await json(privatePath(recordFile));assert.equal(record.database,database);assert.equal(record.oid,oid);assert.equal(record.role,role);
  const{client}=await approvedClient(record.ownerEnv);let commitAttempted=false;
  try{
    const connections=(await client.query('SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1',[record.applicationName])).rows[0].n;assert.equal(connections,0,'CLOSE_REHEARSAL_APPLICATION_CONNECTIONS_FIRST');
    await client.query('BEGIN');await verifyWriteGate(client,{appRole:role,applicationSha256:record.applicationSha256,expectedStatus:'active'});
    const before=await databaseState(client);
    for(const table of gateTables)await client.query(`DROP TRIGGER enforce_published_writer ON public.${qi(table)}`);
    await client.query('DROP FUNCTION migration_new_tires.enforce_writer_gate(); DROP TABLE migration_new_tires.operation_state');
    const after=await databaseState(client);for(const[name,table]of Object.entries(before.tables))if(name!=='migration_new_tires.operation_state')assert.equal(after.tables[name].sha256,table.sha256,'CLEANUP_CHANGED_DATA');
    assert.deepEqual(after.roleDependencies,before.roleDependencies,'CLEANUP_CHANGED_ROLE');commitAttempted=true;await commitOnce(client);
    const report={cleaned:true,database,oid,role,existingRoleUnchanged:true,onlyGateRemoved:true};await save(path.join(record.directory,'cleaned.json'),report);return report;
  }catch(error){if(!commitAttempted)await client.query('ROLLBACK').catch(()=>{});throw error;}finally{await client.end();}
}
export async function verifyOwnerTruncateGuard(recordFile){
  const record=await json(privatePath(recordFile));assert.equal(record.database,database);assert.equal(record.oid,oid);assert.equal(record.role,role);
  const{client}=await approvedClient(record.ownerEnv);let commitAttempted=false;
  try{
    await client.query('BEGIN');const before=await databaseState(client);
    const guards=(await client.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('protect_new_tires_sales_truncate','protect_new_tires_items_truncate')")).rows;
    if(!guards.length)await client.query(historicalTruncateSql);else assert.ok(guards.length===2&&guards.every(g=>g.tgenabled==='O'),'TRUNCATE_GUARDS_INCOMPLETE');
    await client.query('SAVEPOINT truncate_probe');
    await client.query("SELECT set_config('application_name',$1,true)",[record.applicationName]);
    await assert.rejects(()=>client.query('TRUNCATE public.ventas,public.venta_items,migration_new_tires.imported_sales,migration_new_tires.item_context'),e=>e.code==='P0001'&&e.message.includes('no admite TRUNCATE'));
    await client.query('ROLLBACK TO SAVEPOINT truncate_probe');await client.query('RELEASE SAVEPOINT truncate_probe');
    const after=await databaseState(client);for(const[name,table]of Object.entries(before.tables))assert.equal(after.tables[name].sha256,table.sha256,'TRUNCATE_PROBE_CHANGED_DATA');
    commitAttempted=true;await commitOnce(client);
    const report={database,oid,existingRole:role,guardsEnabled:2,truncateRejected:true,allOriginalRowsUnchanged:true};await save(path.join(record.directory,'truncate-guard.json'),report);return report;
  }catch(error){if(!commitAttempted)await client.query('ROLLBACK').catch(()=>{});throw error;}finally{await client.end();}
}
const args=process.argv.slice(2);
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=args[0];(mode==='setup'&&args[1]==='--env'?setupOwnerGate(args[2]):mode==='cleanup'&&args[1]==='--record'?cleanupOwnerGate(args[2]):mode==='truncate-check'&&args[1]==='--record'?verifyOwnerTruncateGuard(args[2]):Promise.reject(new Error('NAMED_ARGUMENT_REQUIRED')))
    .then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(JSON.stringify({failure:error.safeFailure??{code:error.code??error.name}}));process.exitCode=1;});
}
