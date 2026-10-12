/**
 * Source retirement, deliberately not a CLI. The caller owns BEGIN/COMMIT/ROLLBACK,
 * the destination verification, and the durable backup. No connection is opened here.
 * Raw rows must come from to_jsonb(t)::text in UTC: never parse/re-serialize numeric
 * or timestamp values before passing them to this module.
 */
import { createHash } from 'node:crypto';

export const RETIREMENT_VERSION = 'llaneteramulti-source-retirement/v1';
const TABLES = ['llantas', 'ventas', 'movimientos_bodega'];
const HASH = /^[a-f0-9]{64}$/;
const normalizeSupplier = (value) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const supplierSQL = (value) => `upper(regexp_replace(btrim(${value}), '[[:space:]]+', ' ', 'g'))`;
const quoted = (value) => `'${value.replaceAll("'", "''")}'`;

function checkedText(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new Error(`${label} must be a nonempty string without NUL bytes`);
  }
  return value;
}

function preparedSnapshot(expected) {
  const output = {};
  for (const table of TABLES) {
    if (!Array.isArray(expected?.[table])) throw new Error(`Missing raw snapshot: ${table}`);
    const seen = new Set();
    output[table] = expected[table].map((raw) => {
      if (typeof raw !== 'string') throw new Error(`${table}: expected raw row_json strings`);
      const row = JSON.parse(raw);
      if (!row || Array.isArray(row) || typeof row !== 'object') throw new Error(`${table}: invalid row`);
      checkedText(row.id, `${table}.id`);
      if (seen.has(row.id)) throw new Error(`${table}: duplicate ID ${row.id}`);
      seen.add(row.id);
      return { id: row.id, raw, row };
    }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  }
  if (!output.llantas.length) throw new Error('Cannot retire an empty supplier');
  const tireIds = new Set(output.llantas.map(({ id }) => id));
  for (const { row } of output.llantas) {
    if (typeof row.activo !== 'boolean' || typeof row.proveedor !== 'string') {
      throw new Error('Every tire must preserve its original boolean activo and supplier');
    }
  }
  for (const { row } of output.ventas) {
    if (!Array.isArray(row.items) || !row.items.some((item) => tireIds.has(item?.llantaId))) {
      throw new Error(`Sale ${row.id} does not reference a selected tire`);
    }
  }
  for (const { row } of output.movimientos_bodega) {
    if (!tireIds.has(row.llantaId)) throw new Error(`Movement ${row.id} is outside the supplier`);
  }
  return output;
}

const rawArray = (rows) => `[${rows.map(({ raw }) => raw).join(',')}]`;

export function fingerprintRetirementSnapshot(expected) {
  const snapshot = preparedSnapshot(expected);
  const hash = createHash('sha256');
  for (const table of TABLES) {
    hash.update(JSON.stringify([table, snapshot[table].map(({ raw }) => raw)]));
  }
  return hash.digest('hex');
}

const selectors = {
  llantas: `SELECT t.* FROM public.llantas t WHERE ${supplierSQL('t.proveedor')} = $1`,
  ventas: `SELECT t.* FROM public.ventas t WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.items) = 'array' THEN t.items ELSE '[]'::jsonb END) item
    JOIN public.llantas l ON l.id = item->>'llantaId' WHERE ${supplierSQL('l.proveedor')} = $1)`,
  movimientos_bodega: `SELECT t.* FROM public.movimientos_bodega t JOIN public.llantas l ON l.id = t."llantaId"
    WHERE ${supplierSQL('l.proveedor')} = $1`,
};

/** The caller must set UTC (and use a consistent snapshot) before this read. */
export async function readRetirementSnapshot(client, supplier) {
  const normalized = normalizeSupplier(checkedText(supplier, 'supplier'));
  const result = {};
  for (const table of TABLES) {
    const rows = await client.query(`SELECT to_jsonb(t)::text AS row_json FROM (${selectors[table]}) t ORDER BY t.id`, [normalized]);
    result[table] = rows.rows.map(({ row_json }) => row_json);
  }
  preparedSnapshot(result);
  return result;
}

const functionBodies = {
  guard_llantas: `
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM migration_control.archived_llantas a JOIN migration_control.retirement_batches b ON b.batch_id = a.batch_id
    WHERE a.llanta_id = OLD.id AND b.status = 'retired'
  ) THEN RAISE EXCEPTION 'Llanta trasladada: historial de origen protegido (%)', OLD.id USING ERRCODE = '55000'; END IF;
  IF TG_OP <> 'DELETE' AND (
    EXISTS (SELECT 1 FROM migration_control.archived_llantas a JOIN migration_control.retirement_batches b ON b.batch_id = a.batch_id
      WHERE a.llanta_id = NEW.id AND b.status = 'retired')
    OR EXISTS (SELECT 1 FROM migration_control.retirement_batches b
      WHERE b.status = 'retired' AND b.supplier_normalized = ${supplierSQL('NEW.proveedor')})
  ) THEN RAISE EXCEPTION 'Proveedor trasladado: operación exclusiva en la base de destino' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;`,
  guard_ventas: `
DECLARE old_items jsonb := '[]'::jsonb; new_items jsonb := '[]'::jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_items := CASE WHEN jsonb_typeof(OLD.items) = 'array' THEN OLD.items ELSE '[]'::jsonb END;
    IF EXISTS (SELECT 1 FROM migration_control.archived_sales a JOIN migration_control.retirement_batches b ON b.batch_id = a.batch_id
      WHERE a.sale_id = OLD.id AND b.status = 'retired')
    THEN RAISE EXCEPTION 'Venta trasladada: no se permite cancelar ni modificar el historial de origen (%)', OLD.id USING ERRCODE = '55000'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_items := CASE WHEN jsonb_typeof(NEW.items) = 'array' THEN NEW.items ELSE '[]'::jsonb END;
    IF EXISTS (SELECT 1 FROM migration_control.archived_sales a JOIN migration_control.retirement_batches b ON b.batch_id = a.batch_id
      WHERE a.sale_id = NEW.id AND b.status = 'retired')
    THEN RAISE EXCEPTION 'ID de venta trasladada protegido (%)', NEW.id USING ERRCODE = '55000'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(old_items || new_items) item
    JOIN migration_control.archived_llantas a ON a.llanta_id = item->>'llantaId'
    JOIN migration_control.retirement_batches b ON b.batch_id = a.batch_id WHERE b.status = 'retired')
  THEN RAISE EXCEPTION 'La venta contiene llantas trasladadas: operación exclusiva en destino' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;`,
  guard_movimientos: `
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM migration_control.archived_llantas a JOIN migration_control.retirement_batches b ON b.batch_id = a.batch_id
    WHERE a.llanta_id = OLD."llantaId" AND b.status = 'retired'
  ) THEN RAISE EXCEPTION 'Movimiento histórico trasladado protegido (%)', OLD.id USING ERRCODE = '55000'; END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1 FROM migration_control.archived_llantas a JOIN migration_control.retirement_batches b ON b.batch_id = a.batch_id
    WHERE a.llanta_id = NEW."llantaId" AND b.status = 'retired'
  ) THEN RAISE EXCEPTION 'No se permiten movimientos de llantas trasladadas' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;`,
  guard_truncate: `
BEGIN
  IF EXISTS (SELECT 1 FROM migration_control.retirement_batches WHERE status = 'retired')
  THEN RAISE EXCEPTION 'TRUNCATE impediría conservar el historial trasladado' USING ERRCODE = '55000'; END IF;
  RETURN NULL;
END;`,
};

const guardTables = { llantas: 'guard_llantas', ventas: 'guard_ventas', movimientos_bodega: 'guard_movimientos' };

/** Versioned DDL for review. installRetirementControls validates existing objects. */
export function getRetirementDDL() {
  return `CREATE SCHEMA migration_control;
COMMENT ON SCHEMA migration_control IS ${quoted(RETIREMENT_VERSION)};
REVOKE ALL ON SCHEMA migration_control FROM PUBLIC;
CREATE TABLE migration_control.retirement_batches (
  batch_id text PRIMARY KEY,
  supplier_normalized text NOT NULL UNIQUE,
  source_database text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  target_verification jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('preparing', 'retired', 'restoring', 'restored')),
  retired_at timestamptz,
  restored_at timestamptz,
  rollback_evidence jsonb
);
CREATE TABLE migration_control.archived_llantas (
  llanta_id text PRIMARY KEY, batch_id text NOT NULL REFERENCES migration_control.retirement_batches(batch_id), original_row jsonb NOT NULL
);
CREATE TABLE migration_control.archived_sales (
  sale_id text PRIMARY KEY, batch_id text NOT NULL REFERENCES migration_control.retirement_batches(batch_id), original_row jsonb NOT NULL
);
CREATE TABLE migration_control.archived_movements (
  movement_id text PRIMARY KEY, batch_id text NOT NULL REFERENCES migration_control.retirement_batches(batch_id), original_row jsonb NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA migration_control FROM PUBLIC;
${Object.entries(functionBodies).map(([name, body]) => `CREATE FUNCTION migration_control.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $retirement$${body}$retirement$;
REVOKE ALL ON FUNCTION migration_control.${name}() FROM PUBLIC;`).join('\n')}
${Object.entries(guardTables).map(([table, fn]) => `CREATE TRIGGER migration_retirement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.${table}
FOR EACH ROW EXECUTE FUNCTION migration_control.${fn}();
CREATE TRIGGER migration_retirement_truncate BEFORE TRUNCATE ON public.${table}
FOR EACH STATEMENT EXECUTE FUNCTION migration_control.guard_truncate();
ALTER TABLE public.${table} ENABLE ALWAYS TRIGGER migration_retirement_guard;
ALTER TABLE public.${table} ENABLE ALWAYS TRIGGER migration_retirement_truncate;`).join('\n')}`;
}

const columns = {
  retirement_batches: [
    ['batch_id', 'text', true], ['supplier_normalized', 'text', true], ['source_database', 'text', true],
    ['fingerprint', 'text', true], ['target_verification', 'jsonb', true], ['status', 'text', true],
    ['retired_at', 'timestamp with time zone', false], ['restored_at', 'timestamp with time zone', false], ['rollback_evidence', 'jsonb', false],
  ],
  archived_llantas: [['llanta_id', 'text', true], ['batch_id', 'text', true], ['original_row', 'jsonb', true]],
  archived_sales: [['sale_id', 'text', true], ['batch_id', 'text', true], ['original_row', 'jsonb', true]],
  archived_movements: [['movement_id', 'text', true], ['batch_id', 'text', true], ['original_row', 'jsonb', true]],
};

async function installRetirementControls(client) {
  const existing = await client.query(`SELECT obj_description(oid, 'pg_namespace') AS version FROM pg_namespace WHERE nspname = 'migration_control'`);
  if (!existing.rows.length) {
    await client.query(getRetirementDDL());
    return;
  }
  if (existing.rows[0].version !== RETIREMENT_VERSION) throw new Error('Existing migration_control has an unknown version; refusing to replace it');
  const structure = await client.query(`SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull AS not_null
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'migration_control' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum`);
  const actual = {};
  for (const row of structure.rows) (actual[row.table_name] ??= []).push([row.column_name, row.data_type, row.not_null]);
  for (const [name, shape] of Object.entries(columns)) {
    if (JSON.stringify(actual[name]) !== JSON.stringify(shape)) throw new Error(`Retirement table contract differs: ${name}`);
  }
  const constraints = await client.query(`SELECT c.relname AS table_name, con.contype AS type,
    ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, pos)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ORDER BY k.pos) AS columns,
    fc.relname AS foreign_table, fn.nspname AS foreign_schema,
    ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, pos)
      JOIN pg_attribute a ON a.attrelid = fc.oid AND a.attnum = k.attnum ORDER BY k.pos) AS foreign_columns,
    con.convalidated AS validated, con.condeferrable AS deferrable
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class fc ON fc.oid = con.confrelid LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
    WHERE n.nspname = 'migration_control'`);
  for (const [table, shape] of Object.entries(columns)) {
    const primary = constraints.rows.find((row) => row.table_name === table && row.type === 'p');
    if (!primary || primary.deferrable || JSON.stringify(primary.columns) !== JSON.stringify([shape[0][0]])) {
      throw new Error(`Retirement primary key differs: ${table}`);
    }
    if (table === 'retirement_batches') {
      if (!constraints.rows.some((row) => row.table_name === table && row.type === 'u' && !row.deferrable && JSON.stringify(row.columns) === '["supplier_normalized"]')) {
        throw new Error('Retirement supplier uniqueness constraint missing');
      }
    } else if (!constraints.rows.some((row) => row.table_name === table && row.type === 'f' && row.validated && !row.deferrable
      && JSON.stringify(row.columns) === '["batch_id"]' && row.foreign_schema === 'migration_control' && row.foreign_table === 'retirement_batches' && JSON.stringify(row.foreign_columns) === '["batch_id"]')) {
      throw new Error(`Retirement batch foreign key differs: ${table}`);
    }
  }
  const functions = await client.query(`SELECT p.proname AS name, p.prosrc AS body, p.prosecdef AS security_definer, p.proconfig AS config,
    p.provolatile AS volatility, p.prorettype = 'pg_catalog.trigger'::regtype AS returns_trigger
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'migration_control' AND p.pronargs = 0`);
  for (const [name, body] of Object.entries(functionBodies)) {
    const actualFunction = functions.rows.find((row) => row.name === name);
    if (!actualFunction || actualFunction.body !== body || !actualFunction.security_definer || actualFunction.volatility !== 'v' || !actualFunction.returns_trigger || !actualFunction.config?.includes('search_path=pg_catalog')) {
      throw new Error(`Retirement guard differs: ${name}`);
    }
  }
  const triggers = await client.query(`SELECT c.relname AS table_name, t.tgname AS name, t.tgtype AS type, t.tgenabled AS enabled, p.proname AS function_name, pn.nspname AS function_schema,
    t.tgqual IS NULL AS unconditional, t.tgnargs AS argument_count, cardinality(t.tgattr::smallint[]) AS column_count
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'public' AND t.tgname IN ('migration_retirement_guard', 'migration_retirement_truncate')`);
  for (const [table, fn] of Object.entries(guardTables)) {
    for (const [name, type, functionName] of [['migration_retirement_guard', 31, fn], ['migration_retirement_truncate', 34, 'guard_truncate']]) {
      const found = triggers.rows.find((row) => row.table_name === table && row.name === name);
      if (!found || Number(found.type) !== type || found.enabled !== 'A' || found.function_name !== functionName || found.function_schema !== 'migration_control'
        || !found.unconditional || Number(found.argument_count) !== 0 || Number(found.column_count) !== 0) {
        throw new Error(`Retirement trigger differs: ${table}.${name}`);
      }
    }
  }
}

async function lockSource(client) {
  // PostgreSQL refuses LOCK TABLE outside an explicit transaction. Keep all locks
  // until the caller commits; never acquire a new client or commit in this module.
  await client.query('LOCK TABLE public.llantas, public.ventas, public.movimientos_bodega IN SHARE ROW EXCLUSIVE MODE');
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const { rows } = await client.query('SELECT current_database() AS database');
  return rows[0].database;
}

async function assertSnapshotMatches(client, normalized, snapshot, retired = false) {
  for (const table of TABLES) {
    const expectedRow = retired && table === 'llantas' ? `e.row || '{"activo":false}'::jsonb` : 'e.row';
    const result = await client.query(`WITH expected AS (SELECT value AS row FROM jsonb_array_elements($2::jsonb)), actual AS (${selectors[table]})
      SELECT COALESCE(e.row->>'id', a.id) AS id FROM expected e FULL JOIN actual a ON a.id = e.row->>'id'
      WHERE e.row IS NULL OR a.id IS NULL OR to_jsonb(a) IS DISTINCT FROM (${expectedRow}) LIMIT 1`, [normalized, rawArray(snapshot[table])]);
    if (result.rows.length) throw new Error(`Source changed or snapshot is incomplete: ${table}/${result.rows[0].id}`);
  }
}

const archives = {
  llantas: ['archived_llantas', 'llanta_id'],
  ventas: ['archived_sales', 'sale_id'],
  movimientos_bodega: ['archived_movements', 'movement_id'],
};

async function assertArchivesMatch(client, batchId, snapshot) {
  for (const table of TABLES) {
    const [archive, idColumn] = archives[table];
    const result = await client.query(`WITH expected AS (SELECT value AS row FROM jsonb_array_elements($2::jsonb)), actual AS (
      SELECT * FROM migration_control.${archive} WHERE batch_id = $1)
      SELECT COALESCE(e.row->>'id', a.${idColumn}) AS id FROM expected e FULL JOIN actual a ON a.${idColumn} = e.row->>'id'
      WHERE e.row IS NULL OR a.${idColumn} IS NULL OR a.original_row IS DISTINCT FROM e.row LIMIT 1`, [batchId, rawArray(snapshot[table])]);
    if (result.rows.length) throw new Error(`Retirement audit does not match original backup: ${table}`);
  }
}

function validatedRequest(options) {
  const batchId = checkedText(options?.batchId, 'batchId');
  const supplier = normalizeSupplier(checkedText(options?.supplier, 'supplier'));
  const snapshot = preparedSnapshot(options?.expected);
  if (snapshot.llantas.some(({ row }) => normalizeSupplier(row.proveedor) !== supplier)) throw new Error('Snapshot contains a different supplier');
  const fingerprint = fingerprintRetirementSnapshot(options.expected);
  const verification = options.targetVerification;
  if (verification?.verified !== true || verification.sourceFingerprint !== fingerprint || !HASH.test(verification.reportSha256 ?? '') || !Number.isFinite(Date.parse(verification.verifiedAt))) {
    throw new Error('A successful destination verification for this exact snapshot is required');
  }
  checkedText(verification.database, 'verified destination database');
  return { batchId, supplier, snapshot, fingerprint, verification };
}

/**
 * Only activo is changed in source rows; dates, quantities, JSON snapshots and all
 * related history stay intact. A failure requires ROLLBACK of the caller's entire
 * transaction. The result is provisional until the caller successfully COMMITs.
 */
export async function retireSource(client, options) {
  const { batchId, supplier, snapshot, fingerprint, verification } = validatedRequest(options);
  const sourceDatabase = await lockSource(client);
  if (sourceDatabase === verification.database) throw new Error('Destination must be a different database from source');
  await installRetirementControls(client);
  const existing = await client.query('SELECT * FROM migration_control.retirement_batches WHERE batch_id = $1 FOR UPDATE', [batchId]);
  if (existing.rows.length) {
    const batch = existing.rows[0];
    if (batch.fingerprint !== fingerprint || batch.supplier_normalized !== supplier || batch.source_database !== sourceDatabase || batch.status !== 'retired'
      || batch.target_verification?.database !== verification.database) {
      throw new Error('Batch already exists with different data or is not retired');
    }
    await assertArchivesMatch(client, batchId, snapshot);
    await assertSnapshotMatches(client, supplier, snapshot, true);
    return { batchId, fingerprint, alreadyRetired: true, counts: Object.fromEntries(TABLES.map((table) => [table, snapshot[table].length])) };
  }
  await assertSnapshotMatches(client, supplier, snapshot);
  await client.query(`INSERT INTO migration_control.retirement_batches
    (batch_id, supplier_normalized, source_database, fingerprint, target_verification, status) VALUES ($1, $2, $3, $4, $5::jsonb, 'preparing')`,
  [batchId, supplier, sourceDatabase, fingerprint, JSON.stringify(verification)]);
  for (const table of TABLES) {
    const [archive, idColumn] = archives[table];
    await client.query(`INSERT INTO migration_control.${archive} (${idColumn}, batch_id, original_row)
      SELECT value->>'id', $1, value FROM jsonb_array_elements($2::jsonb)`, [batchId, rawArray(snapshot[table])]);
  }
  // Do not use application soft-delete functions: they overwrite updatedAt.
  const updated = await client.query(`UPDATE public.llantas l SET activo = false
    FROM migration_control.archived_llantas a WHERE a.batch_id = $1 AND l.id = a.llanta_id AND l.activo = true`, [batchId]);
  const expectedActive = snapshot.llantas.filter(({ row }) => row.activo).length;
  if (updated.rowCount !== expectedActive) throw new Error('Unexpected active tire count while retiring source');
  await assertSnapshotMatches(client, supplier, snapshot, true);
  await assertArchivesMatch(client, batchId, snapshot);
  await client.query("UPDATE migration_control.retirement_batches SET status = 'retired', retired_at = clock_timestamp() WHERE batch_id = $1 AND status = 'preparing'", [batchId]);
  return { batchId, fingerprint, alreadyRetired: false, activeRetired: expectedActive, counts: Object.fromEntries(TABLES.map((table) => [table, snapshot[table].length])) };
}

/**
 * Future recovery only: stop destination writes first and verify a durable source
 * backup plus any destination changes. This helper does not reconcile later sales.
 * The caller must supply the original raw backup and own the entire transaction.
 */
export async function rollbackSourceRetirement(client, options) {
  const batchId = checkedText(options?.batchId, 'batchId');
  const reason = checkedText(options?.reason, 'rollback reason');
  const snapshot = preparedSnapshot(options?.expected);
  const fingerprint = fingerprintRetirementSnapshot(options.expected);
  if (options.expectedFingerprint !== fingerprint || options.targetQuiesced !== true || options.backupVerified?.sourceFingerprint !== fingerprint || !HASH.test(options.backupVerified?.reportSha256 ?? '') || options.destinationChangesReconciled !== true) {
    throw new Error('Rollback requires verified backup, exact fingerprint, stopped destination and reconciled destination changes');
  }
  const sourceDatabase = await lockSource(client);
  await installRetirementControls(client);
  const existing = await client.query('SELECT * FROM migration_control.retirement_batches WHERE batch_id = $1 FOR UPDATE', [batchId]);
  const batch = existing.rows[0];
  if (!batch || batch.fingerprint !== fingerprint || batch.source_database !== sourceDatabase || !['retired', 'restored'].includes(batch.status)) throw new Error('No matching completed retirement batch');
  if (snapshot.llantas.some(({ row }) => normalizeSupplier(row.proveedor) !== batch.supplier_normalized)) throw new Error('Rollback supplier differs');
  await assertArchivesMatch(client, batchId, snapshot);
  await assertSnapshotMatches(client, batch.supplier_normalized, snapshot, batch.status === 'retired');
  if (batch.status === 'restored') return { batchId, fingerprint, alreadyRestored: true };
  const evidence = { reason, backupVerified: options.backupVerified, targetQuiesced: true, destinationChangesReconciled: true };
  await client.query("UPDATE migration_control.retirement_batches SET status = 'restoring', rollback_evidence = $2::jsonb WHERE batch_id = $1 AND status = 'retired'", [batchId, JSON.stringify(evidence)]);
  await client.query(`UPDATE public.llantas l SET activo = (a.original_row->>'activo')::boolean
    FROM migration_control.archived_llantas a WHERE a.batch_id = $1 AND l.id = a.llanta_id AND l.activo IS DISTINCT FROM (a.original_row->>'activo')::boolean`, [batchId]);
  await assertSnapshotMatches(client, batch.supplier_normalized, snapshot);
  await client.query("UPDATE migration_control.retirement_batches SET status = 'restored', restored_at = clock_timestamp() WHERE batch_id = $1 AND status = 'restoring'", [batchId]);
  return { batchId, fingerprint, alreadyRestored: false };
}
