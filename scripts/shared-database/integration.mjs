// Real two-process application integration tests against a disposable local clone.
// Usage: node scripts/shared-database/integration.mjs --connection PRIVATE_JSON --black BLACK_WORKTREE [--white-connection PRIVATE_JSON] [--instance EXPECTED_UUID]
// The clone must already exist. This program never creates, drops or connects to a source database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { fork } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const white = path.resolve(here, '../..');
const args = process.argv.slice(2);
function argument(name) { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; }
const privateFile = argument('--connection'), black = argument('--black');
if (!privateFile || !black) throw new Error('Explicit --connection private JSON and --black worktree are required.');
const connection = JSON.parse(fs.readFileSync(privateFile, 'utf8'));
const whiteConnection = argument('--white-connection') ? JSON.parse(fs.readFileSync(argument('--white-connection'), 'utf8')) : connection;
for (const config of [connection, whiteConnection]) {
  assert.equal(config.host, '127.0.0.1', 'Only the isolated loopback PostgreSQL instance is allowed.');
  assert.equal(Number(config.port), 55439, 'Refuse a database server outside the dedicated rehearsal port.');
  assert.equal(config.ssl, false, 'Only the local rehearsal connection configuration is accepted.');
}
const require = createRequire(path.join(white, 'package.json'));
const { Client } = require('pg');
const ts = require('typescript');
function historyResetPolicy() {
  const compiledModule = { exports: {} };
  const filename = path.join(white, 'lib/data/white-sales-history.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : require(name), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const database = 'llantas_shared_tests';
const expectedInstance = '2a290d83-a9e5-44e4-8fcb-8d260baeaa14';
if (argument('--instance')) assert.equal(argument('--instance'), expectedInstance, 'Only the dedicated local rehearsal UUID is allowed.');
const client = new Client({ ...connection, database, application_name: 'shared_database_integration_tests' });
const prefix = 'it-' + randomUUID().slice(0, 8), customer = 'CODEX INTEGRATION ' + prefix;
const outcomes = [];
let instance;
function databaseUrl(application) {
  const config = application === 'blanca' ? whiteConnection : connection;
  const url = new URL('postgresql://127.0.0.1:55439/' + database);
  url.username = config.user; url.password = config.password;
  return url.toString();
}
function run(application, operation, payload = {}, overrides = {}) {
  return new Promise((resolve, reject) => {
    // Do not inherit database, central-inventory, migration or application credentials.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|SYSTEMROOT|TEMP|TMP|COMSPEC|WINDIR)$/i.test(key)));
    Object.assign(env, { NODE_ENV: 'development', SHARED_DATABASE_MODE: 'true', SHARED_DATABASE_ENVIRONMENT: 'development',
      SHARED_DATABASE_ID: instance, DATABASE_URL: databaseUrl(application), SHARED_TEST_WORKTREE: application === 'blanca' ? white : path.resolve(black), ...overrides });
    const child = fork(path.join(here, 'integration-worker.mjs'), [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let settled = false;
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Isolated application worker timed out.')); }, 45000);
    child.on('message', result => { settled = true; clearTimeout(timeout); resolve(result); });
    child.on('error', error => { settled = true; clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); if (!settled) reject(new Error(`Isolated application worker exited before replying (${code}).`)); });
    // Output from imported application code must not accidentally expose data or connection strings.
    child.stdout.resume(); child.stderr.resume();
    child.send({ application, operation, ...payload });
  });
}
function expectOk(response) { assert.equal(response.ok, true, response.error?.message ?? 'Application operation failed.'); return response.result; }
async function check(name, operation) {
  if (argument('--only') && !name.includes(argument('--only'))) return;
  try { await operation(); outcomes.push({ name, status: 'passed' }); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { outcomes.push({ name, status: 'failed', reason: error.message }); process.stdout.write(`FAIL ${name}: ${error.message}\n`); }
}
let counter = 0;
async function tire(stock = 10, { supplier = 'COMERCIALIZADORA DE NEW TIRES', domain = 'sistema', origin = 'negra' } = {}) {
  const id = `${prefix}-t${++counter}`;
  const warehouses = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`bodega-${index + 1}`, index === 0 ? stock : 0]));
  await client.query(`INSERT INTO llantas(id,marca,modelo,medida,ancho,perfil,rin,"precioCompra","precioVenta","stockPorBodega",proveedor,dominio,origen_app)
    VALUES($1,'Integration','Fixture','205/55R16',205,55,16,50,116,$2::jsonb,$3,$4,$5)`, [id, JSON.stringify(warehouses), supplier, domain, origin]);
  return id;
}
async function movement(tireId) {
  const id = `${prefix}-m${++counter}`;
  await client.query(`INSERT INTO movimientos_bodega(id,"llantaId","bodegaOrigen","bodegaDestino",cantidad,fecha,dominio)
    VALUES($1,$2,'bodega-1','bodega-2',1,NOW(),'sistema')`, [id, tireId]);
  return id;
}
async function product(stock = 10) {
  const id = `${prefix}-p${++counter}`;
  await client.query(`INSERT INTO productos(id,nombre,"precioCompra","precioVenta",stock,origen_app) VALUES($1,$2,NULL,58,$3,'negra')`, [id, `${prefix} product`, stock]);
  return id;
}
async function service() {
  const id = `${prefix}-s${++counter}`;
  await client.query(`INSERT INTO servicios(id,nombre,"precioDefault","codigoBarras",origen_app) VALUES($1,$2,29,$3,'negra')`, [id, `${prefix} service`, id]);
  return id;
}
const tireItem = (id, cantidad = 1) => ({ tipo: 'producto', id, bodega: 'bodega-1', cantidad });
const whiteInput = (items, operationId = randomUUID()) => ({ operacionId: operationId, clienteNombre: customer, metodoPago: 'efectivo', sinGarantia: true, items });
const blackInput = (id, cantidad = 1, requestId = randomUUID()) => ({ requestId, clienteNombre: customer, metodoPago: 'efectivo', sinGarantia: true, items: [{ llantaId: id, bodega: 'bodega-1', cantidad }] });
const blackProductInput = (id, cantidad = 1, requestId = randomUUID()) => ({ requestId, cliente: customer, metodoPago: 'efectivo', items: [{ productoId: id, nombre: 'Must use database name', cantidad, precioUnitario: 58 }] });
async function tireStock(id) { return Number((await client.query('SELECT "stockPorBodega"->>\'bodega-1\' AS stock FROM llantas WHERE id=$1', [id])).rows[0].stock); }
async function productStock(id) { return Number((await client.query('SELECT stock FROM productos WHERE id=$1', [id])).rows[0].stock); }
async function storedSale(id) { return (await client.query('SELECT * FROM ventas WHERE id=$1', [id])).rows[0]; }
async function sharedStockVisibleToBoth(tireId, productId, expectedTires, expectedProducts, overrides) {
  const catalogs = (await Promise.all(['blanca', 'negra'].map(application => run(application, 'catalog', {
    ids: [tireId, productId].filter(Boolean),
  }, overrides)))).map(expectOk);
  for (const catalog of catalogs) {
    const stock = catalog.tires.find(row => row.id === tireId)?.stockPorBodega?.['bodega-1'];
    assert.equal(Number(stock), expectedTires, 'Both applications must read the same canonical warehouse stock.');
    if (productId) assert.equal(Number(catalog.products.find(row => row.id === productId)?.stock), expectedProducts,
      'Separating histories must not separate catalog stock.');
  }
}
async function photo(background) {
  const bytes = await require('sharp')({ create: { width: 16, height: 10, channels: 3, background } }).png().toBuffer();
  return { base64: bytes.toString('base64'), name: `${prefix}.png`, mime: 'image/png' };
}
async function storedPhoto(id) {
  const image = (await client.query('SELECT * FROM producto_imagenes WHERE id=$1', [id])).rows[0];
  assert.ok(image, 'The product image must remain stored as a real database blob.');
  assert.equal(image.mime_type, 'image/webp'); assert.equal(Number(image.tamanio_bytes), image.contenido.length);
  assert.equal(image.ancho, 16); assert.equal(image.alto, 10);
  assert.equal(image.sha256, createHash('sha256').update(image.contenido).digest('hex'));
  return image;
}
async function fingerprints() {
  const all = {};
  for (const table of ['llantas', 'productos', 'servicios', 'ventas', 'ventas_productos', 'movimientos_bodega', 'producto_imagenes']) {
    all[table] = new Map((await client.query(`SELECT id,md5(row_to_json(t)::text) AS hash FROM public.${table} t ORDER BY id`)).rows.map(row => [row.id, row.hash]));
  }
  return all;
}
async function captureWhiteHistoryReset() {
  // The same read-only MVCC boundary used for the real reset. Business dates and
  // the start time of an in-flight sale never decide whether it is historical.
  const policy = historyResetPolicy();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const identity = (await client.query(`SELECT current_database() AS database,version,environment,instance_id::text AS instance,
      txid_current_snapshot()::text AS snapshot,clock_timestamp() AS captured_at
      FROM shared_runtime.configuration WHERE singleton IS TRUE`)).rows;
    assert.equal(identity.length, 1); assert.equal(identity[0].database, database);
    assert.equal(identity[0].environment, 'development'); assert.equal(identity[0].version, 1);
    assert.equal(identity[0].instance, instance);
    const excludedIds = {};
    for (const kind of ['ventas', 'ventas_productos']) {
      excludedIds[kind] = (await client.query(`SELECT id FROM public.${kind} ORDER BY id`)).rows.map(row => row.id);
    }
    const manifest = policy.buildWhiteSalesHistoryReset({ databaseInstanceId: instance, environment: 'development',
      resetId: randomUUID(), resetAtUtc: identity[0].captured_at.toISOString(), snapshotId: identity[0].snapshot, excludedIds });
    const encoded = policy.serializeWhiteSalesHistoryReset(manifest);
    assert.deepEqual(policy.parseWhiteSalesHistoryReset(encoded, instance, 'development'), manifest);
    return { manifest, overrides: { WHITE_SALES_HISTORY_RESET: encoded } };
  } finally { await client.query('ROLLBACK'); }
}
async function durableOutcome(operationId, saleId) {
  return {
    journal: (await client.query('SELECT * FROM shared_runtime.operations WHERE id=$1', [operationId])).rows,
    sales: (await client.query('SELECT * FROM ventas WHERE request_id=$1', [operationId])).rows,
    movements: (await client.query('SELECT * FROM movimientos_bodega WHERE venta_id=$1 ORDER BY id', [saleId])).rows,
  };
}

