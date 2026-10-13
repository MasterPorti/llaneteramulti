import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { databaseState, compareStates } from '../migration/published-backup-restore.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const privateRoot = path.join(root, '.migration-backups');
const labels = ['negra', 'blanca'];
const hash = value => createHash('sha256').update(value).digest('hex');
const qi = value => '"' + value.replaceAll('"', '""') + '"';
const schemaFilter = "n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'";
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };

export function validateCaptureConnection(configuration, label, mode) {
  check(labels.includes(label), 'UNKNOWN_SOURCE_LABEL');
  check(configuration && typeof configuration === 'object' && !Array.isArray(configuration), 'EXPLICIT_CONNECTION_JSON_REQUIRED');
  check(Object.keys(configuration).every(key => ['host','port','database','user','password','ssl'].includes(key)), 'UNREVIEWED_CONNECTION_OPTION');
  check(typeof configuration.user === 'string' && !!configuration.user && typeof configuration.password === 'string' && !!configuration.password, 'EXPLICIT_CREDENTIALS_REQUIRED');
  // Avoid silently weakening native libpq certificate verification versus node-pg.
  check(configuration.ssl === false || configuration.ssl === true, 'NATIVE_TLS_CONFIGURATION_REQUIRES_REVIEW');
  if (mode === 'production') {
    check(configuration.host === '72.62.83.230' && configuration.port === (label === 'negra' ? 7453 : 12458) && configuration.database === 'postgres', 'PRODUCTION_ENDPOINT_MISMATCH');
  } else {
    check(mode === 'local-test' && configuration.host === '127.0.0.1' && configuration.port === 55439
      && configuration.database === `llantas_source_${label}` && configuration.ssl === false, 'LOCAL_TEST_SOURCE_CLONE_REQUIRED');
  }
  return configuration;
}

export function validateCaptureOutput(directory) {
  const absolute = path.resolve(directory);
  const relative = path.relative(privateRoot, absolute);
  check(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'IGNORED_PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  return absolute;
}

export async function captureIdentity(client, configuration) {
  const row = (await client.query(`SELECT current_database() AS database,d.oid::text AS "databaseOid",
    pg_get_userbyid(d.datdba) AS owner,session_user AS "sessionUser",
    (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
    current_setting('transaction_read_only') AS "readOnly",current_setting('server_version') AS version
    FROM pg_database d WHERE d.datname=current_database()`)).rows[0];
  check(row?.database === configuration.database && row.readOnly === 'on', 'READ_ONLY_DATABASE_IDENTITY_MISMATCH');
  check(/^[0-9]{10,25}$/.test(row.systemIdentifier), 'SYSTEM_IDENTIFIER_REQUIRED');
  return { host:configuration.host,port:configuration.port,...row };
}

export async function observeClients(client) {
  const active = (await client.query(`SELECT count(*)::integer AS count FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`)).rows[0].count;
  const prepared = (await client.query('SELECT count(*)::integer AS count FROM pg_prepared_xacts WHERE database=current_database()')).rows[0].count;
  check(active === 0, 'OTHER_DATABASE_CLIENTS_MUST_BE_STOPPED');
  check(prepared === 0, 'PREPARED_TRANSACTIONS_REQUIRE_RECONCILIATION');
  return {observedAt:new Date().toISOString(),otherClientBackends:active,preparedTransactions:prepared};
}

export async function schemaInventory(client, label, identity) {
  const tables=(await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,pg_total_relation_size(c.oid)::text AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${schemaFilter} AND c.relkind IN ('r','p') ORDER BY 1,2`)).rows;
  for(const table of tables) table.count=(await client.query(`SELECT count(*)::text AS count FROM ${qi(table.schema)}.${qi(table.name)}`)).rows[0].count;
  const statements={
    columns:`SELECT n.nspname AS schema,c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE ${schemaFilter} AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`,
    constraints:`SELECT n.nspname AS schema,c.relname AS table_name,k.conname AS name,k.contype AS type,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${schemaFilter} ORDER BY 1,2,3`,
    triggers:`SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${schemaFilter} AND NOT t.tgisinternal ORDER BY 1,2,3`,
    sequences:`SELECT schemaname,sequencename,data_type::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,last_value::text FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' ORDER BY 1,2`,
    indexes:`SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_%' ORDER BY 1,2,3`,
    functions:`SELECT n.nspname AS schema,p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${schemaFilter} AND p.prokind IN ('f','p') ORDER BY 1,2`,
    foreignTables:`SELECT n.nspname AS schema,c.relname AS table_name FROM pg_foreign_table f JOIN pg_class c ON c.oid=f.ftrelid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY 1,2`,
    extensions:'SELECT extname,extversion FROM pg_extension ORDER BY extname',
  };
  const inventory={label,endpoint:{host:identity.host,port:identity.port,database:identity.database},identity,tables};
  for(const [key,sql] of Object.entries(statements)) inventory[key]=(await client.query(sql)).rows;
  check(inventory.foreignTables.length === 0,'FOREIGN_TABLE_BACKUP_REQUIRES_REVIEW');
  return inventory;
}

export function stateEvidence(state) {
  return {
    rowTables:Object.fromEntries(Object.entries(state.tables).map(([name,table])=>[name,{count:table.count,sha256:table.sha256}])),
    sequenceStatesSha256:hash(JSON.stringify(state.sequenceStates)),
    largeObjects:{count:state.largeObjects.length,pages:state.largeObjectData.length,
      bytes:state.largeObjectData.reduce((sum,page)=>sum+page.data.length/2,0),
      metadataSha256:hash(JSON.stringify(state.largeObjects)),dataSha256:hash(JSON.stringify(state.largeObjectData))},
    permissionsSha256:hash(JSON.stringify({identity:state.identity,relations:state.relations,schemaObjects:state.schemaObjects,databaseGrants:state.databaseGrants,roleDependencies:state.roleDependencies,databaseSettings:state.databaseSettings})),
  };
}

export function nativeEnvironment(configuration) {
  const env={...process.env};for(const key of Object.keys(env))if(/^PG/i.test(key))delete env[key];
  return {...env,PGHOST:configuration.host,PGPORT:String(configuration.port),PGDATABASE:configuration.database,PGUSER:configuration.user,PGPASSWORD:configuration.password,
    PGSSLMODE:configuration.ssl===false?'disable':'verify-full',PGCONNECT_TIMEOUT:'15',PGAPPNAME:'shared-full-capture-readonly',PGOPTIONS:'-c default_transaction_read_only=on -c timezone=UTC -c statement_timeout=120000 -c lock_timeout=5000'};
}

export async function nativeDump(pgDumpFile, configuration, snapshot, filename, schemaOnly=false) {
  check(typeof snapshot === 'string' && /^[0-9A-Fa-f-]+$/.test(snapshot), 'EXPORTED_SNAPSHOT_REQUIRED');
  // Output files are created in a fresh private directory, never a connection string argument.
  const args=[schemaOnly?'--schema-only':'--format=custom','--no-password',`--snapshot=${snapshot}`,`--file=${filename}`,'--lock-wait-timeout=5000'];
  return new Promise((resolve,reject)=>{
    const child=spawn(pgDumpFile,args,{env:nativeEnvironment(configuration),windowsHide:true,shell:false,stdio:['ignore','ignore','pipe']});
    let stderrBytes=0;child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;});
    child.once('error',()=>reject(Object.assign(new Error('NATIVE_CAPTURE_TOOL_FAILED'),{code:'NATIVE_CAPTURE_TOOL_FAILED'})));
    child.once('close',code=>code===0?resolve({exitCode:0,stderrBytes}):reject(Object.assign(new Error('NATIVE_CAPTURE_FAILED'),{code:'NATIVE_CAPTURE_FAILED'})));
  });
}

