import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
function loadModule(filename, db, cache = new Map()) {
  filename = path.resolve(root, filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename); cache.set(filename, mod);
  const native = createRequire(filename);
  mod.require = name => {
    if (name === 'server-only') return {};
    if (name === '@/lib/db') return db;
    if (name.startsWith('@/') || name.startsWith('.')) {
      let target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      if (!path.extname(target)) target += '.ts';
      return loadModule(target, db, cache);
    }
    return native(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return mod.exports;
}
const sampleRow = overrides => ({
  id: 'sale', folio: 'SI-0001', cliente: { nombre: 'Cliente de prueba' }, origen_app: 'negra',
  items: [{ llantaId: 'tire-new', bodega: 'bodega-1', llantaSnapshot: { marca: 'A', modelo: 'B', medida: '205/55R16' }, cantidad: 1, precioUnitario: '640.00', subtotal: 640 },
    { llantaId: 'tire-other', bodega: 'bodega-1', llantaSnapshot: { marca: 'C', modelo: 'D', medida: '205/55R16' }, cantidad: 1, precioUnitario: 710, subtotal: 710 }],
  subtotal: 1163.79, iva: 186.21, total: 1350, metodoPago: 'transferencia', fechaVenta: '2026-10-13T12:00:00.123456Z',
  imported_read_only: true, new_tires_indexes: [0], raw_document: '{"id":"sale","original":true}', ...overrides,
});
function fakeDatabase() {
  let state = { operations: {}, sales: {}, productSales: {}, movements: [], counters: {}, products: {},
    services: { service: { id: 'service', nombre: 'Servicio', precioDefault: 30, activo: true } },
    tires: { tire: { id: 'tire', marca: 'Marca', modelo: 'Modelo', medida: '205/55R16', proveedor: 'COMERCIALIZADORA DE NEW TIRES',
      origen_app: 'negra', precioVenta: 1190, precioCompra: null, activo: true, stockPorBodega: { 'bodega-1': 2 } } } };
  const events = [];
  let loseCommit = false;
  const result = rows => ({ rows, rowCount: rows.length });
  async function query(sql, p = []) {
    events.push(sql);
    if (sql.includes('pg_advisory_xact_lock')) return result([]);
    if (sql.startsWith('SELECT document_text FROM shared_archive.sale_originals')) return result([]);
    if (sql.startsWith('SELECT row_to_json(v)::text AS original FROM public.')) {
      const table = sql.includes('public.ventas_productos') ? state.productSales : state.sales;
      return result(table[p[0]] ? [{ original: JSON.stringify(table[p[0]]) }] : []);
    }
    if (sql.startsWith('SELECT * FROM shared_runtime.operations')) return result(state.operations[p[0]] ? [state.operations[p[0]]] : []);
    if (sql.includes("'ventas'::text AS kind") && sql.includes('request_id')) return result([
      ...Object.values(state.sales).filter(s => s.request_id === p[0]).map(s => ({ ...s, kind: 'ventas' })),
      ...Object.values(state.productSales).filter(s => s.request_id === p[0]).map(s => ({ ...s, kind: 'ventas_productos' })),
    ]);
    if (sql.startsWith('SELECT id FROM ')) return result([]);
    if (sql.startsWith('SELECT * FROM llantas')) {
      const row = state.tires[p[0]];
      const provider = row?.proveedor?.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX');
      if (!row || (sql.includes('activo=true') && !row.activo) || (sql.includes('regexp_replace') && provider !== 'COMERCIALIZADORA DE NEW TIRES')) return result([]);
      return result([structuredClone(row)]);
    }
    if (sql.startsWith('SELECT * FROM productos')) return result(state.products[p[0]] ? [structuredClone(state.products[p[0]])] : []);
    if (sql.startsWith('SELECT * FROM servicios')) return result(state.services[p[0]] ? [structuredClone(state.services[p[0]])] : []);
    if (sql.startsWith('UPDATE llantas SET')) { state.tires[p[0]].stockPorBodega = JSON.parse(p[1]); return result([]); }
    if (sql.startsWith('UPDATE productos SET stock=stock-')) { state.products[p[0]].stock -= p[1]; return result([]); }
    if (sql.startsWith('UPDATE productos SET stock=$2')) { state.products[p[0]].stock = p[1]; return result([]); }
    if (sql.startsWith('INSERT INTO movimientos_bodega')) { state.movements.push(p); return result([]); }
    if (sql.includes('shared_runtime.next_folio')) {
      const prefix = p[0]; state.counters[prefix] = (state.counters[prefix] ?? 0) + 1;
      return result([{ folio: `${prefix}${String(state.counters[prefix]).padStart(4, '0')}` }]);
    }
    if (sql.includes('shared_runtime.next_warranty_id')) return result([{ id: `GAR-${p[0]}-0001` }]);
    if (sql.startsWith('INSERT INTO ventas(')) {
      const [id, folio, customer, lines, subtotal, iva, total, payment, warranty, domain, requestId, hash] = p;
      const items = JSON.parse(lines);
      state.sales[id] = sampleRow({ id, folio, cliente: JSON.parse(customer), items, subtotal, iva, total, metodoPago: payment,
        garantia: JSON.parse(warranty), dominio: domain, origen_app: 'blanca', request_id: requestId, request_hash: hash,
        cancelada: false, facturada: false, imported_read_only: false, iva_politica: 'incluido_16',
        new_tires_indexes: items.flatMap((item, index) => item.proveedorClave === 'COMERCIALIZADORA DE NEW TIRES' ? [index] : []) });
      return result([]);
    }
    if (sql.startsWith('INSERT INTO shared_runtime.operations')) {
      state.operations[p[0]] = { id: p[0], request_hash: p[1], application: 'blanca', status: sql.includes("'released'") ? 'released' : 'committed',
        sale_kind: sql.includes("'released'") ? null : sql.includes("'ventas',$3") ? 'ventas' : p[2],
        sale_id: sql.includes("'ventas',$3") ? p[2] : p[3] ?? null };
      return result([]);
    }
    if (sql.startsWith('UPDATE ventas SET cancelada')) {
      const s = state.sales[p[0]]; s.cancelada = true; s.motivoCancelacion = p[1]; if (s.garantia) s.garantia.activa = false;
      return result([]);
    }
    if (sql.startsWith('SELECT v.*,row_to_json(v)')) {
      const table = sql.includes('FROM public.ventas_productos v') ? state.productSales : state.sales;
      let rows = Object.values(table);
      if (sql.includes('WHERE v.id=$1')) rows = rows.filter(s => s.id === p[0]);
      if (sql.includes('WHERE v.folio=$1')) rows = rows.filter(s => s.folio === p[0]);
      if (sql.includes("upper(v.garantia->>'id')=upper($1)")) rows = rows.filter(s => s.garantia?.id?.toUpperCase() === p[0].toUpperCase());
      const resetParameter = sql.match(/v\.origen_app='blanca' AND NOT \(v\.id=ANY\(\$(\d+)::text\[\]\)\)/);
      if (resetParameter) rows = rows.filter(s => s.origen_app === 'blanca' && !p[Number(resetParameter[1]) - 1].includes(s.id));
      if (sql.includes("coalesce((to_jsonb(v)->>'cancelada')::boolean,false)=false")) rows = rows.filter(s => !s.cancelada);
      const from = sql.match(/AND v\.(?:"fechaVenta"|fecha)>=\$(\d+)::timestamptz/);
      if (from) rows = rows.filter(s => Date.parse(s.fechaVenta ?? s.fecha) >= Date.parse(p[Number(from[1]) - 1]));
      const until = sql.match(/AND v\.(?:"fechaVenta"|fecha)<=\$(\d+)::timestamptz/);
      if (until) rows = rows.filter(s => Date.parse(s.fechaVenta ?? s.fecha) <= Date.parse(p[Number(until[1]) - 1]));
      const scoped = rows.filter(s => !sql.includes('NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.items)')
        || table === state.productSales || !s.items.some(item => item.llantaId) || s.new_tires_indexes.length);
      return result(scoped.map(s => ({ ...structuredClone(s), raw_document: JSON.stringify(s) })));
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  }
  const database = {
    db: { query },
    transaction: async fn => {
      events.push('BEGIN'); const before = structuredClone(state);
      let value;
      try { value = await fn({ query }); } catch (error) { state = before; events.push('ROLLBACK'); throw error; }
      events.push('COMMIT');
      if (loseCommit) { loseCommit = false; throw new Error('Simulated acknowledgement lost'); }
      return value;
    },
  };
  return { database, events, get state() { return state; }, loseNextCommit() { loseCommit = true; } };
}
const input = (overrides = {}) => ({ operacionId: 'test-operation-0001', clienteNombre: 'Cliente de prueba',
  items: [{ tipo: 'producto', id: 'tire', bodega: 'bodega-1', cantidad: 2 }], metodoPago: 'efectivo', generarFactura: false, sinGarantia: true, ...overrides });

test('mixed historical ticket preserves all lines, stored IVA and original without a supplier financial split', () => {
  const { adaptSharedSale } = loadModule('lib/data/shared-database-ventas.ts', {});
  const sale = adaptSharedSale(sampleRow(), 'ventas');
  assert.equal(sale.items.length, 2); assert.equal(sale.total, 1350); assert.equal(sale.iva, 186.21);
  assert.equal(Object.hasOwn(sale, 'importeNewTires'), false); assert.equal(sale.items[1].esNewTires, false);
  assert.equal(sale.fechaVenta, '2026-10-13T12:00:00.123456Z'); assert.equal(sale.soloLecturaMigrada, true);
  assert.equal(sale.items[0].costoUnitario, undefined); assert.equal(sale.datosOriginalesJson, '{"id":"sale","original":true}');
});

function archivedFiscal(sale = {}) {
  const document = JSON.stringify({ sale: { id: 'sale', folio: 'SI-0001', subtotal: 1163.79, iva: 186.21, total: 1350, iva_politica: 'incluido_16', ...sale }, items: [] });
  return { white_original_document: document, white_original_sha256: createHash('sha256').update(document).digest('hex') };
}

test('same historical sale keeps black money unchanged and white recorded fiscal amounts in app and PDF', () => {
  const { adaptSharedSale } = loadModule('lib/data/shared-database-ventas.ts', {});
  const { buildSalesReport } = loadModule('lib/reports/data.ts', {});
  const row = sampleRow({ subtotal: 1350, iva: 0, iva_politica: null, ...archivedFiscal() });
  const original = structuredClone(row); const sale = adaptSharedSale(row, 'ventas');
  assert.deepEqual(row, original, 'Projection must not change the canonical record.');
  assert.equal(sale.id, row.id); assert.equal(sale.folio, row.folio); assert.equal(sale.items.length, row.items.length);
  assert.equal(sale.subtotal, 1163.79); assert.equal(sale.iva, 186.21); assert.equal(sale.total, 1350); assert.equal(sale.ivaPolitica, 'incluido_16');
  assert.equal(row.subtotal, 1350); assert.equal(row.iva, 0);
  const report = buildSalesReport([sale], {});
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0][5], '$1,163.79'); assert.equal(report.rows[0][6], '$186.21'); assert.equal(report.rows[0][7], '$1,350.00');
});
test('historical projection preserves a recorded tax value without recalculating a percentage', () => {
  const { adaptSharedSale } = loadModule('lib/data/shared-database-ventas.ts', {});
  const sale = adaptSharedSale(sampleRow({ subtotal: 1350, iva: 0, ...archivedFiscal({ subtotal: 1300, iva: 50, iva_politica: null }) }), 'ventas');
  assert.equal(sale.subtotal, 1300); assert.equal(sale.iva, 50); assert.equal(sale.ivaPolitica, null);
});
test('unshared and new sales retain canonical recorded amounts even if an archive is supplied', () => {
  const { adaptSharedSale } = loadModule('lib/data/shared-database-ventas.ts', {});
  for (const overrides of [{ imported_read_only: false }, { origen_app: 'blanca' }]) {
    const sale = adaptSharedSale(sampleRow({ subtotal: 1350, iva: 0, ...archivedFiscal(), ...overrides }), 'ventas');
    assert.equal(sale.subtotal, 1350); assert.equal(sale.iva, 0);
  }
});
for (const [name, archive] of [
  ['different sale identity', archivedFiscal({ id: 'another-sale' })],
  ['different folio', archivedFiscal({ folio: 'SI-9999' })],
  ['changed total', archivedFiscal({ subtotal: 1164.79, iva: 186.21, total: 1351 })],
  ['unbalanced amounts', archivedFiscal({ iva: 0 })],
  ['missing tax', archivedFiscal({ iva: undefined })],
  ['unknown tax', archivedFiscal({ iva: null })],
  ['fractional cents', archivedFiscal({ iva: 186.211 })],
  ['damaged integrity hash', { ...archivedFiscal(), white_original_sha256: '0'.repeat(64) }],
]) {
  test('historical fiscal projection refuses ' + name, () => {
    const { adaptSharedSale } = loadModule('lib/data/shared-database-ventas.ts', {});
    assert.throws(() => adaptSharedSale(sampleRow({ subtotal: 1350, iva: 0, ...archive }), 'ventas'), /histórico|históricos/);
  });
}
test('product-sales legacy document remains complete, tagged and read-only without invented tax', () => {
  const { adaptSharedSale } = loadModule('lib/data/shared-database-ventas.ts', {});
  const sale = adaptSharedSale(sampleRow({ cliente: 'Cliente general', items: [{ productoId: 'p', nombre: 'Producto', cantidad: 2, precioUnitario: 15 }],
    subtotal: 30, iva: 0, total: 30, imported_read_only: false, new_tires_indexes: [], cancelada: undefined }), 'ventas_productos');
  assert.equal(sale.storageKind, 'ventas_productos'); assert.equal(sale.items[0].productoId, 'p');
  assert.equal(sale.items[0].subtotal, 30); assert.equal(sale.iva, 0); assert.equal(sale.soloLecturaMigrada, true);
});
test('shared catalog preserves unknown cost and serves the existing image identity', () => {
  const { adaptSharedProduct } = loadModule('lib/data/shared-database-catalog.ts', {});
  const product = adaptSharedProduct({ id: 'p', nombre: 'Producto', precioCompra: null, precioVenta: 100, stock: 3, activo: true,
    createdAt: 'a', updatedAt: 'b', imagen_id: 'image-id', imagen: 'https://example.invalid/old' });
  assert.equal(product.precioCompra, undefined); assert.equal(product.precio, 100); assert.equal(product.imagenId, 'image-id');
  assert.equal(product.imagen, '/api/productos/imagenes/image-id');
});
test('sale atomically saves stock, receipt, scope and included IVA; exact retry does not deduct again', async () => {
  const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  const sale = await api.sharedCreateSale(input());
  assert.equal(sale.total, 2380); assert.equal(sale.subtotal, 2051.72); assert.equal(sale.iva, 328.28);
  assert.equal(sale.items[0].proveedorSnapshot, 'COMERCIALIZADORA DE NEW TIRES'); assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 0);
  assert.equal(fake.state.movements.length, 1); assert.equal(fake.state.sales[sale.id].items[0].costoEstado, 'desconocido');
  assert.equal(fake.state.sales[sale.id].items[0].costoUnitario, null);
  const replay = await api.sharedCreateSale(input()); assert.equal(replay.id, sale.id);
  assert.equal(fake.state.movements.length, 1); assert.equal(fake.state.counters['V-'], 1);
  assert.deepEqual(fake.events.filter(e => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(e)), ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
});
test('same operation with changed cart cannot create a second sale', async () => {
  const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  await api.sharedCreateSale(input());
  await assert.rejects(api.sharedCreateSale(input({ clienteNombre: 'Cambio' })), /otra venta/);
  assert.equal(Object.keys(fake.state.sales).length, 1); assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 0);
});
test('late insufficient stock rolls back earlier deductions and persists terminal failure for UI recovery', async () => {
  const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  const payload = input({ items: [{ tipo: 'producto', id: 'tire', bodega: 'bodega-1', cantidad: 1 }, { tipo: 'producto', id: 'tire', bodega: 'bodega-1', cantidad: 2 }] });
  await assert.rejects(api.sharedCreateSale(payload), e => e.operationStatus === 'released' && /Stock insuficiente/.test(e.message));
  assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 2); assert.equal(fake.state.movements.length, 0);
  assert.equal(Object.keys(fake.state.sales).length, 0); assert.equal(fake.state.operations[payload.operacionId].status, 'released');
  await assert.rejects(api.sharedCreateSale(payload), e => e.operationStatus === 'released');
});
test('lost commit acknowledgement recovers the committed sale instead of compensating stock', async () => {
  const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database); fake.loseNextCommit();
  const sale = await api.sharedCreateSale(input());
  assert.equal(sale.total, 2380); assert.equal(Object.keys(fake.state.sales).length, 1);
  assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 0); assert.equal(fake.state.movements.length, 1);
});
test('cancel retry restores stock once and keeps the document', async () => {
  const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  const sale = await api.sharedCreateSale(input()); await api.sharedCancelSale(sale.id, 'Prueba de cancelación');
  await api.sharedCancelSale(sale.id, 'Prueba de cancelación');
  assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 2); assert.equal(fake.state.movements.length, 2);
  assert.equal(Object.keys(fake.state.sales).length, 1); assert.equal(fake.state.sales[sale.id].cancelada, true);
});
for (const origin of ['negra', 'blanca']) for (const provider of ['Otro', null, '']) {
  test(`provider scope rejects ${origin} tire with provider ${JSON.stringify(provider)} supplied directly`, async () => {
    const fake = fakeDatabase(); Object.assign(fake.state.tires.tire, { proveedor: provider, origen_app: origin });
    const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
    await assert.rejects(api.sharedCreateSale(input()), /catálogo permitido/);
    assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 2); assert.equal(fake.state.movements.length, 0);
    assert.equal(Object.keys(fake.state.sales).length, 0);
  });
}

