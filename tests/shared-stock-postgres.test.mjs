import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Opt-in: the checks refuse every database except disposable codex_shared_*
// clones. No .env file is loaded, and no production defaults are supplied.
const enabled = process.env.RUN_SHARED_POSTGRES_TESTS === '1';
const integration = (name, fn) => test(name, { skip: !enabled }, fn);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let centralAdmin, localAdmin, sales, inventory, coordinator, products, services, previousResolve, previousTs;
let localTireHash;
const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;
const tireId = `shared-tire-${suffix}`, otherId = `shared-other-${suffix}`;
let productId, serviceId;
const operation = () => `shared-test-${randomUUID()}`;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tireItem = (changes = {}) => ({ tipo: 'producto', id: tireId, bodega: 'bodega-1', cantidad: 1, ...changes });
const input = (items, changes = {}) => ({ operacionId: operation(), clienteNombre: 'Disposable integration fixture',
  items, metodoPago: 'efectivo', generarFactura: false, sinGarantia: true, ...changes });

before(async () => {
  if (!enabled) return;
  for (const key of ['DATABASE_URL', 'CENTRAL_INVENTORY_DATABASE_URL']) {
    assert.ok(process.env[key], `${key} is required for opt-in integration tests`);
    assert.match(decodeURIComponent(new URL(process.env[key]).pathname.slice(1)), /^codex_shared_[a-zA-Z0-9_]+$/,
      'These tests may only access disposable codex_shared_* databases');
  }
  const centralUrl = process.env.SHARED_TEST_CENTRAL_ADMIN_DATABASE_URL || process.env.CENTRAL_INVENTORY_DATABASE_URL;
  assert.match(decodeURIComponent(new URL(centralUrl).pathname.slice(1)), /^codex_shared_[a-zA-Z0-9_]+$/);
  process.env.LLANTERA_EXPECTED_DATABASE = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  const { Pool } = require('pg'), ts = require('typescript');
  centralAdmin = new Pool({ connectionString: centralUrl, options: '-c timezone=America/Mexico_City' });
  localAdmin = new Pool({ connectionString: process.env.DATABASE_URL, application_name: process.env.LLANTERA_APPLICATION_ID,
    options: '-c timezone=America/Mexico_City -c search_path=public' });
  previousResolve = Module._resolveFilename; previousTs = require.extensions['.ts'];
  Module._resolveFilename = function(request, parent, ...args) {
    return previousResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
  };
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  sales = require(path.join(root, 'lib/data/ventas.ts'));
  inventory = require(path.join(root, 'lib/data/sistema-inventario.ts'));
  coordinator = require(path.join(root, 'lib/shared-stock.ts'));
  products = require(path.join(root, 'lib/data/productos.ts'));
  services = require(path.join(root, 'lib/data/servicios.ts'));
  localTireHash = hash((await localAdmin.query('SELECT id,stock,stock_por_bodega FROM llantas ORDER BY id')).rows);
  for (const [id, supplier] of [[tireId, 'COMERCIALIZADORA DE NEW TIRES'], [otherId, 'UNRELATED TEST SUPPLIER']]) {
    await centralAdmin.query(`INSERT INTO public.llantas
      (id,marca,modelo,medida,ancho,perfil,rin,"precioCompra","precioVenta","precioMayorista","stockPorBodega",proveedor,dominio,activo)
      VALUES ($1,'Disposable','Fixture','205/55R16',205,55,16,50,116,100,$2::jsonb,$3,'sistema',true)`,
    [id, JSON.stringify({ 'bodega-1': 20, 'bodega-2': 5 }), supplier]);
  }
  productId = (await products.crearProducto({ nombre: `Fixture product ${suffix}`, precio: 58, precioCompra: 10, cantidad: 20 })).id;
  serviceId = (await services.crearServicio({ nombre: `Fixture service ${suffix}`, descripcion: 'Scratch only', precioDefault: 116 })).id;
});

