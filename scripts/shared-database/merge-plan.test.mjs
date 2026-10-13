import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMergePlan, sha256, stable } from './merge-plan.mjs';

// Synthetic records only: no credentials, production snapshots or customer data.
const now = '2026-01-01T12:00:00.123456+00:00';
const supplier = 'COMERCIALIZADORA DE NEW TIRES';
const raw = rows => rows.map(row => JSON.stringify(row));
function fixture() {
  const archivedTire = { id: 'tire-shared', marca: 'Test', modelo: 'Example', medida: '205/55R16',
    precioCompra: 50, precioVenta: 116, precioMayorista: 100, stockPorBodega: { 'bodega-1': 5 }, proveedor: supplier, activo: true };
  const line = { tipo: 'producto', llantaId: archivedTire.id, bodega: 'bodega-1', llantaSnapshot: { marca: 'Test', modelo: 'Example', medida: '205/55R16' }, cantidad: 1, precioUnitario: 116, subtotal: 116 };
  const original = { id: 'sale-shared', folio: 'SI-0010', cliente: { nombre: 'Synthetic customer' }, items: [line], subtotal: 116, iva: 0, total: 116,
    metodoPago: 'efectivo', fechaVenta: now, ticketGenerado: true, facturada: false, factura: null,
    garantia: { activa: false }, createdAt: now, updatedAt: now, cancelada: false, motivoCancelacion: null, dominio: 'sistema' };
  const authorized = { ...original, subtotal: 100, iva: 16 };
  const normalized = { id: original.id, folio: original.folio, cliente_original: original.cliente, garantia_original: original.garantia, factura_original: null,
    subtotal: 100, iva: 16, total: 116, metodo_pago: original.metodoPago, fecha_venta: now, cancelada: false, facturada: false, motivo_cancelacion: null, iva_politica: 'incluido_16' };
  const movement = { id: 'move-shared', llantaId: archivedTire.id, bodegaOrigen: 'bodega-1', bodegaDestino: 'bodega-2', cantidad: 1, fecha: now, dominio: 'sistema' };
  const black = {
    'public.llantas': raw([{ ...archivedTire, stockPorBodega: { 'bodega-1': 8 } }]),
    'public.ventas': raw([original]),
    'migration_control.archived_sales': raw([{ sale_id: original.id, original_row: original }]),
    'migration_control.archived_llantas': raw([{ original_row: archivedTire }]),
    'public.productos': raw([{ id: 'product-black', nombre: 'Synthetic product', precioCompra: 0, precioVenta: 20, stock: 3, activo: true, createdAt: now, updatedAt: now }]),
    'public.servicios': raw([{ id: 'service-black', nombre: 'Synthetic service', precioDefault: 29, activo: true, createdAt: now, updatedAt: now }]),
    'public.movimientos_bodega': raw([movement]),
    'public.app_metadata': raw([{ key: 'sistema_ventas_seq', value: { ultimoFolio: 10, ultimoGarantiaId: 9 }, updatedAt: now }]),
  };
  const white = {
    'migration_new_tires.imported_sales': raw([{ sale_id: original.id }]),
    'migration_new_tires.source_rows': raw([
      { dataset: 'new_tires', source_table: 'public.ventas', row_data: authorized },
      { dataset: 'new_tires', source_table: 'migration_control.sale_iva_adjustments', row_data: { sale_id: original.id, before_row: original, after_row: authorized } },
      { dataset: 'new_tires', source_table: 'public.llantas', row_data: archivedTire },
    ]),
    'public.llantas': raw([{ id: archivedTire.id, marca: archivedTire.marca, modelo: archivedTire.modelo, medida: archivedTire.medida,
      precio_compra: 50, precio_venta: 116, precio_mayorista: 100, stock_por_bodega: archivedTire.stockPorBodega, proveedor: supplier, activo: true }]),
    'public.ventas': raw([normalized]),
    'public.venta_items': raw([{ id: 1, venta_id: original.id, orden: 0, original_item: line, cantidad: 1, precio_unitario: 116, subtotal: 116 }]),
    'public.productos': raw([{ id: 'product-white', nombre: 'Synthetic product', descripcion: null, precio_compra: null, precio: 20, stock: 4, activo: true, created_at: now, updated_at: now }]),
    'public.servicios': raw([{ id: 'service-white', nombre: 'Synthetic service', descripcion: null, precio_default: 29, codigo_barras: null, activo: false, created_at: now, updated_at: now }]),
    'public.movimientos_bodega': raw([{ id: movement.id, llanta_id: movement.llantaId, bodega_origen: movement.bodegaOrigen, bodega_destino: movement.bodegaDestino,
      cantidad: 1, fecha: now, dominio: 'sistema', tipo: null, motivo: null, venta_id: null }]),
    'public.app_metadata': raw([{ key: 'sistema_ventas_seq', value: { ultimoFolio: 8, ultimoGarantiaId: 12 }, updated_at: now }]),
  };
  return { black, white };
}
function change(source, table, index, mutate) {
  const value = JSON.parse(source[table][index]); mutate(value); source[table][index] = JSON.stringify(value);
}
function independentSale() {
  const nullInvoice = Object.fromEntries(['uuid', 'serie', 'folio', 'fecha_timbrado', 'url_pdf', 'url_xml'].map(key => ['factura_' + key, null]));
  return { ...nullInvoice, id: 'sale-white', folio: 'V-0042', cliente_original: null, cliente_nombre: 'Synthetic independent customer', cliente_telefono: null,
    garantia_original: null, garantia_activa: false, garantia_id: null, garantia_fecha_inicio: '2026-01-01', garantia_fecha_fin: '2026-01-01', garantia_dias: 0, garantia_condiciones: 'None',
    factura_original: null, subtotal: 25, iva: 4, total: 29, metodo_pago: 'tarjeta', fecha_venta: now, ticket_generado: true,
    facturada: false, created_at: now, updated_at: now, cancelada: false, motivo_cancelacion: null, dominio: 'general', iva_politica: 'incluido_16' };
}

