import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { databaseState } from './published-backup-restore.mjs';
import { verifyRuntime, verifyWriteGate } from './published-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const privateRoot=path.join(root,'.migration-backups');
const require=createRequire(import.meta.url);
const temporaryPattern=/^llantera_restore_[a-f0-9]{24}$/;
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const enabled=process.argv.includes('--run');
const envIndex=process.argv.indexOf('--env');
const envArgument=envIndex===-1?undefined:process.argv[envIndex+1];
const appEnvIndex=process.argv.indexOf('--app-env');
const appEnvArgument=appEnvIndex===-1?undefined:process.argv[appEnvIndex+1];

function loadAdapters(env,database){
  const ts=require('typescript');
  const keys=['DATABASE_URL','LLANTERA_EXPECTED_DATABASE','DB_REQUIRE_SSL','DB_SSL_REJECT_UNAUTHORIZED'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.DATABASE_URL=env.DATABASE_URL;process.env.LLANTERA_EXPECTED_DATABASE=database;
  process.env.DB_REQUIRE_SSL=env.DB_REQUIRE_SSL||'false';
  const originalResolve=Module._resolveFilename,originalLoad=Module._load,originalTs=require.extensions['.ts'];
  class TestPool extends pg.Pool {
    constructor(config){
      assert.equal(new URL(config.connectionString).pathname.slice(1),database,'REAL_DATABASE_CONNECTION_REFUSED');
      assert.ok(temporaryPattern.test(database),'NON_TEST_DATABASE_REFUSED');
      super({...config,connectionTimeoutMillis:20000,statement_timeout:30000,application_name:'published-app-isolated-integration'});
    }
  }
  Module._resolveFilename=function(request,parent,...args){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
  Module._load=function(request,parent,isMain){return request==='pg'?{...pg,Pool:TestPool}:originalLoad.call(this,request,parent,isMain);};
  require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fsSync.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText,filename);
  return {
    inventory:require(path.join(root,'lib/data/sistema-inventario.ts')),
    sales:require(path.join(root,'lib/data/ventas.ts')),
    systemSales:require(path.join(root,'lib/data/sistema-ventas.ts')),
    products:require(path.join(root,'lib/data/productos.ts')),
    services:require(path.join(root,'lib/data/servicios.ts')),
    async close(){
      if(global._llanteraPg)await global._llanteraPg.pool.end();delete global._llanteraPg;
      Module._resolveFilename=originalResolve;Module._load=originalLoad;
      if(originalTs)require.extensions['.ts']=originalTs;else delete require.extensions['.ts'];
      for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
    },
  };
}

async function run(){
  assert.ok(envArgument,'EXPLICIT_PRIVATE_RESTORE_ENV_REQUIRED');
  const envPath=path.resolve(root,envArgument);
  assert.ok(envPath.startsWith(privateRoot+path.sep)&&path.basename(envPath)==='restore.env','PRIVATE_RESTORE_ENV_REQUIRED');
  const dir=path.dirname(envPath);
  const env=dotenv.parse(await fs.readFile(envPath));
  const url=new URL(env.DATABASE_URL),database=decodeURIComponent(url.pathname.slice(1));
  assert.match(database,temporaryPattern,'PRODUCTION_DATABASE_REFUSED');
  const expected=JSON.parse(await fs.readFile(path.join(dir,'temporary-database.json'),'utf8'));
  assert.equal(database,expected.database,'UNREGISTERED_TEST_DATABASE');
  let appEnv=env;
  if(appEnvArgument){
    const appEnvPath=path.resolve(root,appEnvArgument);
    assert.ok(appEnvPath.startsWith(privateRoot+path.sep),'PRIVATE_APP_ENV_REQUIRED');
    appEnv=dotenv.parse(await fs.readFile(appEnvPath));
    const appUrl=new URL(appEnv.DATABASE_URL);
    assert.equal(appUrl.hostname,url.hostname,'APP_DATABASE_HOST_MISMATCH');
    assert.equal(appUrl.port,url.port,'APP_DATABASE_PORT_MISMATCH');
    assert.equal(decodeURIComponent(appUrl.pathname.slice(1)),database,'APP_DATABASE_NAME_MISMATCH');
    assert.equal(appEnv.LLANTERA_EXPECTED_DATABASE,database,'APP_EXPECTED_DATABASE_MISMATCH');
  }
  const reportFile=path.join(dir,`app-integration-${Date.now()}-${randomBytes(4).toString('hex')}.json`);
  const token='AUDIT_APP_'+randomBytes(8).toString('hex');
  const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:20000,statement_timeout:30000,
    options:'-c timezone=UTC',application_name:'published-app-integration-control'});
  let adapters,before,stage='connect',cleaned=false,failure,gate;
  const checks=[],created={tires:[],products:[],services:[],sales:[]};
  const track=(kind,row)=>{assert.ok(row?.id,'CREATED_ROW_ID_REQUIRED');created[kind].push(row.id);return row;};
  const report={database,rehearsalOnly:true,productionConnected:false,syntheticCustomer:token,checks};
  try{
    await client.connect();
    const identity=(await client.query('SELECT current_database() AS database,d.oid::text,pg_get_userbyid(d.datdba) AS owner FROM pg_database d WHERE d.datname=current_database()')).rows[0];
    assert.equal(identity.database,database);assert.equal(identity.oid,expected.oid);assert.equal(identity.owner,expected.owner);
    await client.query('SELECT pg_advisory_lock(73518808)');
    if(appEnvArgument){
      const appProbe=new pg.Client({connectionString:appEnv.DATABASE_URL,connectionTimeoutMillis:20000,statement_timeout:30000,
        application_name:'published-app-integration-permission-probe'});
      try{
        await appProbe.connect();
        const permissions=(await appProbe.query(`SELECT current_database() AS database,d.oid::text,current_user AS role,
          r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
          pg_has_role(current_user,d.datdba,'MEMBER') AS owner_member,
          has_database_privilege(current_user,current_database(),'CREATE') AS can_create
          FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`)).rows[0];
        assert.equal(permissions.database,database);assert.equal(permissions.oid,expected.oid);
        for(const key of ['rolsuper','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls','owner_member','can_create'])assert.equal(permissions[key],false,`APP_ROLE_EXCESS_PRIVILEGE_${key}`);
        report.appRole=permissions;
      }finally{await appProbe.end().catch(()=>{});}
      gate=(await client.query('SELECT singleton,status,app_role,application_sha256,activated_at::text AS activated_at FROM migration_new_tires.operation_state WHERE singleton')).rows[0];
      assert.equal(gate?.status,'active','ISOLATED_APP_GATE_NOT_ACTIVE');
      assert.equal(gate.app_role,report.appRole.role,'ISOLATED_GATE_APP_ROLE_MISMATCH');
      report.gate=await verifyWriteGate(client,{appRole:gate.app_role,applicationSha256:gate.application_sha256,expectedStatus:'active'});
    }else report.appRole={ownerCoverageOnly:true};
    report.runtime=await verifyRuntime(client);
    before=await databaseState(client);
    report.beforeHashes=Object.fromEntries(Object.entries(before.tables).map(([k,v])=>[k,{count:v.count,sha256:v.sha256}]));
    adapters=loadAdapters(appEnv,database);
    const {inventory,sales,systemSales,products,services}=adapters;
    stage='authentic_data_reads';
    const all=await sales.obtenerVentas({incluirCanceladas:true});
    assert.equal(all.length,before.tables['public.ventas'].count,'SALES_HIDDEN_BY_DOMAIN_FILTER');
    const activeServices=await services.obtenerServicios();
    const originalServices=before.tables['public.servicios'].rows.map(JSON.parse).filter(r=>r.activo);
    assert.deepEqual(activeServices.map(s=>[s.id,s.nombre,s.precioDefault,s.codigoBarras]).sort(),
      originalServices.map(s=>[s.id,s.nombre,Number(s.precio_default),s.codigo_barras]).sort(),'AUTHENTIC_SERVICE_FIELDS_CHANGED');
    assert.ok(activeServices.length>0);
    const existingProducts=await products.obtenerProductos();
    for(const product of existingProducts){const original=before.tables['public.productos'].rows.map(JSON.parse).find(r=>r.id===product.id);assert.ok(original);assert.equal(product.precio,Number(original.precio));if(original.precio_compra===null)assert.equal(product.precioCompra,undefined,'UNKNOWN_COST_INVENTED');}
    const imported=(await client.query('SELECT sale_id FROM migration_new_tires.imported_sales ORDER BY sale_id LIMIT 1')).rows[0].sale_id;
    const importedSale=await sales.obtenerVenta(imported);assert.equal(importedSale.soloLecturaMigrada,true);
    const originals=before.tables['public.ventas'].rows.map(JSON.parse);
    for(const original of originals){const sale=all.find(v=>v.id===original.id);assert.ok(sale);assert.equal(sale.total,Number(original.total));assert.equal(sale.subtotal,Number(original.subtotal));assert.equal(sale.iva,Number(original.iva));}
    const tires=await inventory.obtenerInventarioSistema({incluirInactivos:true});
    assert.equal(tires.length,134);assert.equal(tires.filter(t=>t.activo).length,104);
    const activeStock=tires.filter(t=>t.activo).reduce((s,t)=>s+Object.values(t.stockPorBodega).reduce((a,b)=>a+Number(b),0),0);
    assert.equal(activeStock,185,'WAREHOUSE_QUANTITIES_CHANGED');
    checks.push('all_authentic_sales_services_prices_iva_and_warehouses_read_correctly');

    stage='protect_historical_cancellation';
    const protectedState=await databaseState(client);
    await assert.rejects(()=>sales.cancelarVenta(imported,'Prueba de protección'));
    const protectedAfter=await databaseState(client);
    for(const table of ['public.llantas','public.ventas','public.venta_items','public.movimientos_bodega'])assert.equal(protectedAfter.tables[table].sha256,protectedState.tables[table].sha256,'HISTORICAL_CANCELLATION_CHANGED_DATA');
    checks.push('historical_cancellation_fails_before_any_stock_or_sale_change');

    stage='synthetic_inventory_and_catalog';
    const tire=track('tires',await inventory.crearLlantaSistema({marca:token,modelo:'Integration',medida:'205/55R16',precioCompra:700,precioVenta:1190,bodega:'bodega-6',cantidad:5,proveedor:'COMERCIALIZADORA DE NEW TIRES',fechaRecepcion:'2026-10-11'}));
    assert.equal(tire.stockPorBodega['bodega-6'],5);
    await inventory.ajustarStockSistema(tire.id,'bodega-2',3);
    await inventory.moverStockSistema(tire.id,'bodega-6','bodega-2',2);
    const moved=await inventory.obtenerLlantaSistema(tire.id);assert.equal(moved.stockPorBodega['bodega-6'],3);assert.equal(moved.stockPorBodega['bodega-2'],5);
    const stock=async(id)=>(await client.query('SELECT stock,stock_por_bodega FROM public.llantas WHERE id=$1',[id])).rows[0];
    assert.equal((await stock(tire.id)).stock,8);
    const product=track('products',await products.crearProducto({nombre:token,descripcion:'Synthetic integration fixture',precio:100.25,cantidad:10}));
    const service=track('services',await services.crearServicio({nombre:token,descripcion:'Synthetic integration fixture',precioDefault:70}));
    assert.ok(service.codigoBarras);
    assert.equal((await services.obtenerServicioPorCodigo(service.codigoBarras)).id,service.id);
    checks.push('new_inventory_stock_totals_transfers_and_service_barcode_persist');

    const saleInput=(items)=>({clienteNombre:token,clienteTelefono:'',items,metodoPago:'efectivo',generarFactura:false,sinGarantia:true});
    const inspectSale=async(sale,total)=>{
      const amounts=(await client.query(`SELECT subtotal::text,iva::text,total::text,iva_politica,
        subtotal=round(total/1.16,2) AND iva=total-subtotal AS tax_ok,
        total=(SELECT sum(subtotal) FROM public.venta_items WHERE venta_id=v.id) AS items_ok
        FROM public.ventas v WHERE id=$1`,[sale.id])).rows[0];
      assert.equal(Number(amounts.total),total);assert.ok(amounts.tax_ok&&amounts.items_ok);assert.equal(amounts.iva_politica,'incluido_16');
      assert.equal(sale.subtotal,Number(amounts.subtotal));assert.equal(sale.iva,Number(amounts.iva));assert.equal(sale.total,Number(amounts.total));
      assert.equal((await client.query('SELECT count(*)::int AS n FROM public.venta_items WHERE venta_id=$1 AND original_item IS NOT NULL',[sale.id])).rows[0].n,0);
      const fetched=await sales.obtenerVenta(sale.id);assert.equal(fetched.iva,sale.iva);assert.equal(fetched.total,sale.total);
    };
    stage='included_tax_and_distinct_folios';
    const initialGeneral=report.runtime.sequences.find(r=>r.key==='ventas_seq').value.ultimoFolio;
    const mixed=track('sales',await sales.crearVenta(saleInput([{tipo:'producto',id:tire.id,bodega:'bodega-2',cantidad:2},{tipo:'servicio',id:service.id,cantidad:1}])));
    await inspectSale(mixed,2450);assert.equal(mixed.folio,`V-${String(initialGeneral+1).padStart(4,'0')}`);
    assert.equal((await stock(tire.id)).stock_por_bodega['bodega-2'],3);
    const catalog=track('sales',await sales.crearVenta(saleInput([{tipo:'catalogo',id:product.id,cantidad:2}])));await inspectSale(catalog,200.5);
    assert.equal((await products.obtenerProducto(product.id)).stock,8);
    await sales.cancelarVenta(catalog.id,'Synthetic integration cancellation');assert.equal((await products.obtenerProducto(product.id)).stock,10,'CATALOG_CANCELLATION_FAILED_TO_RESTORE_STOCK');
    const system=await systemSales.crearVentaSistema({clienteNombre:token,clienteTelefono:'',items:[{llantaId:tire.id,bodega:'bodega-6',cantidad:1}],metodoPago:'efectivo',diasGarantia:30});
    assert.equal(system.success,true,system.error||'SYSTEM_SALE_FAILED');track('sales',system.data);assert.match(system.data.folio,/^SI-/);await inspectSale(system.data,1190);
    const zero=track('sales',await sales.crearVenta(saleInput([{tipo:'extra',id:'extra',nombre:token,cantidad:1,precioCustom:0}])));await inspectSale(zero,0);
    checks.push('sales_tire_service_catalog_extra_and_system_persist_included_iva_correct_folios');

    stage='atomic_failed_sale';
    const beforeFailure=await databaseState(client);
    await assert.rejects(()=>sales.crearVenta(saleInput([{tipo:'catalogo',id:product.id,cantidad:1},{tipo:'servicio',id:'NONEXISTENT_'+token,cantidad:1}])));
    const afterFailure=await databaseState(client);
    for(const table of ['public.productos','public.llantas','public.ventas','public.venta_items','public.app_metadata','public.movimientos_bodega'])assert.equal(afterFailure.tables[table].sha256,beforeFailure.tables[table].sha256,'FAILED_SALE_LEFT_PARTIAL_CHANGE');
    await assert.rejects(()=>sales.crearVenta(saleInput([{tipo:'producto',id:tire.id,bodega:'bodega-2',cantidad:2},{tipo:'producto',id:tire.id,bodega:'bodega-2',cantidad:2}])));
    assert.equal((await stock(tire.id)).stock_por_bodega['bodega-2'],3);
    checks.push('failed_or_repeated_cart_oversell_rolls_back_stock_rows_and_folios');

    stage='concurrent_last_unit_sales';
    const lastUnit=track('tires',await inventory.crearLlantaSistema({marca:token,modelo:'Last unit',medida:'215/60R16',precioCompra:100,precioVenta:116,bodega:'bodega-8',cantidad:1,proveedor:'COMERCIALIZADORA DE NEW TIRES',fechaRecepcion:'2026-10-11'}));
    const results=await Promise.allSettled([sales.crearVenta(saleInput([{tipo:'producto',id:lastUnit.id,bodega:'bodega-8',cantidad:1}])),sales.crearVenta(saleInput([{tipo:'producto',id:lastUnit.id,bodega:'bodega-8',cantidad:1}]))]);
    const wins=results.filter(r=>r.status==='fulfilled'),losses=results.filter(r=>r.status==='rejected');
    for(const result of wins)track('sales',result.value);
    assert.equal(wins.length,1,'CONCURRENT_LAST_UNIT_DOUBLE_SOLD');assert.equal(losses.length,1);assert.equal((await stock(lastUnit.id)).stock,0);await inspectSale(wins[0].value,116);
    const cancellations=await Promise.allSettled([sales.cancelarVenta(wins[0].value.id,'Concurrent cancellation A'),sales.cancelarVenta(wins[0].value.id,'Concurrent cancellation B')]);
    assert.equal(cancellations.filter(r=>r.status==='fulfilled').length,1,'DOUBLE_CANCELLATION_SUCCEEDED');
    assert.equal((await stock(lastUnit.id)).stock,1,'DOUBLE_CANCELLATION_DUPLICATED_STOCK');
    assert.equal((await stock(lastUnit.id)).stock_por_bodega['bodega-8'],1);
    checks.push('real_concurrent_last_unit_allows_one_sale_and_double_cancel_restores_once');
    report.verified=true;
  }catch(error){failure=error;report.verified=false;report.failedStage=stage;report.error=error.code||error.name;report.message=String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[connection omitted]');}
  finally{
    if(adapters)await adapters.close();
    if(before){
      try{
        // Discover only sales carrying this unique synthetic customer marker;
        // handles a failure after an INSERT committed but before return mapping.
        const markerSales=(await client.query('SELECT id FROM public.ventas WHERE cliente_nombre=$1',[token])).rows.map(r=>r.id);
        const ids=[...new Set([...created.sales,...markerSales])];
        for(const[table,key]of [['llantas','tires'],['productos','products'],['servicios','services']]){
          const field=table==='llantas'?'marca':'nombre';
          const markerRows=(await client.query(`SELECT id FROM public.${table} WHERE ${field}=$1`,[token])).rows.map(r=>r.id);
          created[key]=[...new Set([...created[key],...markerRows])];
        }
        assert.equal((await client.query('SELECT count(*)::int AS n FROM migration_new_tires.imported_sales WHERE sale_id=ANY($1::text[])',[ids])).rows[0].n,0,'CLEANUP_TOUCHES_HISTORY');
        for(const id of ids)assert.equal((await client.query('SELECT cliente_nombre FROM public.ventas WHERE id=$1',[id])).rows[0]?.cliente_nombre,token,'CLEANUP_SALE_MARKER_MISMATCH');
        await client.query('BEGIN');
        if(gate){
          const locked=(await client.query('SELECT singleton,status,app_role,application_sha256,activated_at::text AS activated_at FROM migration_new_tires.operation_state WHERE singleton FOR UPDATE')).rows[0];
          assert.deepEqual(locked,gate,'ISOLATED_GATE_CHANGED_DURING_TEST');
          // Local to this owner transaction: concurrent app sessions continue
          // seeing their original committed role until the exact state returns.
          await client.query('UPDATE migration_new_tires.operation_state SET app_role=session_user WHERE singleton');
        }
        await client.query('DELETE FROM public.venta_items WHERE venta_id=ANY($1::text[])',[ids]);
        await client.query('DELETE FROM public.movimientos_bodega WHERE llanta_id=ANY($1::text[]) OR venta_id=ANY($2::text[])',[created.tires,ids]);
        await client.query('DELETE FROM public.ventas WHERE id=ANY($1::text[])',[ids]);
        for(const[table,key]of [['llantas','tires'],['productos','products'],['servicios','services']]){
          const field=table==='llantas'?'marca':'nombre';
          const mismatch=(await client.query(`SELECT count(*)::int AS n FROM public.${table} WHERE id=ANY($1::text[]) AND ${field} IS DISTINCT FROM $2`,[created[key],token])).rows[0].n;
          assert.equal(mismatch,0,'CLEANUP_CATALOG_MARKER_MISMATCH');
          await client.query(`DELETE FROM public.${table} WHERE id=ANY($1::text[])`,[created[key]]);
        }
        if(gate)await client.query('UPDATE migration_new_tires.operation_state SET app_role=$1 WHERE singleton',[gate.app_role]);
        await client.query('COMMIT');
        const after=await databaseState(client);
        for(const[name,table]of Object.entries(before.tables)){
          if(name==='public.app_metadata')continue;
          assert.equal(after.tables[name]?.sha256,table.sha256,`ORIGINAL_TABLE_CHANGED_${name}`);
        }
        for(const[name,state]of Object.entries(before.sequenceStates))assert.ok(BigInt(after.sequenceStates[name].last_value)>=BigInt(state.last_value),'SEQUENCE_REWOUND');
        report.runtimeAfter=await verifyRuntime(client);
        if(gate)report.gateAfter=await verifyWriteGate(client,{appRole:gate.app_role,applicationSha256:gate.application_sha256,expectedStatus:'active'});
        report.originalRowsUnchanged=true;report.syntheticRowsRemoved=true;report.sequencesMayAdvanceInCloneOnly=true;
        report.afterHashes=Object.fromEntries(Object.entries(after.tables).map(([k,v])=>[k,{count:v.count,sha256:v.sha256}]));
        report.sequenceStatesAfter=after.sequenceStates;cleaned=true;
      }catch(error){await client.query('ROLLBACK').catch(()=>{});report.cleanupError=error.code||error.name;report.cleanupMessage=String(error.message);failure=failure||error;report.verified=false;}
    }
    report.completedAt=new Date().toISOString();report.cleanupVerified=cleaned;
    report.sourceFiles=Object.fromEntries(['lib/db.ts','lib/data/normalizado.ts','lib/data/ventas.ts','lib/data/sistema-ventas.ts','lib/data/sistema-inventario.ts','lib/data/productos.ts','lib/data/servicios.ts'].map(name=>[name,sha256(fsSync.readFileSync(path.join(root,name)))]));
    await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    await client.end().catch(()=>{});
    console.log(JSON.stringify({report:reportFile,verified:report.verified,cleanupVerified:cleaned,checks:checks.length,failedStage:report.failedStage}));
  }
  if(failure)throw new Error(`PUBLISHED_APP_INTEGRATION_FAILED: ${stage}; see private report`);
}

test('normalized published backend preserves authentic data and atomic concurrent operations',{skip:!enabled},run);
