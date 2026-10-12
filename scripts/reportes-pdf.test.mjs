import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();
const allowed = new Set(['lib/reports/data.ts', 'lib/config.ts', 'lib/utils/formatters.ts']);
function loadTypeScript(relative) {
  assert.ok(allowed.has(relative), `Reports must not import database, network, or other application modules: ${relative}`);
  if (cache.has(relative)) return cache.get(relative).exports;
  const filename = path.join(root, relative), compiled = new Module(filename);
  cache.set(relative, compiled);
  compiled.require = (name) => {
    assert.ok(name.startsWith('@/'), `Unexpected report dependency: ${name}`);
    return loadTypeScript(name.slice(2) + '.ts');
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return compiled.exports;
}
const { buildSalesReport, buildProductsReport, buildTiresReport, buildServicesReport } = loadTypeScript('lib/reports/data.ts');
const allDates = { desde: '', hasta: '' };
const stat = (report, label) => {
  const found = report.stats.find((entry) => entry.label === label);
  assert.ok(found, `Missing statistic: ${label}`);
  return found.value;
};
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const serviceItem = (overrides = {}) => ({ tipo: 'servicio', servicioId: 'test-service', servicioNombre: 'Alineación y revisión', cantidad: 1, precioUnitario: 70, subtotal: 70, ...overrides });
const sale = (overrides = {}) => ({
  id: 'test-sale', folio: 'V-PRUEBA', cliente: { nombre: 'María Núñez', telefono: 'NO-INCLUIR-TELEFONO' },
  items: [serviceItem()], subtotal: 70, iva: 0, total: 70, metodoPago: 'efectivo',
  fechaVenta: '2026-10-11T01:15:00.000Z', ticketGenerado: true, facturada: false,
  garantia: { fechaInicio: '2026-10-10', fechaFin: '2026-12-10', diasGarantia: 60, condiciones: '', activa: true },
  createdAt: '2026-10-11T01:15:00.000Z', updatedAt: '2026-10-11T01:15:00.000Z', cancelada: false,
  datosOriginales: { noPublicar: 'NO-INCLUIR-ARCHIVO-ORIGINAL' }, ...overrides,
});
const warehouses = (values = []) => Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`bodega-${index + 1}`, values[index] ?? 0]));
const tire = (overrides = {}) => ({
  id: 'test-tire', marca: 'Marca Ñ', modelo: 'Modelo Á', medida: '225/70R19.5', ancho: 225, perfil: 70, rin: 19.5,
  precioCompra: 700, precioVenta: 1190, stockPorBodega: warehouses(), proveedor: 'Proveedor auténtico',
  fechaRecepcion: '2026-10-10', createdAt: '2026-10-10', updatedAt: '2026-10-10', activo: true, ...overrides,
});

test('sales retain stored IVA, every item and CDMX dates while excluding cancelled sales only from totals', () => {
  const source = freeze([
    sale({ id: 'taxed', folio: 'SI-PRUEBA', subtotal: 2051.72, iva: 328.28, total: 2380,
      items: [{ tipo: 'producto', llantaId: 'test-tire', bodega: 'bodega-1', llantaSnapshot: { marca: 'Marca Ñ', modelo: 'Modelo Á', medida: '225/70R19.5' }, cantidad: 2, precioUnitario: 1190, subtotal: 2380 }, serviceItem({ precioUnitario: 0, subtotal: 0 })] }),
    sale({ id: 'zero-tax', folio: 'V-HISTÓRICA' }),
    sale({ id: 'cancelled', folio: 'V-CANCELADA', subtotal: 100, iva: 16, total: 116, cancelada: true, items: [serviceItem({ cantidad: 2, precioUnitario: 58, subtotal: 116 })] }),
  ]);
  const before = JSON.stringify(source);
  const report = buildSalesReport(source, { desde: '2026-10-01', hasta: '2026-10-31' });
  assert.equal(report.rows.length, 3);
  assert.match(report.rows[0][0], /^10\/10\/2026/);
  assert.match(report.rows[0][3], /Marca Ñ Modelo Á 225\/70R19\.5 × 2\nAlineación y revisión × 1/);
  assert.equal(report.rows[0][4], '3');
  assert.deepEqual(report.rows[0].slice(5, 8), ['$2,051.72', '$328.28', '$2,380.00']);
  assert.deepEqual(report.rows[1].slice(5, 8), ['$70.00', '$0.00', '$70.00']);
  assert.equal(report.rows[2][7], '$116.00');
  assert.equal(report.rows[2][9], 'Cancelada');
  assert.deepEqual(report.rowStatuses, [undefined, undefined, 'cancelada']);
  assert.deepEqual(report.totalRow.slice(4, 8), ['4', '$2,121.72', '$328.28', '$2,450.00']);
  assert.equal(stat(report, 'Ventas vigentes'), '2');
  assert.equal(stat(report, 'Canceladas'), '1');
  assert.equal(stat(report, 'Total vigente'), '$2,450.00');
  assert.match(report.note, /no recalcula el IVA/);
  assert.equal(report.columns.length, 10);
  assert.deepEqual(report.columns.map((column) => column.width), [29, 19, 34, 60, 12, 24, 22, 24, 24, 21]);
  assert.ok(!JSON.stringify(report).includes('NO-INCLUIR-'));
  assert.equal(JSON.stringify(source), before);
});