test('merge reconciles identity once and preserves both recorded fiscal policies without overwriting black history', () => {
  const { black, white } = fixture(); const before = JSON.stringify({ black, white });
  const plan = buildMergePlan(black, white);
  assert.equal(plan.tables['public.llantas'].length, 1); assert.equal(plan.tables['public.llantas'][0].stockPorBodega['bodega-1'], 8);
  assert.equal(plan.tables['public.ventas'].length, 1); assert.equal(plan.tables['public.ventas'][0].subtotal, 116);
  assert.equal(plan.tables['public.ventas'][0].iva, 0); assert.equal(plan.tables['public.ventas'][0].total, 116);
  assert.equal(plan.tables['public.ventas'][0].updatedAt, JSON.parse(black['public.ventas'][0]).updatedAt);
  const whiteOriginal = JSON.parse(plan.saleOriginals.find(row => row.source_label === 'blanca').document_text).sale;
  assert.equal(whiteOriginal.subtotal, 100); assert.equal(whiteOriginal.iva, 16); assert.equal(whiteOriginal.total, 116);
  assert.equal(plan.adjustments[0].decision, 'preserve-each-recorded-policy');
  assert.equal(plan.tables['public.ventas'][0].imported_read_only, true);
  assert.equal(plan.tables['public.movimientos_bodega'].length, 1); assert.equal(plan.adjustments.length, 1);
  assert.equal(JSON.stringify({ black, white }), before, 'Pure planner must not mutate the source snapshots.');
});
test('archive retains every exact raw row and verifies hashes, including unknown columns', () => {
  const { black, white } = fixture();
  black['unknown.audit_table'] = ['{ "id": "unmapped", "opaque": { "preserved": true } }'];
  const plan = buildMergePlan(black, white);
  assert.equal(plan.originalRows.length, [...Object.values(black), ...Object.values(white)].reduce((n, values) => n + values.length, 0));
  const archived = plan.originalRows.find(row => row.table_name === 'unknown.audit_table');
  assert.equal(archived.raw_text, black['unknown.audit_table'][0]); assert.equal(archived.sha256, sha256(archived.raw_text));
  assert.equal(plan.saleOriginals.find(row => row.source_label === 'negra').document_text, black['public.ventas'][0]);
});
test('independent same-name catalog IDs stay separate, NULL and zero costs remain different, inactive services remain', () => {
  const { black, white } = fixture(); const plan = buildMergePlan(black, white);
  assert.equal(plan.tables['public.productos'].length, 2);
  assert.equal(plan.tables['public.productos'].find(row => row.id === 'product-white').precioCompra, null);
  assert.equal(plan.tables['public.productos'].find(row => row.id === 'product-black').precioCompra, 0);
  assert.equal(plan.tables['public.servicios'].find(row => row.id === 'service-white').activo, false);
});
test('existing sequence high-water marks cannot move backwards', () => {
  const { black, white } = fixture(); const plan = buildMergePlan(black, white);
  assert.deepEqual(plan.tables['public.app_metadata'][0].value, { ultimoFolio: 10, ultimoGarantiaId: 12 });
});
test('independent white service sale retains all amounts, items, dates and unknown cost', () => {
  const { black, white } = fixture(); const sale = independentSale();
  white['public.ventas'].push(JSON.stringify(sale));
  white['public.venta_items'].push(JSON.stringify({ id: 2, venta_id: sale.id, orden: 0, original_item: null, tipo: 'servicio', cantidad: 1,
    precio_unitario: 29, subtotal: 29, costo_unitario: null, costo_subtotal: null, llanta_id: null, servicio_id: 'service-white', servicio_nombre: 'Synthetic service', producto_id: null, codigo_auxiliar: null }));
  const plan = buildMergePlan(black, white); const canonical = plan.tables['public.ventas'].find(row => row.id === sale.id);
  assert.equal(canonical.total, 29); assert.equal(canonical.iva, 4); assert.equal(canonical.subtotal, 25);
  assert.equal(canonical.items.length, 1); assert.equal(canonical.items[0].costoUnitario, null); assert.equal(canonical.fechaVenta, now);
  assert.equal(canonical.origen_app, 'blanca'); assert.equal(canonical.imported_read_only, false);
});
test('historical supplier uses archived evidence despite a changed current catalog supplier', () => {
  const { black, white } = fixture(); change(black, 'public.llantas', 0, tire => { tire.proveedor = 'Different Current Supplier'; });
  const scope = buildMergePlan(black, white).scopes[0];
  assert.equal(scope.provider_key, supplier); assert.equal(scope.evidence, 'archived-supplier-at-prior-migration');
});
test('a recorded explicit NULL supplier snapshot is not invented from current catalog', () => {
  const { black, white } = fixture();
  const modifyLine = sale => { sale.items[0].proveedorSnapshot = null; };
  change(black, 'public.ventas', 0, modifyLine); change(black, 'migration_control.archived_sales', 0, row => modifyLine(row.original_row));
  change(white, 'migration_new_tires.source_rows', 0, row => modifyLine(row.row_data));
  change(white, 'migration_new_tires.source_rows', 1, row => { modifyLine(row.row_data.before_row); modifyLine(row.row_data.after_row); });
  change(white, 'public.venta_items', 0, row => { row.original_item.proveedorSnapshot = null; });
  const scope = buildMergePlan(black, white).scopes[0]; assert.equal(scope.provider_key, null); assert.equal(scope.evidence, 'sale-snapshot');
});
test('timestamp reconciliation preserves microseconds and accepts equivalent offsets', () => {
  assert.equal(stable('2026-01-01T12:00:00.123456Z'), stable('2026-01-01 06:00:00.123456-06:00'));
  assert.notEqual(stable('2026-01-01T12:00:00.123456Z'), stable('2026-01-01T12:00:00.123457Z'));
});

