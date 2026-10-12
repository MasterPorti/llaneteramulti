import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { TABLES, SUPPLIER, qi, sha256, rowsHash, capture, insertRaw, verifyRows, readRows } from './migration/snapshot.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.resolve(root, '../sistemaBodega');
const targetDatabase = 'llaneteramulti_new_tires';
const targetRole = 'llaneteramulti_new_tires_app';
const [mode = 'help', directory] = process.argv.slice(2);
const backups = path.join(root, '.migration-backups');

async function sourceEnv() {
  const e = {};
  for (const name of ['.env', '.env.development', '.env.local', '.env.development.local']) {
    try { Object.assign(e, dotenv.parse(await fs.readFile(path.join(sourceRoot, name)))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!e.DATABASE_URL) throw new Error('Falta la conexión de origen en sistemaBodega.');
  if (new URL(e.DATABASE_URL).pathname.slice(1) === targetDatabase) throw new Error('La conexión origen coincide con el destino.');
  return e;
}

async function connect(e, target = false, readOnly = true) {
  const url = new URL(e.DATABASE_URL);
  if (target) url.pathname = '/' + targetDatabase;
  const c = new pg.Client({ connectionString: url.toString(), ssl: e.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 15000, statement_timeout: 60000, options: `-c timezone=UTC${readOnly ? ' -c default_transaction_read_only=on' : ''}`, application_name: 'new-tires-controlled-migration' });
  await c.connect();
  const actual = (await c.query('SELECT current_database() AS name')).rows[0].name;
  if (target && actual !== targetDatabase) { await c.end(); throw new Error('Destino incorrecto.'); }
  return c;
}

async function saveJson(file, value, exclusive = true) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
}

async function loadBackup(dir) {
  if (!dir) throw new Error('Indica la carpeta del respaldo.');
  const resolved = path.resolve(root, dir);
  if (!resolved.startsWith(backups + path.sep)) throw new Error('El respaldo debe estar dentro de .migration-backups.');
  const bytes = await fs.readFile(path.join(resolved, 'source-backup.json'));
  const manifest = JSON.parse(await fs.readFile(path.join(resolved, 'manifest.json'), 'utf8'));
  if (sha256(bytes) !== manifest.backupSha256) throw new Error('El respaldo no coincide con su SHA-256.');
  const backup = JSON.parse(bytes);
  if (backup.batchId !== manifest.batchId || backup.selection.summary.supplier !== SUPPLIER) throw new Error('Respaldo de otro alcance.');
  return { dir: resolved, backup, manifest };
}

async function snapshot() {
  const e = await sourceEnv();
  const client = await connect(e);
  try {
    const backup = await capture(client);
    backup.batchId = randomUUID();
    const dir = path.join(backups, `new-tires-${new Date().toISOString().replaceAll(':', '-')}-${backup.batchId.slice(0, 8)}`);
    await fs.mkdir(dir, { recursive: true });
    const bytes = Buffer.from(JSON.stringify(backup));
    await fs.writeFile(path.join(dir, 'source-backup.json'), bytes, { flag: 'wx' });
    if (sha256(await fs.readFile(path.join(dir, 'source-backup.json'))) !== sha256(bytes)) throw new Error('La copia de respaldo falló.');
    await fs.writeFile(path.join(dir, 'source-schema.sql'), backup.schema.sql, { flag: 'wx' });
    const assets = {};
    for (const relative of ['data/barcodes.json', 'lib/config.ts', 'lib/config-sistema.ts', 'types/inventario.ts']) {
      const content = await fs.readFile(path.join(sourceRoot, relative));
      const dest = path.join(dir, 'source-files', relative);
      await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, content, { flag: 'wx' });
      assets[relative] = sha256(content);
    }
    const manifest = { batchId: backup.batchId, createdAt: new Date().toISOString(), backupSha256: sha256(bytes), schemaSha256: sha256(backup.schema.sql), sourceFiles: assets, allTables: Object.fromEntries(TABLES.map((t) => [t, { count: backup.all[t].length, sha256: rowsHash(backup.all[t]) }])), selection: backup.selection.summary };
    await saveJson(path.join(dir, 'manifest.json'), manifest);
    console.log(JSON.stringify({ backup: dir, ...backup.selection.summary }, null, 2));
  } finally { await client.end(); }
}

