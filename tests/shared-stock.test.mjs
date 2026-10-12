import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Fault injection for the two-database coordinator. Real SQL constraints and
// permissions are tested separately against isolated PostgreSQL databases.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), ts = require('typescript');
const oldResolve = Module._resolveFilename, oldLoad = Module._load, oldTs = require.extensions['.ts'];
Module._resolveFilename = function(request, parent, ...args) {
  return oldResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const realCentral = require(path.join(root, 'lib/central-inventory.ts'));
let world;
const clone = (value) => structuredClone(value);
const row = () => ({ id: 'central-tire', marca: 'Fixture', modelo: 'A', medida: '205/55R16',
  ancho: 205, perfil: 55, rin: 16, precio_compra: 50, precio_venta: 116, precio_mayorista: null,
  stock: 10, stock_por_bodega: { 'bodega-1': 10 }, proveedor: realCentral.CENTRAL_SUPPLIER,
  activo: true, created_at: null, updated_at: null, fecha_recepcion: null, fecha_recepcion_original: null });

function reset() {
  world = { state: { ops: new Map(), sales: new Map(), productStock: 10 }, locks: new Map(),
    central: new Map(), centralStock: 10, saves: 0, reserveCalls: 0, centralReads: 0,
    reserveFault: null, commitFault: false, releaseFault: false, commitAckLost: false,
    localCommitFails: false, crashLocalOnReserve: false };
}
function result(rows = []) { return { rows, rowCount: rows.length }; }
class LocalClient {
  constructor() { this.tx = null; this.closed = false; this.held = new Set(); }
  get state() { return this.tx ?? world.state; }
  async query(sql, args = []) {
    if (this.closed) throw new Error('Local connection lost');
    if (sql.startsWith('SELECT pg_advisory_lock')) {
      const key = args[0];
      while (world.locks.has(key)) await new Promise((resolve) => world.locks.get(key).waiters.push(resolve));
      world.locks.set(key, { owner: this, waiters: [] }); this.held.add(key); return result([{}]);
    }
    if (sql.startsWith('SELECT pg_try_advisory_lock')) {
      const key = args[0], locked = !world.locks.has(key);
      if (locked) { world.locks.set(key, { owner: this, waiters: [] }); this.held.add(key); }
      return result([{ locked }]);
    }
    if (sql.startsWith('SELECT pg_advisory_unlock')) { this.unlock(args[0]); return result([{}]); }
    if (sql === 'BEGIN') { assert.equal(this.tx, null); this.tx = clone(world.state); return result(); }
    if (sql === 'ROLLBACK') { this.tx = null; return result(); }
    if (sql === 'COMMIT') {
      if (world.localCommitFails) { world.localCommitFails = false; throw new Error('Local commit rejected'); }
      world.state = this.tx; this.tx = null;
      if (world.commitAckLost) { world.commitAckLost = false; throw new Error('Local commit response lost'); }
      return result();
    }
    if (sql.startsWith('INSERT INTO public.shared_stock_operations')) {
      if (!this.state.ops.has(args[0])) this.state.ops.set(args[0], { id: args[0], request_hash: args[1], payload: JSON.parse(args[2]), status: sql.includes("'released'") ? 'released' : 'intent', sale_id: null, reservation: null });
      return result();
    }
    if (sql.startsWith('SELECT * FROM public.shared_stock_operations')) {
      const op = this.state.ops.get(args[0]); return result(op ? [clone(op)] : []);
    }
    if (sql.startsWith('SELECT id FROM public.shared_stock_operations')) {
      return result([...this.state.ops.values()].filter((op) => ['intent', 'reserved', 'local_committed', 'release_pending'].includes(op.status)).slice(0, args[0]).map(({ id }) => ({ id })));
    }
    if (sql.startsWith('UPDATE public.shared_stock_operations')) {
      const op = this.state.ops.get(args[0]);
      const status = sql.match(/status='([^']+)'/); if (status) op.status = status[1];
      if (sql.includes('sale_id=$2')) op.sale_id = args[1];
      if (sql.includes('reservation=$2')) op.reservation = JSON.parse(args[1]);
      return result();
    }
    if (sql === 'TEST_SAVE') {
      this.state.productStock -= 1;
      this.state.sales.set(args[0], { id: args[0], cancelada: false });
      return result();
    }
    if (sql === 'TEST_READ') return result([clone(this.state.sales.get(args[0]))]);
    if (sql === 'TEST_CANCEL') {
      const sale = this.state.sales.get(args[0]);
      if (!sale.cancelada) { sale.cancelada = true; this.state.productStock += 1; }
      return result([clone(sale)]);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  unlock(key) {
    const lock = world.locks.get(key);
    if (lock?.owner === this) { world.locks.delete(key); this.held.delete(key); for (const resolve of lock.waiters) resolve(); }
  }
  release() { this.tx = null; for (const key of this.held) this.unlock(key); }
}
const localDb = {
  async getClient() { const client = new LocalClient(); world.lastClient = client; return client; },
  async query(sql, args) { const client = new LocalClient(); try { return await client.query(sql, args); } finally { client.release(); } },
};
const central = {
  ...realCentral,
  centralInventory: { async query() { world.centralReads++; return result([world.centralRow ?? row()]); } },
  async reserveCentralStock(id, items) {
    world.reserveCalls++;
    if (world.reserveFault === 'before') { world.reserveFault = null; throw new Error('Reserve response unavailable'); }
    let op = world.central.get(id);
    if (!op) {
      const quantity = items.reduce((sum, item) => sum + item.cantidad, 0);
      if (quantity > world.centralStock) throw new Error('Stock insuficiente');
      world.centralStock -= quantity;
      op = { operationId: id, status: 'reserved', items: clone(items), snapshots: { 'central-tire': row() } }; world.central.set(id, op);
    }
    if (world.reserveFault === 'after') {
      world.reserveFault = null;
      if (world.crashLocalOnReserve) world.lastClient.closed = true;
      throw new Error('Reserve response lost');
    }
    return clone(op);
  },
  async commitCentralStock(id) {
    if (world.commitFault) throw new Error('Central unavailable');
    const op = world.central.get(id); assert.ok(op); assert.notEqual(op.status, 'released'); op.status = 'committed'; return clone(op);
  },
  async releaseCentralStock(id) {
    if (world.releaseFault) throw new Error('Central unavailable');
    let op = world.central.get(id);
    if (!op) { op = { operationId: id, status: 'released', items: [], snapshots: {} }; world.central.set(id, op); }
    if (op.status !== 'released') { world.centralStock += op.items.reduce((sum, item) => sum + item.cantidad, 0); op.status = 'released'; }
    return clone(op);
  },
};
Module._load = function(request, parent, isMain) {
  if (request === '@/lib/db') return { db: localDb };
  if (request === '@/lib/central-inventory') return central;
  return oldLoad.call(this, request, parent, isMain);
};
const shared = require(path.join(root, 'lib/shared-stock.ts'));
const inventory = require(path.join(root, 'lib/data/sistema-inventario.ts'));
const sales = require(path.join(root, 'lib/data/ventas.ts'));
const operationId = 'test-operation-000000001';
const stockItems = [{ id: 'central-tire', bodega: 'bodega-1', cantidad: 2 }];
function options(changes = {}) {
  return { id: operationId, request: { customer: 'Fixture', items: stockItems }, items: stockItems,
    async save(client) {
      world.saves++;
      const saleId = 'local-sale';
      await client.query('TEST_SAVE', [saleId]);
      await client.query('UPDATE public.shared_stock_operations SET sale_id=$2 WHERE id=$1', [operationId, saleId]);
      return { saleId, result: (await client.query('TEST_READ', [saleId])).rows[0] };
    },
    async readSale(client, id) { return (await client.query('TEST_READ', [id])).rows[0]; }, ...changes };
}
async function cancel() {
  return shared.withSharedStockCancellation(operationId, async (client) => {
    const sale = (await client.query('TEST_READ', ['local-sale'])).rows[0];
    if (sale.cancelada) return sale;
    const cancelled = (await client.query('TEST_CANCEL', [sale.id])).rows[0];
    await client.query("UPDATE public.shared_stock_operations SET status='release_pending' WHERE id=$1", [operationId]);
    return cancelled;
  });
}

after(() => { Module._resolveFilename = oldResolve; Module._load = oldLoad;
  if (oldTs) require.extensions['.ts'] = oldTs; else delete require.extensions['.ts']; });

test('duplicate submit returns the original ticket and deducts inventory/products once', async () => {
  reset();
  const [first, retry] = await Promise.all([shared.withSharedStockSale(options()), shared.withSharedStockSale(options())]);
  assert.deepEqual(first, retry); assert.equal(world.saves, 1); assert.equal(world.reserveCalls, 1);
  assert.equal(world.centralStock, 8); assert.equal(world.state.productStock, 9);
});

test('reuse with a different complete sale payload fails without altering the first operation', async () => {
  reset(); await shared.withSharedStockSale(options());
  await assert.rejects(shared.withSharedStockSale(options({ request: { customer: 'Different' } })), /otros datos/);
  assert.equal(world.saves, 1); assert.equal(world.centralStock, 8); assert.equal(world.state.ops.get(operationId).status, 'committed');
});

test('failed local transaction rolls back catalog stock and compensates central reserve once', async () => {
  reset(); const originalSave = options().save;
  await assert.rejects(shared.withSharedStockSale(options({ async save(client, reservation) {
    await originalSave(client, reservation); throw new Error('Insert failed');
  } })), /Insert failed/);
  assert.equal(world.state.sales.size, 0); assert.equal(world.state.productStock, 10); assert.equal(world.centralStock, 10);
  await shared.reconcileSharedStock(); assert.equal(world.centralStock, 10);
  await assert.rejects(shared.withSharedStockSale(options()), /operación anterior se canceló/);
});

test('reserve timeout before execution leaves a tombstone, blocking a delayed reserve', async () => {
  reset(); world.reserveFault = 'before';
  await assert.rejects(shared.withSharedStockSale(options()), /unavailable/);
  const late = await central.reserveCentralStock(operationId, stockItems);
  assert.equal(late.status, 'released'); assert.equal(world.centralStock, 10); assert.equal(world.state.sales.size, 0);
});

test('lost reserve response after stock deduction is compensated', async () => {
  reset(); world.reserveFault = 'after';
  await assert.rejects(shared.withSharedStockSale(options()), /response lost/);
  assert.equal(world.centralStock, 10); assert.equal(world.state.ops.get(operationId).status, 'released');
});

test('a corrected cart after confirmed compensation receives terminal status instead of getting trapped by its old hash', async () => {
  reset(); world.reserveFault = 'after';
  await assert.rejects(shared.withSharedStockSale(options()), /response lost/);
  await assert.rejects(shared.withSharedStockSale(options({ request: { customer: 'Corrected', items: stockItems } })),
    { message: 'La operación anterior se canceló. Inicia una nueva venta.' });
  assert.equal(world.centralStock, 10); assert.equal(world.state.sales.size, 0);
});

test('an uncertain compensation never reports a terminal release allowing a new operation', async () => {
  reset(); world.reserveFault = 'after'; world.releaseFault = true;
  await assert.rejects(shared.withSharedStockSale(options()), /response lost/);
  assert.equal(world.state.ops.get(operationId).status, 'release_pending');
  await assert.rejects(shared.withSharedStockSale(options({ request: { customer: 'Corrected' } })), /pendiente de conciliación/);
  assert.equal(world.centralStock, 8); assert.equal(world.state.sales.size, 0);
  world.releaseFault = false;
  await assert.rejects(shared.withSharedStockSale(options({ request: { customer: 'Corrected' } })),
    { message: 'La operación anterior se canceló. Inicia una nueva venta.' });
  assert.equal(world.centralStock, 10);
});

test('process/connection loss leaves durable intent and later recovery restores orphan reserve', async () => {
  reset(); world.reserveFault = 'after'; world.crashLocalOnReserve = true;
  await assert.rejects(shared.withSharedStockSale(options()), /response lost/);
  assert.equal(world.centralStock, 8); assert.equal(world.state.ops.get(operationId).status, 'intent');
  await shared.reconcileSharedStock();
  assert.equal(world.centralStock, 10); assert.equal(world.state.ops.get(operationId).status, 'released');
});

test('lost local COMMIT acknowledgement never releases inventory backing a durable sale', async () => {
  reset(); world.commitAckLost = true;
  await assert.rejects(shared.withSharedStockSale(options()), /commit response lost/);
  assert.equal(world.state.sales.size, 1); assert.equal(world.centralStock, 8); assert.equal(world.state.productStock, 9);
  const sale = await shared.withSharedStockSale(options());
  assert.equal(sale.id, 'local-sale'); assert.equal(world.saves, 1); assert.equal(world.centralStock, 8);
});

test('local COMMIT rejection releases stock and preserves local products', async () => {
  reset(); world.localCommitFails = true;
  await assert.rejects(shared.withSharedStockSale(options()), /commit rejected/);
  assert.equal(world.state.sales.size, 0); assert.equal(world.state.productStock, 10); assert.equal(world.centralStock, 10);
});

test('central confirmation outage still returns the committed sale and recovers on later access', async () => {
  reset(); world.commitFault = true;
  const sale = await shared.withSharedStockSale(options());
  assert.equal(sale.id, 'local-sale'); assert.equal(world.state.ops.get(operationId).status, 'local_committed');
  assert.equal(world.centralStock, 8);
  world.commitFault = false; await shared.reconcileSharedStock();
  assert.equal(world.state.ops.get(operationId).status, 'committed'); assert.equal(world.centralStock, 8);
});

test('reconciliation skips an operation whose sale is still executing', async () => {
  reset(); let resume, entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const originalSave = options().save;
  const selling = shared.withSharedStockSale(options({ async save(client, reservation) {
    entered(); await new Promise((resolve) => { resume = resolve; }); return originalSave(client, reservation);
  } }));
  await enteredPromise; await shared.reconcileSharedStock();
  assert.equal(world.centralStock, 8); assert.equal(world.central.get(operationId).status, 'reserved');
  resume(); await selling; assert.equal(world.state.ops.get(operationId).status, 'committed');
});

test('cancellation returns central and local product stock once, including repeated requests', async () => {
  reset(); await shared.withSharedStockSale(options());
  const first = await cancel(), repeat = await cancel();
  assert.deepEqual(first, repeat); assert.equal(first.cancelada, true);
  assert.equal(world.centralStock, 10); assert.equal(world.state.productStock, 10);
  assert.equal(world.state.ops.get(operationId).status, 'released');
});

test('cancelled sale remains durable during release outage and recovery restores stock later', async () => {
  reset(); await shared.withSharedStockSale(options()); world.releaseFault = true;
  assert.equal((await cancel()).cancelada, true);
  assert.equal(world.state.productStock, 10); assert.equal(world.centralStock, 8);
  assert.equal(world.state.ops.get(operationId).status, 'release_pending');
  world.releaseFault = false; await shared.reconcileSharedStock();
  assert.equal(world.centralStock, 10); assert.equal(world.state.productStock, 10);
});

test('only supplier-scoped central inventory is displayed and every inventory mutation is blocked', async () => {
  reset();
  assert.equal((await inventory.obtenerInventarioSistema())[0].id, 'central-tire'); assert.equal(world.centralReads, 1);
  world.centralRow = { ...row(), proveedor: 'OTHER SUPPLIER' };
  await assert.rejects(inventory.obtenerInventarioSistema(), /fuera del proveedor/);
  for (const call of [() => inventory.crearLlantaSistema({ proveedor: realCentral.CENTRAL_SUPPLIER }),
    () => inventory.actualizarLlantaSistema('id', {}), () => inventory.eliminarLlantaSistema('id'),
    () => inventory.ajustarStockSistema('id', 'bodega-1', 1),
    () => inventory.moverStockSistema('id', 'bodega-1', 'bodega-2', 1)]) {
    await assert.rejects(call(), /Sistema Bodega/);
  }
  assert.equal(world.state.ops.size, 0); assert.equal(world.state.sales.size, 0);
});

test('stable operation IDs are mandatory and duplicate tire lines are aggregated deterministically', () => {
  reset(); assert.throws(() => shared.validateOperationId(''), /identificador estable/);
  assert.deepEqual(shared.aggregateStockItems([...stockItems, ...stockItems]), [{ ...stockItems[0], cantidad: 4 }]);
  assert.equal(shared.sharedRequestHash({ b: 2, a: 1 }), shared.sharedRequestHash({ a: 1, b: 2 }));
  assert.notEqual(shared.sharedRequestHash({ items: stockItems, customer: 'A' }), shared.sharedRequestHash({ items: stockItems, customer: 'B' }));
});

test('products/services-only tickets are idempotent and never contact central inventory', async () => {
  reset(); world.commitFault = true; world.releaseFault = true; world.reserveFault = 'before';
  const localOptions = options({ items: [], request: { customer: 'Fixture', service: 'service-fixture' } });
  const first = await shared.withSharedStockSale(localOptions);
  assert.deepEqual(await shared.withSharedStockSale(localOptions), first);
  assert.equal(world.saves, 1); assert.equal(world.reserveCalls, 0); assert.equal(world.central.size, 0);
  assert.equal(world.state.productStock, 9); assert.equal(world.state.ops.get(operationId).status, 'committed');
  await cancel(); await cancel(); assert.equal(world.state.productStock, 10); assert.equal(world.central.size, 0);
});

test('lost local COMMIT acknowledgement for a service-only sale returns its original ticket on retry', async () => {
  reset(); world.commitAckLost = true;
  const localOptions = options({ items: [], request: { service: 'service-fixture' } });
  await assert.rejects(shared.withSharedStockSale(localOptions), /response lost/);
  assert.equal((await shared.withSharedStockSale(localOptions)).id, 'local-sale');
  assert.equal(world.reserveCalls, 0); assert.equal(world.saves, 1); assert.equal(world.state.productStock, 9);
});

test('input rejection creates a confirmed local tombstone only for unused IDs', async () => {
  reset();
  const invalid = new Error('El teléfono es demasiado largo');
  await assert.rejects(shared.rejectUnstartedStockOperation(operationId, { invalid: true }, invalid),
    (error) => error.message === invalid.message && shared.releasedOperationStatus(error) === 'released');
  assert.equal(world.state.ops.get(operationId).status, 'released'); assert.equal(world.reserveCalls, 0);
  reset(); await shared.withSharedStockSale(options());
  await assert.rejects(shared.rejectUnstartedStockOperation(operationId, { invalid: true }, invalid),
    (error) => error === invalid && shared.releasedOperationStatus(error) === undefined);
  assert.equal(world.state.ops.get(operationId).status, 'committed'); assert.equal(world.centralStock, 8);
});

test('only confirmed compensation exposes released status; uncertain failures keep the checkout pending', async () => {
  reset(); world.reserveFault = 'after';
  await assert.rejects(shared.withSharedStockSale(options()), (error) => shared.releasedOperationStatus(error) === 'released');
  reset(); world.reserveFault = 'after'; world.releaseFault = true;
  await assert.rejects(shared.withSharedStockSale(options()), (error) => shared.releasedOperationStatus(error) === undefined);
  assert.equal(world.state.ops.get(operationId).status, 'release_pending');
});

test('real sale input validation reports safe release for unused IDs and never releases a prior committed ID', async () => {
  const base = { operacionId: operationId, clienteNombre: 'Fixture', generarFactura: false, metodoPago: 'efectivo',
    items: [{ tipo: 'producto', id: 'central-tire', bodega: 'bodega-1', cantidad: 1 }] };
  for (const change of [{ diasGarantia: -1 }, { metodoPago: 'unsupported' }, { clienteTelefono: '1'.repeat(21) },
    { items: [{ ...base.items[0], cantidad: 0 }] }]) {
    reset();
    await assert.rejects(sales.crearVenta({ ...base, ...change }),
      (error) => shared.releasedOperationStatus(error) === 'released');
    assert.equal(world.state.ops.get(operationId).status, 'released'); assert.equal(world.reserveCalls, 0);
  }
  reset(); await shared.withSharedStockSale(options());
  await assert.rejects(sales.crearVenta({ ...base, metodoPago: 'unsupported' }),
    (error) => shared.releasedOperationStatus(error) === undefined);
  assert.equal(world.centralStock, 8); assert.equal(world.state.ops.get(operationId).status, 'committed');
});