for (const [name, mutate, expected] of [
  ['changed black shared document after archive', ({ black }) => change(black, 'public.ventas', 0, row => { row.cancelada = true; }), /changed since archived/],
  ['missing shared VAT authorization', ({ white }) => { white['migration_new_tires.source_rows'].splice(1, 1); }, /Missing baseline/],
  ['changed normalized monetary line', ({ white }) => change(white, 'public.venta_items', 0, row => { row.precio_unitario = 115; }), /line amount changed/],
  ['changed normalized VAT', ({ white }) => change(white, 'public.ventas', 0, row => { row.iva = 15; }), /IVA values changed/],
  ['missing shared history', ({ white }) => { white['public.ventas'] = []; white['public.venta_items'] = []; }, /Incomplete shared history/],
  ['independent sales ID collision', ({ white }) => { white['migration_new_tires.imported_sales'] = []; }, /Independent sales share an ID/],
  ['white tire absent from authentic source', ({ white }) => change(white, 'public.llantas', 0, row => { row.id = 'unknown'; }), /Unreviewed white-only tire/],
  ['changed replica stock must not silently be summed', ({ white }) => change(white, 'public.llantas', 0, row => { row.stock_por_bodega['bodega-1'] = 999; }), /Historical white tire changed/],
  ['independent catalog ID collision', ({ white }) => change(white, 'public.productos', 0, row => { row.id = 'product-black'; }), /Catalogue identity collision/],
  ['conflicting stock movement copies', ({ white }) => change(white, 'public.movimientos_bodega', 0, row => { row.cantidad = 2; }), /Movement copies conflict/],
  ['pending central reservation', ({ black }) => { black['multi_inventory.stock_operations'] = raw([{ status: 'reserved' }]); }, /Pending central stock operations/],
  ['pending white reservation', ({ white }) => { white['public.shared_stock_operations'] = raw([{ status: 'pending', payload: [] }]); }, /Pending white stock operation/],
  ['unreconciled committed tire reservation', ({ white }) => { white['public.shared_stock_operations'] = raw([{ status: 'committed', payload: [{ llanta_id: 'tire-shared' }] }]); }, /tire reservation requires/],
  ['folio collision across sale modules', ({ black }) => { black['public.ventas_productos'] = raw([{ id: 'different', folio: 'SI-0010', items: [] }]); }, /Folio collision/],
  ['orphan white line', ({ white }) => change(white, 'public.venta_items', 0, row => { row.venta_id = 'missing'; }), /Orphan white line/],
]) {
  test('merge refuses ' + name, () => { const sources = fixture(); mutate(sources); assert.throws(() => buildMergePlan(sources.black, sources.white), expected); });
}
