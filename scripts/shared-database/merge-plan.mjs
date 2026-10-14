import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const providerKey = value => value?.trim().replace(/\s+/g, ' ').toUpperCase() || null;
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  // Compare equivalent PostgreSQL/ISO timestamps without discarding microseconds.
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    const micros = ((value.match(/\.(\d+)/)?.[1] || '') + '000000').slice(0, 6);
    return String(BigInt(new Date(value).getTime()) * 1000n + BigInt(micros.slice(3)));
  }
  return value;
}
const equivalent = (left, right, label) => assert.deepEqual(stable(left), stable(right), label);
const rows = (source, table) => (source[table] || []).map(raw => JSON.parse(raw));
function keyed(values, key = 'id') {
  const result = new Map();
  for (const row of values) { assert.ok(row[key] !== undefined); assert.ok(!result.has(row[key]), 'Duplicate original identity'); result.set(row[key], row); }
  return result;
}
function requireNonNull(row, keys) {
  for (const key of keys) assert.ok(row[key] !== null && row[key] !== undefined, 'Unknown required original field: ' + key);
  return row;
}
function mapWhiteItem(item) {
  if (item.original_item) return item.original_item;
  const mapped = {
    tipo: item.tipo, cantidad: item.cantidad, precioUnitario: item.precio_unitario,
    subtotal: item.subtotal, costoUnitario: item.costo_unitario,
    costoSubtotal: item.costo_subtotal, costoEstado: item.costo_unitario === null ? 'desconocido' : 'registrado',
    sourceItemId: String(item.id),
  };
  if (item.llanta_id !== null) Object.assign(mapped, { llantaId: item.llanta_id, bodegaId: item.bodega_id,
    llantaSnapshot: { marca: item.llanta_marca_snapshot, modelo: item.llanta_modelo_snapshot, medida: item.llanta_medida_snapshot } });
  if (item.servicio_id !== null || item.tipo === 'servicio') Object.assign(mapped, { servicioId: item.servicio_id, servicioNombre: item.servicio_nombre });
  if (item.producto_id !== null) Object.assign(mapped, { productoId: item.producto_id });
  if (item.codigo_auxiliar !== null) mapped.codigoAuxiliar = item.codigo_auxiliar;
  return mapped;
}
function mapWhiteSale(sale, items) {
  const facturaFields = ['uuid','serie','folio','fecha_timbrado','url_pdf','url_xml'];
  const factura = sale.factura_original ?? (facturaFields.some(k => sale['factura_' + k] !== null)
    ? { uuid: sale.factura_uuid, serie: sale.factura_serie, folio: sale.factura_folio, fechaTimbrado: sale.factura_fecha_timbrado, urlPdf: sale.factura_url_pdf, urlXml: sale.factura_url_xml } : null);
  return requireNonNull({
    id: sale.id, folio: sale.folio,
    cliente: sale.cliente_original ?? { nombre: sale.cliente_nombre, telefono: sale.cliente_telefono },
    items: items.map(mapWhiteItem), subtotal: sale.subtotal, iva: sale.iva, total: sale.total,
    metodoPago: sale.metodo_pago, fechaVenta: sale.fecha_venta, ticketGenerado: sale.ticket_generado,
    facturada: sale.facturada, factura,
    garantia: sale.garantia_original ?? { activa: sale.garantia_activa, id: sale.garantia_id, fechaInicio: sale.garantia_fecha_inicio,
      fechaFin: sale.garantia_fecha_fin, diasGarantia: sale.garantia_dias, condiciones: sale.garantia_condiciones },
    createdAt: sale.created_at, updatedAt: sale.updated_at, cancelada: sale.cancelada, motivoCancelacion: sale.motivo_cancelacion,
    dominio: sale.dominio ?? 'general', origen_app: 'blanca', iva_politica: sale.iva_politica,
    imported_read_only: false, request_id: null, request_hash: null,
  }, ['id','folio','cliente','items','subtotal','iva','total','metodoPago','fechaVenta','ticketGenerado','facturada','garantia','createdAt','updatedAt','cancelada','dominio']);
}

