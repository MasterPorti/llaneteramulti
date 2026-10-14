// Executes the actual application data modules in an isolated Node process.
// The parent supplies only an explicitly checked local test database; no .env is read.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.env.SHARED_TEST_WORKTREE;
if (!root || !process.send || process.env.NODE_ENV !== 'development') throw new Error('Use the integration test runner.');
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/llantas_shared_tests'
  || process.env.SHARED_DATABASE_ENVIRONMENT !== 'development' || process.env.SHARED_DATABASE_MODE !== 'true') {
  throw new Error('The integration worker only accepts the isolated local test database.');
}
const requirePackage = createRequire(path.join(root, 'package.json'));
const ts = requirePackage('typescript');
const pg = requirePackage('pg');
let lostCommitAcknowledgement = false;
class FaultInjectionPool extends pg.Pool {
  async connect() {
    const client = await super.connect();
    // The real PostgreSQL COMMIT succeeds. Only its acknowledgement to the app
    // is lost, exercising recovery against committed data rather than fake rows.
    const original = client.query.bind(client);
    client.query = async (...args) => {
      const result = await original(...args);
      if (!lostCommitAcknowledgement && args[0] === 'COMMIT') {
        lostCommitAcknowledgement = true;
        throw new Error('Integration fault: lost COMMIT acknowledgement');
      }
      return result;
    };
    return client;
  }
}
const cache = new Map();
function load(filename) {
  let full = path.resolve(filename);
  if (!path.extname(full)) full = [full + '.ts', full + '.tsx', path.join(full, 'index.ts')].find(fs.existsSync);
  if (!full || !full.startsWith(path.resolve(root) + path.sep)) throw new Error('Module outside test worktree.');
  if (cache.has(full)) return cache.get(full).exports;
  const compiledModule = { exports: {} }; cache.set(full, compiledModule);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const localRequire = name => name === 'server-only' ? {} : name.startsWith('@/') ? load(path.join(root, name.slice(2)))
    : name.startsWith('.') ? load(path.resolve(path.dirname(full), name))
      : name === 'pg' && process.env.SHARED_TEST_COMMIT_ACK_LOSS === 'true' ? { ...pg, Pool: FaultInjectionPool } : requirePackage(name);
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(localRequire, compiledModule, compiledModule.exports, full, path.dirname(full));
  return compiledModule.exports;
}
function data(name) { return load(path.join(root, 'lib/data', name)); }
function successful(result) {
  if (!result?.success) throw new Error(result?.error || 'Application rejected operation.');
  return result.data;
}
async function productImage(change) {
  if (change === undefined) return undefined;
  const form = new FormData();
  if (change.eliminarImagen !== undefined) form.set('eliminarImagen', String(change.eliminarImagen));
  if (change.base64 !== undefined) form.set('imagen', new File([Buffer.from(change.base64, 'base64')], change.name, { type: change.mime }));
  return load(path.join(root, 'lib/utils/upload-imagen')).prepararImagenProducto(form);
}
async function dispatch(message) {
  const { application, operation, input, id, reason, ids } = message;
  if (application === 'blanca') {
    if (operation === 'sale') return data('shared-database-ventas').sharedCreateSale(input, message.domain ?? 'sistema');
    if (operation === 'cancel') return data('shared-database-ventas').sharedCancelSale(id, reason);
    if (operation === 'get') return data('shared-database-ventas').sharedFindSale(id, message.by ?? 'id');
    if (operation === 'tire-get') return data('shared-database-catalog').sharedTire(id, message.includeInactive ?? false);
    if (operation === 'movements') return (await data('shared-database-catalog').sharedMovements()).filter(row => ids.includes(row.llantaId));
    if (operation === 'product') return data('shared-database-catalog').sharedCreateProduct(input, await productImage(message.imageChange));
    if (operation === 'service') return data('shared-database-catalog').sharedSaveService(null, input);
    if (operation === 'product-update') return data('shared-database-catalog').sharedUpdateProduct(id, input, await productImage(message.imageChange));
    if (operation === 'product-adjust') return data('shared-database-catalog').sharedAdjustProduct(id, input.delta);
    if (operation === 'service-update') return data('shared-database-catalog').sharedSaveService(id, input);
    if (operation === 'catalog-deactivate') return data('shared-database-catalog').sharedDeleteCatalog(message.table, id);
    if (operation === 'invoice') return data('shared-database-ventas').sharedMarkInvoiced(id, input);
    if (operation === 'catalog') {
      const catalog = data('shared-database-catalog');
      return {
        tires: (await catalog.sharedTires()).filter(row => ids.includes(row.id)),
        products: (await catalog.sharedProducts()).filter(row => ids.includes(row.id)),
        services: (await catalog.sharedServices()).filter(row => ids.includes(row.id)),
      };
    }
    if (operation === 'history') return (await data('shared-database-ventas').sharedSales({ incluirCanceladas: true })).filter(row => ids.includes(row.id));
    if (operation === 'fiscal-history') {
      const sales = (await data('shared-database-ventas').sharedSales({ incluirCanceladas: true })).filter(row => ids.includes(row.id));
      const report = load(path.join(root, 'lib/reports/data')).buildSalesReport(sales, {});
      return { sales: sales.map(({ id, folio, subtotal, iva, total, cancelada }) => ({ id, folio, subtotal, iva, total, cancelada })),
        reportRowCount: report.rows.length, reportTotals: report.totalRow };
    }
  } else if (application === 'negra') {
    if (operation === 'sale') return successful(await data('sistema-ventas').crearVentaSistema(input));
    if (operation === 'mixed-sale') return data('ventas').crearVenta(input);
    if (operation === 'product-sale') return data('ventas-productos').crearVentaProductos(input.items, input.cliente, input.metodoPago, input.requestId);
    if (operation === 'service') return data('servicios').crearServicio(input);
    if (operation === 'tire-adjust') return message.domain === 'general'
      ? data('inventario').ajustarStock(id, 'bodega-1', input.delta)
      : data('sistema-inventario').ajustarStockSistema(id, 'bodega-1', input.delta);
    if (operation === 'cancel') return successful(await data('sistema-ventas').cancelarVentaSistema(id, reason));
    if (operation === 'get') return data('sistema-ventas').obtenerVentaSistema(id);
    if (operation === 'catalog') return {
      tires: (await data('sistema-inventario').obtenerInventarioSistema()).filter(row => ids.includes(row.id)),
      products: (await data('productos').obtenerProductos()).filter(row => ids.includes(row.id)),
      services: (await data('servicios').obtenerServicios()).filter(row => ids.includes(row.id)),
    };
    if (operation === 'history') return (await data('sistema-ventas').obtenerVentasSistema()).filter(row => ids.includes(row.id));
    if (operation === 'fiscal-history') return (await data('sistema-ventas').obtenerVentasSistema()).filter(row => ids.includes(row.id))
      .map(({ id, folio, subtotal, iva, total, cancelada }) => ({ id, folio, subtotal, iva, total, cancelada }));
  }
  throw new Error('Unsupported integration test action.');
}
process.once('message', async message => {
  let reply;
  try { reply = { ok: true, result: await dispatch(message) }; }
  catch (error) { reply = { ok: false, error: { name: error.name, code: error.code, message: error.message, operationStatus: error.operationStatus } }; }
  // No application pool survives this one-shot worker and no credentials are sent over IPC.
  await Promise.all([global._sharedCanonicalPg?.pool.end(), global._llanteraPg?.pool.end(), global._pgPool?.end()]);
  process.send(reply, () => process.exit(0));
});
