import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

// Full native dump of the published database; restore only into a newly created,
// randomly named database. Never replace an existing database or change app env.
const root = fileURLToPath(new URL('../../', import.meta.url));
const backupRoot = path.join(root, '.migration-backups');
const toolsRoot = path.join(backupRoot, 'postgres-tools-17.11-4', 'bin');
const qi = (s) => '"' + s.replaceAll('"', '""') + '"';
const ql = (s) => "'" + s.replaceAll("'", "''") + "'";
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rowsHash = (rows) => hash(JSON.stringify([...rows].sort()));
const nonSystem = "n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'";
let outputDirectory;
let createdDatabase;

async function save(name, value) {
  await fs.writeFile(path.join(outputDirectory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function pgEnvironment(url, readOnly = true) {
  const result = { ...process.env };
  for (const key of Object.keys(result)) if (key.startsWith('PG')) delete result[key];
  return { ...result, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
    PGCONNECT_TIMEOUT: '20', PGAPPNAME: 'published-full-backup-isolated-restore',
    PGOPTIONS: `-c timezone=UTC -c statement_timeout=120000${readOnly ? ' -c default_transaction_read_only=on' : ''}` };
}

async function command(executable, args, url, logName, readOnly = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(toolsRoot, executable + '.exe'), args, {
      cwd: root, env: url ? pgEnvironment(url, readOnly) : process.env,
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', async (code) => {
      try {
        const out = Buffer.concat(stdout).toString('utf8');
        const err = Buffer.concat(stderr).toString('utf8');
        if (logName) await save(logName, { executable, exitCode: code, stdout: out, stderr: err });
        if (code !== 0) return reject(new Error(`${executable.toUpperCase()}_FAILED_${code}`));
        resolve({ stdout: out, stderr: err });
      } catch (error) { reject(error); }
    });
  });
}

async function connect(url, readOnly = true) {
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 20000,
    statement_timeout: 120000, application_name: 'published-full-backup-isolated-restore',
    options: `-c timezone=UTC${readOnly ? ' -c default_transaction_read_only=on' : ''}` });
  await client.connect();
  const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
  assert.equal(actual, decodeURIComponent(url.pathname.slice(1)), 'WRONG_DATABASE');
  return client;
}

