import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import dotenv from 'dotenv';
import pg from 'pg';
import { qi, sha256, rowsHash } from './snapshot.mjs';
import { databaseState, compareStates, normalizeSchema } from './published-backup-restore.mjs';

export const root=fileURLToPath(new URL('../../',import.meta.url));
export const privateRoot=path.join(root,'.migration-backups');
export const maxAgeMs=60*60*1000;
export const codeFiles=['published-merge-production.mjs','published-production-support.mjs','published-merge-rehearsal.mjs',
  'published-merge-model.mjs','published-runtime.mjs','published-backup-restore.mjs','snapshot.mjs'];
export const lockKey='llaneteramulti:published-new-tires:production-v1';
export function privatePath(file){const p=path.resolve(file);assert.ok(p.toLowerCase().startsWith(privateRoot.toLowerCase()+path.sep),'PRIVATE_PROJECT_PATH_REQUIRED');return p;}
export const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export const save=async(file,value)=>fs.writeFile(privatePath(file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export function assertFresh(timestamp,now=Date.now()){
  const t=Date.parse(timestamp);assert.ok(Number.isFinite(t)&&now-t>=-30000&&now-t<=maxAgeMs,'FRESH_PACKAGE_REQUIRED');
}
export function assertIdentity(actual,expected){
  const stableFields=['host','port','database','oid','owner','session_user','server_port','cluster_identifier'];
  const expectedKeys=[...stableFields,'server_address'].sort();
  for(const value of [actual,expected]){
    assert.ok(value&&typeof value==='object','EXACT_SERVER_DATABASE_IDENTITY_MISMATCH');
    assert.deepEqual(Object.keys(value).sort(),expectedKeys,'EXACT_SERVER_DATABASE_IDENTITY_MISMATCH');
    const address=value.server_address;
    assert.equal(typeof address,'string','INVALID_OBSERVED_SERVER_ADDRESS');
    const parts=address.split('/'),family=isIP(parts[0]);
    assert.ok(family!==0&&parts.length<=2,'INVALID_OBSERVED_SERVER_ADDRESS');
    if(parts.length===2)assert.ok(/^\d{1,3}$/.test(parts[1])&&Number(parts[1])<=(family===4?32:128),'INVALID_OBSERVED_SERVER_ADDRESS');
  }
  // Docker may route the same server through IPv4 or IPv6. Preserve each observed
  // inet address as evidence; compare every stable server/database identifier.
  for(const field of stableFields)assert.deepEqual(actual[field],expected[field],'EXACT_SERVER_DATABASE_IDENTITY_MISMATCH');
}
export async function codeHashes(){return Object.fromEntries(await Promise.all(codeFiles.map(async name=>[name,sha256(await fs.readFile(path.join(root,'scripts','migration',name)))])));}
export function documentHashes(documents){return Object.fromEntries(documents.map(([label,bytes])=>[label,sha256(bytes)]));}
export function verifyDocumentHashes(documents,approved){assert.deepEqual(documentHashes(documents),approved,'INPUT_DOCUMENT_CHANGED');}

export async function environment(envFile,expectedDatabase){
  const p=path.resolve(envFile);assert.ok(p.toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep),'PROJECT_ENV_REQUIRED');
  const env=dotenv.parse(await fs.readFile(p));assert.ok(env.DATABASE_URL,'DATABASE_URL_REQUIRED');
  const url=new URL(env.DATABASE_URL);assert.ok(['postgres:','postgresql:'].includes(url.protocol),'POSTGRES_URL_REQUIRED');
  assert.equal(decodeURIComponent(url.pathname.slice(1)),expectedDatabase,'DATABASE_NAME_NOT_APPROVED');
  for(const key of url.searchParams.keys())assert.ok(['sslmode'].includes(key),'AMBIGUOUS_CONNECTION_PARAMETER');
  return {envFile:p,url,env,endpoint:{host:url.hostname,port:url.port||'5432',database:expectedDatabase}};
}
export async function connect(connection,readOnly,{applicationName='llantera-reviewed-published-migration'}={}){
  const client=new pg.Client({connectionString:connection.url.toString(),connectionTimeoutMillis:20000,statement_timeout:120000,
    ssl:connection.env.DB_REQUIRE_SSL==='true'?{rejectUnauthorized:connection.env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:undefined,
    application_name:applicationName,options:`-c timezone=UTC${readOnly?' -c default_transaction_read_only=on':''}`});
  await client.connect();return client;
}
export async function identity(client,connection){
  const row=(await client.query(`SELECT current_database() AS database,d.oid::text AS oid,pg_get_userbyid(d.datdba) AS owner,
    session_user AS session_user,inet_server_addr()::text AS server_address,inet_server_port() AS server_port,
    (SELECT system_identifier::text FROM pg_control_system()) AS cluster_identifier
    FROM pg_database d WHERE d.datname=current_database()`)).rows[0];
  assert.equal(row.database,connection.endpoint.database,'ACTUAL_DATABASE_MISMATCH');
  assert.equal(row.owner,row.session_user,'OWNER_MIGRATION_CONNECTION_REQUIRED');
  return {...connection.endpoint,...row};
}
export async function nativeSchema(client,connection){
  const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key];
  Object.assign(env,{PGHOST:connection.url.hostname,PGPORT:connection.url.port||'5432',
    PGUSER:decodeURIComponent(connection.url.username),PGPASSWORD:decodeURIComponent(connection.url.password),
    PGDATABASE:connection.endpoint.database,PGSSLMODE:connection.url.searchParams.get('sslmode')||'prefer',
    PGCONNECT_TIMEOUT:'20',PGAPPNAME:'llantera-reviewed-schema-proof',PGOPTIONS:'-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=120000'});
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(privateRoot,'postgres-tools-17.11-4','bin','pg_dump.exe'),['--schema-only',`--snapshot=${snapshot}`],
      {cwd:root,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});const output=[];
    child.stdout.on('data',bytes=>output.push(bytes));child.stderr.resume();child.on('error',()=>reject(new Error('NATIVE_SCHEMA_EXECUTION_FAILED')));
    child.on('close',code=>code===0?resolve(Buffer.concat(output).toString('utf8')):reject(new Error('NATIVE_SCHEMA_VERIFICATION_FAILED')));
  });
}
export async function readBackup(directory,{fresh=true}={}){
  directory=privatePath(directory);const manifestBytes=await fs.readFile(path.join(directory,'backup-manifest.json'));
  const manifest=JSON.parse(manifestBytes), proofBytes=await fs.readFile(path.join(directory,'restoration-verification.json'));
  const proof=JSON.parse(proofBytes);if(fresh)assertFresh(manifest.createdAt);
  for(const flag of ['verified','fullNativeArchive','rowsIdentical','schemaEquivalent','ownersAndAclIdentical','sequencesIdentical','largeObjectsIdentical'])assert.equal(proof[flag],true,'FULL_VERIFIED_RESTORATION_REQUIRED');
  assert.equal(proof.backupSha256,manifest.dump.sha256,'RESTORATION_DUMP_HASH_MISMATCH');
  const files={};for(const entry of [manifest.dump,manifest.schema,manifest.rowSnapshot]){
    assert.equal(path.basename(entry.file),entry.file,'BACKUP_FILENAME_INVALID');const bytes=await fs.readFile(path.join(directory,entry.file));
    assert.equal(sha256(bytes),entry.sha256,'BACKUP_FILE_HASH_MISMATCH');if(entry.bytes!==undefined)assert.equal(bytes.length,entry.bytes,'BACKUP_FILE_SIZE_MISMATCH');files[entry.file]=bytes;
  }
  const state=JSON.parse(files[manifest.rowSnapshot.file]);assert.equal(state.identity.database,proof.sourceDatabase,'RESTORATION_SOURCE_MISMATCH');
  assert.equal(state.identity.database,manifest.database,'BACKUP_MANIFEST_DATABASE_MISMATCH');
  return {directory,manifest,proof,state,schema:files[manifest.schema.file].toString('utf8'),
    fingerprints:{manifest:sha256(manifestBytes),proof:sha256(proofBytes),dump:manifest.dump.sha256,schema:manifest.schema.sha256,state:manifest.rowSnapshot.sha256}};
}
export async function captureAndCompare(client,connection,backup){
  const state=await databaseState(client);compareStates(backup.state,state);
  assert.equal(state.identity.database,backup.state.identity.database,'BACKUP_DATABASE_MISMATCH');
  const schema=await nativeSchema(client,connection);assert.equal(normalizeSchema(schema),normalizeSchema(backup.schema),'LIVE_SCHEMA_CHANGED_SINCE_BACKUP');
  const columns=(await client.query(`SELECT n.nspname AS schema,c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p')
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`)).rows;
  return {state,schema,columns};
}
export function toSnapshot(label,capture){return {label,identity:capture.state.identity,metadata:{columns:capture.columns,nativeSchemaSql:capture.schema,
  nativeMetadata:Object.fromEntries(Object.entries(capture.state).filter(([key])=>key!=='tables'))},
  sequenceStates:capture.state.sequenceStates,tables:Object.fromEntries(Object.entries(capture.state.tables).map(([name,value])=>[name,value.rows]))};}
