import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { TABLES, qi, readRows, rowsHash, sha256 } from './snapshot.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = 'llaneteramulti_new_tires';
const applicationRole = 'llaneteramulti_new_tires_app';
export const policy = 'IVA 16% incluido; subtotal = round(total / 1.16, 2); iva = total - subtotal; total cobrado intacto';
export const constraintName = 'ventas_iva_incluido_16_ck';

export async function inspectTaxState(client) {
  const stats = (await client.query(`SELECT count(*)::int AS count,
    count(*) FILTER (WHERE iva IS NULL)::int AS null_iva,
    count(*) FILTER (WHERE iva = 0)::int AS zero_iva,
    count(*) FILTER (WHERE iva <> 0)::int AS existing_iva,
    count(*) FILTER (WHERE subtotal IS DISTINCT FROM total)::int AS different_subtotal,
    count(*) FILTER (WHERE facturada OR factura IS NOT NULL)::int AS invoices,
    count(*) FILTER (WHERE total < 0 OR total <> round(total, 2) OR total > 99999999.99)::int AS invalid_total,
    count(*) FILTER (WHERE dominio <> 'sistema')::int AS other_domain,
    count(*) FILTER (WHERE total IS DISTINCT FROM
      (SELECT coalesce(sum((i->>'subtotal')::numeric),0) FROM jsonb_array_elements(v.items) i))::int AS item_total_mismatch
    FROM public.ventas v`)).rows[0];
  return stats;
}

function requireUncalculated(stats) {
  // Stop on any recorded tax, including cancelled sales. Never overwrite it.
  assert.equal(stats.existing_iva, 0, 'IVA_ALREADY_RECORDED_STOP_AND_NOTIFY');
  assert.equal(stats.null_iva, 0, 'UNEXPECTED_NULL_IVA');
  assert.ok(stats.count > 0 && stats.zero_iva === stats.count, 'ALL_SALES_MUST_HAVE_DEFAULT_ZERO_IVA');
  for (const key of ['different_subtotal','invoices','invalid_total','other_domain','item_total_mismatch']) {
    assert.equal(stats[key], 0, `UNEXPECTED_SALE_STATE_${key.toUpperCase()}`);
  }
}

