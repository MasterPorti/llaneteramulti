// Real two-process application integration tests against a disposable local clone.
// Usage: node scripts/shared-database/integration.mjs --connection PRIVATE_JSON --black BLACK_WORKTREE [--white-connection PRIVATE_JSON]
// The clone must already exist. This program never creates, drops or connects to a source database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
const database = 'llantas_shared_tests';
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
async function tire(stock = 10, { supplier = 'COMERCIALIZADORA DE NEW TIRES', domain = 'sistema' } = {}) {
  const id = `${prefix}-t${++counter}`;
  const warehouses = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`bodega-${index + 1}`, index === 0 ? stock : 0]));
  await client.query(`INSERT INTO llantas(id,marca,modelo,medida,ancho,perfil,rin,"precioCompra","precioVenta","stockPorBodega",proveedor,dominio,origen_app)
    VALUES($1,'Integration','Fixture','205/55R16',205,55,16,50,116,$2::jsonb,$3,$4,'negra')`, [id, JSON.stringify(warehouses), supplier, domain]);
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
async function fingerprints() {
  const all = {};
  for (const table of ['llantas', 'productos', 'servicios', 'ventas', 'ventas_productos', 'movimientos_bodega']) {
    all[table] = new Map((await client.query(`SELECT id,md5(row_to_json(t)::text) AS hash FROM public.${table} t ORDER BY id`)).rows.map(row => [row.id, row.hash]));
  }
  return all;
}

try {
  await client.connect();
  const identity = (await client.query(`SELECT current_database() AS database,version,environment,instance_id::text AS instance
    FROM shared_runtime.configuration WHERE singleton IS TRUE`)).rows;
  assert.equal(identity.length, 1); assert.equal(identity[0].database, database); assert.equal(identity[0].version, 1);
  assert.equal(identity[0].environment, 'development'); instance = identity[0].instance;
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
  await check('white product creation is immediately readable in black with unknown cost preserved', async () => {
    const created = expectOk(await run('blanca', 'product', { input: { nombre: `${prefix} created`, precio: 58, cantidad: 4 } }));
    const catalog = expectOk(await run('negra', 'catalog', { ids: [created.id] }));
    assert.equal(catalog.products.length, 1); assert.equal(catalog.products[0].stock, 4); assert.equal(catalog.products[0].precioCompra, null);
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
    const read = expectOk(await run('blanca', 'get', { id: sale.id })); assert.equal(read.importeNewTires, 116); assert.equal(read.items.length, 4);
    const history = expectOk(await run('blanca', 'history', { ids: [sale.id] })); assert.equal(history.length, 1);
    // Both applications compete to cancel the same complete document.
    await Promise.all([run('blanca', 'cancel', { id: sale.id, reason: 'Integration cancellation' }), run('negra', 'cancel', { id: sale.id, reason: 'Integration cancellation' })]);
    assert.equal(await tireStock(t), 10); assert.equal(await productStock(p), 10); assert.equal((await storedSale(sale.id)).cancelada, true);
  });
  await check('black mixed-provider history remains whole in white and cancels all real stock once', async () => {
    const t = await tire(10, { domain: 'general' }), other = await tire(10, { domain: 'general', supplier: 'Integration Other Supplier' }), s = await service();
    const sale = expectOk(await run('negra', 'mixed-sale', { input: { requestId: randomUUID(), clienteNombre: customer, metodoPago: 'efectivo', items: [tireItem(t), tireItem(other), { tipo: 'servicio', id: s, cantidad: 1 }] } }));
    const detail = expectOk(await run('blanca', 'get', { id: sale.id })); assert.equal(detail.items.length, 3); assert.equal(detail.importeNewTires, 116); assert.equal(detail.total, 261); assert.equal(detail.iva, 0);
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
  await check('all pre-existing catalog, sales and stock-movement rows remain byte-equivalent', async () => {
    const after = await fingerprints();
    for (const [table, hashes] of Object.entries(original)) for (const [id, hash] of hashes) assert.equal(after[table].get(id), hash, `A pre-existing ${table} record changed.`);
  });
} finally { await client.end(); }
const failed = outcomes.filter(outcome => outcome.status === 'failed').length;
process.stdout.write(JSON.stringify({ database, fixtures: prefix, total: outcomes.length, passed: outcomes.length - failed, failed }) + '\n');
process.exitCode = failed ? 1 : 0;