after(async () => {
  if (!enabled) return;
  try {
    if (localAdmin && localTireHash) assert.equal(hash((await localAdmin.query('SELECT id,stock,stock_por_bodega FROM llantas ORDER BY id')).rows), localTireHash,
      'No existing local tire inventory may be changed by the integration');
  } finally {
    if (previousResolve) Module._resolveFilename = previousResolve;
    if (previousTs) require.extensions['.ts'] = previousTs; else delete require.extensions['.ts'];
    await Promise.all([centralAdmin?.end(), localAdmin?.end(), global._llanteraPg?.pool.end(), global._multiCentralInventory?.pool.end()]);
    delete global._llanteraPg; delete global._multiCentralInventory;
  }
  // Fixtures and their immutable tickets remain in the disposable clone for
  // inspection; dropping that database is the cleanup, not bypassing triggers.
});

async function centralUnits(id = tireId, bodega = 'bodega-1') {
  return Number((await centralAdmin.query('SELECT ("stockPorBodega"->>$2)::int AS units FROM public.llantas WHERE id=$1', [id, bodega])).rows[0].units);
}
async function journal(id) { return (await localAdmin.query('SELECT status,sale_id,payload,reservation FROM shared_stock_operations WHERE id=$1', [id])).rows[0]; }

integration('real central inventory includes new central IDs and excludes every other supplier', async () => {
  const inventoryRows = await inventory.obtenerInventarioSistema();
  assert.ok(inventoryRows.some((item) => item.id === tireId));
  assert.ok(inventoryRows.every((item) => item.proveedor.trim().replace(/\s+/g, ' ').toUpperCase() === 'COMERCIALIZADORA DE NEW TIRES'));
  assert.equal(await inventory.obtenerLlantaSistema(otherId), null);
  assert.equal((await localAdmin.query('SELECT id FROM llantas WHERE id=$1', [tireId])).rowCount, 0);
});

integration('real mixed sale reserves duplicate lines centrally once, keeps IVA, and cancels once', async () => {
  const before = await centralUnits(), beforeProducts = (await products.obtenerProducto(productId)).stock;
  const request = input([tireItem(), tireItem(), { tipo: 'catalogo', id: productId, cantidad: 1 }, { tipo: 'servicio', id: serviceId, cantidad: 1 }]);
  const [sale, duplicate] = await Promise.all([sales.crearVenta(request), sales.crearVenta(request)]);
  assert.equal(sale.id, duplicate.id); assert.equal(sale.total, 406); assert.equal(sale.subtotal, 350); assert.equal(sale.iva, 56);
  assert.equal(await centralUnits(), before - 2); assert.equal((await products.obtenerProducto(productId)).stock, beforeProducts - 1);
  const op = await journal(request.operacionId); assert.equal(op.status, 'committed'); assert.equal(op.sale_id, sale.id);
  assert.equal(op.payload.length, 1); assert.equal(op.payload[0].cantidad, 2);
  const items = (await localAdmin.query("SELECT shared_stock_operation_id FROM venta_items WHERE venta_id=$1 AND tipo='producto'", [sale.id])).rows;
  assert.equal(items.length, 2); assert.ok(items.every((item) => item.shared_stock_operation_id === request.operacionId));
  assert.equal((await sales.cancelarVenta(sale.id, 'Scratch cancellation')).cancelada, true);
  assert.equal((await sales.cancelarVenta(sale.id, 'Repeated scratch cancellation')).cancelada, true);
  assert.equal(await centralUnits(), before); assert.equal((await products.obtenerProducto(productId)).stock, beforeProducts);
  assert.equal((await journal(request.operacionId)).status, 'released');
});

integration('real local product failure after reservation compensates stock and creates no sale', async () => {
  const before = await centralUnits();
  const request = input([tireItem(), { tipo: 'catalogo', id: `missing-${suffix}`, cantidad: 1 }]);
  await assert.rejects(sales.crearVenta(request), (error) => /no encontrado/i.test(error.message) && coordinator.releasedOperationStatus(error) === 'released');
  assert.equal(await centralUnits(), before); const op = await journal(request.operacionId);
  assert.equal(op.status, 'released'); assert.equal(op.sale_id, null);
});

