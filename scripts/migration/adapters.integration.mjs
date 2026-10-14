/** Real adapter writes run only in a newly created random database and limited role.
 * Neither source nor application destination is connected to by this test.
 * Usage: node scripts/migration/adapters.integration.mjs --run [--backup <directory>]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { SUPPLIER, TABLES, insertRaw, qi, readRows, rowsHash, sha256, verifyRows } from './snapshot.mjs';
import { applyTaxBackfill, inspectTaxState, constraintName } from './iva-backfill.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.resolve(root, '../sistemaBodega');
const backupRoot = path.join(root, '.migration-backups');
const defaultBackup = path.join(backupRoot, 'new-tires-2026-10-11T23-21-25.623Z-cc8f344f');
const applicationDatabase = 'llaneteramulti_new_tires';
const temporaryPattern = /^llantera_adapters_test_[a-f0-9]{24}$/;
const rolePattern = /^llantera_adapters_role_[a-f0-9]{24}$/;
const importOrder = ['llantas', 'producto_imagenes', 'productos', 'servicios', 'ventas', 'movimientos_bodega', 'ventas_productos', 'app_metadata'];
const require = createRequire(import.meta.url);

async function loadInput(directory) {
  const dir = path.resolve(directory);
  if (!dir.startsWith(backupRoot + path.sep)) throw new Error('BACKUP_OUTSIDE_PROJECT');
  const bytes = await fs.readFile(path.join(dir, 'source-backup.json'));
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(sha256(bytes), manifest.backupSha256, 'BACKUP_HASH_MISMATCH');
  const backup = JSON.parse(bytes);
  assert.equal(backup.batchId, manifest.batchId, 'BACKUP_BATCH_MISMATCH');
  assert.equal(sha256(backup.schema.sql), manifest.schemaSha256, 'SCHEMA_HASH_MISMATCH');
  assert.equal(backup.selection.summary.supplier, SUPPLIER, 'BACKUP_SUPPLIER_MISMATCH');
  for (const table of TABLES) {
    assert.equal(backup.all[table].length, manifest.allTables[table].count, 'BACKUP_TABLE_COUNT_MISMATCH');
    assert.equal(rowsHash(backup.all[table]), manifest.allTables[table].sha256, 'BACKUP_TABLE_HASH_MISMATCH');
  }
  const env = {};
  for (const name of ['.env', '.env.development', '.env.local', '.env.development.local']) {
    try { Object.assign(env, dotenv.parse(await fs.readFile(path.join(sourceRoot, name)))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.ok(env.DATABASE_URL, 'SOURCE_CREDENTIALS_UNAVAILABLE');
  assert.equal(decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)), backup.source.database, 'SOURCE_DATABASE_MISMATCH');
  // Reuse exactly the destination controls without executing migration entrypoint.
  const migrationSource = await fs.readFile(path.join(root, 'scripts/migrate-new-tires.mjs'), 'utf8');
  const targetControl = migrationSource.match(/const targetControl = `([\s\S]*?)`;/)?.[1];
  assert.ok(targetControl && !targetControl.includes('${'), 'DESTINATION_CONTROL_LITERAL_UNAVAILABLE');
  return { dir, backup, manifest, env, targetControl };
}

function databaseUrl(env, database) {
  const url = new URL(env.DATABASE_URL);
  url.pathname = '/' + database;
  url.searchParams.delete('database'); url.searchParams.delete('dbname');
  return url;
}

async function connectAllowed(env, database, forbidden, registry) {
  assert.equal(forbidden.has(database), false, 'PROTECTED_DATABASE_CONNECTION_REFUSED');
  assert.ok(['template1', 'postgres'].includes(database) || registry.has(database), 'UNREGISTERED_DATABASE_CONNECTION_REFUSED');
  const client = new pg.Client({ connectionString: databaseUrl(env,database).toString(),
    ssl: env.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15000, statement_timeout: 60000, options: '-c timezone=UTC',
    application_name: 'llantera-adapters-isolated-integration' });
  await client.connect();
  try {
    const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
    assert.equal(actual,database,'ACTUAL_DATABASE_NOT_ALLOWED');
    assert.equal(forbidden.has(actual),false,'PROTECTED_DATABASE_CONNECTION_REFUSED');
    return client;
  } catch (error) { await client.end(); throw error; }
}

function loadAdapters(env, temporaryName, roleName, password, registry, forbidden) {
  assert.ok(registry.has(temporaryName) && temporaryPattern.test(temporaryName) && !forbidden.has(temporaryName));
  const ts = require('typescript');
  const url = databaseUrl(env,temporaryName); url.username = roleName; url.password = password;
  const keys = ['DATABASE_URL','LLANTERA_EXPECTED_DATABASE','LLANTERA_SUPPLIER','DB_REQUIRE_SSL','DB_SSL_REJECT_UNAUTHORIZED'];
  const previous = Object.fromEntries(keys.map((key) => [key,process.env[key]]));
  process.env.DATABASE_URL = url.toString(); process.env.LLANTERA_EXPECTED_DATABASE = temporaryName;
  process.env.LLANTERA_SUPPLIER = SUPPLIER; process.env.DB_REQUIRE_SSL = env.DB_REQUIRE_SSL === 'true' ? 'true' : 'false';
  process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
  const originalResolve = Module._resolveFilename, originalLoad = Module._load, originalTs = require.extensions['.ts'];
  class IsolatedPool extends pg.Pool {
    constructor(config) {
      const selected = decodeURIComponent(new URL(config.connectionString).pathname.slice(1));
      assert.equal(selected,temporaryName,'ADAPTER_NON_TEMPORARY_DATABASE_REFUSED');
      assert.ok(registry.has(selected) && !forbidden.has(selected),'ADAPTER_CONNECTION_OUTSIDE_REGISTRY');
      super({ ...config, connectionTimeoutMillis: 15000, statement_timeout: 30000, application_name: 'llantera-adapters-temporary-app' });
    }
  }
  Module._resolveFilename = function (request,parent,...args) { return originalResolve.call(this,request.startsWith('@/') ? path.join(root,request.slice(2)) : request,parent,...args); };
  Module._load = function (request,parent,isMain) { return request === 'server-only' ? {} : request === 'pg' ? { ...pg, Pool: IsolatedPool } : originalLoad.call(this,request,parent,isMain); };
  require.extensions['.ts'] = (module,filename) => module._compile(ts.transpileModule(fsSync.readFileSync(filename,'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,filename);
  return {
    db: require(path.join(root,'lib/db.ts')).db,
    inventory: require(path.join(root,'lib/data/sistema-inventario.ts')),
    sales: require(path.join(root,'lib/data/ventas.ts')),
    systemSales: require(path.join(root,'lib/data/sistema-ventas.ts')),
    products: require(path.join(root,'lib/data/productos.ts')),
    services: require(path.join(root,'lib/data/servicios.ts')),
    async close() {
      if (global._llanteraPg) await global._llanteraPg.pool.end();
      delete global._llanteraPg;
      Module._resolveFilename = originalResolve; Module._load = originalLoad;
      if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts'];
      for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    },
  };
}

async function runIntegration(directory) {
  const { dir,backup,manifest,env,targetControl } = await loadInput(directory);
  const token = randomBytes(12).toString('hex');
  const temporaryName = 'llantera_adapters_test_' + token;
  const roleName = 'llantera_adapters_role_' + token;
  assert.match(temporaryName,temporaryPattern); assert.match(roleName,rolePattern);
  const forbidden = new Set([backup.source.database,applicationDatabase]);
  const registry = new Map();
  const maintenanceDatabase = backup.source.database === 'postgres' ? 'template1' : 'postgres';
  let admin, temporary, adapters, roleIdentity;
  let databaseCreated = false, roleCreated = false, removedDatabase = false, removedRole = false, completed = false;
  let stage = 'maintenance_connection';
  const checks = [];
  const reportFile = path.join(dir,`adapters-integration-${Date.now()}.json`);
  try {
    admin = await connectAllowed(env,maintenanceDatabase,forbidden,registry);
    stage = 'create_isolated_database';
    assert.equal((await admin.query('SELECT oid FROM pg_database WHERE datname = $1',[temporaryName])).rowCount,0,'TEMPORARY_DATABASE_ALREADY_EXISTS');
    assert.equal((await admin.query('SELECT oid FROM pg_roles WHERE rolname = $1',[roleName])).rowCount,0,'TEMPORARY_ROLE_ALREADY_EXISTS');
    await admin.query(`CREATE DATABASE ${qi(temporaryName)} TEMPLATE template0`); databaseCreated = true;
    const identity = (await admin.query(`SELECT d.oid::text AS oid,d.datdba = r.oid AS owned FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=$1`,[temporaryName])).rows[0];
    assert.ok(identity?.owned && /^\d+$/.test(identity.oid),'TEMPORARY_DATABASE_IDENTITY_UNVERIFIED');
    registry.set(temporaryName,Object.freeze({ name:temporaryName,oid:identity.oid }));
    temporary = await connectAllowed(env,temporaryName,forbidden,registry);
    stage = 'restore_verified_supplier_snapshot';
    await temporary.query('BEGIN');
    try {
      await temporary.query(backup.schema.sql); await temporary.query(targetControl);
      for (const table of importOrder) await insertRaw(temporary,'public',table,backup.selection.rows[table]);
      await insertRaw(temporary,'migration_context','llantas',backup.selection.context);
      await temporary.query('INSERT INTO public.migration_imported_sales(sale_id,batch_id) SELECT id,$1 FROM public.ventas',[backup.batchId]);
      await verifyRows(temporary,backup.selection); await temporary.query('COMMIT');
    } catch (error) { await temporary.query('ROLLBACK'); throw error; }
    checks.push('exact_supplier_snapshot_and_historical_context_restored');
    stage = 'create_limited_temporary_application_role';
    const password = randomBytes(36).toString('base64url');
    await admin.query(`CREATE ROLE ${qi(roleName)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`); roleCreated = true;
    roleIdentity = (await admin.query('SELECT oid::text AS oid,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1',[roleName])).rows[0];
    assert.ok(roleIdentity && !roleIdentity.rolsuper && !roleIdentity.rolcreatedb && !roleIdentity.rolcreaterole && !roleIdentity.rolreplication,'TEMPORARY_ROLE_PRIVILEGES_UNSAFE');
    await temporary.query(`REVOKE ALL ON DATABASE ${qi(temporaryName)} FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${qi(temporaryName)} TO ${qi(roleName)};
      GRANT USAGE ON SCHEMA public TO ${qi(roleName)};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${qi(roleName)};
      GRANT INSERT,UPDATE,DELETE ON public.llantas,public.movimientos_bodega,public.ventas,public.productos,public.servicios,public.ventas_productos,public.producto_imagenes TO ${qi(roleName)};
      GRANT UPDATE ON public.app_metadata TO ${qi(roleName)};`);
    adapters = loadAdapters(env,temporaryName,roleName,password,registry,forbidden);
    const { db,inventory,sales,systemSales,products,services } = adapters;
    checks.push('same_limited_application_permissions_as_destination_activation');
    const originalHistory = rowsHash(await readRows(temporary,'public','ventas'));
    const sequence = async () => (await db.query("SELECT value FROM app_metadata WHERE key='sistema_ventas_seq'")).rows[0].value;
    const assertStoredAmounts = async (sale, expected) => {
      // Read the stored numeric columns independently of the TypeScript adapter.
      const persisted = (await temporary.query(`SELECT subtotal::text,iva::text,total::text,
        subtotal + iva = total AS reconciled,
        subtotal = round(total / 1.16,2) AS correct_subtotal,
        iva = total - round(total / 1.16,2) AS correct_iva
        FROM public.ventas WHERE id=$1`,[sale.id])).rows[0];
      assert.ok(persisted,'SALE_NOT_STORED');
      const amounts = { subtotal:Number(persisted.subtotal),iva:Number(persisted.iva),total:Number(persisted.total) };
      assert.deepEqual(amounts,expected,'PERSISTED_INCLUDED_IVA_MISMATCH');
      assert.deepEqual({subtotal:sale.subtotal,iva:sale.iva,total:sale.total},amounts,'RESPONSE_DIFFERS_FROM_STORED_AMOUNTS');
      assert.ok(persisted.reconciled && persisted.correct_subtotal && persisted.correct_iva,'POSTGRESQL_TAX_RECONCILIATION_FAILED');
    };
    const active = await inventory.obtenerInventarioSistema();
    assert.equal(active.length,104);
    const fixture = active.find((tire) => Object.values(tire.stockPorBodega).some((amount) => amount >= 2));
    assert.ok(fixture,'STOCK_FIXTURE_NOT_FOUND');
    const warehouse = Object.keys(fixture.stockPorBodega).find((key) => fixture.stockPorBodega[key] >= 2);
    const otherWarehouse = warehouse === 'bodega-1' ? 'bodega-2' : 'bodega-1';
    stage = 'warehouse_transfer_round_trip';
    const moved = await inventory.moverStockSistema(fixture.id,warehouse,otherWarehouse,1);
    assert.equal(Object.values(moved.stockPorBodega).reduce((a,b) => a+b,0),Object.values(fixture.stockPorBodega).reduce((a,b) => a+b,0),'TRANSFER_CHANGED_TOTAL_STOCK');
    assert.equal(moved.stockPorBodega[warehouse],fixture.stockPorBodega[warehouse]-1);
    await inventory.moverStockSistema(fixture.id,otherWarehouse,warehouse,1);
    assert.deepEqual((await inventory.obtenerLlantaSistema(fixture.id)).stockPorBodega,fixture.stockPorBodega);
    assert.equal((await inventory.obtenerMovimientosSistema()).length,491);
    checks.push('warehouse_transfer_preserves_total_and_restores_exact_stock');
    stage = 'real_sale_and_cancellation';
    const beforeSequence = await sequence();
    const created = await systemSales.crearVentaSistema({ clienteNombre:'Isolated integration test',metodoPago:'efectivo',
      subtotal:1,iva:9999,total:1,items:[{llantaId:fixture.id,bodega:warehouse,cantidad:2,precioCustom:1190,subtotal:1}] });
    assert.equal(created.success,true,'SYSTEM_SALE_CREATION_FAILED');
    assert.equal(created.data.items[0].costoUnitario,fixture.precioCompra);
    assert.equal(created.data.items[0].subtotal,2380);
    await assertStoredAmounts(created.data,{subtotal:2051.72,iva:328.28,total:2380});
    assert.equal((await inventory.obtenerLlantaSistema(fixture.id)).stockPorBodega[warehouse],fixture.stockPorBodega[warehouse]-2);
    assert.equal((await sequence()).ultimoFolio,beforeSequence.ultimoFolio+1);
    assert.equal((await sequence()).ultimoGarantiaId,beforeSequence.ultimoGarantiaId+1);
    const cancelled = await systemSales.cancelarVentaSistema(created.data.id,'Isolated test reversal');
    assert.equal(cancelled.success,true,'SYSTEM_CANCELLATION_FAILED'); assert.equal(cancelled.data.garantia.activa,false);
    await assertStoredAmounts(cancelled.data,{subtotal:2051.72,iva:328.28,total:2380});
    assert.deepEqual((await inventory.obtenerLlantaSistema(fixture.id)).stockPorBodega,fixture.stockPorBodega);
    assert.equal((await systemSales.cancelarVentaSistema(created.data.id,'Again')).success,false);
    checks.push('system_sale_persists_included_iva_ignores_client_totals_and_cancel_restores_stock');
    stage = 'general_sale_catalog_and_service';
    const product = await products.crearProducto({ nombre:'Isolated catalog test',precio:25,precioCompra:10,cantidad:2 });
    const service = await services.crearServicio({ nombre:'Isolated service test',descripcion:'Temporary database only',precioDefault:5 });
    const general = await sales.crearVenta({ clienteNombre:'Isolated mixed sale',metodoPago:'efectivo',generarFactura:false,subtotal:1,iva:9999,total:1,
      items:[{tipo:'producto',id:fixture.id,bodega:warehouse,cantidad:1,precioCustom:0},{tipo:'catalogo',id:product.id,cantidad:1},{tipo:'servicio',id:service.id,cantidad:1}] });
    assert.equal(general.total,30); assert.equal((await products.obtenerProducto(product.id)).stock,1);
    await assertStoredAmounts(general,{subtotal:25.86,iva:4.14,total:30});
    assert.equal((await systemSales.obtenerVentaSistema(general.id)).items.length,3);
    await sales.cancelarVenta(general.id,'Isolated test reversal');
    assert.equal((await products.obtenerProducto(product.id)).stock,2);
    assert.deepEqual((await inventory.obtenerLlantaSistema(fixture.id)).stockPorBodega,fixture.stockPorBodega);
    checks.push('general_sale_persists_included_iva_for_catalog_service_and_zero_price_tire');
    stage = 'fractional_currency_persistence';
    const fractional = await sales.crearVenta({clienteNombre:'Isolated decimal sale',metodoPago:'efectivo',generarFactura:false,
      items:[{tipo:'extra',nombre:'Decimal A',cantidad:1,precioCustom:0.1},{tipo:'extra',nombre:'Decimal B',cantidad:1,precioCustom:0.2}]});
    await assertStoredAmounts(fractional,{subtotal:0.26,iva:0.04,total:0.3});
    const rounded = await sales.crearVenta({clienteNombre:'Isolated rounded sale',metodoPago:'efectivo',generarFactura:false,
      items:[{tipo:'extra',nombre:'Rounded price',cantidad:3,precioCustom:1.005}]});
    await assertStoredAmounts(rounded,{subtotal:2.61,iva:0.42,total:3.03});
    assert.equal(rounded.items[0].precioUnitario,1.01); assert.equal(rounded.items[0].subtotal,3.03);
    await sales.cancelarVenta(fractional.id,'Isolated test reversal');
    await sales.cancelarVenta(rounded.id,'Isolated test reversal');
    checks.push('decimal_and_half_cent_prices_reconcile_in_actual_postgresql_columns');
    stage = 'concurrent_sales_and_oversell_rollback';
    const oneUnit = await inventory.crearLlantaSistema({marca:'Isolated',modelo:'One unit',medida:'10.00R20',precioCompra:10,precioVenta:20,cantidad:1,bodega:'bodega-1',proveedor:SUPPLIER,fechaRecepcion:'2026-10-11'});
    const sellOne = () => sales.crearVenta({clienteNombre:'Isolated concurrency test',metodoPago:'efectivo',generarFactura:false,items:[{tipo:'producto',id:oneUnit.id,bodega:'bodega-1',cantidad:1}]});
    const concurrent = await Promise.allSettled([sellOne(),sellOne()]);
    assert.equal(concurrent.filter((result)=>result.status==='fulfilled').length,1,'CONCURRENT_OVERSELL');
    assert.equal((await inventory.obtenerLlantaSistema(oneUnit.id)).stockPorBodega['bodega-1'],0);
    await sales.cancelarVenta(concurrent.find((result)=>result.status==='fulfilled').value.id,'Isolated test reversal');
    const beforeDuplicate = await inventory.obtenerLlantaSistema(oneUnit.id), sequenceBeforeDuplicate = await sequence();
    await assert.rejects(()=>sales.crearVenta({clienteNombre:'Isolated duplicate cart',metodoPago:'efectivo',generarFactura:false,
      items:[{tipo:'producto',id:oneUnit.id,bodega:'bodega-1',cantidad:1},{tipo:'producto',id:oneUnit.id,bodega:'bodega-1',cantidad:1}]}),/Stock insuficiente/);
    assert.deepEqual(await inventory.obtenerLlantaSistema(oneUnit.id),beforeDuplicate,'FAILED_CART_CHANGED_TIRE');
    assert.deepEqual(await sequence(),sequenceBeforeDuplicate,'FAILED_CART_CHANGED_SEQUENCE');
    checks.push('concurrent_sales_cannot_oversell_and_duplicate_cart_rolls_back_all_changes');
    stage = 'historical_mutation_guards_application_and_postgresql';
    const historicalId = JSON.parse(backup.selection.rows.ventas[0]).id;
    assert.equal((await systemSales.cancelarVentaSistema(historicalId,'Must reject')).success,false);
    await assert.rejects(()=>sales.marcarFacturada(historicalId,{uuid:'not-written',serie:'',folio:'',fechaTimbrado:''}),/solo lectura/);
    await assert.rejects(()=>db.query('UPDATE public.ventas SET total=total WHERE id=$1',[historicalId]),/histórica migrada/);
    await assert.rejects(()=>db.query('DELETE FROM public.ventas WHERE id=$1',[historicalId]),/histórica migrada/);
    await assert.rejects(()=>db.query('DELETE FROM public.migration_imported_sales WHERE sale_id=$1',[historicalId]),(error)=>error.code==='42501');
    const unchanged = await temporary.query('SELECT to_jsonb(v)::text AS row_json FROM public.ventas v JOIN public.migration_imported_sales i ON i.sale_id=v.id ORDER BY to_jsonb(v)::text COLLATE "C"');
    assert.equal(rowsHash(unchanged.rows.map((row)=>row.row_json)),originalHistory,'HISTORICAL_ROWS_CHANGED');
    assert.equal(rowsHash(await readRows(temporary,'migration_context','llantas')),rowsHash(backup.selection.context));
    checks.push('application_and_database_reject_historical_changes_all_465_original_sales_unchanged');
    stage = 'database_identity_guard';
    process.env.LLANTERA_EXPECTED_DATABASE = 'intentionally_wrong_database';
    await assert.rejects(()=>inventory.obtenerInventarioSistema(),/independiente esperada/);
    process.env.LLANTERA_EXPECTED_DATABASE = temporaryName;
    checks.push('expected_database_guard_rejects_mismatched_configuration');
    stage = 'backfill_refuses_any_previously_recorded_iva';
    const beforeRefusal = rowsHash(await readRows(temporary,'public','ventas'));
    await assert.rejects(() => applyTaxBackfill(temporary,{expectedDatabase:temporaryName,backupRoot:dir,appRole:roleName}), /IVA_ALREADY_RECORDED_STOP_AND_NOTIFY/);
    assert.equal(rowsHash(await readRows(temporary,'public','ventas')),beforeRefusal,'REFUSED_BACKFILL_CHANGED_SALES');
    assert.equal((await temporary.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.ventas'::regclass AND tgname='protect_imported_sales'")).rows[0].tgenabled,'O');
    assert.equal((await temporary.query("SELECT to_regclass('migration_control.sale_iva_adjustments') AS relation")).rows[0].relation,null);
    checks.push('backfill_refuses_recorded_iva_without_disabling_guard_or_modifying_sales');
    stage = 'backfill_original_history_in_isolated_database';
    // Remove only synthetic sales in this verified temporary database. Historical
    // migration markers remain intact and prevent deletion of original rows.
    assert.ok(temporaryPattern.test(temporaryName) && registry.has(temporaryName) && !forbidden.has(temporaryName));
    await temporary.query('DELETE FROM public.ventas WHERE id NOT IN (SELECT sale_id FROM public.migration_imported_sales)');
    assert.equal(rowsHash(await readRows(temporary,'public','ventas')),originalHistory,'TEMPORARY_HISTORY_NOT_RESTORED');
    const uncalculated = await inspectTaxState(temporary);
    assert.equal(uncalculated.count,465); assert.equal(uncalculated.zero_iva,465); assert.equal(uncalculated.existing_iva,0);
    const taxBackfill = await applyTaxBackfill(temporary,{expectedDatabase:temporaryName,backupRoot:dir,appRole:roleName});
    assert.equal(taxBackfill.summary.sales,465);
    const archived = (await temporary.query('SELECT before_row::text AS original FROM migration_control.sale_iva_adjustments')).rows.map(({original})=>original);
    assert.equal(rowsHash(archived),rowsHash(backup.selection.rows.ventas),'BACKFILL_ARCHIVE_DIFFERS_FROM_ORIGINAL_SOURCE');
    const updatedHistory = rowsHash(await readRows(temporary,'public','ventas'));
    assert.notEqual(updatedHistory,originalHistory,'BACKFILL_DID_NOT_APPLY');
    const taxMismatches = (await temporary.query(`SELECT count(*)::int AS count FROM public.ventas v
      JOIN migration_control.sale_iva_adjustments a ON a.sale_id=v.id
      WHERE (to_jsonb(v)-'subtotal'-'iva') IS DISTINCT FROM (a.before_row-'subtotal'-'iva')
        OR subtotal <> round(total/1.16,2) OR iva <> total-subtotal
        OR to_jsonb(v) IS DISTINCT FROM a.after_row`)).rows[0].count;
    assert.equal(taxMismatches,0,'BACKFILL_CHANGED_UNAUTHORIZED_FIELDS_OR_INCORRECT_TAX');
    const known = (await temporary.query("SELECT subtotal,iva,total FROM public.ventas WHERE folio='SI-0809'")).rows[0];
    assert.deepEqual({subtotal:Number(known.subtotal),iva:Number(known.iva),total:Number(known.total)}, {subtotal:2051.72,iva:328.28,total:2380});
    const sourceDocument = backup.selection.rows.ventas.find((raw)=>JSON.parse(raw).folio==='SI-0809');
    assert.ok(sourceDocument,'KNOWN_ORIGINAL_SALE_MISSING');
    const updatedDetail = await sales.obtenerVenta(JSON.parse(sourceDocument).id);
    assert.deepEqual({subtotal:updatedDetail.subtotal,iva:updatedDetail.iva,total:updatedDetail.total}, {subtotal:2051.72,iva:328.28,total:2380});
    assert.equal(updatedDetail.datosOriginalesJson,sourceDocument,'ORIGINAL_DOCUMENT_DOWNLOAD_CHANGED');
    assert.deepEqual(updatedDetail.datosOriginales,JSON.parse(sourceDocument),'PARSED_ORIGINAL_DOCUMENT_CHANGED');
    const diskBackup = JSON.parse(await fs.readFile(path.join(taxBackfill.directory,'before.json'),'utf8'));
    assert.equal(rowsHash(diskBackup.before.ventas),originalHistory,'BACKFILL_DISK_BACKUP_NOT_EXACT');
    checks.push('backfill_preserves_all_original_fields_and_archives_exact_465_source_sales');
    stage = 'backfill_constraint_guard_and_repeat_refusal';
    await assert.rejects(() => db.query(`INSERT INTO public.ventas(id,folio,cliente,items,subtotal,iva,total,"metodoPago",garantia,dominio)
      VALUES($1,$2,'{}'::jsonb,'[]'::jsonb,116,0,116,'efectivo','{}'::jsonb,'sistema')`,['invalid-tax-'+token,'INVALID-'+token]),
      (error)=>error.code==='23514' && error.constraint===constraintName,'WRONG_IVA_INSERT_MUST_FAIL_DATABASE_CONSTRAINT');
    assert.equal((await temporary.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.ventas'::regclass AND tgname='protect_imported_sales'")).rows[0].tgenabled,'O');
    await assert.rejects(()=>db.query('UPDATE public.ventas SET iva=iva WHERE id=$1',[historicalId]),/histórica migrada/);
    await assert.rejects(()=>db.query('UPDATE migration_control.sale_iva_adjustments SET policy=policy WHERE sale_id=$1',[historicalId]),(error)=>error.code==='42501');
    await assert.rejects(()=>applyTaxBackfill(temporary,{expectedDatabase:temporaryName,backupRoot:dir,appRole:roleName}),/IVA_ALREADY_RECORDED_STOP_AND_NOTIFY/);
    assert.equal(rowsHash(await readRows(temporary,'public','ventas')),updatedHistory,'REPEATED_BACKFILL_OR_INVALID_WRITE_CHANGED_HISTORY');
    checks.push('database_constraint_historical_guard_and_repeat_backfill_rejection_preserve_corrected_history');
    completed = true;
  } catch (error) {
    error.integrationFailure = {stage,code:error.code ?? error.name ?? 'INTEGRATION_FAILED',reason:/^[A-Z_]+$/.test(error.message)?error.message:undefined};
    throw error;
  } finally {
    if (adapters) await adapters.close();
    if (temporary) { await temporary.query('ROLLBACK').catch(()=>{}); await temporary.end(); }
    try {
      if (databaseCreated) {
        const entry = registry.get(temporaryName);
        assert.ok(entry && entry.name===temporaryName && temporaryPattern.test(temporaryName) && !forbidden.has(temporaryName),'CLEANUP_REGISTRY_CHECK_FAILED');
        const identity = (await admin.query(`SELECT d.oid::text AS oid,d.datdba=r.oid AS owned FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=$1`,[temporaryName])).rows[0];
        assert.ok(identity?.owned && identity.oid===entry.oid,'CLEANUP_DATABASE_IDENTITY_CHANGED');
        await admin.query(`DROP DATABASE ${qi(temporaryName)}`);
        assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[temporaryName])).rowCount,0,'CLEANUP_DATABASE_STILL_EXISTS');
        registry.delete(temporaryName); removedDatabase=true;
      }
      if (roleCreated) {
        assert.ok(roleIdentity?.oid && rolePattern.test(roleName),'CLEANUP_ROLE_REGISTRY_MISSING');
        const actual = (await admin.query('SELECT oid::text AS oid,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1',[roleName])).rows[0];
        assert.deepEqual(actual,roleIdentity,'CLEANUP_ROLE_IDENTITY_CHANGED');
        await admin.query(`DROP ROLE ${qi(roleName)}`);
        assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[roleName])).rowCount,0,'CLEANUP_ROLE_STILL_EXISTS');
        removedRole=true;
      }
    } finally {
      if (admin) await admin.end();
      const report={integration:completed?'passed':'failed',batchId:backup.batchId,backupSha256:manifest.backupSha256,checks,
        testsPassed:checks.length,temporaryDatabase:temporaryName,temporaryRole:roleName,temporaryDatabaseRemoved:removedDatabase,
        temporaryRoleRemoved:removedRole,sourceDatabaseConnected:false,applicationDatabaseConnected:false,sourceOrDestinationRowsModified:false,
        completedAt:new Date().toISOString()};
      await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
      console.log(JSON.stringify({...report,reportFile},null,2));
    }
  }
}

const args=process.argv.slice(2);
if(args[0]!=='--run'||(args.length!==1&&!(args.length===3&&args[1]==='--backup'))){
  console.log('Uso: node scripts/migration/adapters.integration.mjs --run [--backup <carpeta>]');process.exitCode=2;
}else{
  try{await runIntegration(args[2]??defaultBackup);}catch(error){console.error(JSON.stringify({integrationFailure:error.integrationFailure??{stage:'setup_or_cleanup',code:error.code??error.name??'INTEGRATION_FAILED'}}));process.exitCode=1;}
}
