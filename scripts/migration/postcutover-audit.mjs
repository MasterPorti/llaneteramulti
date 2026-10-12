/**
 * Post-cutover evidence. All database connections and transactions are READ ONLY.
 * The only write is an aggregate JSON report in the verified backup directory.
 * Run promptly after cutover, before the destination begins receiving new sales.
 * Usage: node scripts/migration/postcutover-audit.mjs --run <backup-directory>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { TABLES, SUPPLIER, readRows, rowsHash, sha256, verifyRows } from './snapshot.mjs';
import { fingerprintRetirementSnapshot, RETIREMENT_VERSION } from './retirement.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backupRoot = path.join(root, '.migration-backups');
const targetDatabase = 'llaneteramulti_new_tires';
const targetRole = 'llaneteramulti_new_tires_app';
const retiredTables = ['llantas', 'ventas', 'movimientos_bodega'];
const businessWriteTables = ['llantas', 'movimientos_bodega', 'ventas', 'productos', 'servicios', 'ventas_productos', 'producto_imagenes'];
const normalize = (supplier) => String(supplier ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

function requireCondition(condition, code) { if (!condition) throw new Error(code); }
function jsonArray(rows) { return '[' + rows.join(',') + ']'; }

async function loadEvidence(directory) {
  const resolved = path.resolve(root, directory);
  requireCondition(resolved.startsWith(backupRoot + path.sep), 'BACKUP_OUTSIDE_PROJECT');
  const reportPath = path.join(resolved, 'postcutover-verification.json');
  try { await fs.access(reportPath); throw new Error('REPORT_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = await fs.readFile(path.join(resolved, 'source-backup.json'));
  const manifest = JSON.parse(await fs.readFile(path.join(resolved, 'manifest.json'), 'utf8'));
  const precommit = JSON.parse(await fs.readFile(path.join(resolved, 'cutover-precommit.json'), 'utf8'));
  const complete = JSON.parse(await fs.readFile(path.join(resolved, 'cutover-complete.json'), 'utf8'));
  requireCondition(sha256(bytes) === manifest.backupSha256, 'BACKUP_HASH_MISMATCH');
  const backup = JSON.parse(bytes);
  requireCondition(backup.batchId === manifest.batchId && precommit.batchId === backup.batchId && complete.batchId === backup.batchId, 'BATCH_EVIDENCE_MISMATCH');
  requireCondition(backup.selection.summary.supplier === SUPPLIER && precommit.backupSha256 === manifest.backupSha256, 'BACKUP_SCOPE_MISMATCH');
  requireCondition(sha256(backup.schema.sql) === manifest.schemaSha256, 'SCHEMA_HASH_MISMATCH');
  requireCondition(precommit.onlySourceActiveFlagsChanged === true && complete.sourceRetired === true && complete.targetWritable === true && complete.targetDatabase === targetDatabase, 'CUTOVER_NOT_COMPLETE');
  requireCondition(retiredTables.every((table) => /^[a-f0-9]{64}$/.test(precommit.sourceAfterHashes?.[table] ?? '')), 'SOURCE_PRECOMMIT_HASHES_REQUIRED');
  for (const table of TABLES) requireCondition(backup.all[table].length === manifest.allTables[table].count && rowsHash(backup.all[table]) === manifest.allTables[table].sha256, 'BACKUP_TABLE_MISMATCH');
  const expected = Object.fromEntries(retiredTables.map((table) => [table, backup.selection.rows[table]]));
  requireCondition(precommit.targetVerification?.verified === true && precommit.targetVerification?.sourceFingerprint === fingerprintRetirementSnapshot(expected), 'CUTOVER_FINGERPRINT_MISMATCH');
  const env = {};
  for (const name of ['.env', '.env.development', '.env.local', '.env.development.local']) {
    try { Object.assign(env, dotenv.parse(await fs.readFile(path.join(root, '../sistemaBodega', name)))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  requireCondition(Boolean(env.DATABASE_URL), 'SOURCE_CONNECTION_UNAVAILABLE');
  requireCondition(decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)) === backup.source.database, 'SOURCE_DATABASE_MISMATCH');
  requireCondition(backup.source.database !== targetDatabase, 'SOURCE_AND_TARGET_MUST_DIFFER');
  return { backup, expected, manifest, precommit, complete, env, reportPath };
}

async function connectReadOnly(env, database) {
  const url = new URL(env.DATABASE_URL);
  url.pathname = '/' + database;
  url.searchParams.delete('database');
  url.searchParams.delete('dbname');
  url.searchParams.delete('options');
  const client = new pg.Client({
    connectionString: url.toString(), ssl: env.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15000, statement_timeout: 60000,
    options: '-c timezone=UTC -c default_transaction_read_only=on', application_name: 'new-tires-postcutover-readonly-audit',
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const info = (await client.query(`SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only,
      current_setting('TimeZone') AS timezone, clock_timestamp()::text AS observed_at`)).rows[0];
    requireCondition(info.database === database && info.read_only === 'on' && info.timezone === 'UTC', 'READ_ONLY_DATABASE_IDENTITY_MISMATCH');
    return { client, observedAt: info.observed_at };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); await client.end(); throw error; }
}

async function compareRawJson(client, expected, actual, deactivate = false) {
  const result = await client.query(`WITH expected AS (SELECT value AS row FROM jsonb_array_elements($1::jsonb)),
    actual AS (SELECT value AS row FROM jsonb_array_elements($2::jsonb))
    SELECT count(*) FILTER (WHERE e.row IS NULL)::int AS added,
      count(*) FILTER (WHERE a.row IS NULL)::int AS missing,
      count(*) FILTER (WHERE e.row IS NOT NULL AND a.row IS NOT NULL AND a.row IS DISTINCT FROM
        CASE WHEN $3::boolean THEN e.row || '{"activo":false}'::jsonb ELSE e.row END)::int AS changed
    FROM expected e FULL JOIN actual a ON a.row->>'id' = e.row->>'id'`, [jsonArray(expected), jsonArray(actual), deactivate]);
  const difference = result.rows[0];
  return { expectedCount: expected.length, actualCount: actual.length, ...difference,
    exact: difference.added === 0 && difference.missing === 0 && difference.changed === 0 };
}

function compareOutsideScope(expected, actual, table, excludedIds = new Set()) {
  const key = table === 'app_metadata' ? 'key' : 'id';
  const keyed = (rows) => new Map(rows.map((raw) => [JSON.parse(raw)[key], raw]).filter(([id]) => !excludedIds.has(id)));
  const before = keyed(expected);
  const after = keyed(actual);
  let added = 0; let missing = 0; let changed = 0;
  for (const [id, raw] of before) { if (!after.has(id)) missing++; else if (after.get(id) !== raw) changed++; }
  for (const id of after.keys()) if (!before.has(id)) added++;
  return { table, expectedCount: before.size, actualCount: after.size, added, missing, changed,
    exact: added === 0 && missing === 0 && changed === 0,
    expectedSha256: rowsHash([...before.values()]), actualSha256: rowsHash([...after.values()]) };
}

async function inspectPrivileges(target) {
  const role = (await target.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname = $1`, [targetRole])).rows[0];
  requireCondition(Boolean(role), 'APPLICATION_ROLE_MISSING');
  const tables = [...businessWriteTables, 'app_metadata', 'migration_imported_sales'];
  const permissions = (await target.query(`SELECT table_name,
    has_table_privilege($1, 'public.' || table_name, 'SELECT') AS select_allowed,
    has_table_privilege($1, 'public.' || table_name, 'INSERT') AS insert_allowed,
    has_table_privilege($1, 'public.' || table_name, 'UPDATE') AS update_allowed,
    has_table_privilege($1, 'public.' || table_name, 'DELETE') AS delete_allowed,
    has_table_privilege($1, 'public.' || table_name, 'TRUNCATE') AS truncate_allowed,
    has_table_privilege($1, 'public.' || table_name, 'TRIGGER') AS trigger_allowed,
    has_any_column_privilege($1, 'public.' || table_name, 'INSERT') AS column_insert_allowed,
    has_any_column_privilege($1, 'public.' || table_name, 'UPDATE') AS column_update_allowed
    FROM unnest($2::text[]) AS table_name`, [targetRole, tables])).rows;
  const migrationTables = (await target.query(`SELECT n.nspname AS schema_name, c.relname AS table_name,
    has_table_privilege($1, c.oid, 'INSERT') OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE')
      OR has_table_privilege($1, c.oid, 'TRUNCATE') OR has_table_privilege($1, c.oid, 'TRIGGER')
      OR has_any_column_privilege($1, c.oid, 'INSERT') OR has_any_column_privilege($1, c.oid, 'UPDATE') AS writable,
    c.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1) AS owned
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('migration_control','migration_context') AND c.relkind = 'r'`, [targetRole])).rows;
  const scope = (await target.query(`SELECT
    has_database_privilege($1, current_database(), 'CONNECT') AS connect_allowed,
    has_database_privilege($1, current_database(), 'CREATE') AS database_create_allowed,
    has_schema_privilege($1, 'public', 'USAGE') AS public_usage_allowed,
    has_schema_privilege($1, 'public', 'CREATE') AS public_create_allowed,
    has_schema_privilege($1, 'migration_control', 'CREATE') AS control_create_allowed,
    has_schema_privilege($1, 'migration_context', 'CREATE') AS context_create_allowed`, [targetRole])).rows[0];
  const businessAllowed = businessWriteTables.every((table) => permissions.some((p) => p.table_name === table && p.select_allowed && p.insert_allowed && p.update_allowed && p.delete_allowed && !p.truncate_allowed && !p.trigger_allowed));
  const metadata = permissions.find((p) => p.table_name === 'app_metadata');
  const imported = permissions.find((p) => p.table_name === 'migration_imported_sales');
  const readonlyImported = imported.select_allowed && !imported.insert_allowed && !imported.update_allowed && !imported.delete_allowed && !imported.truncate_allowed && !imported.trigger_allowed && !imported.column_insert_allowed && !imported.column_update_allowed;
  const sequencesAllowed = metadata.select_allowed && metadata.update_allowed && !metadata.insert_allowed && !metadata.delete_allowed && !metadata.truncate_allowed && !metadata.trigger_allowed;
  const minimalRole = Object.values(role).every((value) => value === false);
  const restrictedSchemas = scope.connect_allowed && scope.public_usage_allowed && !scope.database_create_allowed && !scope.public_create_allowed && !scope.control_create_allowed && !scope.context_create_allowed;
  const protectedControl = migrationTables.every((table) => !table.writable && !table.owned);
  return { verified: businessAllowed && readonlyImported && sequencesAllowed && minimalRole && restrictedSchemas && protectedControl,
    businessAllowed, importedSalesReadonly: readonlyImported, sequencesAllowed, minimalRole, restrictedSchemas, protectedControl,
    tables: permissions, migrationTables, scope };
}

export async function auditPostcutover(directory) {
  const evidence = await loadEvidence(directory);
  const { backup, expected, manifest, precommit, env, reportPath } = evidence;
  let source; let target;
  const report = { batchId: backup.batchId, verified: false, auditedAt: new Date().toISOString(),
    databaseAccess: 'READ ONLY / REPEATABLE READ', backupSha256: manifest.backupSha256,
    sourceDatabase: backup.source.database, targetDatabase, failures: [] };
  try {
    const sourceConnection = await connectReadOnly(env, backup.source.database); source = sourceConnection.client;
    const targetConnection = await connectReadOnly(env, targetDatabase); target = targetConnection.client;
    report.observedAt = { source: sourceConnection.observedAt, target: targetConnection.observedAt };
    try { report.target = await verifyRows(target, backup.selection); }
    catch { report.target = { verified: false, code: 'TARGET_DIFFERS_FROM_MIGRATED_SNAPSHOT' }; report.failures.push('TARGET_NOT_EXACT'); }
    const all = {};
    for (const table of TABLES) all[table] = await readRows(source, 'public', table);
    const originalIds = Object.fromEntries(retiredTables.map((table) => [table, new Set(expected[table].map((raw) => JSON.parse(raw).id))]));
    const sourceSelection = {
      llantas: all.llantas.filter((raw) => { const row = JSON.parse(raw); return originalIds.llantas.has(row.id) || normalize(row.proveedor) === SUPPLIER; }),
      ventas: all.ventas.filter((raw) => { const row = JSON.parse(raw); return originalIds.ventas.has(row.id) || (Array.isArray(row.items) && row.items.some((item) => originalIds.llantas.has(item.llantaId))); }),
      movimientos_bodega: all.movimientos_bodega.filter((raw) => { const row = JSON.parse(raw); return originalIds.movimientos_bodega.has(row.id) || originalIds.llantas.has(row.llantaId); }),
    };
    const selectedComparison = {};
    for (const table of retiredTables) selectedComparison[table] = await compareRawJson(source, expected[table], sourceSelection[table], table === 'llantas');
    const inactive = sourceSelection.llantas.filter((raw) => JSON.parse(raw).activo === false).length;
    const selectedExact = retiredTables.every((table) => selectedComparison[table].exact) && inactive === expected.llantas.length;
    if (!selectedExact) report.failures.push('SOURCE_RETIRED_SCOPE_NOT_EXACT');
    const beforeCommitHashes = retiredTables.map((table) => ({ table, expectedSha256: precommit.sourceAfterHashes[table], actualSha256: rowsHash(all[table]), exact: precommit.sourceAfterHashes[table] === rowsHash(all[table]) }));
    const outsideScope = TABLES.map((table) => {
      const excluded = new Set([...(originalIds[table] ?? []), ...(sourceSelection[table] ?? []).map((raw) => JSON.parse(raw).id)]);
      return compareOutsideScope(backup.all[table], all[table], table, excluded);
    });
    const baselineExact = beforeCommitHashes.every((table) => table.exact);
    if (!baselineExact) report.failures.push('SOURCE_CHANGED_AFTER_PRECOMMIT_HASH');
    const outsideChanged = outsideScope.some((table) => !table.exact);
    report.source = { verified: selectedExact && baselineExact, supplier: SUPPLIER, inactiveTires: inactive,
      selectedComparison, fullTablePrecommitHashes: beforeCommitHashes, outsideMigratedScopeComparedToBackup: outsideScope,
      changesOutsideMigratedScopeObserved: outsideChanged,
      sourceActivityInterpretation: !baselineExact && selectedExact
        ? 'Protected supplier records match; full-table changes occurred outside that selection after precommit. Review unrelated activity.'
        : outsideChanged ? 'Rows outside the migrated selection differ from the original backup; they are reported separately.' : 'No changes outside the migrated selection were observed.' };
    const sourceBatch = (await source.query(`SELECT status, fingerprint, source_database, supplier_normalized, target_verification,
      retired_at IS NOT NULL AS has_retired_at FROM migration_control.retirement_batches WHERE batch_id = $1`, [backup.batchId])).rows[0];
    const targetBatch = (await target.query(`SELECT source_retired, source_database, supplier, backup_sha256
      FROM migration_control.destination_batch WHERE batch_id = $1`, [backup.batchId])).rows[0];
    const statesValid = sourceBatch?.status === 'retired' && sourceBatch.has_retired_at && sourceBatch.fingerprint === fingerprintRetirementSnapshot(expected)
      && sourceBatch.source_database === backup.source.database && sourceBatch.supplier_normalized === SUPPLIER
      && sourceBatch.target_verification?.reportSha256 === precommit.targetVerification.reportSha256
      && targetBatch?.source_retired === true && targetBatch.source_database === backup.source.database && targetBatch.supplier === SUPPLIER && targetBatch.backup_sha256 === manifest.backupSha256;
    const archives = {};
    for (const [table, archived] of [['llantas', 'archived_llantas'], ['ventas', 'archived_sales'], ['movimientos_bodega', 'archived_movements']]) {
      const rows = (await source.query(`SELECT original_row::text AS row_json FROM migration_control.${archived} WHERE batch_id = $1`, [backup.batchId])).rows.map((row) => row.row_json);
      archives[table] = await compareRawJson(source, expected[table], rows);
    }
    const auditExact = retiredTables.every((table) => archives[table].exact);
    const namespace = (await source.query("SELECT obj_description(oid,'pg_namespace') AS version FROM pg_namespace WHERE nspname='migration_control'")).rows[0];
    const triggers = (await source.query(`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,t.tgtype AS type,t.tgqual IS NULL AS unconditional
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace
      AND c.relname=ANY($1::text[]) AND t.tgname IN ('migration_retirement_guard','migration_retirement_truncate')`, [retiredTables])).rows;
    const guardsValid = namespace?.version === RETIREMENT_VERSION && retiredTables.every((table) =>
      [['migration_retirement_guard', 31], ['migration_retirement_truncate', 34]].every(([name, type]) => triggers.some((t) => t.table_name === table && t.name === name && Number(t.type) === type && t.enabled === 'A' && t.unconditional)));
    const importedSales = (await target.query(`SELECT sale_id AS id FROM public.migration_imported_sales WHERE batch_id=$1`, [backup.batchId])).rows.map((row) => row.id).sort();
    const importedSalesExact = JSON.stringify(importedSales) === JSON.stringify([...originalIds.ventas].sort());
    report.control = { verified: statesValid && auditExact && guardsValid && importedSalesExact, statesValid, sourceStatus: sourceBatch?.status ?? null,
      targetSourceRetired: targetBatch?.source_retired ?? null, archives, guardsValid, importedSalesExact, importedSaleCount: importedSales.length };
    if (!report.control.verified) report.failures.push('MIGRATION_CONTROL_EVIDENCE_FAILED');
    report.privileges = await inspectPrivileges(target);
    if (!report.privileges.verified) report.failures.push('APPLICATION_PRIVILEGES_FAILED');
    report.supplierTransferVerified = Boolean(report.target.verified && selectedExact && report.control.verified && report.privileges.verified);
    report.verified = report.supplierTransferVerified && baselineExact;
  } catch (error) {
    report.failures.push(/^[A-Z_]+$/.test(error.message) ? error.message : 'AUDIT_QUERY_FAILED');
    report.failureCode = error.code ?? error.name ?? 'UNKNOWN';
  } finally {
    if (source) { await source.query('ROLLBACK').catch(() => {}); await source.end(); }
    if (target) { await target.query('ROLLBACK').catch(() => {}); await target.end(); }
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ report: reportPath, verified: report.verified, supplierTransferVerified: report.supplierTransferVerified ?? false,
    inactiveSourceTires: report.source?.inactiveTires ?? null, targetExact: report.target?.verified ?? false,
    sourceOtherActivityObserved: report.source?.changesOutsideMigratedScopeObserved ?? null,
    failures: report.failures, databaseWrites: false }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--run') {
    console.log('Uso: node scripts/migration/postcutover-audit.mjs --run <carpeta-respaldo>');
    process.exitCode = 2;
  } else {
    try { const report = await auditPostcutover(args[1]); if (!report.verified) process.exitCode = 1; }
    catch (error) {
      console.error(JSON.stringify({ audit: 'not_run_or_report_not_written', code: error.code ?? error.name ?? 'UNKNOWN', reason: /^[A-Z_]+$/.test(error.message) ? error.message : 'AUDIT_SETUP_FAILED', databaseWrites: false }));
      process.exitCode = 1;
    }
  }
}
