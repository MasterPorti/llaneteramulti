import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, selectSupplier, rowsHash, SUPPLIER, insertRaw, verifyRows } from './snapshot.mjs';

function fixture() {
  const tables = Object.fromEntries(TABLES.map((t) => [t, []]));
  tables.llantas = [
    '{"id":"mine","proveedor":"COMERCIALIZADORA DE NEW TIRES","activo":true,"stockPorBodega":{"bodega-8":3},"precioCompra":123.4500,"createdAt":"2026-03-17T15:14:28.470958+00:00"}',
    JSON.stringify({ id: 'deleted', proveedor: SUPPLIER, activo: false, stockPorBodega: {} }),
    JSON.stringify({ id: 'other', proveedor: 'Otro', activo: true, stockPorBodega: { 'bodega-1': 8 } }),
  ];
  tables.ventas = [JSON.stringify({ id: 'mixed', folio: 'SI-0002', items: [{ llantaId: 'mine' }, { llantaId: 'other' }], garantia: { id: 'GAR-2026-0002' }, total: 900, cancelada: true })];
  tables.movimientos_bodega = [JSON.stringify({ id: 'move', llantaId: 'mine' }), JSON.stringify({ id: 'unrelated', llantaId: 'other' })];
  tables.app_metadata = [JSON.stringify({ key: 'sistema_ventas_seq', value: { ultimoFolio: 10, ultimoGarantiaId: 10 } })];
  return tables;
}

test('preserva documentos mixtos completos, inactivos, canceladas, microsegundos y números originales', () => {
  const all = fixture();
  const result = selectSupplier(all);
  assert.deepEqual(result.rows.llantas, all.llantas.slice(0, 2));
  assert.deepEqual(result.rows.ventas, all.ventas);
  assert.deepEqual(result.context, all.llantas.slice(2));
  assert.equal(result.rows.movimientos_bodega.length, 1);
  assert.equal(result.summary.activeStockByWarehouse['bodega-8'], 3);
  assert.equal(result.summary.mixedSales, 1);
  assert.equal(result.summary.cancelledSales, 1);
  assert.equal(result.rows.productos.length, 0);
});
test('rechaza referencias rotas y consecutivos insuficientes', () => {
  const missing = fixture(); missing.llantas.pop();
  assert.throws(() => selectSupplier(missing), /sin llanta/);
  const seq = fixture(); seq.app_metadata = [JSON.stringify({ key: 'sistema_ventas_seq', value: { ultimoFolio: 1, ultimoGarantiaId: 1 } })];
  assert.throws(() => selectSupplier(seq), /consecutivo/);
});
test('importación envía JSON original directamente a PostgreSQL sin Date/Number', async () => {
  const calls = [];
  await insertRaw({ query: async (...args) => calls.push(args) }, 'public', 'llantas', [fixture().llantas[0]]);
  assert.equal(calls[0][1][0], '[' + fixture().llantas[0] + ']');
  assert.match(calls[0][0], /jsonb_populate_recordset/);
});
test('verificación detecta una diferencia de stock aunque coincida el conteo', async () => {
  const selection = selectSupplier(fixture());
  const client = { query: async (sql) => ({ rows: (sql.includes('"migration_context"') ? selection.context : selection.rows[sql.match(/"public"\."(\w+)"/)[1]]).map((row_json) => ({ row_json: row_json.replace('"bodega-8":3', '"bodega-8":4') })) }) };
  await assert.rejects(verifyRows(client, selection), /1:1 falló/);
  assert.equal(rowsHash(['b', 'a']), rowsHash(['a', 'b']));
});