test('financial aggregation is exact in cents and never rebuilds stored totals from unit prices or a tax rate', () => {
  const report = buildSalesReport([
    sale({ subtotal: 0.1, iva: 0, total: 0.1 }),
    sale({ subtotal: 0.2, iva: 0, total: 0.2 }),
    sale({ subtotal: 0.29, iva: 0, total: 0.29 }),
    sale({ subtotal: 0.26, iva: 0.04, total: 0.3 }),
  ], allDates);
  // Item prices intentionally differ: a report must use the stored sale fields.
  assert.deepEqual(report.totalRow.slice(5, 8), ['$0.85', '$0.04', '$0.89']);
  assert.equal(report.rows[0][6], '$0.00');
  const many = buildSalesReport(Array.from({ length: 1001 }, () => sale({ subtotal: 0.01, iva: 0, total: 0.01 })), allDates);
  assert.equal(stat(many, 'Total vigente'), '$10.01');
});

test('only-cancelled selection remains visible with zero current totals and missing optional customer data is not invented', () => {
  const report = buildSalesReport([sale({ cancelada: true, cliente: { nombre: '', telefono: null }, factura: null })], allDates);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0][2], '—');
  assert.equal(report.rows[0][7], '$70.00');
  assert.deepEqual(report.totalRow.slice(4, 8), ['0', '$0.00', '$0.00', '$0.00']);
  assert.equal(stat(report, 'Ventas vigentes'), '0');
});

test('builders keep exactly the supplied selection, including when descriptive filters do not match its rows', () => {
  const selected = freeze([sale({ id: 'chosen', folio: 'SELECCIÓN-ÚNICA' })]);
  const report = buildSalesReport(selected, { desde: '2020-01-01', hasta: '2020-01-02' });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0][1], 'SELECCIÓN-ÚNICA');
  assert.deepEqual(report.filters, ['Desde: 01/01/2020', 'Hasta: 02/01/2020']);
  assert.equal(report.filename, 'ventas_2020-01-01_2020-01-02.pdf');
  assert.equal(buildProductsReport([{ id: 'chosen', nombre: 'Único', descripcion: null, precio: 9.5, precioVenta: 999, stock: 2, activo: true }], { busqueda: 'otra cosa' }).rows.length, 1);
});

