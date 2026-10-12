import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(root, '.env.local'), override: true, quiet: true });
assert.equal(process.env.LLANTERA_EXPECTED_DATABASE, 'llaneteramulti_new_tires');
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)), 'llaneteramulti_new_tires');

// Load the actual adapters with their project aliases, without adding a runtime dependency.
const ts = require('typescript');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
const originalTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

const { Client } = require('pg');
const originalQuery = Client.prototype.query;
const statements = [];
Client.prototype.query = function (sql, ...args) {
  const text = typeof sql === 'string' ? sql : sql.text;
  statements.push(text);
  // Hard guard: this audit cannot perform DML, DDL, or request write locks.
  assert.match(text.trim(), /^(SELECT|BEGIN|COMMIT|ROLLBACK)\b/i, 'Read-only adapter audit attempted a non-read statement');
  assert.doesNotMatch(text, /\bFOR\s+(UPDATE|SHARE)\b/i, 'Read-only audit requested a write lock');
  return originalQuery.call(this, sql, ...args);
};

let db;
try {
  ({ db } = require(path.join(root, 'lib/db.ts')));
  const inventory = require(path.join(root, 'lib/data/inventario.ts'));
  const systemInventory = require(path.join(root, 'lib/data/sistema-inventario.ts'));
  const sales = require(path.join(root, 'lib/data/ventas.ts'));
  const systemSales = require(path.join(root, 'lib/data/sistema-ventas.ts'));
  const products = require(path.join(root, 'lib/data/productos.ts'));
  const services = require(path.join(root, 'lib/data/servicios.ts'));
  const tableKeys = { llantas: 'id', ventas: 'id', movimientos_bodega: 'id', productos: 'id', servicios: 'id', app_metadata: 'key', migration_imported_sales: 'sale_id' };
  async function fingerprint() {
    return Object.fromEntries(await Promise.all(Object.entries(tableKeys).map(async ([table,key]) => {
      const result = await db.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY "${key}"), '')) AS hash FROM ${table} t`);
      return [table, result.rows[0]];
    })));
  }
  const before = await fingerprint();
  const [active, all, generic, moves, history, genericHistory] = await Promise.all([
    systemInventory.obtenerInventarioSistema(), systemInventory.obtenerInventarioSistema({ incluirInactivos: true }),
    inventory.obtenerInventario(), systemInventory.obtenerMovimientosSistema(),
    systemSales.obtenerVentasSistema({ incluirCanceladas: true }), sales.obtenerVentas({ incluirCanceladas: true }),
  ]);
  assert.equal(active.length, 104); assert.equal(all.length, 134); assert.equal(moves.length, 489);
  assert.equal(history.length, 465); assert.equal(genericHistory.length, 465);
  assert.deepEqual(generic, active);
  assert.deepEqual(new Set(history.map((v) => v.id)), new Set(genericHistory.map((v) => v.id)));
  assert.ok(all.every((tire) => tire.proveedor.trim().toUpperCase() === 'COMERCIALIZADORA DE NEW TIRES'));
  assert.equal(active.reduce((sum,tire) => sum + Object.values(tire.stockPorBodega).reduce((a,b) => a+b, 0), 0), 185);
  assert.ok(all.every((tire) => typeof tire.precioCompra === 'number' && typeof tire.precioVenta === 'number' && typeof tire.createdAt === 'string'));
  const inactive = all.find((tire) => !tire.activo);
  assert.equal(await inventory.obtenerLlanta(inactive.id), null);
  assert.equal((await inventory.obtenerLlanta(inactive.id, true)).id, inactive.id);
  assert.ok((await inventory.buscarLlantas('NEW TIRES')).length > 0);
  const unique = await systemInventory.obtenerOpcionesUnicasSistema();
  assert.equal(unique.proveedores.length, 1);
  assert.deepEqual(await inventory.obtenerStockBajo(), await systemInventory.obtenerStockBajoSistema());
  assert.deepEqual(await inventory.obtenerMovimientos(), moves);

  assert.ok(history.every((sale) => sale.soloLecturaMigrada));
  assert.ok(genericHistory.every((sale) => typeof sale.total === 'number' && sale.items.every((item) => item.tipo === 'producto' && typeof item.precioUnitario === 'number' && typeof item.subtotal === 'number')));
  const one = history.find((sale) => !sale.cancelada && sale.garantia?.id);
  const detail = await sales.obtenerVenta(one.id);
  const systemDetail = await systemSales.obtenerVentaSistema(one.id);
  assert.equal(detail.datosOriginalesJson, systemDetail.datosOriginalesJson);
  assert.equal(JSON.parse(detail.datosOriginalesJson).id, one.id);
  assert.deepEqual(detail.datosOriginales, JSON.parse(detail.datosOriginalesJson));
  assert.equal((await systemSales.obtenerVentaPorFolio(one.folio)).id, one.id);
  const warranty = await systemSales.buscarGarantiaPorId(one.garantia.id);
  assert.equal(warranty.success, true); assert.equal(warranty.data.venta.id, one.id);
  const summary = await systemSales.obtenerResumenVentas();
  assert.equal(summary.ventas.length, 465);
  assert.equal(summary.totalIngresos, history.filter((sale) => !sale.cancelada).reduce((sum,sale) => sum + sale.total, 0));
  const [generalWarranties, systemWarranties] = await Promise.all([sales.obtenerGarantiasActivas(), systemSales.obtenerGarantiasActivas()]);
  assert.deepEqual(new Set(generalWarranties.map((sale) => sale.id)), new Set(systemWarranties.map(({ venta }) => venta.id)));
  assert.ok((await sales.obtenerUltimoFolio()) > 0);
  const rejected = await systemSales.cancelarVentaSistema(one.id, 'Read-only migration verification');
  assert.equal(rejected.success, false); assert.match(rejected.error, /historial migrado de solo lectura/);
  await assert.rejects(() => sales.cancelarVenta(one.id, 'Read-only migration verification'), /historial migrado de solo lectura/);
  await assert.rejects(() => sales.marcarFacturada(one.id, { uuid: 'not-written', serie: '', folio: '', fechaTimbrado: '' }), /historial migrado de solo lectura/);

  assert.deepEqual(await products.obtenerProductos(), []);
  assert.equal(await products.obtenerProducto('missing'), null);
  assert.deepEqual(await services.obtenerServicios(), []);
  assert.deepEqual(await services.buscarServicios(''), []);
  assert.equal(await services.obtenerServicio('missing'), null);
  assert.equal(await services.obtenerServicioPorCodigo('missing'), null);
  const after = await fingerprint();
  assert.deepEqual(after, before, 'Adapter reads changed migrated data');
  console.log(JSON.stringify({ success: true, database: 'llaneteramulti_new_tires', activeTires: active.length, totalTires: all.length, activeUnits: 185, sales: history.length, movements: moves.length, guarantees: systemWarranties.length, statements: statements.length, dataUnchanged: true, importedMutationRejected: true, runtimeUsesJsonFiles: false }, null, 2));
} finally {
  if (global._llanteraPg) await global._llanteraPg.pool.end();
  Client.prototype.query = originalQuery;
  Module._resolveFilename = originalResolve;
  if (originalTs) require.extensions['.ts'] = originalTs;
  else delete require.extensions['.ts'];
}