export async function applyTaxBackfill(client, { expectedDatabase, backupRoot, appRole }) {
  const identity = (await client.query('SELECT current_database() AS name')).rows[0].name;
  assert.equal(identity, expectedDatabase, 'WRONG_DATABASE');
  assert.ok(expectedDatabase === destination || /^llantera_adapters_test_[a-f0-9]{24}$/.test(expectedDatabase), 'DATABASE_NOT_ALLOWED');
  const batchId = randomUUID();
  const directory = path.join(backupRoot, `iva-incluido-${new Date().toISOString().replaceAll(':','-')}-${batchId.slice(0,8)}`);
  let committed = false;
  let commitAttempted = false;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query('LOCK TABLE public.ventas IN ACCESS EXCLUSIVE MODE');
    const stats = await inspectTaxState(client);
    requireUncalculated(stats);
    assert.equal((await client.query("SELECT to_regclass('migration_control.sale_iva_adjustments') AS relation")).rows[0].relation, null, 'BACKFILL_ALREADY_APPLIED');
    const triggers = (await client.query(`SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition
      FROM pg_trigger WHERE tgrelid='public.ventas'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows;
    assert.equal(triggers.length, 1, 'REVIEW_UNEXPECTED_SALES_TRIGGERS');
    assert.equal(triggers[0].tgname, 'protect_imported_sales', 'IMPORTED_GUARD_MISSING');
    assert.equal(triggers[0].tgenabled, 'O', 'IMPORTED_GUARD_NOT_ENABLED');
    const before = {};
    for (const table of [...TABLES, 'migration_imported_sales']) before[table] = await readRows(client, 'public', table);
    const context = await readRows(client, 'migration_context', 'llantas');
    const constraints = (await client.query(`SELECT conname,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='public.ventas'::regclass ORDER BY conname`)).rows;
    const backup = { batchId, database:identity, policy, capturedAt:new Date().toISOString(), stats, before, context, triggers, constraints };
    await fs.mkdir(directory, { recursive:true });
    const bytes = Buffer.from(JSON.stringify(backup));
    await fs.writeFile(path.join(directory,'before.json'), bytes, { flag:'wx' });
    assert.equal(sha256(await fs.readFile(path.join(directory,'before.json'))), sha256(bytes), 'BACKUP_VERIFICATION_FAILED');
    const manifest = { batchId, database:identity, policy, backupSha256:sha256(bytes), count:stats.count,
      hashes:Object.fromEntries(Object.entries(before).map(([table,rows])=>[table,rowsHash(rows)])) };
    await fs.writeFile(path.join(directory,'manifest.json'), JSON.stringify(manifest,null,2), { flag:'wx' });
    await client.query(`CREATE TABLE migration_control.sale_iva_adjustments (
      sale_id text PRIMARY KEY, batch_id uuid NOT NULL, policy text NOT NULL,
      before_row jsonb NOT NULL, after_row jsonb NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query(`INSERT INTO migration_control.sale_iva_adjustments(sale_id,batch_id,policy,before_row,after_row)
      SELECT id,$1,$2,to_jsonb(v),to_jsonb(v) || jsonb_build_object(
        'subtotal',round(total / 1.16,2),'iva',total-round(total / 1.16,2)) FROM public.ventas v`, [batchId,policy]);
    // All steps occur under one exclusive transaction. Failure restores the guard.
    await client.query('ALTER TABLE public.ventas DISABLE TRIGGER protect_imported_sales');
    const updated = await client.query('UPDATE public.ventas SET subtotal=round(total / 1.16,2), iva=total-round(total / 1.16,2)');
    assert.equal(updated.rowCount, stats.count, 'UPDATED_COUNT_MISMATCH');
    await client.query('ALTER TABLE public.ventas ENABLE TRIGGER protect_imported_sales');
    await client.query(`ALTER TABLE public.ventas ADD CONSTRAINT ${qi(constraintName)} CHECK (
      total >= 0 AND subtotal = round(total / 1.16,2) AND iva = total - subtotal
    )`);
    await client.query(`GRANT USAGE ON SCHEMA migration_control TO ${qi(appRole)}`);
    await client.query(`GRANT SELECT ON migration_control.sale_iva_adjustments TO ${qi(appRole)}`);
    const mismatch = (await client.query(`SELECT count(*)::int AS count FROM public.ventas v
      FULL JOIN migration_control.sale_iva_adjustments a ON a.sale_id=v.id
      WHERE v.id IS NULL OR a.sale_id IS NULL OR to_jsonb(v) IS DISTINCT FROM a.after_row
        OR (to_jsonb(v) - 'subtotal' - 'iva') IS DISTINCT FROM (a.before_row - 'subtotal' - 'iva')`)).rows[0].count;
    assert.equal(mismatch, 0, 'ONLY_AUTHORIZED_AMOUNTS_MAY_CHANGE');
    for (const table of [...TABLES, 'migration_imported_sales'].filter(t=>t!=='ventas')) {
      assert.equal(rowsHash(await readRows(client,'public',table)),manifest.hashes[table], `UNRELATED_TABLE_CHANGED_${table}`);
    }
    assert.equal(rowsHash(await readRows(client,'migration_context','llantas')),rowsHash(context),'CONTEXT_CHANGED');
    const enabled = (await client.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.ventas'::regclass AND tgname='protect_imported_sales'")).rows[0]?.tgenabled;
    assert.equal(enabled, 'O', 'IMPORTED_GUARD_NOT_RESTORED');
    const summary = (await client.query(`SELECT count(*)::int AS sales,sum(subtotal)::text AS subtotal,
      sum(iva)::text AS iva,sum(total)::text AS total FROM public.ventas`)).rows[0];
    const after = await readRows(client,'public','ventas');
    const afterBytes = Buffer.from(JSON.stringify({batchId,rows:after}));
    await fs.writeFile(path.join(directory,'after.json'),afterBytes,{flag:'wx'});
    assert.equal(sha256(await fs.readFile(path.join(directory,'after.json'))),sha256(afterBytes),'AFTER_BACKUP_VERIFICATION_FAILED');
    const report = { batchId,database:identity,policy,summary,onlySubtotalAndIvaChanged:true,
      importedGuardEnabled:true,otherTablesUnchanged:true,backupSha256:manifest.backupSha256,
      beforeSha256:manifest.hashes.ventas,afterSha256:rowsHash(after) };
    await fs.writeFile(path.join(directory,'verified-before-commit.json'),JSON.stringify(report,null,2),{flag:'wx'});
    commitAttempted = true;
    await client.query('COMMIT'); committed = true;
    await fs.writeFile(path.join(directory,'complete.json'),JSON.stringify({...report,committedAt:new Date().toISOString()},null,2),{flag:'wx'});
    return { directory,...report };
  } catch (error) {
    if (!commitAttempted) await client.query('ROLLBACK').catch(() => {});
    error.backfillCommitted = committed ? true : commitAttempted ? 'unknown' : false;
    error.backfillBatchId = batchId;
    error.backupDirectory = directory;
    throw error;
  }
}

async function readEnvironment(dir) {
  const env = {};
  for (const name of ['.env','.env.development','.env.local','.env.development.local']) {
    try { Object.assign(env,dotenv.parse(await fs.readFile(path.join(dir,name)))); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  return env;
}

async function main() {
  const mode = process.argv[2];
  if (!['inspect','apply'].includes(mode)) {
    console.log('Uso: node scripts/migration/iva-backfill.mjs inspect | apply --included-16-preserve-total'); return;
  }
  if (mode==='apply') assert.equal(process.argv[3],'--included-16-preserve-total','EXPLICIT_POLICY_REQUIRED');
  const appEnv = await readEnvironment(root);
  const appUrl = new URL(appEnv.DATABASE_URL);
  assert.equal(decodeURIComponent(appUrl.pathname.slice(1)),destination,'APPLICATION_DESTINATION_MISMATCH');
  const env = mode==='apply' ? await readEnvironment(path.resolve(root,'../sistemaBodega')) : appEnv;
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.host,appUrl.host,'SERVER_MISMATCH');
  if (mode==='apply') assert.notEqual(decodeURIComponent(url.pathname.slice(1)),destination,'ADMIN_SOURCE_EXPECTATION_MISMATCH');
  url.pathname='/'+destination; url.searchParams.delete('options'); url.searchParams.delete('database'); url.searchParams.delete('dbname');
  const client = new pg.Client({connectionString:url.toString(),
    ssl:env.DB_REQUIRE_SSL==='true'?{rejectUnauthorized:env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:undefined,
    connectionTimeoutMillis:15000,statement_timeout:60000,
    options:`-c timezone=UTC${mode==='inspect'?' -c default_transaction_read_only=on':''}`,
    application_name:'llantera-iva-included-16-authorized'});
  try {
    await client.connect();
    assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,destination,'WRONG_DATABASE');
    const result = mode==='inspect' ? await inspectTaxState(client) : await applyTaxBackfill(client,{
      expectedDatabase:destination,backupRoot:path.join(root,'.migration-backups'),appRole:applicationRole});
    console.log(JSON.stringify(result,null,2));
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{
    console.error(JSON.stringify({error:error.code || (String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0]) || error.name,
      committed:error.backfillCommitted ?? false,backupDirectory:error.backupDirectory,batchId:error.backfillBatchId,
      recovery:error.backfillCommitted==='unknown'?'VERIFY_AUDIT_BATCH_BEFORE_RETRY':undefined}));process.exitCode=1;
  });
}
