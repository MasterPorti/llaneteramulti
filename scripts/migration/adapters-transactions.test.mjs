import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// PostgreSQL transaction behavior is covered by published-app-integration.test.mjs.
// These offline tests do not simulate SQL: they cover rejection before DB access
// and preservation of authentic historical values in presentation.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url),ts=require('typescript');
const originalResolve=Module._resolveFilename,originalLoad=Module._load,originalTs=require.extensions['.ts'];
const realPg=require('pg');
const keys=['DATABASE_URL','LLANTERA_EXPECTED_DATABASE'];
const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
process.env.DATABASE_URL='postgresql://offline:offline@localhost/llantera_offline_test';
process.env.LLANTERA_EXPECTED_DATABASE='llantera_offline_test';
let connectionAttempts=0;
class ForbiddenPool {
  async connect(){connectionAttempts++;throw new Error('OFFLINE_TEST_DB_ACCESS_FORBIDDEN');}
}
Module._resolveFilename=function(request,parent,...args){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
Module._load=function(request,parent,isMain){return request==='pg'?{...realPg,Pool:ForbiddenPool}:originalLoad.call(this,request,parent,isMain);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,filename);
const sales=require(path.join(root,'lib/data/ventas.ts'));
const inventory=require(path.join(root,'lib/data/sistema-inventario.ts'));
const {stockDeFila,adaptarLlanta}=require(path.join(root,'lib/data/normalizado.ts'));
after(()=>{
  assert.equal(connectionAttempts,0,'An offline validation unexpectedly reached the database.');
  Module._resolveFilename=originalResolve;Module._load=originalLoad;
  if(originalTs)require.extensions['.ts']=originalTs;else delete require.extensions['.ts'];
  for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  delete global._llanteraPg;
});
const item=(changes={})=>({tipo:'producto',id:'fixture-tire',bodega:'bodega-6',cantidad:1,...changes});
const input=(items=[item()],changes={})=>({clienteNombre:'Offline fixture',items,metodoPago:'efectivo',generarFactura:false,...changes});

test('invalid quantities, non-finite prices, negative prices and overflow fail before DB access',async()=>{
  for(const cantidad of [0,-1,0.5,NaN,Infinity,2147483648,'2',null]){
    await assert.rejects(()=>sales.crearVenta(input([item({cantidad})])),/cantidad/);
  }
  for(const precioCustom of [NaN,Infinity,-Infinity,-0.01,100000000,'100',null]){
    await assert.rejects(()=>sales.crearVenta(input([item({precioCustom})])),/importe|precio/i);
  }
});

test('sales require real warehouses, supported references and valid customer/payment data',async()=>{
  for(const bodega of ['',undefined,'bodega-99'])await assert.rejects(()=>sales.crearVenta(input([item({bodega})])),/bodega/i);
  await assert.rejects(()=>sales.crearVenta(input([item({tipo:'unknown'})])),/Tipo/);
  await assert.rejects(()=>sales.crearVenta(input([item({id:''})])),/referencia/);
  await assert.rejects(()=>sales.crearVenta(input([])),/partida/);
  await assert.rejects(()=>sales.crearVenta(input(undefined,{clienteNombre:''})),/cliente/);
  await assert.rejects(()=>sales.crearVenta(input(undefined,{clienteNombre:'x'.repeat(201)})),/cliente/);
  await assert.rejects(()=>sales.crearVenta(input(undefined,{clienteTelefono:'1'.repeat(21)})),/teléfono/);
  await assert.rejects(()=>sales.crearVenta(input(undefined,{metodoPago:'invented'})),/pago/);
});

test('extra concepts require a real description and explicit price',async()=>{
  await assert.rejects(()=>sales.crearVenta(input([{tipo:'extra',cantidad:1,nombre:'',precioCustom:10}])),/concepto/);
  await assert.rejects(()=>sales.crearVenta(input([{tipo:'extra',cantidad:1,nombre:'Additional work'}])),/precio/);
});

test('unavailable invoices and invalid warranty dates cannot start a sale',async()=>{
  await assert.rejects(()=>sales.crearVenta(input(undefined,{generarFactura:true})),/factura/);
  await assert.rejects(()=>sales.crearVenta(input(undefined,{diasGarantia:-1})),/cantidad/);
  await assert.rejects(()=>sales.crearVenta(input(undefined,{diasGarantia:2147483647})),/garantía/);
});

test('unrelated inventory suppliers and invalid stock operations fail before DB access',async()=>{
  await assert.rejects(()=>inventory.crearLlantaSistema({proveedor:'Unrelated supplier'}),/exclusivamente/);
  await assert.rejects(()=>inventory.ajustarStockSistema('fixture-tire','bodega-6',0.5),/entero|cantidad/);
  await assert.rejects(()=>inventory.moverStockSistema('fixture-tire','bodega-6','bodega-6',1),/bodegas distintas/);
  await assert.rejects(()=>inventory.moverStockSistema('fixture-tire','bodega-99','bodega-6',1),/bodega/i);
});

test('inventory rejects unknown or inconsistent allocation instead of inventing a warehouse',()=>{
  for(const stock_por_bodega of [null,undefined,[],{'bodega-6':2},{'bodega-99':3},{'bodega-6':-1}])assert.throws(()=>stockDeFila({stock:3,stock_por_bodega}));
  const result=stockDeFila({stock:3,stock_por_bodega:{'bodega-6':1,'bodega-8':2}});
  assert.equal(result['bodega-1'],0);assert.equal(result['bodega-6'],1);assert.equal(result['bodega-8'],2);
  assert.equal(Object.values(result).reduce((a,b)=>a+b,0),3);
});

test('tire presentation preserves the original receipt date and optional unknown fields',()=>{
  const source={id:'fixture-tire',marca:'A',modelo:'B',medida:'205/55R16',ancho:205,perfil:55,rin:16,
    precio_compra:'70.00',precio_venta:'116.00',precio_mayorista:null,stock:3,stock_por_bodega:{'bodega-6':3},
    proveedor:'COMERCIALIZADORA DE NEW TIRES',fecha_recepcion:'2026-10-11',fecha_recepcion_original:'2026-10-11T04:20:00.000Z',
    tipo_usada:null,vida:null,publicada:null,activo:true,created_at:null,updated_at:null};
  const original=structuredClone(source),result=adaptarLlanta(source);
  assert.equal(result.fechaRecepcion,source.fecha_recepcion_original);
  assert.equal(result.precioMayorista,undefined);assert.equal(result.tipoUsada,undefined);
  assert.equal(result.stockPorBodega['bodega-6'],3);assert.deepEqual(source,original);
});

const historical=(partidas)=>({id:'fixture-sale',folio:'V-0001',cliente_nombre:'Offline fixture',cliente_telefono:null,
  subtotal:'200.00',iva:'0.00',total:'200.00',iva_politica:null,metodo_pago:'efectivo',fecha_venta:'2026-10-11 10:00:00',
  ticket_generado:true,facturada:false,factura_uuid:null,garantia_activa:false,garantia_dias:null,
  cancelada:false,partidas});
const line=(changes={})=>({tipo:'servicio',servicio_id:'fixture-service',servicio_nombre:'Recorded service',producto_id:null,
  cantidad:1,precio_unitario:'200.00',subtotal:'200.00',costo_unitario:null,costo_subtotal:null,...changes});

test('historical zero IVA remains zero and unknown costs are not fabricated',()=>{
  const source=historical([line()]),original=structuredClone(source),result=sales.adaptarVenta(source);
  assert.equal(result.subtotal,200);assert.equal(result.iva,0);assert.equal(result.total,200);assert.equal(result.ivaPolitica,null);
  assert.equal(result.items[0].costoUnitario,undefined);assert.equal(result.items[0].costoSubtotal,undefined);
  assert.equal(result.factura,undefined);assert.equal(result.garantia.id,undefined);assert.deepEqual(source,original);
});

test('catalog and extra references survive normalization, including the published legacy encoding',()=>{
  const result=sales.adaptarVenta(historical([
    line({tipo:'catalogo',producto_id:'product-a',servicio_id:null}),
    line({tipo:'servicio',producto_id:null,servicio_id:'producto-product-b'}),
    line({tipo:'extra',servicio_id:null,servicio_nombre:'Recorded extra'}),
  ]));
  assert.deepEqual(result.items.map(i=>[i.tipoOriginal,i.productoId]),[['catalogo','product-a'],['servicio','product-b'],['extra',undefined]]);
  assert.equal(result.items[2].servicioNombre,'Recorded extra');
});

test('migration read-only marker and source document are preserved verbatim',()=>{
  const raw='{"iva":0,"source":"archived original","unknown":null}';
  const result=sales.adaptarVenta({...historical([line()]),solo_lectura_migrada:true,datos_originales_json:raw});
  assert.equal(result.soloLecturaMigrada,true);assert.equal(result.datosOriginalesJson,raw);
  assert.deepEqual(result.datosOriginales,JSON.parse(raw));
});