const targetControl = `
CREATE SCHEMA migration_control;
CREATE TABLE migration_control.destination_batch(batch_id text PRIMARY KEY,source_database text NOT NULL,supplier text NOT NULL,backup_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),source_retired boolean NOT NULL DEFAULT false);
CREATE SCHEMA migration_context;
CREATE TABLE migration_context.llantas (LIKE public.llantas INCLUDING ALL);
CREATE TABLE public.migration_imported_sales(sale_id text PRIMARY KEY REFERENCES public.ventas(id),batch_id text NOT NULL,imported_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION migration_control.protect_imported_sales() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.migration_imported_sales WHERE sale_id=OLD.id) THEN
  RAISE EXCEPTION 'Venta histórica migrada: el documento original es de solo lectura';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER protect_imported_sales BEFORE UPDATE OR DELETE ON public.ventas FOR EACH ROW EXECUTE FUNCTION migration_control.protect_imported_sales();
CREATE FUNCTION migration_control.only_selected_supplier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF upper(trim(NEW.proveedor)) IS DISTINCT FROM 'COMERCIALIZADORA DE NEW TIRES' OR NEW.dominio <> 'sistema' THEN
  RAISE EXCEPTION 'Esta base opera exclusivamente Comercializadora de New Tires';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER only_selected_supplier BEFORE INSERT OR UPDATE ON public.llantas FOR EACH ROW EXECUTE FUNCTION migration_control.only_selected_supplier();
`;

