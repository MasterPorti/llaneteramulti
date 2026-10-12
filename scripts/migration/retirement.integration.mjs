/**
 * Destructive operations are restricted to a freshly-created, random temporary DB.
 * Source and application destination databases are never connected to or modified.
 * Usage: node scripts/migration/retirement.integration.mjs --run [--backup <directory>]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { SUPPLIER, TABLES, insertRaw, qi, readRows, rowsHash, sha256 } from './snapshot.mjs';
import { fingerprintRetirementSnapshot, retireSource, rollbackSourceRetirement } from './retirement.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = path.resolve(projectRoot, '../sistemaBodega');
const backupRoot = path.join(projectRoot, '.migration-backups');
const defaultBackup = path.join(backupRoot, 'new-tires-2026-10-11T23-21-25.623Z-cc8f344f');
const applicationDatabase = 'llaneteramulti_new_tires';
const temporaryNamePattern = /^llantera_retirement_test_[a-f0-9]{24}$/;
const importOrder = ['llantas', 'producto_imagenes', 'productos', 'servicios', 'ventas', 'movimientos_bodega', 'ventas_productos', 'app_metadata'];

async function loadInput(directory) {
  const dir = path.resolve(directory);
  if (!dir.startsWith(backupRoot + path.sep)) throw new Error('BACKUP_OUTSIDE_PROJECT');
  const bytes = await fs.readFile(path.join(dir, 'source-backup.json'));
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (sha256(bytes) !== manifest.backupSha256) throw new Error('BACKUP_HASH_MISMATCH');
  const backup = JSON.parse(bytes);
  assert.equal(backup.batchId, manifest.batchId, 'BACKUP_BATCH_MISMATCH');
  assert.equal(sha256(backup.schema.sql), manifest.schemaSha256, 'SCHEMA_HASH_MISMATCH');
  assert.equal(backup.selection.summary.supplier, SUPPLIER, 'BACKUP_SUPPLIER_MISMATCH');
  assert.deepEqual([...Object.keys(backup.all)].sort(), [...TABLES].sort(), 'BACKUP_TABLES_MISMATCH');
  for (const table of TABLES) {
    assert.equal(backup.all[table].length, manifest.allTables[table].count, 'BACKUP_TABLE_COUNT_MISMATCH');
    assert.equal(rowsHash(backup.all[table]), manifest.allTables[table].sha256, 'BACKUP_TABLE_HASH_MISMATCH');
  }
  const env = {};
  for (const name of ['.env', '.env.development', '.env.local', '.env.development.local']) {
    try { Object.assign(env, dotenv.parse(await fs.readFile(path.join(sourceRoot, name)))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!env.DATABASE_URL) throw new Error('SOURCE_CONNECTION_UNAVAILABLE');
  assert.equal(decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)), backup.source.database, 'SOURCE_DATABASE_MISMATCH');
  return { backup, manifest, env };
}

async function connectToAllowedDatabase(env, database, forbidden, registry) {
  if (forbidden.has(database)) throw new Error('PROTECTED_DATABASE_CONNECTION_REFUSED');
  if (!['postgres', 'template1'].includes(database) && !registry.has(database)) throw new Error('UNREGISTERED_DATABASE_CONNECTION_REFUSED');
  const url = new URL(env.DATABASE_URL);
  url.pathname = '/' + database;
  url.searchParams.delete('database');
  url.searchParams.delete('dbname');
  const client = new pg.Client({
    connectionString: url.toString(), ssl: env.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15000, statement_timeout: 60000,
    options: '-c timezone=UTC', application_name: 'llantera-retirement-isolated-integration',
  });
  await client.connect();
  try {
    const current = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (current !== database || forbidden.has(current)) throw new Error('ACTUAL_DATABASE_NOT_ALLOWED');
    return client;
  } catch (error) { await client.end(); throw error; }
}

async function compareAllRows(client, backup, retired) {
  const retiredIds = backup.selection.rows.llantas.map((raw) => JSON.parse(raw).id);
  for (const table of TABLES) {
    if (!retired || table !== 'llantas') {
      const actual = await readRows(client, 'public', table);
      assert.equal(actual.length, backup.all[table].length, 'EXACT_ROW_COUNT_MISMATCH');
      assert.equal(rowsHash(actual), rowsHash(backup.all[table]), `EXACT_TABLE_HASH_MISMATCH_${table}`);
      continue;
    }
    const rows = '[' + backup.all.llantas.join(',') + ']';
    const comparison = await client.query(`WITH expected AS (SELECT value AS row FROM jsonb_array_elements($1::jsonb))
      SELECT count(*)::int AS differences FROM expected e FULL JOIN public.llantas l ON l.id = e.row->>'id'
      WHERE e.row IS NULL OR l.id IS NULL OR to_jsonb(l) IS DISTINCT FROM
        (CASE WHEN l.id = ANY($2::text[]) THEN e.row || '{"activo":false}'::jsonb ELSE e.row END)`, [rows, retiredIds]);
    assert.equal(comparison.rows[0].differences, 0, 'RETIREMENT_CHANGED_FIELDS_OTHER_THAN_ACTIVO');
  }
}

async function transactional(client, run) {
  await client.query('BEGIN');
  try { const value = await run(); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function runIntegration(directory) {
  const { backup, manifest, env } = await loadInput(directory);
  const registry = new Map(); // Only objects created in this invocation are eligible for DROP.
  const forbidden = new Set([backup.source.database, applicationDatabase]);
  const maintenanceDatabase = backup.source.database === 'postgres' ? 'template1' : 'postgres';
  const temporaryName = 'llantera_retirement_test_' + randomBytes(12).toString('hex');
  assert.match(temporaryName, temporaryNamePattern);
  assert.equal(forbidden.has(temporaryName), false);
  let admin;
  let temporary;
  let created = false;
  let completed = false;
  let cleaned = false;
  let stage = 'maintenance_connection';
  const passed = [];
  const expected = Object.fromEntries(['llantas', 'ventas', 'movimientos_bodega'].map((table) => [table, backup.selection.rows[table]]));
  const fingerprint = fingerprintRetirementSnapshot(expected);
  const targetVerification = {
    verified: true, database: applicationDatabase, sourceFingerprint: fingerprint,
    verifiedAt: new Date().toISOString(), reportSha256: manifest.backupSha256,
  };
  const request = { batchId: backup.batchId, supplier: SUPPLIER, expected, targetVerification };
  const rollbackRequest = {
    batchId: backup.batchId, expected, expectedFingerprint: fingerprint, targetQuiesced: true,
    destinationChangesReconciled: true, reason: 'Isolated integration verification; destination never used',
    backupVerified: { sourceFingerprint: fingerprint, reportSha256: manifest.backupSha256 },
  };
  try {
    admin = await connectToAllowedDatabase(env, maintenanceDatabase, forbidden, registry);
    stage = 'create_unique_temporary_database';
    const existing = await admin.query('SELECT oid FROM pg_database WHERE datname = $1', [temporaryName]);
    assert.equal(existing.rows.length, 0, 'TEMPORARY_NAME_ALREADY_EXISTS');
    await admin.query(`CREATE DATABASE ${qi(temporaryName)} TEMPLATE template0`);
    created = true;
    const identity = (await admin.query(`SELECT d.oid::text AS oid, d.datdba = r.oid AS owned
      FROM pg_database d JOIN pg_roles r ON r.rolname = current_user WHERE d.datname = $1`, [temporaryName])).rows[0];
    assert.ok(identity?.owned && /^\d+$/.test(identity.oid), 'TEMPORARY_IDENTITY_UNVERIFIED');
    registry.set(temporaryName, Object.freeze({ oid: identity.oid, name: temporaryName }));
    temporary = await connectToAllowedDatabase(env, temporaryName, forbidden, registry);
    stage = 'import_all_eight_tables';
    await transactional(temporary, async () => {
      await temporary.query(backup.schema.sql);
      for (const table of importOrder) await insertRaw(temporary, 'public', table, backup.all[table]);
      await compareAllRows(temporary, backup, false);
    });
    passed.push('full_backup_import_exact_all_eight_tables');
    stage = 'retire_supplier';
    const retired = await transactional(temporary, () => retireSource(temporary, request));
    assert.equal(retired.activeRetired, 104, 'EXPECTED_104_ACTIVE_TIRES');
    assert.equal(retired.alreadyRetired, false, 'FIRST_RETIREMENT_ALREADY_COMPLETED');
    assert.deepEqual(retired.counts, { llantas: 134, ventas: 465, movimientos_bodega: 489 });
    await compareAllRows(temporary, backup, true);
    passed.push('retirement_104_active_134_catalog_465_sales_489_movements');
    passed.push('all_eight_tables_unchanged_except_selected_activo');
    stage = 'retirement_idempotence_and_installed_contract';
    const repeated = await transactional(temporary, () => retireSource(temporary, request));
    assert.equal(repeated.alreadyRetired, true, 'RETIREMENT_NOT_IDEMPOTENT');
    await compareAllRows(temporary, backup, true);
    passed.push('retirement_idempotence_and_catalog_contract');

    const tire = JSON.parse(expected.llantas.find((raw) => JSON.parse(raw).activo));
    const selectedIds = new Set(expected.llantas.map((raw) => JSON.parse(raw).id));
    const otherTire = backup.all.llantas.map(JSON.parse).find((row) => !selectedIds.has(row.id));
    assert.ok(otherTire, 'OTHER_SUPPLIER_TEST_FIXTURE_REQUIRED');
    const mixedSale = expected.ventas.map(JSON.parse).find((row) => row.items.some((item) => !selectedIds.has(item.llantaId)));
    assert.ok(mixedSale, 'MIXED_SALE_TEST_FIXTURE_REQUIRED');
    const movement = JSON.parse(expected.movimientos_bodega[0]);
    const rawTire = expected.llantas.find((raw) => JSON.parse(raw).id === tire.id);
    const rawSale = expected.ventas.find((raw) => JSON.parse(raw).id === mixedSale.id);
    const newId = 'integration-' + randomBytes(12).toString('hex');
    const insertTire = `INSERT INTO public.llantas SELECT * FROM jsonb_populate_record(NULL::public.llantas,
      jsonb_set(jsonb_set($1::jsonb, '{id}', to_jsonb($2::text)), '{proveedor}', to_jsonb($3::text)))`;
    async function blocked(label, sql, params) {
      stage = label;
      await temporary.query('SAVEPOINT expected_guard_failure');
      let rejection;
      try { await temporary.query(sql, params); } catch (error) { rejection = error; }
      await temporary.query('ROLLBACK TO SAVEPOINT expected_guard_failure');
      await temporary.query('RELEASE SAVEPOINT expected_guard_failure');
      assert.equal(rejection?.code, '55000', 'EXPECTED_RETIREMENT_GUARD_SQLSTATE');
      passed.push(label);
    }
    await transactional(temporary, async () => {
      await blocked('guard_supplier_recreation_case_whitespace', insertTire, [rawTire, newId, '  Comercializadora   de New Tires  ']);
      await blocked('guard_tire_reactivation', 'UPDATE public.llantas SET activo = true WHERE id = $1', [tire.id]);
      await blocked('guard_tire_restock', `UPDATE public.llantas SET "stockPorBodega" = jsonb_set("stockPorBodega", '{bodega-1}', '999999'::jsonb) WHERE id = $1`, [tire.id]);
      await blocked('guard_tire_delete', 'DELETE FROM public.llantas WHERE id = $1', [tire.id]);
      await blocked('guard_mixed_sale_cancel', 'UPDATE public.ventas SET cancelada = true WHERE id = $1', [mixedSale.id]);
      await blocked('guard_mixed_sale_reference_removal', "UPDATE public.ventas SET items = '[]'::jsonb WHERE id = $1", [mixedSale.id]);
      await blocked('guard_mixed_sale_delete', 'DELETE FROM public.ventas WHERE id = $1', [mixedSale.id]);
      await blocked('guard_new_related_sale', `INSERT INTO public.ventas SELECT * FROM jsonb_populate_record(NULL::public.ventas,
        jsonb_set($1::jsonb, '{id}', to_jsonb($2::text)))`, [rawSale, newId]);
      await blocked('guard_movement_delete', 'DELETE FROM public.movimientos_bodega WHERE id = $1', [movement.id]);
      await blocked('guard_movement_reassignment', 'UPDATE public.movimientos_bodega SET "llantaId" = $1 WHERE id = $2', [otherTire.id, movement.id]);
      await blocked('guard_new_movement', `INSERT INTO public.movimientos_bodega SELECT * FROM jsonb_populate_record(NULL::public.movimientos_bodega,
        jsonb_set($1::jsonb, '{id}', to_jsonb($2::text)))`, [expected.movimientos_bodega[0], newId]);
      await blocked('guard_truncate_catalog', 'TRUNCATE public.llantas, public.movimientos_bodega');
      await blocked('guard_truncate_sales', 'TRUNCATE public.ventas');
      await blocked('guard_truncate_movements', 'TRUNCATE public.movimientos_bodega');
      stage = 'other_supplier_update_allowed';
      const allowed = await temporary.query('UPDATE public.llantas SET activo = activo WHERE id = $1', [otherTire.id]);
      assert.equal(allowed.rowCount, 1, 'OTHER_SUPPLIER_OPERATION_BLOCKED');
      passed.push(stage);
    });
    await compareAllRows(temporary, backup, true);

    stage = 'rollback_restores_exact_original';
    const restored = await transactional(temporary, () => rollbackSourceRetirement(temporary, rollbackRequest));
    assert.equal(restored.alreadyRestored, false, 'FIRST_ROLLBACK_ALREADY_COMPLETED');
    await compareAllRows(temporary, backup, false);
    passed.push('rollback_exact_all_eight_tables');
    stage = 'rollback_idempotence';
    const restoredAgain = await transactional(temporary, () => rollbackSourceRetirement(temporary, rollbackRequest));
    assert.equal(restoredAgain.alreadyRestored, true, 'ROLLBACK_NOT_IDEMPOTENT');
    await compareAllRows(temporary, backup, false);
    passed.push('rollback_idempotence_exact');
    stage = 'rollback_releases_operational_guards';
    await temporary.query('BEGIN');
    try {
      assert.equal((await temporary.query('UPDATE public.llantas SET activo = activo WHERE id = $1', [tire.id])).rowCount, 1);
      assert.equal((await temporary.query('UPDATE public.ventas SET total = total WHERE id = $1', [mixedSale.id])).rowCount, 1);
      assert.equal((await temporary.query('UPDATE public.movimientos_bodega SET cantidad = cantidad WHERE id = $1', [movement.id])).rowCount, 1);
      assert.equal((await temporary.query(insertTire, [rawTire, newId, SUPPLIER])).rowCount, 1);
    } finally { await temporary.query('ROLLBACK'); }
    await compareAllRows(temporary, backup, false);
    passed.push('rollback_releases_guards_without_data_changes');
    stage = 'audit_records_preserved';
    const audit = await temporary.query(`SELECT status,
      (SELECT count(*)::int FROM migration_control.archived_llantas) AS tires,
      (SELECT count(*)::int FROM migration_control.archived_sales) AS sales,
      (SELECT count(*)::int FROM migration_control.archived_movements) AS movements
      FROM migration_control.retirement_batches WHERE batch_id = $1`, [backup.batchId]);
    assert.deepEqual(audit.rows[0], { status: 'restored', tires: 134, sales: 465, movements: 489 });
    passed.push('original_audit_retained_after_rollback');
    completed = true;
  } catch (error) {
    // No pg detail/rows/parameters or connection URL is printed.
    const safeContractFailure = /^Retirement (?:table contract|primary key|guard|trigger|batch foreign key) differs: [a-z_.]+$/.test(error.message);
    error.integrationFailure = { stage, code: error.code ?? error.name ?? 'INTEGRATION_FAILED',
      reason: /^[A-Z_]+$/.test(error.message) || safeContractFailure ? error.message : undefined };
    throw error;
  } finally {
    if (temporary) { await temporary.query('ROLLBACK').catch(() => {}); await temporary.end(); }
    try {
      if (created) {
        const entry = registry.get(temporaryName);
        if (!entry || entry.name !== temporaryName || !temporaryNamePattern.test(temporaryName) || forbidden.has(temporaryName)) throw new Error('CLEANUP_REGISTRY_CHECK_FAILED');
        const identity = (await admin.query(`SELECT d.oid::text AS oid, d.datdba = r.oid AS owned
          FROM pg_database d JOIN pg_roles r ON r.rolname = current_user WHERE d.datname = $1`, [temporaryName])).rows[0];
        if (!identity?.owned || identity.oid !== entry.oid) throw new Error('CLEANUP_DATABASE_IDENTITY_CHANGED');
        await admin.query(`DROP DATABASE ${qi(temporaryName)}`);
        assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [temporaryName])).rowCount, 0, 'CLEANUP_DATABASE_STILL_EXISTS');
        registry.delete(temporaryName);
        cleaned = true;
      }
    } finally {
      if (admin) await admin.end();
      console.log(JSON.stringify({ integration: completed ? 'passed' : 'failed', testsPassed: passed.length, checks: passed,
        temporaryDatabase: temporaryName, temporaryDatabaseRemoved: cleaned,
        sourceDatabaseConnected: false, applicationDatabaseConnected: false,
        sourceOrDestinationRowsModified: false }));
    }
  }
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const args = process.argv.slice(2);
  if (args[0] !== '--run' || (args.length !== 1 && !(args.length === 3 && args[1] === '--backup'))) {
    console.log('Uso: node scripts/migration/retirement.integration.mjs --run [--backup <carpeta>]');
    process.exitCode = 2;
  } else {
    try { await runIntegration(args[2] ?? defaultBackup); }
    catch (error) {
      console.error(JSON.stringify({ integrationFailure: error.integrationFailure ?? { stage: 'setup_or_cleanup', code: error.code ?? error.name ?? 'INTEGRATION_FAILED' } }));
      process.exitCode = 1;
    }
  }
}