export async function databaseState(client) {
  const identity = (await client.query(`SELECT d.datname AS database, pg_encoding_to_char(d.encoding) AS encoding,
    d.datcollate, d.datctype, d.datlocprovider, to_jsonb(d)->>'datlocale' AS locale,
    pg_get_userbyid(d.datdba) AS owner, d.datacl::text AS acl,
    current_setting('server_version') AS version, current_setting('transaction_read_only') AS read_only
    FROM pg_database d WHERE d.datname=current_database()`)).rows[0];
  const relations = (await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind,
    c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text AS acl,
    pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE ${nonSystem} AND c.relkind IN ('r','p','m','f','S','v') ORDER BY 1,2`)).rows;
  assert.ok(relations.every((r) => r.relkind !== 'f'), 'FOREIGN_TABLE_DATA_NEEDS_SEPARATE_SCOPE');
  const tables = {};
  const sequenceStates = {};
  for (const relation of relations) {
    const key = `${relation.schema}.${relation.name}`;
    const qualified = `${qi(relation.schema)}.${qi(relation.name)}`;
    if (['r','p','m'].includes(relation.relkind)) {
      const rows = (await client.query(`SELECT to_jsonb(t)::text AS row FROM ONLY ${qualified} t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map((r) => r.row);
      tables[key] = { count: rows.length, sha256: rowsHash(rows), rows };
    } else if (relation.relkind === 'S') {
      sequenceStates[key] = (await client.query(`SELECT last_value::text,is_called FROM ${qualified}`)).rows[0];
    }
  }
  const largeObjects = (await client.query('SELECT oid::text AS oid,lomowner::regrole::text AS owner,lomacl::text AS acl FROM pg_largeobject_metadata ORDER BY oid')).rows;
  const largeObjectData = (await client.query("SELECT loid::text,pageno,encode(data,'hex') AS data FROM pg_largeobject ORDER BY loid,pageno")).rows;
  const extensions = (await client.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
  const subscriptions = (await client.query('SELECT subname FROM pg_subscription WHERE subdbid=(SELECT oid FROM pg_database WHERE datname=current_database()) ORDER BY subname')).rows;
  assert.equal(subscriptions.length, 0, 'SUBSCRIPTIONS_REQUIRE_RESTORE_SIDE_EFFECT_REVIEW');
  const databaseSettings = (await client.query(`SELECT CASE WHEN s.setrole=0 THEN NULL ELSE pg_get_userbyid(s.setrole) END AS role,s.setconfig
    FROM pg_db_role_setting s WHERE s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) ORDER BY role NULLS FIRST`)).rows;
  const databaseGrants = (await client.query(`SELECT a.position::int,pg_get_userbyid(g.grantor) AS grantor,
    CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END AS grantee,g.privilege_type,g.is_grantable
    FROM pg_database d CROSS JOIN LATERAL unnest(d.datacl) WITH ORDINALITY a(item,position)
    CROSS JOIN LATERAL aclexplode(ARRAY[a.item]) g WHERE d.datname=current_database()
    ORDER BY a.position,g.privilege_type`)).rows;
  const schemaObjects = (await client.query(`SELECT n.nspname AS schema,pg_get_userbyid(n.nspowner) AS owner,n.nspacl::text AS acl
    FROM pg_namespace n WHERE ${nonSystem} ORDER BY n.nspname`)).rows;
  const roleDependencies = (await client.query(`SELECT DISTINCT r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls
    FROM pg_roles r WHERE r.oid IN (SELECT refobjid FROM pg_shdepend WHERE refclassid='pg_authid'::regclass
      AND dbid=(SELECT oid FROM pg_database WHERE datname=current_database())) ORDER BY r.rolname`)).rows;
  return { identity, relations, tables, sequenceStates, largeObjects, largeObjectData, extensions, databaseSettings, databaseGrants, schemaObjects, roleDependencies };
}

export const normalizeSchema = (text) => text.replace(/^\\(?:un)?restrict .*\r?\n/gm, '').replace(/^-- Dumped (?:from|by).*\r?\n/gm, '').replaceAll('\r\n', '\n')
  // PostgreSQL may distribute the varchar[] -> text[] cast while parsing a
  // restored CHECK. Canonicalize only constant varchar arrays; no other SQL is
  // ignored. Source and restored expressions accept exactly the same values.
  .replace(/ANY \(\(ARRAY\[([^\]]+)\]\)::text\[\]\)/g,(original,list)=>{
    const values=list.split(', ');
    return values.every((v)=>/^'(?:[^']|'')*'::character varying$/.test(v))
      ? `ANY (ARRAY[${values.map((v)=>`(${v})::text`).join(', ')}])` : original;
  }).trim();

function schemaComparisonDetails(source, restored) {
  const sourceChecks=source.split(/\r?\n/).filter((line)=>line.includes(' CHECK '));
  const restoredChecks=restored.split(/\r?\n/).filter((line)=>line.includes(' CHECK '));
  return { sourceRewrittenChecks:sourceChecks.filter((line)=>!restoredChecks.includes(line)),
    restoredRewrittenChecks:restoredChecks.filter((line)=>!sourceChecks.includes(line)),
    justification:'Casting a constant varchar array to text[] equals casting each identical non-null varchar element to text. Element order and every literal are retained. Other casts, NULL elements, predicates and values are not normalized.' };
}