async function stage(dir) {
  const { backup, manifest, dir: resolved } = await loadBackup(dir);
  const e = await sourceEnv();
  const admin = await connect(e, false, false);
  let target;
  try {
    if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [targetDatabase])).rowCount) throw new Error('La base de destino ya existe; no se reemplaza automáticamente. Usar verify para revisar el lote existente.');
    if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [targetRole])).rowCount) throw new Error('El rol de destino ya existe; requiere revisión.');
    try { await fs.access(path.join(root, '.env.local')); throw new Error('.env.local ya existe; no se reemplaza automáticamente.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await admin.query(`CREATE DATABASE ${qi(targetDatabase)} TEMPLATE template0`);
    target = await connect(e, true, false);
    await target.query('BEGIN');
    await target.query(backup.schema.sql);
    await target.query(targetControl);
    // Inserción ordenada para respetar FK; sin ejecutar funciones de negocio.
    for (const table of ['llantas', 'producto_imagenes', 'productos', 'servicios', 'ventas', 'movimientos_bodega', 'ventas_productos', 'app_metadata']) await insertRaw(target, 'public', table, backup.selection.rows[table]);
    await insertRaw(target, 'migration_context', 'llantas', backup.selection.context);
    await target.query('INSERT INTO migration_control.destination_batch(batch_id,source_database,supplier,backup_sha256) VALUES($1,$2,$3,$4)', [backup.batchId, backup.source.database, SUPPLIER, manifest.backupSha256]);
    await target.query('INSERT INTO public.migration_imported_sales(sale_id,batch_id) SELECT id,$1 FROM public.ventas', [backup.batchId]);
    const verified = await verifyRows(target, backup.selection);
    await target.query('COMMIT');
    const password = randomBytes(36).toString('base64url');
    // Secret is generated in memory and never written to console or command line.
    await admin.query(`CREATE ROLE ${qi(targetRole)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await target.query(`REVOKE ALL ON DATABASE ${qi(targetDatabase)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${qi(targetDatabase)} TO ${qi(targetRole)}; GRANT USAGE ON SCHEMA public TO ${qi(targetRole)}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${qi(targetRole)};`);
    const appUrl = new URL(e.DATABASE_URL); appUrl.pathname = '/' + targetDatabase; appUrl.username = targetRole; appUrl.password = password;
    const env = [`DATABASE_URL=${JSON.stringify(appUrl.toString())}`,`DB_REQUIRE_SSL=${e.DB_REQUIRE_SSL === 'true'}`,`LLANTERA_EXPECTED_DATABASE=${targetDatabase}`,`LLANTERA_SUPPLIER=${JSON.stringify(SUPPLIER)}`].join('\n') + '\n';
    await fs.writeFile(path.join(root, '.env.local'), env, { flag: 'wx' });
    const report = { ...verified, batchId: backup.batchId, database: targetDatabase, verifiedAt: new Date().toISOString(), mode: 'staging_read_only', summary: backup.selection.summary };
    await saveJson(path.join(resolved, 'staging-verification.json'), report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { if (target) await target.query('ROLLBACK').catch(() => {}); throw error; }
  finally { if (target) await target.end(); await admin.end(); }
}

async function verify(dir) {
  const { backup, dir: resolved } = await loadBackup(dir);
  const c = await connect(await sourceEnv(), true);
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const batch = (await c.query('SELECT * FROM migration_control.destination_batch WHERE batch_id=$1', [backup.batchId])).rows[0];
    if (!batch) throw new Error('El destino pertenece a otro lote.');
    const report = { ...await verifyRows(c, backup.selection), batchId: backup.batchId, database: targetDatabase, verifiedAt: new Date().toISOString(), sourceRetired: batch.source_retired, summary: backup.selection.summary };
    await c.query('ROLLBACK');
    await saveJson(path.join(resolved, `verification-${Date.now()}.json`), report);
    console.log(JSON.stringify(report, null, 2));
    return report;
  } finally { await c.end(); }
}

async function cutover(dir) {
  const { backup, manifest, dir: resolved } = await loadBackup(dir);
  const { retireSource, fingerprintRetirementSnapshot } = await import('./migration/retirement.mjs');
  const evidence = JSON.parse(await fs.readFile(path.join(resolved, 'application-verification.json'), 'utf8'));
  if (evidence.batchId !== backup.batchId || evidence.verified !== true) throw new Error('Falta verificar la aplicación contra este lote antes del corte.');
  const expected = { llantas: backup.selection.rows.llantas, ventas: backup.selection.rows.ventas, movimientos_bodega: backup.selection.rows.movimientos_bodega };
  const e = await sourceEnv(); const source = await connect(e, false, false); const target = await connect(e, true, false);
  let sourceCommitted = false;
  let targetCommitted = false;
  try {
    await source.query('BEGIN');
    await source.query("SET LOCAL lock_timeout='8s'");
    await source.query('LOCK TABLE public.llantas,public.ventas,public.movimientos_bodega IN SHARE ROW EXCLUSIVE MODE');
    await target.query('BEGIN');
    await target.query("SET LOCAL lock_timeout='8s'");
    await target.query('LOCK TABLE public.llantas,public.ventas,public.movimientos_bodega IN SHARE ROW EXCLUSIVE MODE');
    const batch = (await target.query('SELECT * FROM migration_control.destination_batch WHERE batch_id=$1 FOR UPDATE',[backup.batchId])).rows[0];
    if (!batch || batch.source_retired) throw new Error('Lote inexistente o ya retirado.');
    const verification = await verifyRows(target, backup.selection);
    // Check every row of the three affected source tables under the same locks.
    // The only permitted business change is activo=false for the selected IDs.
    const selectedIds = expected.llantas.map((raw) => JSON.parse(raw).id);
    const projectedTires = (await source.query(`SELECT
      (CASE WHEN id=ANY($1::text[]) THEN to_jsonb(t)||jsonb_build_object('activo',false)
        ELSE to_jsonb(t) END)::text AS row_json FROM public.llantas t`, [selectedIds])).rows.map((r) => r.row_json);
    const expectedSourceHashes = {
      llantas: rowsHash(projectedTires),
      ventas: rowsHash(await readRows(source, 'public', 'ventas')),
      movimientos_bodega: rowsHash(await readRows(source, 'public', 'movimientos_bodega')),
    };
    const targetVerification = { verified: true, database: targetDatabase, sourceFingerprint: fingerprintRetirementSnapshot(expected), verifiedAt: new Date().toISOString(), reportSha256: sha256(JSON.stringify(verification)) };
    const retirement = await retireSource(source, { batchId: backup.batchId, supplier: SUPPLIER, expected, targetVerification });
    const sourceAfterHashes = {};
    for (const table of Object.keys(expectedSourceHashes)) {
      sourceAfterHashes[table] = rowsHash(await readRows(source, 'public', table));
      if (sourceAfterHashes[table] !== expectedSourceHashes[table]) throw new Error(`El retiro cambió datos adicionales en ${table}; se revierte la transacción.`);
    }
    await saveJson(path.join(resolved, 'cutover-precommit.json'), { batchId: backup.batchId, backupSha256: manifest.backupSha256, targetVerification, retirement, sourceAfterHashes, onlySourceActiveFlagsChanged: true });
    await source.query('COMMIT'); sourceCommitted = true;
    // Origin retires first. If activation fails, destination remains read-only,
    // avoiding two writable copies; activation can be recovered deliberately.
    await target.query(`GRANT INSERT,UPDATE,DELETE ON public.llantas,public.movimientos_bodega,public.ventas,public.productos,public.servicios,public.ventas_productos,public.producto_imagenes TO ${qi(targetRole)}; GRANT UPDATE ON public.app_metadata TO ${qi(targetRole)};`);
    await target.query('UPDATE migration_control.destination_batch SET source_retired=true WHERE batch_id=$1',[backup.batchId]);
    await target.query('COMMIT');
    targetCommitted = true;
    const report = { batchId: backup.batchId, completedAt: new Date().toISOString(), sourceRetired: true, targetWritable: true, targetDatabase, summary: backup.selection.summary, targetVerification };
    await saveJson(path.join(resolved, 'cutover-complete.json'), report);
    console.log(JSON.stringify(report,null,2));
  } catch (error) {
    await source.query('ROLLBACK').catch(()=>{}); await target.query('ROLLBACK').catch(()=>{});
    if (targetCommitted) console.error('El retiro y la activación ya se confirmaron en PostgreSQL; falló guardar el informe local. Verificar el estado antes de cualquier reintento.');
    else if (sourceCommitted) console.error('El origen ya fue retirado; el destino permanece protegido. Revisar cutover-precommit antes de recuperar la activación.');
    throw error;
  } finally { await source.end(); await target.end(); }
}

try {
  if (mode === 'snapshot') await snapshot();
  else if (mode === 'stage') await stage(directory);
  else if (mode === 'verify') await verify(directory);
  else if (mode === 'cutover') await cutover(directory);
  else console.log('Uso: node scripts/migrate-new-tires.mjs snapshot | stage <respaldo> | verify <respaldo> | cutover <respaldo>\nSnapshot: solo lectura en origen. Stage: crea destino nuevo, nunca reemplaza uno existente. Cutover exige verificación de aplicación y cotejo final.');
} catch (error) {
  // Do not print connection strings, pg parameters, credentials or complete rows.
  console.error(JSON.stringify({ error: error.code || 'MIGRATION_STOPPED', message: (error.message || '').replace(/postgres(?:ql)?:\/\/\S+/gi, '[conexión omitida]') }));
  process.exitCode = 1;
}