integration('real supplier rejection and insufficient stock never persist tickets', async () => {
  for (const item of [tireItem({ id: otherId }), tireItem({ cantidad: 1000 })]) {
    const before = await centralUnits(); const request = input([item]);
    await assert.rejects(sales.crearVenta(request));
    assert.equal(await centralUnits(), before); const op = await journal(request.operacionId);
    assert.equal(op.status, 'released'); assert.equal(op.sale_id, null);
  }
});

integration('real service/catalog sales are idempotent without a central connection', async () => {
  const savedUrl = process.env.CENTRAL_INVENTORY_DATABASE_URL;
  delete process.env.CENTRAL_INVENTORY_DATABASE_URL;
  try {
    const before = (await products.obtenerProducto(productId)).stock;
    const request = input([{ tipo: 'catalogo', id: productId, cantidad: 1 }, { tipo: 'servicio', id: serviceId, cantidad: 1 }]);
    const sale = await sales.crearVenta(request);
    assert.equal((await sales.crearVenta(request)).id, sale.id);
    assert.equal((await products.obtenerProducto(productId)).stock, before - 1);
    const op = await journal(request.operacionId); assert.deepEqual(op.payload, []); assert.equal(op.reservation, null); assert.equal(op.status, 'committed');
    await sales.cancelarVenta(sale.id, 'Scratch local cancellation');
    assert.equal((await products.obtenerProducto(productId)).stock, before); assert.equal((await journal(request.operacionId)).status, 'released');
  } finally { process.env.CENTRAL_INVENTORY_DATABASE_URL = savedUrl; }
});

integration('real validation failure leaves a safe local tombstone and never alters prior successful IDs', async () => {
  const request = input([{ tipo: 'servicio', id: serviceId, cantidad: 1 }], { clienteTelefono: '1'.repeat(21) });
  await assert.rejects(sales.crearVenta(request), (error) => coordinator.releasedOperationStatus(error) === 'released');
  assert.equal((await journal(request.operacionId)).status, 'released');
  const valid = input([{ tipo: 'servicio', id: serviceId, cantidad: 1 }]); const sale = await sales.crearVenta(valid);
  await assert.rejects(sales.crearVenta({ ...valid, clienteTelefono: '1'.repeat(21) }),
    (error) => coordinator.releasedOperationStatus(error) === undefined);
  assert.equal((await journal(valid.operacionId)).status, 'committed');
  await sales.cancelarVenta(sale.id, 'Scratch cleanup cancellation');
});

integration('real abandoned reservation is recovered after process restart', async () => {
  const before = await centralUnits(), id = operation(), items = [{ id: tireId, bodega: 'bodega-1', cantidad: 1 }];
  await localAdmin.query("INSERT INTO shared_stock_operations(id,request_hash,payload,status) VALUES($1,$2,$3::jsonb,'intent')", [id, 'a'.repeat(64), JSON.stringify(items)]);
  await centralAdmin.query('SELECT multi_inventory.reserve_stock($1,$2::jsonb)', [id, JSON.stringify(items)]);
  assert.equal(await centralUnits(), before - 1);
  await coordinator.reconcileSharedStock();
  assert.equal(await centralUnits(), before); assert.equal((await journal(id)).status, 'released');
});

integration('real imported tickets and historical local tire inventory remain immutable', async () => {
  const imported = (await localAdmin.query('SELECT sale_id FROM migration_new_tires.imported_sales LIMIT 1')).rows[0];
  if (imported) await assert.rejects(sales.cancelarVenta(imported.sale_id, 'Must fail'), /solo lectura/);
  await assert.rejects(localAdmin.query('UPDATE llantas SET stock=stock WHERE false'), /central/);
});