test('white-origin tire-only history is hidden unless its recorded supplier is New Tires', async () => {
  const fake = fakeDatabase(); fake.state.sales.sale = sampleRow({ origen_app: 'blanca', new_tires_indexes: [] });
  const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  assert.deepEqual(await api.sharedSales(), []); assert.equal(await api.sharedFindSale('sale'), null);
  assert.equal(fake.state.sales.sale.items.length, 2, 'Visibility must not remove original rows or lines.');
});

for (const kind of ['productoId', 'servicioId']) {
  test(`black-origin non-tire ${kind} sale remains visible with its recorded zero IVA`, async () => {
    const fake = fakeDatabase(); fake.state.sales.sale = sampleRow({ items: [{ [kind]: 'catalog-id', nombre: 'Prueba', cantidad: 1, precioUnitario: 30, subtotal: 30 }],
      new_tires_indexes: [], subtotal: 30, iva: 0, total: 30, imported_read_only: false });
    const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
    assert.equal((await api.sharedSales()).length, 1);
    const sale = await api.sharedFindSale('sale'); assert.equal(sale.total, 30); assert.equal(sale.iva, 0);
  });
}
test('shared mode dispatch never queries the legacy outbox while reading history', async () => {
  const saved = process.env.SHARED_DATABASE_MODE; process.env.SHARED_DATABASE_MODE = 'true';
  try {
    const fake = fakeDatabase(); const api = loadModule('lib/data/ventas.ts', fake.database);
    assert.deepEqual(await api.obtenerVentas(), []);
    assert.equal(fake.events.some(sql => /shared_stock_operations|multi_inventory/.test(sql)), false);
  } finally { if (saved === undefined) delete process.env.SHARED_DATABASE_MODE; else process.env.SHARED_DATABASE_MODE = saved; }
});
test('sales report retains mixed document totals and excludes cancelled documents from totals without supplier split', () => {
  const api = loadModule('lib/data/shared-database-ventas.ts', {});
  const { buildSalesReport } = loadModule('lib/reports/data.ts', {});
  const active = api.adaptSharedSale(sampleRow(), 'ventas'); const cancelled = { ...active, id: 'cancelled', cancelada: true };
  const report = buildSalesReport([active, cancelled], { desde: '', hasta: '' });
  assert.equal(report.rows.length, 2); assert.equal(report.rows[0][8], 'Transferencia');
  assert.equal(report.totalRow[7], '$1,350.00'); assert.equal(report.columns.length, 10);
  assert.ok(report.columns.every(column => column.header !== 'Importe New Tires'));
  assert.match(report.rows[0][3], /A B/); assert.match(report.rows[0][3], /C D/);
});