async function writeJson(filename,value) {
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await fs.writeFile(filename,bytes,{flag:'wx'});return {file:filename,bytes:bytes.length,sha256:hash(bytes)};
}

export async function captureSource({label,configuration,pgDumpFile,outputDirectory,mode,expectedIdentity}) {
  validateCaptureConnection(configuration,label,mode);
  validateCaptureOutput(outputDirectory);
  const client=new pg.Client({...configuration,connectionTimeoutMillis:15000,statement_timeout:120000,
    application_name:'shared-full-capture-readonly',options:'-c default_transaction_read_only=on -c timezone=UTC -c lock_timeout=5000'});
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity=await captureIdentity(client,configuration);
    if(expectedIdentity) for(const key of ['host','port','database','databaseOid','owner','sessionUser','systemIdentifier'])check(identity[key]===expectedIdentity[key],'PINNED_SOURCE_IDENTITY_MISMATCH');
    const beforeClients=await observeClients(client);
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const fullState=await databaseState(client);
    const schema=await schemaInventory(client,label,identity);
    const rawRows={};
    for(const table of schema.tables) {
      rawRows[`${table.schema}.${table.name}`]=(await client.query(`SELECT row_to_json(t)::text AS raw FROM ${qi(table.schema)}.${qi(table.name)} t`)).rows.map(row=>row.raw).sort();
    }
    const prefix=name=>path.join(outputDirectory,`${label}-${name}`);
    const stateFile=await writeJson(prefix('full-state.json'),fullState);
    const schemaFile=await writeJson(prefix('schema.json'),schema);
    const rowsFile=await writeJson(prefix('rows.json'),rawRows);
    const dumpFile=path.join(outputDirectory,`${label}.dump`),nativeSchemaFile=prefix('native-schema.sql');
    const commands=await Promise.all([
      nativeDump(pgDumpFile,configuration,snapshot,dumpFile),nativeDump(pgDumpFile,configuration,snapshot,nativeSchemaFile,true),
    ]);
    // Sequences are not MVCC snapshots. Require stable state across both native
    // dumps as well as no other clients; a sustained external fence is still required.
    const afterState=await databaseState(client);compareStates(fullState,afterState);
    const afterClients=await observeClients(client);
    const dumpBytes=await fs.readFile(dumpFile),nativeSchemaBytes=await fs.readFile(nativeSchemaFile);
    check(dumpBytes.subarray(0,5).toString()==='PGDMP','NATIVE_ARCHIVE_REQUIRED');
    const manifest={version:1,source:label,createdAt:new Date().toISOString(),identity,
      dump:{file:dumpFile,bytes:dumpBytes.length,sha256:hash(dumpBytes),rowsFile:rowsFile.file,
        rowHashes:Object.fromEntries(Object.entries(rawRows).map(([table,rows])=>[table,{count:rows.length,sha256:hash(JSON.stringify(rows))}]))},
      fullState:stateFile,sourceStateSha256:stateFile.sha256,sourceSchema:schemaFile,sourceRows:rowsFile,
      nativeSchema:{file:nativeSchemaFile,bytes:nativeSchemaBytes.length,sha256:hash(nativeSchemaBytes)},
      consistency:{isolation:'repeatable read',readOnly:true,exportedSnapshot:snapshot,nativeCommandsUseExportedSnapshot:true,
        sequenceStatesStable:true,fullStateStable:true,beforeClients,afterClients},
      stateEvidence:stateEvidence(fullState),nativeCommands:commands,
      restorationVerified:false,productionCutoverReady:false,
      limitations:['This captures data and schema only. It does not restore a database or assert that a restore has succeeded.',
        'Sequence values are nontransactional: they were compared before and after native dumps. A sustained external fence and stopped writers are required through capture and cutover; zero observed clients is not proof of that fence.',
        'PostgreSQL role attributes and database permissions are captured without role password hashes. pg_dump does not back up cluster role definitions, role passwords or server configuration.']};
    await client.query('ROLLBACK');
    await writeJson(prefix('backup-manifest.json'),manifest);
    return {source:label,identity,sourceStateSha256:manifest.sourceStateSha256,backupSha256:manifest.dump.sha256,tables:schema.tables.length,restorationVerified:false};
  } finally {await client.query('ROLLBACK').catch(()=>{});await client.end();}
}