try {
  await client.connect();
  const identity = (await client.query(`SELECT current_database() AS database,version,environment,instance_id::text AS instance
    FROM shared_runtime.configuration WHERE singleton IS TRUE`)).rows;
  assert.equal(identity.length, 1); assert.equal(identity[0].database, database); assert.equal(identity[0].version, 1);
  assert.equal(identity[0].environment, 'development'); instance = identity[0].instance;
  assert.equal(instance, expectedInstance, 'Refuse fixtures in any other database instance.');
  assert.match(instance, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  if (argument('--instance')) assert.equal(instance, argument('--instance'), 'Refuse fixtures in an unexpected local clone.');
  const original = await fingerprints();

  await check('authentic shared history preserves each application fiscal record under one sale identity', async () => {
    const originals = (await client.query(`SELECT v.id,v.subtotal,v.iva,v.total,v.cancelada,b.document_text AS black_original,w.document_text AS white_original
      FROM ventas v JOIN shared_archive.sale_originals b ON b.sale_kind='ventas' AND b.sale_id=v.id AND b.source_label='negra'
      JOIN shared_archive.sale_originals w ON w.sale_kind='ventas' AND w.sale_id=v.id AND w.source_label='blanca'
      WHERE v.imported_read_only=true AND v.origen_app='negra'`)).rows;
    assert.ok(originals.length > 0, 'The real merged historical cohort must be present.');
    const ids = originals.map(row => row.id);
    const whiteHistory = expectOk(await run('blanca', 'fiscal-history', { ids }));
    const blackHistory = expectOk(await run('negra', 'fiscal-history', { ids }));
    const whiteById = new Map(whiteHistory.sales.map(row => [row.id, row]));
    const blackById = new Map(blackHistory.map(row => [row.id, row]));
    assert.equal(whiteHistory.sales.length, originals.length); assert.equal(whiteById.size, originals.length);
    assert.equal(whiteHistory.reportRowCount, originals.length);
    let subtotalCents = 0, ivaCents = 0, totalCents = 0;
    for (const canonical of originals) {
      const authenticBlack = JSON.parse(canonical.black_original), authenticWhite = JSON.parse(canonical.white_original).sale;
      const whiteSale = whiteById.get(canonical.id);
      for (const amount of ['subtotal', 'iva', 'total']) {
        assert.equal(Number(canonical[amount]), Number(authenticBlack[amount]), 'Canonical historical money must remain equal to the black original.');
        assert.equal(whiteSale[amount], Number(authenticWhite[amount]), 'White history must show its exact archived money without recalculation.');
        if (!canonical.cancelada) assert.equal(Number(blackById.get(canonical.id)?.[amount]), Number(authenticBlack[amount]));
      }
      assert.equal(whiteSale.total, Number(canonical.total));
      if (!canonical.cancelada) {
        subtotalCents += Math.round(authenticWhite.subtotal * 100); ivaCents += Math.round(authenticWhite.iva * 100); totalCents += Math.round(authenticWhite.total * 100);
      }
    }
    const money = cents => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);
    assert.equal(whiteHistory.reportTotals[5], money(subtotalCents)); assert.equal(whiteHistory.reportTotals[6], money(ivaCents)); assert.equal(whiteHistory.reportTotals[7], money(totalCents));
  });

  await check('connection guards reject mismatched database identity before a business write', async () => {
    const id = await tire();
    for (const application of ['blanca', 'negra']) {
      const response = await run(application, 'sale', { input: application === 'blanca' ? whiteInput([tireItem(id)]) : blackInput(id) }, { SHARED_DATABASE_ID: randomUUID() });
      assert.equal(response.ok, false); assert.match(response.error.message, /instancia/);
    }
    assert.equal(await tireStock(id), 10);
  });
  await check('white tire scope and both applications share product and service catalogs', async () => {
    const newTires = await tire(), other = await tire(10, { supplier: 'Integration Other Supplier' }), p = await product(), s = await service();
    const ids = [newTires, other, p, s];
    const [w, b] = (await Promise.all([run('blanca', 'catalog', { ids }), run('negra', 'catalog', { ids })])).map(expectOk);
    assert.deepEqual(w.tires.map(row => row.id), [newTires]); assert.equal(b.tires.length, 2);
    assert.equal(w.products[0].id, p); assert.equal(b.products[0].id, p); assert.equal(w.products[0].precioCompra, undefined); assert.equal(b.products[0].precioCompra, null);
    assert.equal(w.services[0].id, s); assert.equal(b.services[0].id, s);
  });
  await check('white tire catalog, direct lookup and movements require New Tires regardless of origin', async () => {
    const primary = await tire(), ownNewTires = await tire(10, { supplier: '  comercializadora   de new tires  ', origin: 'blanca' });
    const ownOther = await tire(10, { supplier: 'Integration Other Supplier', origin: 'blanca' });
    const ownUnknown = await tire(10, { supplier: null, origin: 'blanca' });
    const blackOther = await tire(10, { supplier: 'Integration Other Supplier' });
    const allowed = [primary, ownNewTires], hidden = [ownOther, ownUnknown, blackOther], ids = [...allowed, ...hidden];
    const movementIds = new Map();
    for (const id of ids) movementIds.set(id, await movement(id));
    const [whiteCatalog, blackCatalog] = (await Promise.all([run('blanca', 'catalog', { ids }), run('negra', 'catalog', { ids })])).map(expectOk);
    assert.deepEqual(whiteCatalog.tires.map(row => row.id).sort(), allowed.sort());
    assert.deepEqual(blackCatalog.tires.map(row => row.id).sort(), ids.sort());
    for (const id of allowed) assert.equal(expectOk(await run('blanca', 'tire-get', { id })).id, id);
    for (const id of hidden) {
      assert.equal(expectOk(await run('blanca', 'tire-get', { id })), null);
      assert.equal(expectOk(await run('blanca', 'tire-get', { id, includeInactive: true })), null);
    }
    const movements = expectOk(await run('blanca', 'movements', { ids }));
    assert.deepEqual(movements.map(row => row.id).sort(), allowed.map(id => movementIds.get(id)).sort());
    for (const id of ids) assert.equal(await tireStock(id), 10, 'Reading filtered catalogs and movements must not change stock.');
  });
  await check('white cannot sell its own other or unknown supplier tires and every deduction rolls back', async () => {
    const allowed = await tire();
    for (const supplier of ['Integration Other Supplier', null]) {
      const hidden = await tire(10, { supplier, origin: 'blanca' });
      for (const items of [[tireItem(hidden)], [tireItem(allowed), tireItem(hidden)]]) {
        const input = whiteInput(items);
        const before = (await client.query('SELECT id,md5(row_to_json(t)::text) AS hash FROM llantas t WHERE id=ANY($1::varchar[]) ORDER BY id', [[allowed, hidden]])).rows;
        const rejected = await run('blanca', 'sale', { input });
        assert.equal(rejected.ok, false, 'Owning the catalog row must not bypass the supplier restriction.');
        assert.equal((await client.query('SELECT count(*)::int AS n FROM ventas WHERE request_id=$1', [input.operacionId])).rows[0].n, 0);
        assert.equal(await tireStock(allowed), 10); assert.equal(await tireStock(hidden), 10);
        const after = (await client.query('SELECT id,md5(row_to_json(t)::text) AS hash FROM llantas t WHERE id=ANY($1::varchar[]) ORDER BY id', [[allowed, hidden]])).rows;
        assert.deepEqual(after, before, 'A rejected sale must leave both tire rows byte-equivalent.');
      }
    }
  });
  await check('white product creation is immediately readable in black with unknown cost preserved', async () => {
    const created = expectOk(await run('blanca', 'product', { input: { nombre: `${prefix} created`, precio: 58, cantidad: 4 } }));
    const catalog = expectOk(await run('negra', 'catalog', { ids: [created.id] }));
    assert.equal(catalog.products.length, 1); assert.equal(catalog.products[0].stock, 4); assert.equal(catalog.products[0].precioCompra, null);
  });
  await check('white product photo and cost edits are shared without rewriting sales, stock or image blobs', async () => {
    const firstPhoto = await photo({ r: 220, g: 30, b: 30 }), secondPhoto = await photo({ r: 20, g: 60, b: 210 });
    const created = expectOk(await run('blanca', 'product', {
      input: { nombre: `${prefix} photographed product`, precioCompra: 12.5, precioVenta: 58, cantidad: 5 }, imageChange: firstPhoto,
    }));
    assert.equal(created.precioCompra, 12.5); assert.equal(created.stock, 5); assert.ok(created.imagenId);
    const originalImage = await storedPhoto(created.imagenId);
    async function readBoth({ cost, price, imageId, stock }) {
      for (const application of ['blanca', 'negra']) {
        const result = expectOk(await run(application, 'catalog', { ids: [created.id] })).products;
        assert.equal(result.length, 1); const item = result[0];
        assert.equal(item.precioCompra, cost === null && application === 'blanca' ? undefined : cost);
        assert.equal(item.precioVenta, price); assert.equal(item.stock, stock); assert.equal(item.imagenId, imageId);
        assert.equal(item.imagen, imageId ? `/api/productos/imagenes/${imageId}` : undefined);
      }
    }
    await readBoth({ cost: 12.5, price: 58, imageId: created.imagenId, stock: 5 });
    const sale = expectOk(await run('blanca', 'sale', { domain: 'general', input: whiteInput([{ tipo: 'catalogo', id: created.id, cantidad: 1 }]) }));
    const storedBefore = await storedSale(sale.id);
    assert.equal(storedBefore.items[0].costoUnitario, 12.5); assert.equal(Number(storedBefore.total), 58);
    assert.equal(Number(storedBefore.subtotal), 50); assert.equal(Number(storedBefore.iva), 8);
    const edited = expectOk(await run('blanca', 'product-update', {
      id: created.id, input: { nombre: `${prefix} edited photo product`, precioCompra: null, precioVenta: 69.6 }, imageChange: secondPhoto,
    }));
    assert.notEqual(edited.imagenId, created.imagenId); assert.ok(edited.imagenId);
    const replacementImage = await storedPhoto(edited.imagenId);
    assert.notEqual(replacementImage.sha256, originalImage.sha256);
    await readBoth({ cost: null, price: 69.6, imageId: edited.imagenId, stock: 4 });
    assert.deepEqual(await storedSale(sale.id), storedBefore, 'Catalog edits must not replace historical prices, costs or IVA.');
    assert.deepEqual(await storedPhoto(created.imagenId), originalImage, 'Replacing an image retains its original bytes.');
    const unchangedPhoto = expectOk(await run('blanca', 'product-update', { id: created.id, input: { descripcion: 'Synthetic description-only edit' } }));
    assert.equal(unchangedPhoto.imagenId, edited.imagenId); assert.equal(unchangedPhoto.precioCompra, undefined);
    const samePhotoProduct = expectOk(await run('blanca', 'product', {
      input: { nombre: `${prefix} reused photo`, precio: 69.6, cantidad: 0 }, imageChange: secondPhoto,
    }));
    assert.equal(samePhotoProduct.imagenId, edited.imagenId, 'The limited role must reuse the same stored image by hash without updating it.');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM producto_imagenes WHERE sha256=$1', [replacementImage.sha256])).rows[0].n, 1);
    const removed = expectOk(await run('blanca', 'product-update', { id: created.id, input: {}, imageChange: { eliminarImagen: true } }));
    assert.equal(removed.imagenId, null);
    await readBoth({ cost: null, price: 69.6, imageId: null, stock: 4 });
    assert.deepEqual(await storedPhoto(created.imagenId), originalImage);
    assert.deepEqual(await storedPhoto(edited.imagenId), replacementImage, 'Removing a reference must not delete an image shared by another product.');
    assert.equal((await client.query('SELECT imagen_id,imagen FROM productos WHERE id=$1', [created.id])).rows[0].imagen, null);
    assert.deepEqual(await storedSale(sale.id), storedBefore); assert.equal(await productStock(created.id), 4);
  });
  await check('invalid white photo upload leaves no product, image or partial catalog edit', async () => {
    const imageChange = { base64: Buffer.from('This is not an image').toString('base64'), name: 'invalid.png', mime: 'image/png' };
    const imagesBefore = (await client.query('SELECT count(*)::int AS n FROM producto_imagenes')).rows[0].n;
    const name = `${prefix} rejected photo`;
    const created = await run('blanca', 'product', { input: { nombre: name, precio: 58, cantidad: 3 }, imageChange });
    assert.equal(created.ok, false); assert.match(created.error.message, /imagen/i);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM productos WHERE nombre=$1', [name])).rows[0].n, 0);
    const p = await product();
    const before = (await client.query('SELECT md5(row_to_json(t)::text) AS hash FROM productos t WHERE id=$1', [p])).rows[0].hash;
    const edited = await run('blanca', 'product-update', { id: p, input: { precioVenta: 99, precioCompra: 7, cantidad: 1 }, imageChange });
    assert.equal(edited.ok, false); assert.match(edited.error.message, /imagen/i);
    assert.equal((await client.query('SELECT md5(row_to_json(t)::text) AS hash FROM productos t WHERE id=$1', [p])).rows[0].hash, before);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM producto_imagenes')).rows[0].n, imagesBefore);
  });
  await check('both applications allocate distinct service codes under concurrent catalog writes', async () => {
    const blocker = new Client({ ...connection, database, application_name: 'integration_catalog_barrier' });
    await blocker.connect();
    let pending;
    try {
      await blocker.query('BEGIN'); await blocker.query('LOCK TABLE servicios IN SHARE MODE');
      // With the broken implementation both MAX reads finish before either INSERT.
      // With shared locking the second application instead waits on the advisory lock.
      pending = Promise.all(['blanca', 'negra'].map(application => run(application, 'service', {
        input: { nombre: `${prefix} concurrent service ${application}`, descripcion: 'Synthetic concurrency fixture', precioDefault: 29 },
      })));
      const deadline = Date.now() + 15000;
      let waiting = 0;
      while (Date.now() < deadline) {
        waiting = (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=$1 AND application_name='shared_canonical_application' AND wait_event_type='Lock'`, [database])).rows[0].n;
        if (waiting >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      assert.equal(waiting, 2, 'Both real application writers must reach the controlled concurrency barrier.');
    } finally { await blocker.query('COMMIT'); await blocker.end(); }
    const created = (await pending).map(expectOk);
    assert.notEqual(created[0].codigoBarras, created[1].codigoBarras, 'Concurrent service creation duplicated a barcode.');
  });
  await check('white catalog edits and deactivation preserve records with shared visibility', async () => {
    const p = await product(), s = await service();
    const updated = expectOk(await run('blanca', 'product-update', { id: p, input: { nombre: `${prefix} updated`, descripcion: 'Synthetic edit', precio: 69.6 } }));
    assert.equal(updated.precio, 69.6); assert.equal(updated.precioCompra, undefined);
    const adjusted = expectOk(await run('blanca', 'product-adjust', { id: p, input: { delta: 2 } }));
    assert.equal(adjusted.stock, 12);
    const serviceEdit = expectOk(await run('blanca', 'service-update', { id: s, input: { nombre: `${prefix} service updated`, precioDefault: 34.8 } }));
    assert.equal(serviceEdit.precioDefault, 34.8);
    const catalog = expectOk(await run('negra', 'catalog', { ids: [p, s] }));
    assert.equal(Number(catalog.products[0].precioVenta), 69.6); assert.equal(Number(catalog.services[0].precioDefault), 34.8);
    for (const [table, id] of [['productos', p], ['servicios', s]]) {
      assert.equal(expectOk(await run('blanca', 'catalog-deactivate', { table, id })), true);
      assert.equal((await client.query(`SELECT activo FROM ${table} WHERE id=$1`, [id])).rows[0].activo, false);
    }
  });
  await check('black tire adjustments reject insufficient stock instead of silently clamping to zero', async () => {
    for (const domain of ['general', 'sistema']) {
      const id = await tire(1, { domain });
      const rejected = await run('negra', 'tire-adjust', { id, domain, input: { delta: -3 } });
      assert.equal(rejected.ok, false); assert.equal(await tireStock(id), 1);
    }
  });
  await check('simultaneous white and black tire sales cannot oversell the same warehouse', async () => {
    const id = await tire(3);
    const results = await Promise.all([run('blanca', 'sale', { input: whiteInput([tireItem(id, 2)]) }), run('negra', 'sale', { input: blackInput(id, 2) })]);
    assert.equal(results.filter(row => row.ok).length, 1); assert.equal(await tireStock(id), 1);
  });
  await check('simultaneous white and black product sales cannot oversell shared products', async () => {
    const id = await product(3);
    const results = await Promise.all([run('blanca', 'sale', { domain: 'general', input: whiteInput([{ tipo: 'catalogo', id, cantidad: 2 }]) }), run('negra', 'product-sale', { input: blackProductInput(id, 2) })]);
    assert.equal(results.filter(row => row.ok).length, 1); assert.equal(await productStock(id), 1);
  });
  await check('both applications allocate unique SI folios and warranty IDs concurrently', async () => {
    const id = await tire(20);
    const replies = await Promise.all(Array.from({ length: 8 }, (_, index) => index % 2
      ? run('blanca', 'sale', { input: { ...whiteInput([tireItem(id)]), sinGarantia: false, diasGarantia: 3 } })
      : run('negra', 'sale', { input: { ...blackInput(id), sinGarantia: false, diasGarantia: 3 } })));
    const sales = replies.map(expectOk);
    assert.equal(new Set(sales.map(sale => sale.folio)).size, 8); assert.equal(new Set(sales.map(sale => sale.garantia.id)).size, 8);
    assert.ok(sales.every(sale => sale.folio.startsWith('SI-') && sale.garantia.id)); assert.equal(await tireStock(id), 12);
  });
  for (const application of ['blanca', 'negra']) {
    await check(`${application} lost COMMIT acknowledgement and retry cannot duplicate a persisted sale`, async () => {
      const id = await tire(), input = application === 'blanca' ? whiteInput([tireItem(id)]) : blackInput(id);
      const uncertain = await run(application, 'sale', { input }, { SHARED_TEST_COMMIT_ACK_LOSS: 'true' });
      if (application === 'blanca') expectOk(uncertain); // White resolves the commit within the original request.
      const recovered = expectOk(await run(application, 'sale', { input }));
      const records = (await client.query('SELECT id FROM ventas WHERE request_id=$1', [input.operacionId ?? input.requestId])).rows;
      assert.equal(records.length, 1); assert.equal(records[0].id, recovered.id); assert.equal(await tireStock(id), 9);
      if (uncertain.ok) assert.equal(uncertain.result.id, recovered.id);
    });
    await check(`${application} repeated concurrent request commits one sale and one deduction`, async () => {
      const id = await tire(), input = application === 'blanca' ? whiteInput([tireItem(id)]) : blackInput(id);
      const sales = (await Promise.all([run(application, 'sale', { input }), run(application, 'sale', { input })])).map(expectOk);
      assert.equal(sales[0].id, sales[1].id); assert.equal(await tireStock(id), 9);
      const changed = structuredClone(input); changed.items[0].cantidad = 2;
      assert.equal((await run(application, 'sale', { input: changed })).ok, false); assert.equal(await tireStock(id), 9);
    });
    await check(`${application} rejects negative quantity without increasing stock`, async () => {
      const id = await tire();
      const result = await run(application, 'sale', { input: application === 'blanca' ? whiteInput([tireItem(id, -1)]) : blackInput(id, -1) });
      assert.equal(result.ok, false); assert.equal(await tireStock(id), 10);
    });
    await check(`${application} rolls back earlier deductions when a later line has insufficient stock`, async () => {
      const first = await tire(10), second = await tire(0);
      const input = application === 'blanca' ? whiteInput([tireItem(first), tireItem(second)]) : {
        ...blackInput(first), items: [{ llantaId: first, bodega: 'bodega-1', cantidad: 1 }, { llantaId: second, bodega: 'bodega-1', cantidad: 1 }],
      };
      assert.equal((await run(application, 'sale', { input })).ok, false); assert.equal(await tireStock(first), 10); assert.equal(await tireStock(second), 0);
      const key = input.operacionId ?? input.requestId;
      const result = await client.query('SELECT id FROM ventas WHERE request_id=$1', [key]); assert.equal(result.rows.length, 0);
    });
  }
  await check('one request ID cannot be reused across white and black application writers', async () => {
    const id = await tire(), key = randomUUID();
    const replies = await Promise.all([run('blanca', 'sale', { input: whiteInput([tireItem(id)], key) }), run('negra', 'sale', { input: blackInput(id, 1, key) })]);
    assert.equal(replies.filter(row => row.ok).length, 1); assert.equal(await tireStock(id), 9);
  });
  await check('released white request cannot later produce a black sale', async () => {
    const id = await tire(0), key = randomUUID();
    const rejected = await run('blanca', 'sale', { input: whiteInput([tireItem(id)], key) }); assert.equal(rejected.ok, false); assert.equal(rejected.error.operationStatus, 'released');
    await client.query('UPDATE llantas SET "stockPorBodega"=jsonb_set("stockPorBodega",\'{bodega-1}\',\'5\'::jsonb) WHERE id=$1', [id]);
    assert.equal((await run('negra', 'sale', { input: blackInput(id, 1, key) })).ok, false); assert.equal(await tireStock(id), 5);
  });
  await check('mixed white sale stores authentic VAT, unknown costs and complete lines with supplier scope', async () => {
    const t = await tire(), p = await product(), s = await service();
    const sale = expectOk(await run('blanca', 'sale', { domain: 'general', input: whiteInput([
      tireItem(t), { tipo: 'catalogo', id: p, cantidad: 1 }, { tipo: 'servicio', id: s, cantidad: 1 }, { tipo: 'extra', id: 'extra', nombre: 'Integration extra', cantidad: 1, precioCustom: 11.6 },
    ]) }));
    const stored = await storedSale(sale.id);
    assert.equal(Number(stored.total), 214.6); assert.equal(Number(stored.subtotal), 185); assert.equal(Number(stored.iva), 29.6); assert.equal(stored.iva_politica, 'incluido_16');
    assert.equal(stored.items.length, 4); assert.equal(stored.items[0].costoUnitario, 50); assert.equal(stored.items[1].costoUnitario, null); assert.equal(stored.items[2].costoUnitario, null);
    const read = expectOk(await run('blanca', 'get', { id: sale.id })); assert.equal(read.items[0].proveedorSnapshot, 'COMERCIALIZADORA DE NEW TIRES'); assert.equal(read.items.length, 4);
    const history = expectOk(await run('blanca', 'history', { ids: [sale.id] })); assert.equal(history.length, 1);
    // Both applications compete to cancel the same complete document.
    await Promise.all([run('blanca', 'cancel', { id: sale.id, reason: 'Integration cancellation' }), run('negra', 'cancel', { id: sale.id, reason: 'Integration cancellation' })]);
    assert.equal(await tireStock(t), 10); assert.equal(await productStock(p), 10); assert.equal((await storedSale(sale.id)).cancelada, true);
  });
  await check('black mixed-provider history remains whole in white and cancels all real stock once', async () => {
    const t = await tire(10, { domain: 'general' }), other = await tire(10, { domain: 'general', supplier: 'Integration Other Supplier', origin: 'blanca' }), s = await service();
    const sale = expectOk(await run('negra', 'mixed-sale', { input: { requestId: randomUUID(), clienteNombre: customer, metodoPago: 'efectivo', items: [tireItem(t), tireItem(other), { tipo: 'servicio', id: s, cantidad: 1 }] } }));
    const detail = expectOk(await run('blanca', 'get', { id: sale.id })); assert.equal(detail.items.length, 3); assert.equal(Object.hasOwn(detail, 'importeNewTires'), false); assert.equal(detail.total, 261); assert.equal(detail.iva, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM shared_runtime.sale_item_scope WHERE sale_kind=\'ventas\' AND sale_id=$1 AND provider_key=\'COMERCIALIZADORA DE NEW TIRES\'', [sale.id])).rows[0].n, 1);
    expectOk(await run('blanca', 'cancel', { id: sale.id, reason: 'Integration mixed cancellation' }));
    assert.equal(await tireStock(t), 10); assert.equal(await tireStock(other), 10);
  });
  await check('white cannot read or cancel another supplier-only black tire sale', async () => {
    const t = await tire(10, { supplier: 'Integration Other Supplier' });
    const sale = expectOk(await run('negra', 'sale', { input: blackInput(t) }));
    assert.equal(expectOk(await run('blanca', 'get', { id: sale.id })), null);
    assert.equal(expectOk(await run('blanca', 'cancel', { id: sale.id, reason: 'Must not cancel' })), null);
    assert.equal(await tireStock(t), 9); assert.equal((await storedSale(sale.id)).cancelada, false);
  });
  await check('white-origin sales with only other or unknown supplier tires stay hidden and unchanged', async () => {
    for (const supplier of ['Integration Other Supplier', null]) {
      const t = await tire(10, { supplier, origin: 'blanca' });
      const sale = expectOk(await run('negra', 'sale', { input: blackInput(t) }));
      // Model a previously recorded white document; only this synthetic QA row
      // changes origin. The sale lines and captured supplier evidence stay real.
      await client.query("UPDATE ventas SET origen_app='blanca' WHERE id=$1", [sale.id]);
      const before = await storedSale(sale.id);
      assert.equal(expectOk(await run('blanca', 'get', { id: sale.id })), null);
      assert.equal(expectOk(await run('blanca', 'get', { id: sale.folio, by: 'folio' })), null);
      assert.deepEqual(expectOk(await run('blanca', 'history', { ids: [sale.id] })), []);
      assert.equal(expectOk(await run('blanca', 'cancel', { id: sale.id, reason: 'Must not cancel hidden white-origin sale' })), null);
      assert.deepEqual(await storedSale(sale.id), before); assert.equal(await tireStock(t), 9);
    }
  });
  await check('black service and product-only documents remain visible in white with recorded IVA intact', async () => {
    const s = await service(), p = await product();
    const inputs = [[{ tipo: 'servicio', id: s, cantidad: 1 }], [{ tipo: 'catalogo', id: p, cantidad: 1 }]];
    const sales = [];
    for (const items of inputs) sales.push(expectOk(await run('negra', 'mixed-sale', {
      input: { requestId: randomUUID(), clienteNombre: customer, metodoPago: 'efectivo', items },
    })));
    const productSale = expectOk(await run('negra', 'product-sale', { input: blackProductInput(p) }));
    const ids = [...sales.map(sale => sale.id), productSale.id];
    const history = expectOk(await run('blanca', 'history', { ids }));
    assert.deepEqual(history.map(sale => sale.id).sort(), ids.sort());
    for (const sale of sales) {
      const detail = expectOk(await run('blanca', 'get', { id: sale.id }));
      assert.equal(detail.items.length, 1); assert.equal(Object.hasOwn(detail, 'importeNewTires'), false);
      for (const field of ['subtotal', 'iva', 'total']) assert.equal(detail[field], Number(sale[field]));
      assert.equal(detail.iva, 0, 'White must not recalculate the black application fiscal policy.');
    }
    const detail = expectOk(await run('blanca', 'get', { id: productSale.id }));
    assert.equal(detail.storageKind, 'ventas_productos'); assert.equal(detail.total, Number(productSale.total));
    assert.equal(await productStock(p), 8);
  });
  await check('both applications preserve imported and invoiced documents against cancellation', async () => {
    for (const protectedColumn of ['facturada', 'imported_read_only']) {
      const t = await tire(); const sale = expectOk(await run('blanca', 'sale', { input: whiteInput([tireItem(t)]) }));
      await client.query(`UPDATE ventas SET ${protectedColumn}=true WHERE id=$1`, [sale.id]);
      for (const application of ['blanca', 'negra']) assert.equal((await run(application, 'cancel', { id: sale.id, reason: 'Must not cancel protected sale' })).ok, false);
      assert.equal(await tireStock(t), 9); assert.equal((await storedSale(sale.id)).cancelada, false);
    }
  });
  await check('white invoice metadata records once without altering charged money or stock', async () => {
    const t = await tire(); const sale = expectOk(await run('blanca', 'sale', { input: whiteInput([tireItem(t)]) }));
    const input = { uuid: randomUUID(), folio: `${prefix}-invoice`, fechaTimbrado: new Date().toISOString() };
    const invoiced = expectOk(await run('blanca', 'invoice', { id: sale.id, input }));
    assert.equal(invoiced.facturada, true); assert.equal(invoiced.factura.uuid, input.uuid);
    const stored = await storedSale(sale.id);
    for (const field of ['subtotal', 'iva', 'total']) assert.equal(Number(stored[field]), sale[field]);
    assert.equal(await tireStock(t), 9);
    assert.equal((await run('blanca', 'invoice', { id: sale.id, input })).ok, false);
  });
  await check('white history reset hides its entire baseline while black keeps authentic previous records', async () => {
    const t = await tire(10), p = await product();
    const oldWhite = expectOk(await run('blanca', 'sale', { input: { ...whiteInput([tireItem(t)]), sinGarantia: false, diasGarantia: 3 } }));
    const oldBlack = expectOk(await run('negra', 'sale', { input: blackInput(t) }));
    const legacyProduct = expectOk(await run('negra', 'product-sale', { input: blackProductInput(p) }));
    // Only synthetic rows are changed to exercise misleading business dates and
    // the legacy white product-sales module captured by the two-table baseline.
    await client.query('UPDATE ventas SET "fechaVenta"=$2 WHERE id=$1', [oldWhite.id, '2099-01-01T00:00:00.000Z']);
    await client.query("UPDATE ventas_productos SET origen_app='blanca' WHERE id=$1", [legacyProduct.id]);
    const before = await fingerprints();
    const { manifest, overrides } = await captureWhiteHistoryReset();
    const baselineIds = [...manifest.excludedIds.ventas, ...manifest.excludedIds.ventas_productos];
    assert.deepEqual(expectOk(await run('blanca', 'history', { ids: baselineIds }, overrides)), []);
    for (const [value, by] of [[oldWhite.id, 'id'], [oldWhite.folio, 'folio'], [oldWhite.garantia.id, 'garantia'], [legacyProduct.id, 'id']]) {
      assert.equal(expectOk(await run('blanca', 'get', { id: value, by }, overrides)), null);
    }
    assert.equal(expectOk(await run('blanca', 'cancel', { id: oldWhite.id, reason: 'Must preserve hidden original' }, overrides)), null);
    assert.equal(expectOk(await run('blanca', 'invoice', { id: oldWhite.id, input: {} }, overrides)), null);
    const blackHistory = expectOk(await run('negra', 'history', { ids: [oldWhite.id, oldBlack.id] }, overrides));
    assert.deepEqual(blackHistory.map(sale => sale.id).sort(), [oldWhite.id, oldBlack.id].sort());
    assert.equal(expectOk(await run('negra', 'get', { id: oldWhite.id }, overrides)).id, oldWhite.id);
    assert.equal(expectOk(await run('negra', 'get', { id: oldBlack.id }, overrides)).id, oldBlack.id);
    assert.deepEqual(await fingerprints(), before, 'Capturing and applying the reset must not modify any historical sale, catalog row, movement or stock.');
    assert.equal(expectOk(await run('blanca', 'get', { id: oldWhite.id })).id, oldWhite.id,
      'Removing only the runtime policy must restore the old view without a database restore.');
  });
  await check('white history reset excludes all later black modules and keeps a new backdated white mixed sale with authentic IVA', async () => {
    const t = await tire(10), p = await product(), s = await service();
    const { overrides } = await captureWhiteHistoryReset();
    const blackTire = expectOk(await run('negra', 'sale', { input: blackInput(t) }));
    const blackService = expectOk(await run('negra', 'mixed-sale', {
      input: { requestId: randomUUID(), clienteNombre: customer, metodoPago: 'efectivo', items: [{ tipo: 'servicio', id: s, cantidad: 1 }] },
    }));
    const blackProduct = expectOk(await run('negra', 'product-sale', { input: blackProductInput(p) }));
    const sale = expectOk(await run('blanca', 'sale', { input: whiteInput([
      tireItem(t), { tipo: 'catalogo', id: p, cantidad: 1 }, { tipo: 'servicio', id: s, cantidad: 1 },
    ]) }, overrides));
    assert.equal(sale.fueraDelHistorialActual, undefined); assert.equal(sale.total, 203);
    assert.equal(sale.subtotal, 175); assert.equal(sale.iva, 28);
    await client.query('UPDATE ventas SET "fechaVenta"=$2 WHERE id=$1', [sale.id, '2000-01-01T00:00:00.000Z']);
    const before = await fingerprints();
    const ids = [blackTire.id, blackService.id, blackProduct.id, sale.id];
    assert.deepEqual(expectOk(await run('blanca', 'history', { ids }, overrides)).map(row => row.id), [sale.id]);
    for (const id of [blackTire.id, blackService.id, blackProduct.id]) {
      assert.equal(expectOk(await run('blanca', 'get', { id }, overrides)), null);
    }
    assert.equal(expectOk(await run('negra', 'get', { id: blackTire.id })).id, blackTire.id);
    assert.equal(expectOk(await run('negra', 'get', { id: blackService.id })).id, blackService.id);
    const detail = expectOk(await run('blanca', 'get', { id: sale.id }, overrides));
    assert.equal(detail.items.length, 3); assert.equal(detail.total, 203); assert.equal(detail.iva, 28);
    assert.equal(new Date(detail.fechaVenta).toISOString(), '2000-01-01T00:00:00.000Z');
    assert.deepEqual(await fingerprints(), before);
    assert.equal(await tireStock(t), 8); assert.equal(await productStock(p), 8);
  });
  await check('white history reset acknowledges a hidden old retry with one stock deduction and one durable outcome', async () => {
    const t = await tire(10), input = whiteInput([tireItem(t)]);
    const sale = expectOk(await run('blanca', 'sale', { input }));
    const { overrides } = await captureWhiteHistoryReset();
    const beforeRows = await fingerprints(), beforeOutcome = await durableOutcome(input.operacionId, sale.id);
    assert.equal(beforeOutcome.sales.length, 1); assert.equal(beforeOutcome.movements.length, 1);
    assert.equal(beforeOutcome.journal[0].status, 'committed');
    const responses = await Promise.all([run('blanca', 'sale', { input }, overrides), run('blanca', 'sale', { input }, overrides)]);
    for (const response of responses) {
      const recovered = expectOk(response);
      assert.equal(recovered.id, sale.id); assert.equal(recovered.folio, sale.folio);
      assert.equal(recovered.storageKind, 'ventas'); assert.equal(recovered.fueraDelHistorialActual, true);
    }
    const changed = structuredClone(input); changed.items[0].cantidad = 2;
    assert.equal((await run('blanca', 'sale', { input: changed }, overrides)).ok, false);
    assert.equal(expectOk(await run('blanca', 'get', { id: sale.id }, overrides)), null);
    assert.equal(await tireStock(t), 9);
    assert.deepEqual(await durableOutcome(input.operacionId, sale.id), beforeOutcome);
    assert.deepEqual(await fingerprints(), beforeRows);
    assert.equal(Object.hasOwn((await storedSale(sale.id)), 'fueraDelHistorialActual'), false);
  });
  await check('white history reset recovers an old request without a journal and a new lost COMMIT acknowledgement', async () => {
    const t = await tire(10), oldInput = whiteInput([tireItem(t)]);
    const old = expectOk(await run('blanca', 'sale', { input: oldInput }));
    const { overrides } = await captureWhiteHistoryReset();
    // Remove only this synthetic QA request's journal to exercise reconciliation
    // of a durable sale from before the current journal implementation.
    await client.query('DELETE FROM shared_runtime.operations WHERE id=$1 AND sale_id=$2', [oldInput.operacionId, old.id]);
    const replay = expectOk(await run('blanca', 'sale', { input: oldInput }, overrides));
    assert.equal(replay.id, old.id); assert.equal(replay.fueraDelHistorialActual, true);
    const oldOutcome = await durableOutcome(oldInput.operacionId, old.id);
    assert.equal(oldOutcome.sales.length, 1); assert.equal(oldOutcome.movements.length, 1);
    assert.equal(oldOutcome.journal.length, 1); assert.equal(oldOutcome.journal[0].status, 'committed');
    const input = whiteInput([tireItem(t)]);
    const resolved = expectOk(await run('blanca', 'sale', { input }, { ...overrides, SHARED_TEST_COMMIT_ACK_LOSS: 'true' }));
    const recovered = expectOk(await run('blanca', 'sale', { input }, overrides));
    assert.equal(recovered.id, resolved.id); assert.equal(recovered.fueraDelHistorialActual, undefined);
    assert.equal(expectOk(await run('blanca', 'get', { id: recovered.id }, overrides)).id, recovered.id);
    const outcome = await durableOutcome(input.operacionId, recovered.id);
    assert.equal(outcome.sales.length, 1); assert.equal(outcome.movements.length, 1);
    assert.equal(outcome.journal.length, 1); assert.equal(outcome.journal[0].status, 'committed');
    assert.equal(await tireStock(t), 8);
  });
  await check('white history reset retains an in-flight sale committed after its MVCC snapshot despite an earlier transaction date', async () => {
    const t = await tire(10), input = whiteInput([tireItem(t)]);
    const blocker = new Client({ ...connection, database, application_name: 'integration_history_reset_barrier' });
    await blocker.connect();
    let pending, captured;
    try {
      await blocker.query('BEGIN'); await blocker.query('LOCK TABLE ventas IN SHARE MODE');
      pending = run('blanca', 'sale', { input });
      const deadline = Date.now() + 15000;
      let waiting = 0;
      while (Date.now() < deadline) {
        waiting = (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=$1 AND application_name='shared_canonical_application' AND wait_event_type='Lock'`, [database])).rows[0].n;
        if (waiting >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      assert.equal(waiting, 1, 'The real white writer must reach the controlled pre-COMMIT barrier.');
      captured = await captureWhiteHistoryReset();
    } finally { await blocker.query('COMMIT'); await blocker.end(); }
    const sale = expectOk(await pending);
    assert.equal(captured.manifest.excludedIds.ventas.includes(sale.id), false);
    assert.ok(Date.parse(sale.fechaVenta) <= Date.parse(captured.manifest.resetAtUtc), 'The sale transaction must have begun before the snapshot.');
    assert.equal(expectOk(await run('blanca', 'get', { id: sale.id }, captured.overrides)).id, sale.id);
    assert.deepEqual(expectOk(await run('blanca', 'history', { ids: [sale.id] }, captured.overrides)).map(row => row.id), [sale.id]);
    assert.equal(await tireStock(t), 9);
  });
  await check('separate histories retain five previous white-origin documents in black without rewriting a record', async () => {
    const t = await tire(20), p = await product(20), s = await service();
    const warranty = { sinGarantia: false, diasGarantia: 30 };
    const systemSale = expectOk(await run('blanca', 'sale', { input: { ...whiteInput([tireItem(t)]), ...warranty } }));
    const generalSale = expectOk(await run('blanca', 'sale', { domain: 'general', input: { ...whiteInput([
      tireItem(t), { tipo: 'catalogo', id: p, cantidad: 1 }, { tipo: 'servicio', id: s, cantidad: 1 },
    ]), ...warranty } }));
    const serviceSale = expectOk(await run('blanca', 'sale', { domain: 'general', input: whiteInput([{ tipo: 'servicio', id: s, cantidad: 1 }]) }));
    const productSale = expectOk(await run('blanca', 'sale', { domain: 'general', input: whiteInput([{ tipo: 'catalogo', id: p, cantidad: 1 }]) }));
    const legacyProduct = expectOk(await run('negra', 'product-sale', { input: blackProductInput(p) }));
    // Model a historical white document from the old product-sale module using
    // this synthetic fixture only; no imported business row is ever rewritten.
    await client.query("UPDATE ventas_productos SET origen_app='blanca' WHERE id=$1", [legacyProduct.id]);
    const oldSales = [systemSale, generalSale, serviceSale, productSale], ids = [...oldSales.map(row => row.id), legacyProduct.id];
    const before = await fingerprints(), { overrides } = await captureWhiteHistoryReset();
    const blackHistory = expectOk(await run('negra', 'all-public-history', { ids }, overrides));
    assert.deepEqual(blackHistory.system.map(row => row.id).sort(), oldSales.map(row => row.id).sort());
    assert.deepEqual(blackHistory.general.map(row => row.id).sort(), [generalSale.id, serviceSale.id, productSale.id].sort());
    assert.deepEqual(blackHistory.products.map(row => row.id), [legacyProduct.id]);
    assert.deepEqual(blackHistory.summary.map(row => row.id).sort(), oldSales.map(row => row.id).sort());
    assert.deepEqual(blackHistory.finance.map(row => row.sourceId).sort(), ids.sort());
    assert.deepEqual(blackHistory.systemWarranties.map(row => row.venta.id).sort(), [systemSale.id, generalSale.id].sort());
    assert.deepEqual(blackHistory.generalWarranties.map(row => row.id), [generalSale.id]);
    for (const sale of oldSales) {
      assert.equal(expectOk(await run('negra', 'get', { id: sale.id }, overrides)).id, sale.id);
      assert.equal(expectOk(await run('negra', 'get', { id: sale.folio, by: 'folio' }, overrides)).id, sale.id);
      assert.equal(expectOk(await run('blanca', 'get', { id: sale.id }, overrides)), null);
    }
    for (const sale of [systemSale, generalSale]) {
      assert.equal(expectOk(await run('negra', 'get', { id: sale.garantia.id, by: 'garantia' }, overrides)).id, sale.id);
    }
    assert.equal(expectOk(await run('negra', 'get-product', { id: legacyProduct.id }, overrides)).id, legacyProduct.id);
    assert.deepEqual(expectOk(await run('blanca', 'history', { ids }, overrides)), []);
    await sharedStockVisibleToBoth(t, p, 18, 17, overrides);
    assert.deepEqual(await fingerprints(), before, 'Applying either presentation policy must leave all canonical records byte-equivalent.');
  });
  await check('separate histories hide new white mixed and legacy-module sales from every black UI while preserving the financial feed', async () => {
    const t = await tire(20), p = await product(20), s = await service(), { overrides } = await captureWhiteHistoryReset();
    const whiteSales = [];
    for (const domain of ['general', 'sistema']) {
      whiteSales.push(expectOk(await run('blanca', 'sale', { domain, input: { ...whiteInput([
        tireItem(t), { tipo: 'catalogo', id: p, cantidad: 1 }, { tipo: 'servicio', id: s, cantidad: 1 },
      ]), sinGarantia: false, diasGarantia: 30 } }, overrides)));
    }
    const newLegacyWhite = expectOk(await run('negra', 'product-sale', { input: blackProductInput(p) }, overrides));
    await client.query("UPDATE ventas_productos SET origen_app='blanca' WHERE id=$1", [newLegacyWhite.id]);
    const blackSystem = expectOk(await run('negra', 'sale', { input: blackInput(t) }, overrides));
    const blackGeneral = expectOk(await run('negra', 'mixed-sale', { input: {
      requestId: randomUUID(), clienteNombre: customer, metodoPago: 'efectivo',
      items: [{ tipo: 'catalogo', id: p, cantidad: 1 }, { tipo: 'servicio', id: s, cantidad: 1 }],
    } }, overrides));
    const blackProduct = expectOk(await run('negra', 'product-sale', { input: blackProductInput(p) }, overrides));
    const whiteIds = [...whiteSales.map(row => row.id), newLegacyWhite.id], blackIds = [blackSystem.id, blackGeneral.id, blackProduct.id];
    const before = await fingerprints();
    const black = expectOk(await run('negra', 'all-public-history', { ids: [...whiteIds, ...blackIds] }, overrides));
    assert.deepEqual(black.system.map(row => row.id).sort(), [blackSystem.id, blackGeneral.id].sort());
    assert.deepEqual(black.general.map(row => row.id), [blackGeneral.id]);
    assert.deepEqual(black.products.map(row => row.id), [blackProduct.id]);
    assert.deepEqual(black.summary.map(row => row.id).sort(), [blackSystem.id, blackGeneral.id].sort());
    assert.deepEqual(black.systemWarranties.map(row => row.venta.id), [blackGeneral.id]);
    assert.deepEqual(black.generalWarranties.map(row => row.id), [blackGeneral.id]);
    assert.deepEqual(black.finance.map(row => row.sourceId).sort(), [...whiteIds, ...blackIds].sort(),
      'The existing integration contract stays canonical; no external financial system is changed or contacted.');
    for (const sale of whiteSales) {
      for (const [value, by] of [[sale.id, 'id'], [sale.folio, 'folio'], [sale.garantia.id, 'garantia']]) {
        assert.equal(expectOk(await run('negra', 'get', { id: value, by }, overrides)), null);
      }
      assert.equal(expectOk(await run('negra', 'get-general', { id: sale.id }, overrides)), null);
      const own = expectOk(await run('blanca', 'get', { id: sale.id }, overrides));
      assert.equal(own.items.length, 3); assert.equal(own.total, 203); assert.equal(own.subtotal, 175); assert.equal(own.iva, 28);
    }
    assert.equal(expectOk(await run('negra', 'get-product', { id: newLegacyWhite.id }, overrides)), null);
    const whiteHistory = expectOk(await run('blanca', 'history', { ids: [...whiteIds, ...blackIds] }, overrides));
    assert.deepEqual(whiteHistory.map(row => row.id).sort(), whiteIds.sort());
    for (const id of blackIds) assert.equal(expectOk(await run('blanca', 'get', { id }, overrides)), null);
    await sharedStockVisibleToBoth(t, p, 17, 15, overrides);
    assert.deepEqual(await fingerprints(), before, 'History reads, reports and local feed projections may not change a canonical row.');
  });
  await check('separate histories reject black mutations of a new white sale and white cancellation restores shared stock exactly once', async () => {
    const t = await tire(10), p = await product(), s = await service(), { overrides } = await captureWhiteHistoryReset();
    const sale = expectOk(await run('blanca', 'sale', { domain: 'general', input: whiteInput([
      tireItem(t, 2), { tipo: 'catalogo', id: p, cantidad: 2 }, { tipo: 'servicio', id: s, cantidad: 1 },
    ]) }, overrides));
    await sharedStockVisibleToBoth(t, p, 8, 8, overrides);
    const before = await fingerprints();
    assert.equal((await run('negra', 'cancel', { id: sale.id, reason: 'Must not cancel a hidden white sale' }, overrides)).ok, false);
    assert.equal(expectOk(await run('negra', 'cancel-general', { id: sale.id, reason: 'Must not cancel a hidden white sale' }, overrides)), null);
    assert.equal(expectOk(await run('negra', 'invoice-general', { id: sale.id, input: {
      uuid: randomUUID(), serie: 'QA', folio: prefix, fechaTimbrado: new Date().toISOString(),
    } }, overrides)), null);
    assert.deepEqual(await fingerprints(), before, 'Rejected black mutations must leave the hidden sale and both inventories unchanged.');
    const cancellations = await Promise.all([run('blanca', 'cancel', { id: sale.id, reason: 'Isolated integration cancellation' }, overrides),
      run('blanca', 'cancel', { id: sale.id, reason: 'Isolated integration cancellation' }, overrides)]);
    assert.ok(cancellations.some(reply => reply.ok && reply.result?.cancelada));
    assert.equal((await storedSale(sale.id)).cancelada, true);
    await sharedStockVisibleToBoth(t, p, 10, 10, overrides);
    assert.equal(expectOk(await run('negra', 'get', { id: sale.id }, overrides)), null);
    const movements = (await client.query('SELECT tipo,count(*)::int AS n FROM movimientos_bodega WHERE venta_id=$1 GROUP BY tipo ORDER BY tipo', [sale.id])).rows;
    assert.deepEqual(movements, [{ tipo: 'cancelacion', n: 1 }, { tipo: 'venta', n: 1 }]);
  });
  await check('separate histories keep one shared stock under competing white and black tire and product sales', async () => {
    const t = await tire(3), p = await product(3), { overrides } = await captureWhiteHistoryReset();
    const results = await Promise.all([
      run('blanca', 'sale', { input: whiteInput([tireItem(t, 2)]) }, overrides), run('negra', 'sale', { input: blackInput(t, 2) }, overrides),
      run('blanca', 'sale', { domain: 'general', input: whiteInput([{ tipo: 'catalogo', id: p, cantidad: 2 }]) }, overrides),
      run('negra', 'product-sale', { input: blackProductInput(p, 2) }, overrides),
    ]);
    assert.equal(results.slice(0, 2).filter(reply => reply.ok).length, 1);
    assert.equal(results.slice(2).filter(reply => reply.ok).length, 1);
    await sharedStockVisibleToBoth(t, p, 1, 1, overrides);
    for (const [index, response] of results.entries()) if (response.ok) {
      const sale = response.result, own = index % 2 === 0 ? 'blanca' : 'negra', other = own === 'blanca' ? 'negra' : 'blanca';
      const ownOperation = index === 3 ? 'get-product' : 'get';
      assert.equal(expectOk(await run(own, ownOperation, { id: sale.id }, overrides)).id, sale.id);
      assert.equal(expectOk(await run(other, 'get', { id: sale.id }, overrides)), null);
    }
  });
  await check('separate histories preserve each application request retry and lost COMMIT recovery without a second deduction', async () => {
    const t = await tire(20), p = await product(20), { overrides } = await captureWhiteHistoryReset();
    const cases = [
      { application: 'blanca', operation: 'sale', input: whiteInput([tireItem(t)]) },
      { application: 'negra', operation: 'sale', input: blackInput(t) },
      { application: 'negra', operation: 'mixed-sale', input: { requestId: randomUUID(), clienteNombre: customer, metodoPago: 'efectivo',
        items: [{ tipo: 'catalogo', id: p, cantidad: 1 }] } },
      { application: 'negra', operation: 'product-sale', input: blackProductInput(p) },
    ];
    for (const testCase of cases) {
      const { application, operation, input } = testCase;
      const uncertain = await run(application, operation, { input }, { ...overrides, SHARED_TEST_COMMIT_ACK_LOSS: 'true' });
      const retries = (await Promise.all([run(application, operation, { input }, overrides), run(application, operation, { input }, overrides)])).map(expectOk);
      assert.equal(retries[0].id, retries[1].id);
      if (uncertain.ok) assert.equal(retries[0].id, uncertain.result.id);
      const kind = operation === 'product-sale' ? 'ventas_productos' : 'ventas', request = input.operacionId ?? input.requestId;
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${kind} WHERE request_id=$1`, [request])).rows[0].n, 1);
      const foreign = application === 'blanca' ? 'negra' : 'blanca';
      assert.equal(expectOk(await run(foreign, 'get', { id: retries[0].id }, overrides)), null);
    }
    await sharedStockVisibleToBoth(t, p, 18, 18, overrides);
  });
  await check('separate histories fail closed for an invalid black policy without changing stock or the canonical integration feed', async () => {
    const t = await tire(10), p = await product(), { overrides } = await captureWhiteHistoryReset();
    const sale = expectOk(await run('blanca', 'sale', { input: whiteInput([tireItem(t)]) }, overrides));
    const malformed = { WHITE_SALES_HISTORY_RESET: 'invalid-manifest' }, before = await fingerprints();
    for (const operation of ['history', 'get']) assert.equal((await run('negra', operation, { id: sale.id, ids: [sale.id] }, malformed)).ok, false);
    const attempts = [
      ['sale', blackInput(t)], ['mixed-sale', { requestId: randomUUID(), clienteNombre: customer, metodoPago: 'efectivo', items: [{ tipo: 'catalogo', id: p, cantidad: 1 }] }],
      ['product-sale', blackProductInput(p)],
    ];
    for (const [operation, input] of attempts) assert.equal((await run('negra', operation, { input }, malformed)).ok, false);
    const canonical = expectOk(await run('negra', 'finance-history', { ids: [sale.id] }, malformed));
    assert.deepEqual(canonical.map(row => row.sourceId), [sale.id]);
    assert.deepEqual(await fingerprints(), before, 'An invalid presentation configuration cannot perform a business write.');
  });
  await check('all pre-existing catalog, sales and stock-movement rows remain byte-equivalent', async () => {
    const after = await fingerprints();
    for (const [table, hashes] of Object.entries(original)) for (const [id, hash] of hashes) assert.equal(after[table].get(id), hash, `A pre-existing ${table} record changed.`);
  });
} finally { await client.end(); }
const failed = outcomes.filter(outcome => outcome.status === 'failed').length;
process.stdout.write(JSON.stringify({ database, fixtures: prefix, total: outcomes.length, passed: outcomes.length - failed, failed }) + '\n');
process.exitCode = failed ? 1 : 0;