const RESET_INSTANCE = '6209cdf3-7929-4a32-9c7b-75df1704631f';
const RESET_ID = 'ad2bbf36-d534-4894-95db-dad86507a223';
const historyPolicy = () => loadModule('lib/data/white-sales-history.ts', {});
function resetInput(excludedIds = { ventas: [], ventas_productos: [] }, overrides = {}) {
  return { databaseInstanceId: RESET_INSTANCE, environment: 'development', resetId: RESET_ID,
    resetAtUtc: '2026-10-14T12:00:00.000Z', snapshotId: '100:102:101', excludedIds, ...overrides };
}
async function withHistoryReset(excludedIds, run) {
  const keys = ['WHITE_SALES_HISTORY_RESET', 'SHARED_DATABASE_ID', 'SHARED_DATABASE_ENVIRONMENT'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const policy = historyPolicy();
  const manifest = policy.buildWhiteSalesHistoryReset(resetInput(excludedIds));
  process.env.WHITE_SALES_HISTORY_RESET = policy.serializeWhiteSalesHistoryReset(manifest);
  process.env.SHARED_DATABASE_ID = RESET_INSTANCE;
  process.env.SHARED_DATABASE_ENVIRONMENT = 'development';
  try { return await run(manifest, policy); }
  finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('white reset manifest is deterministic, checksummed, source-bound and private to its instance/environment', () => {
  const policy = historyPolicy();
  const manifest = policy.buildWhiteSalesHistoryReset(resetInput({ ventas: ['z', 'a'], ventas_productos: ['a'] }));
  assert.deepEqual(manifest.excludedIds, { ventas: ['a', 'z'], ventas_productos: ['a'] });
  assert.equal(manifest.application, 'blanca'); assert.equal(manifest.sourceSchema, 'public');
  assert.deepEqual(manifest.sourceTables, ['ventas', 'ventas_productos']);
  const { sha256, ...body } = manifest;
  assert.equal(sha256, createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex'));
  const encoded = policy.serializeWhiteSalesHistoryReset(manifest);
  assert.deepEqual(policy.parseWhiteSalesHistoryReset(encoded, RESET_INSTANCE, 'development'), manifest);
  assert.equal(policy.serializeWhiteSalesHistoryReset(policy.buildWhiteSalesHistoryReset(resetInput({ ventas: ['a', 'z'], ventas_productos: ['a'] }))), encoded);
  assert.throws(() => policy.parseWhiteSalesHistoryReset(encoded, RESET_ID, 'development'), /reinicio del historial/);
  assert.throws(() => policy.parseWhiteSalesHistoryReset(encoded, RESET_INSTANCE, 'production'), /reinicio del historial/);
  assert.throws(() => policy.parseWhiteSalesHistoryReset(encoded, undefined, 'development'), /reinicio del historial/);
});

for (const [name, change] of [
  ['different application', value => ({ ...value, application: 'negra' })],
  ['different source schema', value => ({ ...value, sourceSchema: 'other' })],
  ['different source table', value => ({ ...value, sourceTables: ['ventas', 'ventas_fake'] })],
  ['unexpected field', value => ({ ...value, ignored: true })],
  ['unknown version', value => ({ ...value, version: 2 })],
  ['damaged checksum', value => ({ ...value, sha256: '0'.repeat(64) })],
  ['missing module baseline', value => ({ ...value, excludedIds: { ventas: [] } })],
  ['duplicate identity', value => ({ ...value, excludedIds: { ventas: ['same', 'same'], ventas_productos: [] } })],
  ['invalid identity', value => ({ ...value, excludedIds: { ventas: ['\u0000'], ventas_productos: [] } })],
  ['invalid UTC date', value => ({ ...value, resetAtUtc: '2026-02-30T12:00:00.000Z' })],
  ['non-UTC date', value => ({ ...value, resetAtUtc: '2026-10-14T06:00:00.000-06:00' })],
  ['invalid MVCC snapshot', value => ({ ...value, snapshotId: '100-102' })],
  ['non-string environment', value => ({ ...value, environment: ['development'] })],
]) {
  test('reset rejects ' + name + ' explicitly without trusting partial configuration', () => {
    const policy = historyPolicy();
    const manifest = policy.buildWhiteSalesHistoryReset(resetInput());
    const encoded = Buffer.from(JSON.stringify(change(manifest)), 'utf8').toString('base64');
    assert.throws(() => policy.parseWhiteSalesHistoryReset(encoded, RESET_INSTANCE, 'development'), /reinicio del historial/);
  });
}

test('reset rejects empty, malformed, noncanonical or excessive BASE64 without echoing the private value', () => {
  const policy = historyPolicy();
  const encoded = policy.serializeWhiteSalesHistoryReset(policy.buildWhiteSalesHistoryReset(resetInput()));
  for (const value of ['', 'not-base64', encoded + '\n', Buffer.from('{oops').toString('base64'), 'a'.repeat(120_004)]) {
    assert.throws(() => policy.parseWhiteSalesHistoryReset(value, RESET_INSTANCE, 'development'), error =>
      /reinicio del historial/.test(error.message) && (!value || !error.message.includes(value)));
  }
});

test('reset SQL uses composite module identity and bound parameters rather than dates or ID interpolation', () => {
  const policy = historyPolicy();
  const hostile = "sale' OR true--";
  const manifest = policy.buildWhiteSalesHistoryReset(resetInput({ ventas: [hostile], ventas_productos: ['product-sale'] }));
  const params = ['existing-filter'];
  const sql = policy.whiteSalesHistoryPredicate('ventas', params, manifest);
  assert.equal(sql, "(v.origen_app='blanca' AND NOT (v.id=ANY($2::text[])))");
  assert.deepEqual(params, ['existing-filter', [hostile]]); assert.equal(sql.includes(hostile), false);
  const productParams = [];
  policy.whiteSalesHistoryPredicate('ventas_productos', productParams, manifest);
  assert.deepEqual(productParams, [['product-sale']]);
  assert.equal(policy.whiteSalesHistoryPredicate('ventas', [], null), 'true');
});

test('baseline hides old future-dated white documents, keeps new backdated white documents and excludes every future black sale', async () => {
  const fake = fakeDatabase();
  const service = { servicioId: 'service', nombre: 'Servicio', cantidad: 1, precioUnitario: 30, subtotal: 30 };
  fake.state.sales.old = sampleRow({ id: 'old', folio: 'V-0001', origen_app: 'blanca', fechaVenta: '2099-01-01T00:00:00Z', imported_read_only: false });
  fake.state.sales.new = sampleRow({ id: 'new', folio: 'V-0002', origen_app: 'blanca', fechaVenta: '2000-01-01T00:00:00Z', imported_read_only: false });
  fake.state.sales.blackTire = sampleRow({ id: 'black-tire', folio: 'SI-0003', fechaVenta: '2100-01-01T00:00:00Z' });
  fake.state.sales.blackService = sampleRow({ id: 'black-service', folio: 'SI-0004', items: [service], new_tires_indexes: [] });
  fake.state.productSales.old = sampleRow({ id: 'old-product', folio: 'VP-0001', origen_app: 'blanca', items: [service], new_tires_indexes: [] });
  fake.state.productSales.new = sampleRow({ id: 'new-product', folio: 'VP-0002', origen_app: 'blanca', items: [service], new_tires_indexes: [] });
  fake.state.productSales.black = sampleRow({ id: 'black-product', folio: 'VP-0003', items: [service], new_tires_indexes: [] });
  const before = structuredClone(fake.state);
  const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  await withHistoryReset({ ventas: ['old'], ventas_productos: ['old-product'] }, async () => {
    const sales = await api.sharedSales({ incluirCanceladas: true });
    assert.deepEqual(sales.map(s => s.id).sort(), ['new', 'new-product']);
    assert.equal((await api.sharedFindSale('new')).id, 'new');
    assert.equal((await api.sharedFindSale('new-product')).storageKind, 'ventas_productos');
    assert.equal(await api.sharedFindSale('black-tire'), null);
    assert.equal(await api.sharedFindSale('black-service'), null);
    assert.equal(await api.sharedFindSale('black-product'), null);
  });
  assert.deepEqual(fake.state, before, 'A UI reset must not change any canonical row, journal, movement, stock or counter.');
  assert.equal(fake.events.some(sql => /^(INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE)/.test(sql)), false);
  assert.equal((await api.sharedSales({ incluirCanceladas: true })).length, 7, 'Removing the private policy rolls back visibility without a DB restore.');
});

test('old direct ticket, folio, warranty and original JSON paths cannot recover a hidden document', async () => {
  const fake = fakeDatabase();
  fake.state.sales.old = sampleRow({ id: 'old', folio: 'V-0001', origen_app: 'blanca', imported_read_only: false,
    garantia: { id: 'GAR-2026-0001', activa: true, fechaInicio: '2026-10-14', fechaFin: '2999-10-14', diasGarantia: 30 } });
  const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  await withHistoryReset({ ventas: ['old'], ventas_productos: [] }, async () => {
    assert.equal(await api.sharedFindSale('old'), null);
    assert.equal(await api.sharedFindSale('V-0001', 'folio'), null);
    assert.equal(await api.sharedFindSale('gar-2026-0001', 'garantia'), null);
    assert.deepEqual(await api.sharedWarranties(), []);
    assert.equal(fake.events.some(sql => sql.startsWith('SELECT document_text FROM shared_archive.sale_originals')), false,
      'Original downloads must first pass the visible sale lookup.');
    assert.equal(await api.sharedCancelSale('old', 'Must stay hidden'), null);
    assert.equal(await api.sharedMarkInvoiced('old', {}), null);
    assert.equal(fake.events.some(sql => /^(UPDATE|INSERT|DELETE)/.test(sql)), false, 'Passing a transaction client cannot bypass history visibility.');
  });
});

test('same textual ID in different modules is hidden only in its captured module', async () => {
  const fake = fakeDatabase();
  fake.state.sales.same = sampleRow({ id: 'same', folio: 'V-0001', origen_app: 'blanca', imported_read_only: false });
  fake.state.productSales.same = sampleRow({ id: 'same', folio: 'VP-0001', origen_app: 'blanca', imported_read_only: false,
    items: [{ productoId: 'product', nombre: 'Producto', cantidad: 1, precioUnitario: 30 }], new_tires_indexes: [] });
  const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  await withHistoryReset({ ventas: ['same'], ventas_productos: [] }, async () => {
    const found = await api.sharedFindSale('same');
    assert.equal(found.storageKind, 'ventas_productos'); assert.equal(found.folio, 'VP-0001');
    assert.equal((await api.sharedSales()).length, 1);
  });
});

test('a confirmed hidden retry acknowledges the same module and flag without repeating stock, folio, movement or release', async () => {
  const fake = fakeDatabase();
  const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  const sale = await api.sharedCreateSale(input());
  fake.state.productSales[sale.id] = sampleRow({ id: sale.id, folio: 'VP-0001', origen_app: 'negra' });
  const before = structuredClone(fake.state);
  await withHistoryReset({ ventas: [sale.id], ventas_productos: [] }, async () => {
    const replay = await api.sharedCreateSale(input());
    assert.equal(replay.id, sale.id); assert.equal(replay.storageKind, 'ventas');
    assert.equal(replay.fueraDelHistorialActual, true);
    assert.equal(await api.sharedFindSale(sale.id), null, 'Acknowledgement must not re-expose the document to normal readers.');
    assert.equal(fake.state.operations[input().operacionId].status, 'committed');
    assert.equal(Object.hasOwn(fake.state.sales[sale.id], 'fueraDelHistorialActual'), false);
  });
  assert.deepEqual(fake.state, before);
  assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 0);
  assert.equal(fake.state.movements.length, 1); assert.equal(fake.state.counters['V-'], 1);
  assert.equal(fake.events.filter(sql => sql.startsWith('INSERT INTO ventas(')).length, 1);
  assert.equal(fake.events.filter(sql => sql.startsWith('INSERT INTO shared_runtime.operations')).length, 1);
});

test('hidden request reconciliation without an existing journal restores only its committed outcome', async () => {
  const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  const sale = await api.sharedCreateSale(input()); delete fake.state.operations[input().operacionId];
  await withHistoryReset({ ventas: [sale.id], ventas_productos: [] }, async () => {
    const replay = await api.sharedCreateSale(input());
    assert.equal(replay.id, sale.id); assert.equal(replay.fueraDelHistorialActual, true);
    assert.equal(fake.state.operations[input().operacionId].status, 'committed');
    assert.equal(fake.state.operations[input().operacionId].sale_kind, 'ventas');
    assert.equal(fake.state.movements.length, 1); assert.equal(fake.state.counters['V-'], 1);
    assert.equal(fake.events.some(sql => sql.includes("VALUES($1,$2,'blanca','released')")), false);
  });
});

test('lost acknowledgement of a post-reset sale recovers visibly and deducts stock once', async () => {
  const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  await withHistoryReset({ ventas: ['earlier'], ventas_productos: [] }, async () => {
    fake.loseNextCommit(); const sale = await api.sharedCreateSale(input());
    assert.equal(sale.fueraDelHistorialActual, undefined);
    assert.equal((await api.sharedFindSale(sale.id)).id, sale.id);
    assert.equal(Object.keys(fake.state.sales).length, 1); assert.equal(fake.state.movements.length, 1);
    assert.equal(fake.state.counters['V-'], 1); assert.equal(fake.state.tires.tire.stockPorBodega['bodega-1'], 0);
  });
});

test('date filters still bind their own parameters after the baseline parameter', async () => {
  const fake = fakeDatabase();
  fake.state.sales.new = sampleRow({ id: 'new', folio: 'V-0002', origen_app: 'blanca', fechaVenta: '2026-10-15T15:00:00Z', imported_read_only: false });
  const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
  await withHistoryReset({ ventas: [], ventas_productos: [] }, async () => {
    assert.equal((await api.sharedSales({ fechaInicio: '2026-10-15T00:00:00Z', fechaFin: '2026-10-15T23:59:59Z' })).length, 1);
    assert.equal((await api.sharedSales({ fechaInicio: '2026-10-16T00:00:00Z' })).length, 0);
    assert.equal((await api.sharedSales({ fechaFin: '2026-10-14T23:59:59Z' })).length, 0);
  });
});

test('an explicitly configured invalid reset fails reads and creation before any database access', async () => {
  const saved = process.env.WHITE_SALES_HISTORY_RESET; process.env.WHITE_SALES_HISTORY_RESET = '';
  try {
    const fake = fakeDatabase(); const api = loadModule('lib/data/shared-database-ventas.ts', fake.database);
    await assert.rejects(api.sharedSales(), /reinicio del historial/);
    await assert.rejects(api.sharedFindSale('sale'), /reinicio del historial/);
    await assert.rejects(api.sharedCreateSale(input()), /reinicio del historial/);
    assert.deepEqual(fake.events, []);
  } finally {
    if (saved === undefined) delete process.env.WHITE_SALES_HISTORY_RESET; else process.env.WHITE_SALES_HISTORY_RESET = saved;
  }
});
