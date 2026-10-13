import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadInstallation, qualified, tableRows } from './install-core.mjs';
import { sha256, stable } from './merge-plan.mjs';
import { databaseState, compareStates, normalizeSchema } from '../migration/published-backup-restore.mjs';

export const labels = ['negra', 'blanca'];
export const maxAgeMs = 60 * 60 * 1000;
export const migrationLock = 'shared-database:production:canonical-v1';
const root = fileURLToPath(new URL('../../', import.meta.url));
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class GuardError extends Error { constructor(code) { super(code); this.code = code; } }
export function guard(condition, code) { if (!condition) throw new GuardError(code); }
export function fresh(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  guard(Number.isFinite(timestamp) && now - timestamp >= -30000 && now - timestamp <= maxAgeMs, 'FRESH_STOPPED_APPLICATION_AUDIT_REQUIRED');
}
export function validateConnection(configuration, label) {
  guard(configuration && typeof configuration === 'object' && !Array.isArray(configuration), 'EXPLICIT_CONNECTION_JSON_REQUIRED');
  const allowed = ['host', 'port', 'database', 'user', 'password', 'ssl'];
  guard(Object.keys(configuration).every(key => allowed.includes(key)), 'UNREVIEWED_CONNECTION_OPTION');
  guard(configuration.host === '72.62.83.230' && configuration.port === (label === 'negra' ? 7453 : 12458) && configuration.database === 'postgres', 'PRODUCTION_ENDPOINT_MISMATCH');
  guard(typeof configuration.user === 'string' && configuration.user.length > 0 && typeof configuration.password === 'string' && configuration.password.length > 0, 'EXPLICIT_CONNECTION_CREDENTIALS_REQUIRED');
  guard(configuration.ssl === false || configuration.ssl === true || (configuration.ssl && typeof configuration.ssl === 'object' && configuration.ssl.rejectUnauthorized === true && Object.keys(configuration.ssl).every(key => ['rejectUnauthorized', 'ca'].includes(key))), 'EXPLICIT_TLS_CONFIGURATION_REQUIRED');
  return configuration;
}
export async function readConnection(file, label) {
  guard(typeof file === 'string' && file.length > 0, 'EXPLICIT_CONNECTION_FILE_REQUIRED');
  return validateConnection(JSON.parse(await fs.readFile(path.resolve(file), 'utf8')), label);
}
export async function databaseIdentity(client, configuration) {
  const row = (await client.query(`SELECT current_database() AS database,d.oid::text AS databaseOid,
    pg_get_userbyid(d.datdba) AS owner,session_user AS "sessionUser",
    (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"
    FROM pg_database d WHERE d.datname=current_database()`)).rows[0];
  // Unquoted aliases are folded by PostgreSQL.
  return { host: configuration.host, port: configuration.port, database: row.database,
    databaseOid: row.databaseoid, owner: row.owner, sessionUser: row.sessionUser, systemIdentifier: row.systemIdentifier };
}
export function assertIdentity(actual, expected, label) {
  guard(expected && /^[0-9]{10,25}$/.test(expected.systemIdentifier ?? ''), 'PINNED_POSTGRES_SYSTEM_IDENTIFIER_REQUIRED');
  guard(expected.host === '72.62.83.230' && expected.port === (label === 'negra' ? 7453 : 12458) && expected.database === 'postgres', 'PINNED_ENDPOINT_MISMATCH');
  for (const field of ['host', 'port', 'database', 'databaseOid', 'owner', 'sessionUser', 'systemIdentifier']) {
    guard(expected[field] !== undefined && actual[field] === expected[field], 'PINNED_DATABASE_IDENTITY_MISMATCH');
  }
}
export function assertMaintenance(readiness, manifests, now = Date.now(), requireFresh = true) {
  guard(readiness?.version === 1 && readiness.fiscalMode === 'recorded-per-application', 'REVIEWED_CUTOVER_READINESS_REQUIRED');
  if (requireFresh) fresh(readiness.createdAt, now);
  guard(uuid.test(readiness.productionInstanceId ?? ''), 'NEW_PRODUCTION_INSTANCE_UUID_REQUIRED');
  guard(Array.isArray(readiness.developmentInstanceIds) && readiness.developmentInstanceIds.length > 0 && readiness.developmentInstanceIds.every(value => uuid.test(value)), 'DEVELOPMENT_IDENTITIES_REQUIRED');
  guard(!readiness.developmentInstanceIds.includes(readiness.productionInstanceId), 'PRODUCTION_MUST_NOT_REUSE_DEVELOPMENT_IDENTITY');
  const maintenance = readiness.maintenance;
  guard(maintenance && uuid.test(maintenance.windowId ?? '') && maintenance.newConnectionsFenced === true && typeof maintenance.fenceEvidence === 'string' && maintenance.fenceEvidence.trim().length > 0, 'EXTERNAL_CONNECTION_FENCE_REQUIRED');
  if (requireFresh) fresh(maintenance.startedAt, now);
  for (const label of labels) {
    const application = maintenance.applications?.[label];
    guard(application?.stopped === true && typeof application.resourceId === 'string' && application.resourceId.length > 0 && typeof application.deployedCommit === 'string' && /^[a-f0-9]{40}$/.test(application.deployedCommit), 'BOTH_DEPLOYED_WRITERS_MUST_BE_STOPPED');
    if (requireFresh) fresh(manifests[label].createdAt, now);
    guard(Date.parse(manifests[label].createdAt) >= Date.parse(maintenance.startedAt), 'BACKUP_MUST_FOLLOW_WRITER_SHUTDOWN');
  }
  guard(readiness.identities?.negra?.systemIdentifier !== readiness.identities?.blanca?.systemIdentifier, 'SOURCE_CLUSTERS_MUST_BE_DISTINCT');
}
export function assertRecordedMoney(installation) {
  const canonical = new Map(installation.plan.tables['public.ventas'].map(row => [row.id, row]));
  for (const raw of installation.black['public.ventas']) {
    const original = JSON.parse(raw), current = canonical.get(original.id);
    for (const field of ['subtotal', 'iva', 'total']) guard(current?.[field] === original[field], 'BLACK_RECORDED_TAX_MUST_REMAIN_UNCHANGED');
  }
  const originals = new Map(installation.plan.saleOriginals.filter(row => row.source_label === 'blanca' && row.sale_kind === 'ventas').map(row => [row.sale_id, JSON.parse(row.document_text).sale]));
  for (const raw of installation.white['public.ventas']) {
    const original = JSON.parse(raw), archived = originals.get(original.id);
    for (const field of ['subtotal', 'iva', 'total']) guard(archived?.[field] === original[field], 'WHITE_RECORDED_TAX_EVIDENCE_MUST_REMAIN_UNCHANGED');
  }
}
export function assertTransactionSafeSql(sql) {
  // Strip PostgreSQL bodies and literals before inspecting transaction control;
  // BEGIN inside a function or DO block is not a transaction boundary.
  let outside = '', index = 0;
  while (index < sql.length) {
    if (sql.startsWith('--', index)) { const end = sql.indexOf('\n', index); index = end < 0 ? sql.length : end; continue; }
    if (sql.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < sql.length && depth) {
        if (sql.startsWith('/*', index)) { depth++; index += 2; }
        else if (sql.startsWith('*/', index)) { depth--; index += 2; } else index++;
      }
      guard(depth === 0, 'UNTERMINATED_REVIEWED_SQL_COMMENT'); continue;
    }
    const dollar = sql.slice(index).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)?.[0];
    if (dollar) { const end = sql.indexOf(dollar, index + dollar.length); guard(end >= 0, 'UNTERMINATED_REVIEWED_SQL_BODY'); index = end + dollar.length; outside += ' '; continue; }
    if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index++]; let closed = false;
      while (index < sql.length) {
        if (sql[index++] === quote) { if (sql[index] === quote) { index++; continue; } closed = true; break; }
      }
      guard(closed, 'UNTERMINATED_REVIEWED_SQL_LITERAL'); outside += ' '; continue;
    }
    outside += sql[index++];
  }
  guard(!/\b(?:BEGIN|COMMIT|ROLLBACK|ABORT|END|SAVEPOINT|VACUUM|DISCARD)\b|\bSTART\s+TRANSACTION\b|\bPREPARE\s+TRANSACTION\b|\bALTER\s+SYSTEM\b|\b(?:CREATE|DROP)\s+DATABASE\b/i.test(outside), 'SQL_MUST_NOT_ESCAPE_SINGLE_TRANSACTION');
}
export async function readPackage(requestFile, { requireReady = true, requireFresh = true } = {}) {
  const absolute = path.resolve(requestFile), directory = path.dirname(absolute);
  const requestBytes = await fs.readFile(absolute), request = JSON.parse(requestBytes);
  guard(request.version === 1, 'SUPPORTED_EXPLICIT_REQUEST_VERSION_REQUIRED');
  const resolve = file => { guard(typeof file === 'string' && file.length > 0, 'EXPLICIT_ARTIFACT_PATH_REQUIRED'); return path.resolve(directory, file); };
  const snapshotDirectory = resolve(request.snapshotDirectory), blackWorkspace = resolve(request.blackWorkspace), whiteWorkspace = resolve(request.whiteWorkspace);
  const installation = await loadInstallation(snapshotDirectory, blackWorkspace, whiteWorkspace);
  assertRecordedMoney(installation);
  Object.values(installation.sql).forEach(assertTransactionSafeSql);
  const documents = { request: sha256(requestBytes) }, blockers = [], proofs = {}, manifests = {}, states = {};
  async function document(name, file) { const bytes = await fs.readFile(file); documents[name] = sha256(bytes); return bytes; }
  for (const label of labels) for (const suffix of ['rows.json', 'schema.json', 'native-schema.sql']) {
    await document(`${label}-${suffix}`, path.join(snapshotDirectory, `${label}-${suffix}`));
  }
  // Pin every module that can influence reconciliation or verification and all SQL.
  for (const name of ['merge-plan.mjs', 'install-core.mjs', 'production-guards.mjs', 'install-production.mjs', 'capture.mjs']) await document(name, path.join(root, 'scripts/shared-database', name));
  await document('native-state-verifier', path.join(root, 'scripts/migration/published-backup-restore.mjs'));
  for (const [name, sql] of Object.entries(installation.sql)) documents[`sql-${name}`] = sha256(sql);
  let readiness, pgDumpFile, permissionsSql;
  try {
    readiness = JSON.parse(await document('readiness', resolve(request.readinessFile)));
    for (const label of labels) {
      const manifest = manifests[label] = JSON.parse(await document(`${label}-backup-manifest`, resolve(request.backupManifestFiles?.[label])));
      const proof = proofs[label] = JSON.parse(await document(`${label}-restoration-proof`, resolve(request.restorationProofFiles?.[label])));
      const dumpFile = path.join(snapshotDirectory, label + '.dump');
      const dump = await fs.readFile(dumpFile);
      guard(dump.subarray(0, 5).toString() === 'PGDMP' && sha256(dump) === manifest.dump.sha256 && dump.length === manifest.dump.bytes, 'NATIVE_BACKUP_BYTES_CHANGED');
      documents[`${label}-dump`] = sha256(dump);
      guard(proof.version === 1 && proof.source === label && proof.backupSha256 === manifest.dump.sha256, 'RESTORATION_MUST_VERIFY_THIS_NATIVE_BACKUP');
      for (const flag of ['nativeRestoreVerified', 'rowsIdentical', 'schemaEquivalent', 'sequencesIdentical', 'largeObjectsIdentical', 'ownershipAndAclPreservedInNativeArchive']) guard(proof[flag] === true, 'FULL_NATIVE_RESTORATION_PROOF_REQUIRED');
      for (const [field, suffix] of [['sourceRowsSha256', 'rows.json'], ['sourceSchemaSha256', 'schema.json'], ['nativeSchemaSha256', 'native-schema.sql']]) guard(proof[field] === documents[`${label}-${suffix}`], 'RESTORATION_SNAPSHOT_HASH_MISMATCH');
      guard(Array.isArray(proof.limitations) && JSON.stringify(proof.limitations) === JSON.stringify(readiness.reviewedRestorationLimitations?.[label]), 'RESTORATION_LIMITATIONS_REQUIRE_EXPLICIT_REVIEW');
      guard(typeof proof.restoreDatabase === 'string' && proof.restoreDatabase !== 'postgres', 'INDEPENDENT_RESTORATION_REQUIRED');
      guard(Date.parse(proof.verifiedAt) >= Date.parse(manifest.createdAt), 'RESTORATION_PREDATES_BACKUP');
      const sourceRows = label === 'negra' ? installation.black : installation.white;
      guard(JSON.stringify(Object.keys(manifest.dump.rowHashes).sort()) === JSON.stringify(Object.keys(sourceRows).sort()), 'BACKUP_TABLE_SET_MISMATCH');
      for (const [table, rows] of Object.entries(sourceRows)) {
        guard(manifest.dump.rowHashes[table].count === rows.length && manifest.dump.rowHashes[table].sha256 === sha256(JSON.stringify(rows)), 'BACKUP_ROW_HASH_MISMATCH');
      }
      const stateBytes = await document(`${label}-full-state`, resolve(request.fullStateFiles?.[label]));
      guard(proof.sourceStateSha256 === sha256(stateBytes), 'FULL_STATE_MUST_BE_BOUND_TO_RESTORED_BACKUP');
      states[label] = JSON.parse(stateBytes);
      guard(states[label].identity.database === 'postgres', 'FULL_STATE_DATABASE_MISMATCH');
    }
    pgDumpFile = resolve(request.pgDumpFile);
    documents.pgDump = sha256(await fs.readFile(pgDumpFile));
    guard(hex.test(readiness.pgDumpSha256 ?? '') && readiness.pgDumpSha256 === documents.pgDump, 'REVIEWED_NATIVE_TOOL_REQUIRED');
    permissionsSql = (await document('existing-white-role-permissions', resolve(request.permissionsFile))).toString('utf8');
    assertTransactionSafeSql(permissionsSql);
    guard(readiness.privilegeChange?.reviewed === true && readiness.privilegeChange.role === 'llantera_multi_stock'
      && readiness.privilegeChange.sqlSha256 === documents['existing-white-role-permissions'], 'EXISTING_ROLE_PERMISSION_PAYLOAD_REQUIRES_REVIEW');
    assertMaintenance(readiness, manifests, Date.now(), requireFresh);
    for (const label of labels) assertIdentity(readiness.identities?.[label], readiness.identities?.[label], label);
  } catch (error) {
    if (requireReady) throw error;
    blockers.push(error instanceof GuardError ? error.code : 'MISSING_OR_INVALID_EXPLICIT_READINESS_ARTIFACT');
  }
  const packageSha256 = sha256(JSON.stringify(stable({ version: 1, planSha256: installation.digest, documents })));
  return { installation, request, readiness, manifests, proofs, states, documents, pgDumpFile, permissionsSql, snapshotDirectory,
    packageSha256, blockers, requestFile: absolute };
}
export async function assertNoOtherClients(client) {
  const count = (await client.query(`SELECT count(*)::integer AS n FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`)).rows[0].n;
  guard(count === 0, 'OTHER_DATABASE_CLIENTS_MUST_BE_STOPPED');
  const prepared = (await client.query('SELECT count(*)::integer AS n FROM pg_prepared_xacts WHERE database=current_database()')).rows[0].n;
  guard(prepared === 0, 'PREPARED_TRANSACTIONS_REQUIRE_RECONCILIATION');
}
export async function assertExistingRoles(client, readiness, { installed = false } = {}) {
  const roles = readiness.runtimeRoles;
  guard(roles && typeof roles.negra === 'string' && roles.blanca === 'llantera_multi_stock' && roles.negra !== roles.blanca, 'EXISTING_RUNTIME_ROLES_REQUIRED');
  for (const role of new Set(Object.values(roles))) {
    const row = (await client.query(`SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
      pg_has_role(oid,current_user,'USAGE') AS inherits_owner,
      has_database_privilege(oid,current_database(),'CONNECT') AS can_connect,
      EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=pg_roles.oid OR m.roleid=pg_roles.oid) AS has_memberships,
      EXISTS(SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=pg_roles.oid AND d.deptype='o') AS owns_objects
      FROM pg_roles WHERE rolname=$1`, [role])).rows[0];
    guard(row?.rolcanlogin && row.can_connect, 'EXISTING_RUNTIME_ROLE_MISSING');
    if (role === roles.negra) {
      guard(row.rolsuper || row.inherits_owner, 'PRIMARY_EXISTING_RUNTIME_ROLE_REQUIRES_REVIEW');
      for (const table of ['llantas', 'productos', 'servicios', 'ventas', 'ventas_productos', 'app_metadata', 'movimientos_bodega']) for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
        guard((await client.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, 'public.' + table, privilege])).rows[0].allowed, 'EXISTING_RUNTIME_TABLE_PRIVILEGES_MISSING');
      }
    } else {
      guard(!row.rolsuper && !row.rolcreaterole && !row.rolcreatedb && !row.rolreplication && !row.rolbypassrls && !row.inherits_owner && !row.has_memberships && !row.owns_objects, 'EXISTING_WHITE_ROLE_MUST_REMAIN_LIMITED');
    }
    if (installed) {
      for (const schema of ['shared_runtime', 'shared_archive']) guard((await client.query('SELECT has_schema_privilege($1,$2,\'USAGE\') AS allowed', [role, schema])).rows[0].allowed, 'NEW_SCHEMA_PERMISSIONS_MISSING');
      for (const name of ['shared_runtime.next_folio(text)', 'shared_runtime.next_warranty_id(integer)']) guard((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, name])).rows[0].allowed, 'NEW_FUNCTION_PERMISSIONS_MISSING');
      for (const table of ['shared_runtime.configuration', 'shared_runtime.sale_item_scope', 'shared_archive.sale_originals']) guard((await client.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed", [role, table])).rows[0].allowed, 'NEW_READ_PERMISSIONS_MISSING');
      guard((await client.query("SELECT has_table_privilege($1,'shared_runtime.operations','SELECT') AS allowed", [role])).rows[0].allowed, 'NEW_OPERATION_PERMISSIONS_MISSING');
      for (const column of ['id', 'request_hash', 'application', 'status', 'sale_kind', 'sale_id']) guard((await client.query("SELECT has_column_privilege($1,'shared_runtime.operations',$2,'INSERT') AS allowed", [role, column])).rows[0].allowed, 'NEW_OPERATION_PERMISSIONS_MISSING');
      if (role === roles.blanca) {
        for (const table of ['llantas', 'productos', 'servicios', 'ventas', 'ventas_productos', 'app_metadata', 'movimientos_bodega']) {
          guard((await client.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed", [role, 'public.' + table])).rows[0].allowed, 'WHITE_CATALOG_READ_PERMISSIONS_MISSING');
          for (const privilege of ['DELETE', 'TRUNCATE']) guard(!(await client.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, 'public.' + table, privilege])).rows[0].allowed, 'WHITE_DELETE_PRIVILEGE_NOT_PERMITTED');
        }
      }
    }
  }
}
export async function lockTables(client, rows, writable) {
  guard(Object.keys(rows).length > 0, 'SOURCE_TABLES_REQUIRED');
  const mode = writable ? 'SHARE ROW EXCLUSIVE' : 'ACCESS SHARE';
  await client.query(`LOCK TABLE ${Object.keys(rows).sort().map(qualified).join(',')} IN ${mode} MODE`);
}
export async function nativeSchema(client, configuration, pgDumpFile) {
  const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG/i.test(key)) delete env[key];
  Object.assign(env, { PGHOST: configuration.host, PGPORT: String(configuration.port), PGDATABASE: configuration.database,
    PGUSER: configuration.user, PGPASSWORD: configuration.password, PGSSLMODE: configuration.ssl === false ? 'disable' : 'verify-full',
    PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'shared-production-schema-readonly', PGOPTIONS: '-c default_transaction_read_only=on -c timezone=UTC -c statement_timeout=120000 -c lock_timeout=5000' });
  // A custom CA may be passed inline to pg, but libpq expects a path. Refuse to
  // silently downgrade its verification; supply an equivalent reviewed tool
  // configuration in a later version if that transport is needed.
  guard(configuration.ssl === false || configuration.ssl === true, 'NATIVE_TLS_CA_CONFIGURATION_REQUIRES_REVIEW');
  return new Promise((resolve, reject) => {
    const child = spawn(pgDumpFile, ['--schema-only', '--no-password', `--snapshot=${snapshot}`], { env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', bytes => chunks.push(bytes)); child.stderr.resume();
    child.once('error', () => reject(new GuardError('NATIVE_SCHEMA_TOOL_FAILED')));
    child.once('close', code => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new GuardError('NATIVE_SCHEMA_CAPTURE_FAILED')));
  });
}
export async function verifySource(client, configuration, bundle, label, { native = true } = {}) {
  const expected = label === 'negra' ? bundle.installation.black : bundle.installation.white;
  const tables = (await client.query(`SELECT n.nspname||'.'||c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p') ORDER BY 1`)).rows.map(row => row.name).sort();
  guard(JSON.stringify(tables) === JSON.stringify(Object.keys(expected).sort()), 'LIVE_SOURCE_TABLE_SET_CHANGED');
  for (const [table, rows] of Object.entries(expected)) guard(sha256(JSON.stringify(await tableRows(client, table))) === sha256(JSON.stringify(rows)), 'LIVE_SOURCE_ROWS_CHANGED');
  // Includes ACL/owners, sequence is_called, large-object bytes, materialized
  // data, extension versions and replication side-effect checks.
  try { compareStates(bundle.states[label], await databaseState(client)); }
  catch { throw new GuardError('LIVE_FULL_DATABASE_STATE_CHANGED'); }
  if (native) {
    const current = await nativeSchema(client, configuration, bundle.pgDumpFile);
    const before = await fs.readFile(path.join(bundle.snapshotDirectory, label + '-native-schema.sql'), 'utf8');
    guard(normalizeSchema(current) === normalizeSchema(before), 'LIVE_NATIVE_SCHEMA_CHANGED');
  }
}