/** Pure, offline reconciliation. It cannot connect to or modify any database. */
export function buildMergePlan(black, white) {
  const originalRows = [];
  for (const [label, source] of [['negra', black], ['blanca', white]]) {
    for (const [table, entries] of Object.entries(source)) entries.forEach((raw, index) => {
      originalRows.push({ source_label: label, table_name: table, row_index: index, raw_text: raw, sha256: sha256(raw) });
    });
  }
  const imported = keyed(rows(white, 'migration_new_tires.imported_sales'), 'sale_id');
  const evidence = rows(white, 'migration_new_tires.source_rows');
  const evidenceFor = table => evidence.filter(row => row.dataset === 'new_tires' && row.source_table === table).map(row => row.row_data);
  const originalBlackSales = keyed(rows(black, 'migration_control.archived_sales'), 'sale_id');
  const ivaDecisions = keyed(evidenceFor('migration_control.sale_iva_adjustments'), 'sale_id');
  const authorizedSales = keyed(evidenceFor('public.ventas'));
  const whiteSales = keyed(rows(white, 'public.ventas'));
  const blackSales = keyed(rows(black, 'public.ventas'));
  const whiteItems = rows(white, 'public.venta_items');
  const itemsBySale = new Map();
  for (const item of whiteItems) {
    assert.ok(whiteSales.has(item.venta_id), 'Orphan white line');
    const list = itemsBySale.get(item.venta_id) || []; list.push(item); itemsBySale.set(item.venta_id, list);
  }
  for (const list of itemsBySale.values()) list.sort((a,b) => (a.orden ?? Number(a.id)) - (b.orden ?? Number(b.id)));
  const canonicalSales = [];
  const adjustments = [];
  const entityMap = [];
  const map = (label, table, id, decision) => entityMap.push({source_label: label, source_table: table, source_id: String(id), target_table: table, target_id: String(id), decision});
  for (const sale of blackSales.values()) {
    let canonical = { ...sale, origen_app: 'negra', iva_politica: null, imported_read_only: false, request_id: null, request_hash: null };
    if (whiteSales.has(sale.id)) {
      assert.ok(imported.has(sale.id), 'Independent sales share an ID: manual reconciliation required');
      const original = originalBlackSales.get(sale.id)?.original_row;
      const decision = ivaDecisions.get(sale.id);
      const authorized = authorizedSales.get(sale.id);
      assert.ok(original && decision && authorized, 'Missing baseline or IVA authorization evidence');
      equivalent(sale, original, 'Black shared sale changed since archived baseline: ' + sale.id);
      equivalent(decision.before_row, original, 'IVA before-state differs from authentic sale');
      equivalent(decision.after_row, authorized, 'IVA after-state differs from migration evidence');
      const whiteSale = whiteSales.get(sale.id);
      for (const key of ['subtotal','iva','total']) assert.equal(whiteSale[key], authorized[key], 'White IVA values changed');
      const lineItems = itemsBySale.get(sale.id) || [];
      assert.equal(lineItems.length, authorized.items.length, 'Missing migrated sale lines');
      lineItems.forEach((item, index) => {
        equivalent(item.original_item, authorized.items[index], 'Migrated original line changed');
        for (const [normalized, legacy] of [['cantidad','cantidad'],['precio_unitario','precioUnitario'],['subtotal','subtotal']])
          assert.equal(Number(item[normalized]), Number(authorized.items[index][legacy]), 'Normalized line amount changed');
      });
      for (const [normalized, legacy] of [['cliente_original','cliente'],['garantia_original','garantia'],['factura_original','factura']])
        equivalent(whiteSale[normalized], authorized[legacy], 'Original document changed');
      for (const [normalized, legacy] of [['folio','folio'],['metodo_pago','metodoPago'],['fecha_venta','fechaVenta'],['cancelada','cancelada'],['facturada','facturada'],['motivo_cancelacion','motivoCancelacion']])
        equivalent(whiteSale[normalized], authorized[legacy], 'Document state changed');
      assert.equal(authorized.total, sale.total, 'IVA adjustment must preserve amount charged');
      // Keep the black document exactly as recorded. The white app reads its
      // previously recorded fiscal values from immutable sale_originals; neither
      // historical policy is allowed to overwrite the other during consolidation.
      canonical = { ...canonical, imported_read_only: true };
      adjustments.push({id: sale.id, negra: {subtotal: sale.subtotal, iva: sale.iva, total: sale.total}, blanca: {subtotal: whiteSale.subtotal, iva: whiteSale.iva, total: whiteSale.total}, decision: 'preserve-each-recorded-policy', evidence: 'both originals retained in shared_archive.sale_originals'});
      map('blanca','public.ventas',sale.id,'same original identity; preserve authorized IVA version');
    }
    canonicalSales.push(canonical); map('negra','public.ventas',sale.id,'primary original identity');
  }
  for (const sale of whiteSales.values()) if (!blackSales.has(sale.id)) {
    assert.ok(!imported.has(sale.id), 'Previously shared document is missing from black source');
    canonicalSales.push(mapWhiteSale(sale, itemsBySale.get(sale.id) || []));
    map('blanca','public.ventas',sale.id,'independent white sale; unchanged recorded money and state');
  }
  for (const id of imported.keys()) assert.ok(blackSales.has(id) && whiteSales.has(id), 'Incomplete shared history');

  const blackTires = keyed(rows(black,'public.llantas'));
  const whiteTires = rows(white,'public.llantas');
  const historicalTires = keyed(evidenceFor('public.llantas'));
  const catalog = {
    'public.llantas': [...blackTires.values()].map(row => ({...row,origen_app:'negra'})),
    'public.productos': rows(black,'public.productos').map(row => ({...row,origen_app:'negra'})),
    'public.servicios': rows(black,'public.servicios').map(row => ({...row,origen_app:'negra'})),
  };
  for (const tire of whiteTires) {
    assert.ok(blackTires.has(tire.id) && historicalTires.has(tire.id), 'Unreviewed white-only tire or ID collision');
    const baseline = historicalTires.get(tire.id);
    for (const [normalized, legacy] of [['marca','marca'],['modelo','modelo'],['medida','medida'],['precio_compra','precioCompra'],['precio_venta','precioVenta'],['precio_mayorista','precioMayorista'],['stock_por_bodega','stockPorBodega'],['proveedor','proveedor'],['activo','activo']])
      equivalent(tire[normalized], baseline[legacy], 'Historical white tire changed: ' + tire.id);
    map('blanca','public.llantas',tire.id,'historical replica; current primary stock wins, never sum copies');
  }
  for (const row of catalog['public.llantas']) map('negra','public.llantas',row.id,'current primary inventory');
  for (const [table, converted] of [
    ['public.productos',rows(white,'public.productos').map(p => ({ id:p.id,nombre:p.nombre,descripcion:p.descripcion,stock:p.stock,activo:p.activo,createdAt:p.created_at,updatedAt:p.updated_at,precioCompra:p.precio_compra,precioVenta:p.precio,imagen:null,imagen_id:null,origen_app:'blanca' }))],
    ['public.servicios',rows(white,'public.servicios').map(s => ({ id:s.id,nombre:s.nombre,descripcion:s.descripcion,precioDefault:s.precio_default,codigoBarras:s.codigo_barras,activo:s.activo,createdAt:s.created_at,updatedAt:s.updated_at,origen_app:'blanca' }))],
  ]) {
    const primary = keyed(catalog[table]);
    for (const row of primary.values()) map('negra',table,row.id,'original primary catalogue entry');
    for (const row of converted) {
      assert.ok(!primary.has(row.id), 'Catalogue identity collision requires review');
      requireNonNull(row,['id','nombre','activo','createdAt','updatedAt']);
      catalog[table].push(row); map('blanca',table,row.id,'independent white catalogue entry; preserve NULL cost');
    }
  }
  const movements = rows(black,'public.movimientos_bodega');
  const movementMap = keyed(movements);
  for (const item of rows(white,'public.movimientos_bodega')) {
    const mapped={ id:item.id,llantaId:item.llanta_id,bodegaOrigen:item.bodega_origen,bodegaDestino:item.bodega_destino,cantidad:item.cantidad,fecha:item.fecha,dominio:item.dominio };
    assert.ok(movementMap.has(item.id), 'White-only movement requires explicit reconciliation');
    equivalent(mapped,movementMap.get(item.id),'Movement copies conflict');
    assert.ok(item.tipo===null && item.motivo===null && item.venta_id===null, 'Additional white movement data requires reconciliation');
    map('blanca','public.movimientos_bodega',item.id,'same original movement, retain once');
  }
  movements.forEach(row=>map('negra','public.movimientos_bodega',row.id,'original movement'));
  const productSales=rows(black,'public.ventas_productos').map(row=>({...row,origen_app:'negra',iva_politica:null,imported_read_only:true,request_id:null,request_hash:null}));
  const allIds=new Set(); const allFolios=new Set();
  for (const sale of [...canonicalSales,...productSales]) {
    assert.ok(!allIds.has(sale.id),'Sales ID collision across modules'); allIds.add(sale.id);
    assert.ok(!allFolios.has(sale.folio),'Folio collision requires review'); allFolios.add(sale.folio);
  }
  const journals=rows(white,'public.shared_stock_operations');
  assert.equal(rows(black,'multi_inventory.stock_operations').filter(row=>!['committed','released'].includes(row.status)).length,0,'Pending central stock operations');
  const operations=[];
  for(const op of journals) {
    assert.ok(['committed','released'].includes(op.status),'Pending white stock operation must be reconciled before cutover');
    assert.equal(op.payload.length,0,'A tire reservation requires explicit transition reconciliation');
    if(op.status==='committed') {
      const sale=canonicalSales.find(row=>row.id===op.sale_id);
      assert.ok(sale && sale.origen_app==='blanca','Operation sale missing or owned by another source');
      sale.request_id=op.id; sale.request_hash=op.request_hash;
    }
    operations.push({ id:op.id,request_hash:op.request_hash,application:'blanca',status:op.status,sale_kind:op.sale_id?'ventas':null,sale_id:op.sale_id,created_at:op.created_at,updated_at:op.updated_at });
  }
  const scopes=[];
  const archivedTires=keyed(rows(black,'migration_control.archived_llantas').map(row=>row.original_row));
  const contextTires=keyed(rows(white,'migration_new_tires.context_tires').map(row=>row.original_row));
  for(const [kind,sales] of [['ventas',canonicalSales],['ventas_productos',productSales]]) for(const sale of sales) sale.items.forEach((item,index)=>{
    let provider=null, proof='not-a-tire';
    if(Object.hasOwn(item,'proveedorSnapshot')) {provider=item.proveedorSnapshot;proof='sale-snapshot';}
    else if(item.llantaSnapshot && Object.hasOwn(item.llantaSnapshot,'proveedor')) {provider=item.llantaSnapshot.proveedor;proof='sale-snapshot';}
    else if(item.llantaId) {
      const archived=archivedTires.get(item.llantaId)||contextTires.get(item.llantaId);
      const tire=archived||blackTires.get(item.llantaId);
      assert.ok(tire,'No evidence for historical tire'); provider=tire.proveedor;
      proof=archived?'archived-supplier-at-prior-migration':'supplier-in-current-source-snapshot';
    }
    scopes.push({sale_kind:kind,sale_id:sale.id,item_index:index,provider,provider_key:providerKey(provider),evidence:proof});
  });
  const saleOriginals=[];
  for (const [label,source] of [['negra',black],['blanca',white]]) for(const table of ['public.ventas','public.ventas_productos']) for(const raw of source[table]||[]) {
    const sale=JSON.parse(raw);
    const document=label==='blanca'?JSON.stringify({sale,items:itemsBySale.get(sale.id)||[]}):raw;
    saleOriginals.push({sale_kind:table.slice(7),sale_id:sale.id,source_label:label,document_text:document,sha256:sha256(document)});
  }
  const metadata=keyed(rows(black,'public.app_metadata'),'key');
  for(const source of rows(white,'public.app_metadata')) {
    const key=source.key==='ventas_seq'?'general_ventas_seq':source.key;
    const existing=metadata.get(key);
    if(!existing) metadata.set(key,{key,value:source.value,updatedAt:source.updated_at});
    else {
      const value={...existing.value};
      for(const [counter,n] of Object.entries(source.value)) {
        assert.ok(Number.isSafeInteger(n)&&n>=0,'Unknown metadata merge rule');
        value[counter]=Math.max(value[counter]||0,n);
      }
      metadata.set(key,{...existing,value});
    }
  }
  const tables={...catalog,'public.ventas':canonicalSales,'public.ventas_productos':productSales,'public.movimientos_bodega':movements,'public.producto_imagenes':rows(black,'public.producto_imagenes'),'public.bodegas':rows(white,'public.bodegas'),'public.app_metadata':[...metadata.values()]};
  const summary={counts:Object.fromEntries(Object.entries(tables).map(([table,value])=>[table,value.length])), sharedSales:imported.size, sharedTires:whiteTires.length,
    whiteVisibleSales:canonicalSales.filter(s=>!s.items.some(item=>item.llantaId)||scopes.some(p=>p.sale_kind==='ventas'&&p.sale_id===s.id&&p.provider_key==='COMERCIALIZADORA DE NEW TIRES')).length,
    archivedRows:originalRows.length, stockAuthority:'negra', preservesInactive:true, preservesUnknownCosts:true, pendingOperations:0};
  return {version:1,summary,tables,adjustments,scopes,operations,originalRows,saleOriginals,entityMap};
}