export function compareStates(before, after) {
  assert.deepEqual(after.relations, before.relations, 'RELATIONS_OR_PERMISSIONS_DIFFER');
  assert.deepEqual(Object.keys(after.tables), Object.keys(before.tables), 'TABLE_SET_DIFFERS');
  for (const [name, table] of Object.entries(before.tables)) {
    assert.equal(after.tables[name].count, table.count, `ROW_COUNT_DIFFERS_${name}`);
    assert.equal(after.tables[name].sha256, table.sha256, `ROW_CONTENT_DIFFERS_${name}`);
  }
  for (const key of ['sequenceStates','largeObjects','largeObjectData','extensions','databaseSettings','schemaObjects','roleDependencies']) {
    assert.deepEqual(after[key], before[key], `${key.toUpperCase()}_DIFFERS`);
  }
  if(before.databaseGrants) assert.deepEqual(after.databaseGrants,before.databaseGrants,'DATABASE_GRANTS_DIFFER');
  for (const key of ['encoding','datcollate','datctype','datlocprovider','locale','owner','acl']) {
    assert.equal(after.identity[key], before.identity[key], `DATABASE_PROPERTY_DIFFERS_${key}`);
  }
}

async function verifyExisting(directory) {
  outputDirectory=path.resolve(root,directory);
  assert.ok(outputDirectory.startsWith(backupRoot+path.sep),'PRIVATE_BACKUP_DIRECTORY_REQUIRED');
  const manifest=JSON.parse(await fs.readFile(path.join(outputDirectory,'backup-manifest.json'),'utf8'));
  const beforeBytes=await fs.readFile(path.join(outputDirectory,'source-snapshot.json'));
  assert.equal(hash(beforeBytes),manifest.rowSnapshot.sha256,'SOURCE_SNAPSHOT_HASH_MISMATCH');
  assert.equal(hash(await fs.readFile(path.join(outputDirectory,'published.dump'))),manifest.dump.sha256,'NATIVE_DUMP_HASH_MISMATCH');
  const before=JSON.parse(beforeBytes);
  const expected=JSON.parse(await fs.readFile(path.join(outputDirectory,'temporary-database.json'),'utf8'));
  assert.match(expected.database,/^llantera_(?:oldtarget_)?restore_[a-f0-9]{24}$/);
  const env=dotenv.parse(await fs.readFile(path.join(outputDirectory,'restore.env')));
  const url=new URL(env.DATABASE_URL);
  assert.equal(decodeURIComponent(url.pathname.slice(1)),expected.database,'RESTORE_DATABASE_NAME_MISMATCH');
  const client=await connect(url);
  try {
    const identity=(await client.query('SELECT oid::text,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()')).rows[0];
    assert.equal(identity.oid,expected.oid,'RESTORE_DATABASE_OID_MISMATCH');
    assert.equal(identity.owner,expected.owner,'RESTORE_DATABASE_OWNER_MISMATCH');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const after=await databaseState(client); compareStates(before,after);
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const filename=`restored-schema-recheck-${Date.now()}.sql`;
    await command('pg_dump',['--schema-only',`--snapshot=${snapshot}`,`--file=${path.join(outputDirectory,filename)}`],url,`schema-recheck-log-${Date.now()}.json`);
    const sourceSchema=await fs.readFile(path.join(outputDirectory,'source-schema.sql'),'utf8');
    assert.equal(hash(sourceSchema),manifest.schema.sha256,'SOURCE_SCHEMA_HASH_MISMATCH');
    const restoredSchema=await fs.readFile(path.join(outputDirectory,filename),'utf8');
    assert.equal(normalizeSchema(restoredSchema),normalizeSchema(sourceSchema),'RESTORED_SCHEMA_DIFFERS');
    await client.query('ROLLBACK');
    const report={verified:true,completedAt:new Date().toISOString(),sourceDatabase:before.identity.database,
      restoredDatabase:expected.database,temporaryIdentity:identity,fullNativeArchive:true,rowsIdentical:true,
      schemaEquivalent:true,schemaNormalization:'Only pg_dump random restrict tokens, version comments, and equivalent varchar-array text casts',
      schemaComparison: schemaComparisonDetails(sourceSchema,restoredSchema),
      ownersAndAclIdentical:true,sequencesIdentical:true,largeObjectsIdentical:true,
      rowCounts:Object.fromEntries(Object.entries(before.tables).map(([name,t])=>[name,t.count])),
      backupSha256:manifest.dump.sha256,restoreEnv:path.join(outputDirectory,'restore.env'),
      productionBusinessDataModified:false,productionSchemaModified:false};
    await save('restoration-verification.json',report);
    console.log(JSON.stringify({...report,directory:outputDirectory},null,2));
  } finally { await client.query('ROLLBACK').catch(()=>{});await client.end(); }
}

