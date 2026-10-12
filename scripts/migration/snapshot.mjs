import { createHash } from 'node:crypto';

export const SUPPLIER = 'COMERCIALIZADORA DE NEW TIRES';
export const TABLES = ['llantas', 'movimientos_bodega', 'producto_imagenes', 'productos', 'servicios', 'ventas', 'ventas_productos', 'app_metadata'];
export const qi = (s) => '"' + s.replaceAll('"', '""') + '"';
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const rowsHash = (rows) => sha256(JSON.stringify([...rows].sort()));

export async function readRows(client, schema, table) {
  const result = await client.query(`SELECT to_jsonb(t)::text AS row_json FROM ${qi(schema)}.${qi(table)} t ORDER BY to_jsonb(t)::text COLLATE "C"`);
  return result.rows.map((r) => r.row_json);
}

export async function readSchema(client) {
  const tables = (await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)).rows.map((r) => r.relname);
  if (JSON.stringify([...TABLES].sort()) !== JSON.stringify(tables)) throw new Error('El esquema cambió: revisar las tablas antes de migrar.');
  const unsupported = (await client.query(`SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m','S','f') UNION ALL SELECT trigger_name,'t' FROM information_schema.triggers WHERE trigger_schema='public'`)).rows;
  if (unsupported.length) throw new Error('El esquema tiene vistas, secuencias o triggers que requieren revisión explícita.');
  const columns = (await client.query(`SELECT c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expr,a.attidentity AS identity,a.attgenerated AS generated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows;
  if (columns.some((c) => c.identity || c.generated)) throw new Error('Columnas generadas requieren exportación especial.');
  const constraints = (await client.query(`SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE k.connamespace='public'::regnamespace ORDER BY CASE WHEN k.contype='f' THEN 1 ELSE 0 END,c.relname,k.conname`)).rows;
  const indexes = (await client.query(`SELECT pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace AND NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid) ORDER BY i.indexrelid::regclass::text`)).rows;
  const sql = [];
  for (const table of TABLES) {
    const defs = columns.filter((c) => c.table_name === table).map((c) => `${qi(c.name)} ${c.type}${c.default_expr ? ' DEFAULT ' + c.default_expr : ''}${c.not_null ? ' NOT NULL' : ''}`);
    if (!defs.length) throw new Error(`Faltan columnas de ${table}`);
    sql.push(`CREATE TABLE public.${qi(table)} (${defs.join(',\n')});`);
  }
  for (const c of constraints) sql.push(`ALTER TABLE public.${qi(c.table_name)} ADD CONSTRAINT ${qi(c.name)} ${c.definition};`);
  for (const i of indexes) sql.push(i.definition + ';');
  return { columns, constraints, indexes, sql: sql.join('\n') };
}

// Nunca reconstruye ventas: conserva el texto JSON generado por PostgreSQL,
// incluyendo decimales, microsegundos, nulos, JSONB y estados históricos.
export function selectSupplier(all, supplier = SUPPLIER) {
  const parsed = Object.fromEntries(TABLES.map((t) => [t, all[t].map((raw) => ({ raw, value: JSON.parse(raw) }))]));
  const selected = parsed.llantas.filter(({ value }) => value.proveedor?.trim().toUpperCase() === supplier);
  if (!selected.length) throw new Error('El proveedor no tiene registros.');
  const ids = new Set(selected.map(({ value }) => value.id));
  const sales = parsed.ventas.filter(({ value }) => value.items.some((i) => ids.has(i.llantaId)));
  const referenceIds = new Set();
  for (const { value } of sales) {
    for (const item of value.items) {
      if (!item.llantaId || item.productoId || item.servicioId) throw new Error('La venta tiene una entidad adicional que requiere revisar el alcance.');
      if (!ids.has(item.llantaId)) referenceIds.add(item.llantaId);
    }
  }
  const context = parsed.llantas.filter(({ value }) => referenceIds.has(value.id));
  if (context.length !== referenceIds.size) throw new Error('Hay referencias de venta sin llanta de origen.');
  const rows = Object.fromEntries(TABLES.map((t) => [t, []]));
  rows.llantas = selected.map((r) => r.raw);
  rows.ventas = sales.map((r) => r.raw);
  rows.movimientos_bodega = parsed.movimientos_bodega.filter(({ value }) => ids.has(value.llantaId)).map((r) => r.raw);
  rows.app_metadata = [...all.app_metadata];
  const metadata = parsed.app_metadata.find(({ value }) => value.key === 'sistema_ventas_seq')?.value.value;
  if (!metadata) throw new Error('Faltan consecutivos de ventas y garantías.');
  for (const { value } of sales) {
    const number = Number(value.folio.match(/(\d+)$/)?.[1]);
    if (!Number.isSafeInteger(number) || number > metadata.ultimoFolio) throw new Error('El consecutivo de ventas no cubre el historial.');
    const warranty = Number(value.garantia?.id?.match(/(\d+)$/)?.[1] || 0);
    if (warranty > metadata.ultimoGarantiaId) throw new Error('El consecutivo de garantías no cubre el historial.');
  }
  const totals = {};
  for (const { value } of selected) if (value.activo) for (const [warehouse, amount] of Object.entries(value.stockPorBodega)) totals[warehouse] = (totals[warehouse] || 0) + Number(amount);
  return {
    rows, context: context.map((r) => r.raw),
    summary: { supplier, tires: selected.length, activeTires: selected.filter((r) => r.value.activo).length, inactiveTires: selected.filter((r) => !r.value.activo).length, sales: sales.length, cancelledSales: sales.filter((r) => r.value.cancelada).length, mixedSales: sales.filter(({ value }) => value.items.some((i) => !ids.has(i.llantaId))).length, historicalOtherTires: context.length, movements: rows.movimientos_bodega.length, activeStockByWarehouse: totals },
  };
}

export async function capture(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const schema = await readSchema(client);
    const all = {};
    for (const t of TABLES) all[t] = await readRows(client, 'public', t);
    const selection = selectSupplier(all);
    const info = (await client.query("SELECT current_database() AS database,current_setting('server_version') AS version,clock_timestamp()::text AS snapshot_time")).rows[0];
    await client.query('ROLLBACK');
    return { format: 1, source: info, schema, all, selection };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function insertRaw(client, schema, table, rawRows) {
  // jsonb_populate_record preserves typed numeric/timestamp/bytea values without
  // round-tripping them through JavaScript numbers or Date.
  for (let offset = 0; offset < rawRows.length; offset += 100) {
    const json = '[' + rawRows.slice(offset, offset + 100).join(',') + ']';
    await client.query(`INSERT INTO ${qi(schema)}.${qi(table)} SELECT * FROM jsonb_populate_recordset(NULL::${qi(schema)}.${qi(table)}, $1::jsonb)`, [json]);
  }
}

export async function verifyRows(client, selection) {
  const tables = [];
  for (const table of TABLES) {
    const actual = await readRows(client, 'public', table);
    const expected = selection.rows[table];
    if (actual.length !== expected.length || rowsHash(actual) !== rowsHash(expected)) throw new Error(`Comparación 1:1 falló: ${table}`);
    tables.push({ table, count: actual.length, sha256: rowsHash(actual) });
  }
  const refs = await readRows(client, 'migration_context', 'llantas');
  if (rowsHash(refs) !== rowsHash(selection.context)) throw new Error('Difieren las referencias históricas de ventas mixtas.');
  return { verified: true, tables, contextTires: { count: refs.length, sha256: rowsHash(refs) } };
}