test('tire stock uses all eight warehouses, keeps inactive stock separate and does not shrink to the warehouse filter', () => {
  const inventory = freeze([
    tire({ stockPorBodega: warehouses([1, 2, 3, 4, 5, 6, 7, 8]) }),
    tire({ id: 'inactive', activo: false, stockPorBodega: warehouses([0, 0, 0, 0, 0, 0, 0, 9]) }),
    tire({ id: 'empty', proveedor: null }),
  ]);
  const report = buildTiresReport(inventory, { bodega: 'bodega-2', estado: 'todos', busqueda: 'Á' });
  assert.equal(report.rows.length, 3);
  assert.equal(report.rows[0][6], '36');
  assert.equal(report.rows[0][7].split('\n').length, 8);
  assert.match(report.rows[0][7], /Local: 1\nEscaleras: 2/);
  assert.match(report.rows[0][7], /Claudia Usadas Hacienda: 7\nJose Manuel Teyahualco: 8/);
  assert.equal(report.rows[1][3], 'Inactiva');
  assert.equal(report.rows[1][6], '9');
  assert.deepEqual(report.rowStatuses, [undefined, 'inactiva', undefined]);
  assert.equal(report.rows[2][4], '—');
  assert.equal(report.rows[2][7], 'Sin existencias');
  assert.equal(stat(report, 'Piezas activas'), '36');
  assert.equal(stat(report, 'Piezas inactivas'), '9');
  assert.equal(stat(report, 'Piezas totales'), '45');
  assert.equal(report.totalRow[6], '45');
  assert.deepEqual(report.filters, ['Búsqueda: Á', 'Estado: Todas', 'Bodega: Escaleras']);
  assert.match(report.note, /incluso cuando se filtró por una bodega/);
});

test('unknown recorded warehouse references retain their units and real ID without invented names', () => {
  const report = buildTiresReport([tire({ stockPorBodega: { 'bodega-1': 2, 'bodega-descontinuada': 4 } })], { bodega: 'Local', estado: 'Activos' });
  assert.equal(report.rows[0][6], '6');
  assert.equal(report.rows[0][7], 'Local: 2\nbodega-descontinuada: 4');
  assert.deepEqual(report.filters, ['Estado: Activos', 'Bodega: Local']);
  assert.throws(() => buildTiresReport([tire({ stockPorBodega: null, cantidad: 99 })], {}), /Faltan las existencias/);
});

test('product and service reports retain accents, nullable descriptions, stored prices and inactive status', () => {
  const products = freeze([
    { id: 'p1', nombre: 'Válvula, edición "Á"', descripcion: 'Descripción\ncompleta', precio: 9.5, precioVenta: 999, stock: 2, activo: true },
    { id: 'p2', nombre: 'Último producto', descripcion: null, precio: 0, stock: 4, activo: false },
  ]);
  const report = buildProductsReport(products, { busqueda: '  Válvula  ' });
  assert.deepEqual(report.rows[0], ['Válvula, edición "Á"', 'Descripción\ncompleta', '$9.50', '2']);
  assert.equal(report.rows[1][1], '—');
  assert.equal(stat(report, 'Existencias seleccionadas'), '6');
  assert.deepEqual(report.rowStatuses, [undefined, 'inactiva']);
  const services = buildServicesReport(freeze([
    { id: 's1', nombre: 'Alineación', descripcion: 'Revisión y ajuste', precioDefault: 350, codigoBarras: 'SERV-Á', activo: true },
    { id: 's2', nombre: 'Reparación', descripcion: null, precioDefault: 0, codigoBarras: '', activo: false },
  ]));
  assert.deepEqual(services.rows[0], ['SERV-Á', 'Alineación', 'Revisión y ajuste', '$350.00', 'Activo']);
  assert.deepEqual(services.rows[1], ['—', 'Reparación', '—', '$0.00', 'Inactivo']);
  assert.deepEqual(services.rowStatuses, [undefined, 'inactiva']);
});

test('empty selections produce no placeholder records and zero totals', () => {
  for (const report of [buildSalesReport([], allDates), buildProductsReport([], {}), buildTiresReport([], {}), buildServicesReport([])]) {
    assert.deepEqual(report.rows, []);
    assert.deepEqual(report.rowStatuses, []);
    assert.ok(report.columns.length > 0);
    assert.match(report.filename, /\.pdf$/);
    assert.ok(report.stats.every((item) => ['0', '$0.00', 'MXN'].includes(item.value)));
  }
});

test('invalid amounts and stock fail explicitly instead of silently becoming invented zeros', () => {
  for (const amount of [NaN, Infinity, null, undefined, 1.005]) {
    assert.throws(() => buildSalesReport([sale({ total: amount })], allDates), /importe|centavo/);
  }
  for (const amount of [-1, 0.5, NaN, undefined]) {
    assert.throws(() => buildTiresReport([tire({ stockPorBodega: { 'bodega-1': amount } })], {}), /cantidad/);
  }
});