async function main() {
  if(process.argv[2]==='--verify') return verifyExisting(process.argv[3]);
  if (process.argv[2] !== '--run') {
    console.log('Uso: node scripts/migration/published-backup-restore.mjs --run [published|oldtarget] | --verify <backup>'); return;
  }
  const mode=process.argv[3]||'published';
  assert.ok(['published','oldtarget'].includes(mode),'UNKNOWN_DATABASE_SCOPE');
  let sourceUrl;
  if(mode==='published') {
    const env = dotenv.parse(await fs.readFile(path.join(root, '.env.auditoria-publicada.local')));
    sourceUrl = new URL(env.DATABASE_URL);
    assert.equal(decodeURIComponent(sourceUrl.pathname.slice(1)), 'postgres', 'PUBLISHED_DATABASE_MUST_BE_POSTGRES');
  } else {
    const app=dotenv.parse(await fs.readFile(path.join(root,'.env.local')));
    const currentUrl=new URL(app.DATABASE_URL);
    assert.equal(decodeURIComponent(currentUrl.pathname.slice(1)),'llaneteramulti_new_tires','OLDTARGET_APP_CONNECTION_MISMATCH');
    const sourceEnv={};
    for(const filename of ['.env','.env.development','.env.local','.env.development.local']) {
      try {Object.assign(sourceEnv,dotenv.parse(await fs.readFile(path.join(root,'../sistemaBodega',filename))));}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    sourceUrl=new URL(sourceEnv.DATABASE_URL);
    assert.equal(sourceUrl.host,currentUrl.host,'OLDTARGET_SERVER_MISMATCH');
    assert.notEqual(decodeURIComponent(sourceUrl.pathname.slice(1)),'llaneteramulti_new_tires','ADMIN_SOURCE_EXPECTATION_MISMATCH');
    sourceUrl.pathname='/llaneteramulti_new_tires';
  }
  assert.ok(['postgres:','postgresql:'].includes(sourceUrl.protocol), 'POSTGRES_CONNECTION_REQUIRED');
  const token = randomBytes(12).toString('hex');
  const database = `llantera_${mode==='oldtarget'?'oldtarget_':''}restore_${token}`;
  assert.match(database, /^llantera_(?:oldtarget_)?restore_[a-f0-9]{24}$/);
  outputDirectory = path.join(backupRoot, `${mode}-full-${new Date().toISOString().replaceAll(':','-')}-${token.slice(0,8)}`);
  await fs.mkdir(outputDirectory, { recursive: false });
  const version = (await command('pg_dump',['--version'])).stdout.trim();
  assert.match(version, /PostgreSQL\) 17\.11/);
  await save('tools.json', { version, binaryArchiveSha256:'b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28',
    source:'https://get.enterprisedb.com/postgresql/postgresql-17.11-4-windows-x64-binaries.zip',
    officialChecksum:'https://github.com/EnterpriseDB/edb-installers/issues/706' });
  const source = await connect(sourceUrl);
  let admin; let restored;
  try {
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await source.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const before = await databaseState(source);
    assert.equal(before.identity.read_only, 'on');
    assert.match(before.identity.version, /^17\./);
    await save('source-snapshot.json', before);
    const dumpFile = path.join(outputDirectory,'published.dump');
    await command('pg_dump', ['--format=custom','--verbose','--lock-wait-timeout=15000',`--snapshot=${snapshot}`,`--file=${dumpFile}`], sourceUrl, 'pg-dump-log.json');
    const sourceSchemaFile = path.join(outputDirectory, 'source-schema.sql');
    await command('pg_dump', ['--schema-only',`--snapshot=${snapshot}`,`--file=${sourceSchemaFile}`], sourceUrl, 'source-schema-log.json');
    const afterDump = await databaseState(source);
    compareStates(before, afterDump);
    await source.query('ROLLBACK');
    const toc = await command('pg_restore',['--list',dumpFile]);
    await fs.writeFile(path.join(outputDirectory,'archive-toc.txt'),toc.stdout,{flag:'wx'});
    const schema = await fs.readFile(sourceSchemaFile,'utf8');
    assert.ok(!/^(?:CREATE|ALTER|DROP)\s+(?:DATABASE|ROLE|USER|TABLESPACE|SUBSCRIPTION)\b/im.test(schema), 'GLOBAL_MUTATION_IN_RESTORE_SCHEMA');
    assert.ok(!/CREATE\s+EVENT\s+TRIGGER\b/i.test(schema), 'EVENT_TRIGGER_REQUIRES_REVIEW');
    await save('backup-manifest.json', {
      createdAt:new Date().toISOString(), database:before.identity.database, snapshot,
      consistency:'pg_dump and row capture share exported REPEATABLE READ READ ONLY snapshot',
      dump:{file:'published.dump',sha256:hash(await fs.readFile(dumpFile)),bytes:(await fs.stat(dumpFile)).size},
      schema:{file:'source-schema.sql',sha256:hash(schema)},
      rowSnapshot:{file:'source-snapshot.json',sha256:hash(await fs.readFile(path.join(outputDirectory,'source-snapshot.json')))},
      tables:Object.fromEntries(Object.entries(before.tables).map(([name,t])=>[name,{count:t.count,sha256:t.sha256}])),
      notes:['Full logical database archive, no schema/table/data filters; owner and ACL entries included.',
        'Global roles and tablespaces are cluster objects; existing same-server roles are recorded without password hashes.',
        'Credentials are stored separately in ignored restore.env for the temporary database.'] });
    console.log(JSON.stringify({phase:'complete_backup_saved',directory:outputDirectory,tables:Object.keys(before.tables).length}));
    admin = await connect(sourceUrl, false);
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0,'TEMPORARY_DATABASE_ALREADY_EXISTS');
    const i = before.identity;
    let localeOptions = `ENCODING ${ql(i.encoding)} LC_COLLATE ${ql(i.datcollate)} LC_CTYPE ${ql(i.datctype)}`;
    if (i.datlocprovider === 'i') localeOptions += ` LOCALE_PROVIDER icu ICU_LOCALE ${ql(i.locale)}`;
    else if (i.datlocprovider === 'c') localeOptions += ' LOCALE_PROVIDER libc';
    else throw new Error('UNREVIEWED_LOCALE_PROVIDER');
    await admin.query(`CREATE DATABASE ${qi(database)} WITH TEMPLATE template0 OWNER ${qi(i.owner)} ${localeOptions}`);
    createdDatabase = database;
    const databaseIdentity = (await admin.query('SELECT oid::text,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',[database])).rows[0];
    await save('temporary-database.json',{database,...databaseIdentity,createdAt:new Date().toISOString(),purpose:'published full backup restoration and migration rehearsal',doNotUseForProduction:true});
    const restoreUrl = new URL(sourceUrl); restoreUrl.pathname='/'+database;
    restoreUrl.searchParams.delete('options');
    await fs.writeFile(path.join(outputDirectory,'restore.env'),`DATABASE_URL=${JSON.stringify(restoreUrl.toString())}\nLLANTERA_EXPECTED_DATABASE=${database}\n`,{flag:'wx'});
    restored = await connect(restoreUrl, false);
    assert.equal((await restored.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${nonSystem} AND c.relkind IN ('r','p','m','f','S','v')`)).rows[0].count,0,'TEMPORARY_DATABASE_NOT_EMPTY');
    await command('pg_restore',['--exit-on-error','--single-transaction','--verbose','--dbname='+database,dumpFile],restoreUrl,'pg-restore-log.json',false);
    if(before.identity.acl!==null) {
      await admin.query('BEGIN');
      try {
        await admin.query(`REVOKE ALL ON DATABASE ${qi(database)} FROM PUBLIC`);
        await admin.query(`REVOKE ALL ON DATABASE ${qi(database)} FROM ${qi(before.identity.owner)}`);
        for(const grant of before.databaseGrants) {
          assert.ok(['CREATE','CONNECT','TEMPORARY'].includes(grant.privilege_type),'UNEXPECTED_DATABASE_PRIVILEGE');
          await admin.query(`SET LOCAL ROLE ${qi(grant.grantor)}`);
          await admin.query(`GRANT ${grant.privilege_type} ON DATABASE ${qi(database)} TO ${grant.grantee==='PUBLIC'?'PUBLIC':qi(grant.grantee)}${grant.is_grantable?' WITH GRANT OPTION':''}`);
          await admin.query('RESET ROLE');
        }
        await admin.query('COMMIT');
      } catch(error) { await admin.query('ROLLBACK');throw error; }
    }
    // Database settings are not applied by pg_restore without --create, since
    // that switch would target the original database name. Apply only settings
    // scoped to our new, verified temporary database.
    for (const setting of before.databaseSettings) for (const entry of setting.setconfig) {
      const separator=entry.indexOf('='); assert.ok(separator>0,'INVALID_DATABASE_SETTING');
      const name=entry.slice(0,separator); const value=entry.slice(separator+1);
      assert.match(name,/^[a-zA-Z0-9_.]+$/);
      await admin.query(`${setting.role ? `ALTER ROLE ${qi(setting.role)} IN` : 'ALTER'} DATABASE ${qi(database)} SET ${qi(name)} TO ${ql(value)}`);
    }
    await restored.end(); restored = await connect(restoreUrl);
    await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const after = await databaseState(restored);
    compareStates(before,after);
    await save('restored-snapshot.json',after);
    const restoredSchemaFile=path.join(outputDirectory,'restored-schema.sql');
    await command('pg_dump',['--schema-only',`--file=${restoredSchemaFile}`],restoreUrl,'restored-schema-log.json');
    const restoredSchema=await fs.readFile(restoredSchemaFile,'utf8');
    assert.equal(normalizeSchema(restoredSchema),normalizeSchema(schema),'RESTORED_SCHEMA_DIFFERS');
    await restored.query('ROLLBACK');
    const report={verified:true,completedAt:new Date().toISOString(),sourceDatabase:before.identity.database,
      restoredDatabase:database,temporaryIdentity:databaseIdentity,fullNativeArchive:true,rowsIdentical:true,
      schemaEquivalent:true,schemaNormalization:'Only pg_dump random restrict tokens, version comments, and equivalent varchar-array text casts',ownersAndAclIdentical:true,sequencesIdentical:true,largeObjectsIdentical:true,
      schemaComparison: schemaComparisonDetails(schema,restoredSchema),
      rowCounts:Object.fromEntries(Object.entries(before.tables).map(([name,t])=>[name,t.count])),
      backupSha256:hash(await fs.readFile(dumpFile)),restoreEnv:path.join(outputDirectory,'restore.env'),
      scope:'Logical database; global server roles not recreated. Existing same-server role dependencies retained.',
      productionBusinessDataModified:false,productionSchemaModified:false};
    await save('restoration-verification.json',report);
    console.log(JSON.stringify({...report,directory:outputDirectory},null,2));
  } finally {
    await source.query('ROLLBACK').catch(()=>{}); await source.end();
    if(restored) await restored.end().catch(()=>{}); if(admin) await admin.end().catch(()=>{});
  }
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(async(error)=>{
    const safe={error:error.code||String(error.message).match(/\b[A-Z][A-Z_0-9]{5,}\b/)?.[0]||error.name,
      directory:outputDirectory,temporaryDatabase:createdDatabase,temporaryDatabaseRetained:Boolean(createdDatabase)};
    if(outputDirectory) await save(`failure-${Date.now()}.json`,{...safe,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[connection omitted]')}).catch(()=>{});
    console.error(JSON.stringify(safe));process.exitCode=1;
  });
}