export async function writeSnapshots(directory,source,published){
  const snapshots=[];for(const [label,capture]of [['target',source],['published',published]]){
    const snapshot=toSnapshot(label,capture),bytes=Buffer.from(JSON.stringify(snapshot,null,2)+'\n'),file=label+'-snapshot.json';
    await fs.writeFile(path.join(directory,file),bytes,{flag:'wx'});snapshots.push({label,file,bytes:bytes.length,sha256:sha256(bytes),rowHashes:Object.fromEntries(Object.entries(snapshot.tables).map(([name,rows])=>[name,rowsHash(rows)]))});
  }
  await save(path.join(directory,'manifest.json'),{createdAt:new Date().toISOString(),snapshots});
}
export async function lockStateTables(client,state){
  const names=state.relations.filter(r=>['r','p'].includes(r.relkind)).map(r=>qi(r.schema)+'.'+qi(r.name)).sort();
  assert.ok(names.length,'TABLES_REQUIRED_FOR_LOCK');await client.query('LOCK TABLE '+names.join(',')+' IN SHARE ROW EXCLUSIVE MODE');
}
export async function assertNoOtherClients(client){
  const count=(await client.query(`SELECT count(*)::integer AS n FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`)).rows[0].n;
  assert.equal(count,0,'OTHER_DATABASE_CONNECTIONS_MUST_BE_STOPPED');
}
export async function readSupplement(manifestFile){
  const manifestPath=privatePath(manifestFile),bytes=await fs.readFile(manifestPath),manifest=JSON.parse(bytes);
  assert.equal(manifest.reviewed,true,'SUPPLEMENT_REVIEW_REQUIRED');assert.equal(manifest.resolution,'archive-only-authenticated','SUPPLEMENT_SCOPE_MISMATCH');
  assert.equal(manifest.source,'puntodeventa-running-source','SUPPLEMENT_SOURCE_MISMATCH');
  const names=['data/inventario.json','data/productos.json','data/servicios.json','data/sistema-inventario.json','data/sistema-ventas.json','data/ventas.json'];
  assert.deepEqual(manifest.files.map(f=>f.name).sort(),names.sort(),'ALL_SIX_AUTHENTIC_JSON_FILES_REQUIRED');
  const entries=[];for(const file of manifest.files){const content=await fs.readFile(privatePath(file.path));
    assert.equal(content.length,file.bytes,'SUPPLEMENT_SIZE_MISMATCH');assert.equal(sha256(content),file.sha256,'SUPPLEMENT_HASH_MISMATCH');JSON.parse(content);
    entries.push({name:file.name,content,sha256:file.sha256,bytes:file.bytes,source:manifest.source});
  }
  entries.push({name:'supplement-manifest.json',content:bytes,sha256:sha256(bytes),bytes:bytes.length,source:manifest.source});
  return {manifestFile:manifestPath,sha256:sha256(bytes),entries};
}
export async function storeSupplement(client,supplement){
  await client.query(`CREATE TABLE migration_new_tires.supplemental_files(name text PRIMARY KEY,content bytea NOT NULL,sha256 text NOT NULL,
    bytes bigint NOT NULL CHECK(bytes=octet_length(content)),source text NOT NULL)`);
  for(const e of supplement.entries)await client.query('INSERT INTO migration_new_tires.supplemental_files(name,content,sha256,bytes,source) VALUES($1,$2,$3,$4,$5)',[e.name,e.content,e.sha256,e.bytes,e.source]);
}
export async function verifySupplement(client,supplement){
  const rows=(await client.query('SELECT name,content,sha256,bytes::text,source FROM migration_new_tires.supplemental_files ORDER BY name')).rows;
  assert.equal(rows.length,supplement.entries.length,'SUPPLEMENT_FILE_COUNT_MISMATCH');
  for(const e of supplement.entries){const row=rows.find(r=>r.name===e.name);assert.ok(row,'SUPPLEMENT_FILE_MISSING');assert.ok(row.content.equals(e.content),'SUPPLEMENT_BYTES_CHANGED');
    assert.equal(row.sha256,e.sha256);assert.equal(row.bytes,String(e.bytes));assert.equal(row.source,e.source);}
  return {files:rows.length,allBytesExact:true};
}
// Exactly one COMMIT attempt. A transport error cannot establish whether the server committed.
export async function commitOnce(client){
  try{await client.query('COMMIT');return{committed:true,commitAttempted:true,commitOutcome:'confirmed'};}
  catch(error){const wrapped=new Error('COMMIT_OUTCOME_UNKNOWN_USE_STATUS');wrapped.commitState={committed:false,commitAttempted:true,commitOutcome:'unknown'};wrapped.cause=error;throw wrapped;}
}
export function assertBatchAbsent(schemaExists){assert.equal(schemaExists,false,'MIGRATION_SCHEMA_ALREADY_PRESENT_USE_STATUS_DO_NOT_REAPPLY');}

export async function probeBatch(client,{batchId,planHash}){
  const acquired=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[lockKey])).rows[0].acquired;
  if(!acquired)return{outcome:'still_in_progress_or_unknown',retryAllowed:false};
  const exists=(await client.query("SELECT to_regclass('migration_new_tires.production_manifest') IS NOT NULL AS present")).rows[0].present;
  if(!exists)return{outcome:'not_committed',retryAllowed:false};
  const rows=(await client.query('SELECT batch_id::text,plan_sha256 FROM migration_new_tires.production_manifest')).rows;
  assert.deepEqual(rows,[{batch_id:batchId,plan_sha256:planHash}],'DIFFERENT_MIGRATION_BATCH_PRESENT');
  return{outcome:'committed',retryAllowed:false};
}