export async function capture(configFile) {
  const configPath=path.resolve(configFile),config=JSON.parse(await fs.readFile(configPath,'utf8'));
  check(config.version===1&&['production','local-test'].includes(config.mode),'EXPLICIT_CAPTURE_MODE_REQUIRED');
  const resolve=value=>{check(typeof value==='string'&&value.length>0,'EXPLICIT_PRIVATE_PATH_REQUIRED');return path.resolve(path.dirname(configPath),value);};
  const outputDirectory=validateCaptureOutput(resolve(config.outputDirectory));
  const pgDumpFile=resolve(config.pgDumpFile);check(/^pg_dump(?:\.exe)?$/i.test(path.basename(pgDumpFile)),'PG_DUMP_EXECUTABLE_REQUIRED');
  const pgDumpSha256=hash(await fs.readFile(pgDumpFile));
  if(config.pgDumpSha256)check(pgDumpSha256===config.pgDumpSha256,'PINNED_PG_DUMP_BINARY_MISMATCH');
  const sources=[];
  for(const label of labels) {
    const source=config.sources?.[label];check(source,'BOTH_EXPLICIT_SOURCES_REQUIRED');
    const configuration=validateCaptureConnection(JSON.parse(await fs.readFile(resolve(source.connectionFile),'utf8')),label,config.mode);
    if(config.mode==='production')check(source.expectedIdentity&&/^[0-9]{10,25}$/.test(source.expectedIdentity.systemIdentifier??''),'PINNED_PRODUCTION_IDENTITY_REQUIRED');
    sources.push({label,configuration,expectedIdentity:source.expectedIdentity,mode:config.mode,pgDumpFile,outputDirectory});
  }
  await fs.mkdir(privateRoot,{recursive:true});
  await fs.mkdir(outputDirectory,{recursive:false});
  const results=[];
  try {
    // Independent clusters cannot share one snapshot. Each source is internally
    // consistent, and the external writer fence must span both captures.
    for(const source of sources)results.push(await captureSource(source));
    await writeJson(path.join(outputDirectory,'capture-summary.json'),{version:1,createdAt:new Date().toISOString(),mode:config.mode,pgDumpSha256,results,databaseWrites:false,restorationVerified:false});
  } catch(error) {
    await writeJson(path.join(outputDirectory,'capture-failure.json'),{code:error.code||'CAPTURE_VERIFICATION_FAILED',completedSources:results.map(result=>result.source),restorationVerified:false}).catch(()=>{});
    throw error;
  }
  return {directory:outputDirectory,sources:results.map(({source,tables,restorationVerified})=>({source,tables,restorationVerified})),databaseWrites:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==4||process.argv[2]!=='--config-file') {
    console.error('Usage: node scripts/shared-database/capture.mjs --config-file <private-json>');process.exitCode=1;
  } else capture(process.argv[3]).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({error:error.code||'CAPTURE_VERIFICATION_FAILED',databaseWrites:false}));process.exitCode=1;
  });
}
