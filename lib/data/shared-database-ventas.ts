import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db, transaction } from '@/lib/db';
import type { Venta, VentaInput, VentaItem, FacturaInfo, BodegaId } from '@/types';
import { CONFIG } from '@/lib/config';
import { SISTEMA_CONFIG, generarCodigoAuxiliar } from '@/lib/config-sistema';
import { generateId, getMexicoDateString } from '@/lib/utils/formatters';
import { calcularImportePartida, calcularImportesVenta } from '@/lib/utils/iva';
import { validarBodega, validarCantidad } from './validation';
import { validarTexto } from './normalizado';
import { NEW_TIRES, nextFolio, originalSaleJson, providerKey, saleScopeSql, tireScopeSql } from './shared-database';
import type { SharedTire, SharedProduct, SharedService } from './shared-database-catalog';
import { whiteSaleBelongsToCurrentHistory, whiteSalesHistoryPredicate, whiteSalesHistoryReset } from './white-sales-history';

export type SaleKind = 'ventas' | 'ventas_productos';
type RawItem = Record<string, unknown> & { llantaSnapshot?: Record<string, unknown> };
export interface SharedSaleRow {
  id: string; folio: string; cliente: Venta['cliente'] | string; items: RawItem[];
  subtotal: number; iva: number; total: number; metodoPago: Venta['metodoPago'];
  fechaVenta?: string; fecha?: string; ticketGenerado?: boolean; facturada?: boolean;
  factura?: Venta['factura']; garantia?: Venta['garantia']; createdAt?: string; updatedAt?: string;
  cancelada?: boolean; motivoCancelacion?: string; origen_app: string; iva_politica?: 'incluido_16' | null;
  imported_read_only?: boolean; new_tires_indexes: number[]; raw_document: string;
  white_original_document?: string | null; white_original_sha256?: string | null;
}
function numeric(value: unknown, field: string): number {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) throw new Error(`La partida no tiene ${field} verificable.`);
  return Number(value);
}
/** Read the white system's authentic historical fiscal record without changing the canonical sale. */
function historicalWhiteAmounts(row: SharedSaleRow): Pick<Venta, 'subtotal' | 'iva' | 'total' | 'ivaPolitica'> {
  const canonical = { subtotal: Number(row.subtotal), iva: Number(row.iva), total: Number(row.total), ivaPolitica: row.iva_politica };
  if (!row.imported_read_only || row.origen_app !== 'negra' || row.white_original_document == null) return canonical;
  const document = row.white_original_document;
  if (createHash('sha256').update(document).digest('hex') !== row.white_original_sha256) {
    throw new Error('El archivo fiscal histórico de la aplicación blanca no supera la verificación de integridad.');
  }
  const source = (JSON.parse(document) as { sale?: Record<string, unknown> }).sale;
  if (!source || source.id !== row.id || source.folio !== row.folio) throw new Error('El archivo fiscal histórico no corresponde a esta venta.');
  function storedCents(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('El archivo fiscal histórico contiene un importe inválido.');
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(value - cents / 100) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4) {
      throw new Error('El archivo fiscal histórico contiene un importe sin precisión verificable.');
    }
    return cents;
  }
  const subtotal = storedCents(source.subtotal), iva = storedCents(source.iva), total = storedCents(source.total);
  if (subtotal + iva !== total || total !== storedCents(canonical.total)) {
    throw new Error('Los importes fiscales históricos no conservan el total de la venta.');
  }
  if (source.iva_politica !== null && source.iva_politica !== undefined && source.iva_politica !== 'incluido_16') {
    throw new Error('La política fiscal histórica registrada no es compatible.');
  }
  // Never infer a tax rate or recompute stored amounts. Different historical IVA
  // presentations share the same sale identity, lines, inventory and total charged.
  return { subtotal: source.subtotal as number, iva: source.iva as number, total: source.total as number,
    ivaPolitica: source.iva_politica as Venta['ivaPolitica'] };
}
/** Preserve the whole document. Scope classifies lines; it never removes them. */
export function adaptSharedSale(row: SharedSaleRow, kind: SaleKind): Venta {
  const classified = new Set(row.new_tires_indexes ?? []);
  const items = row.items.map((item, index): VentaItem => {
    const quantity = numeric(item.cantidad, 'cantidad');
    const price = numeric(item.precioUnitario, 'precio');
    const amount = item.subtotal == null ? calcularImportePartida(price, quantity) : numeric(item.subtotal, 'importe');
    const common = { cantidad: quantity, precioUnitario: price, subtotal: amount,
      ...(item.costoUnitario == null ? {} : { costoUnitario: Number(item.costoUnitario) }),
      ...(item.costoSubtotal == null ? {} : { costoSubtotal: Number(item.costoSubtotal) }),
      esNewTires: classified.has(index), proveedorSnapshot: typeof item.proveedorSnapshot === 'string' ? item.proveedorSnapshot : null };
    if (typeof item.llantaId === 'string' && item.llantaId) return { ...common, tipo: 'producto', tipoOriginal: 'producto',
      llantaId: item.llantaId, bodega: (item.bodega ?? '') as BodegaId | '', llantaSnapshot: {
        marca: String(item.llantaSnapshot?.marca ?? ''), modelo: String(item.llantaSnapshot?.modelo ?? ''), medida: String(item.llantaSnapshot?.medida ?? ''),
        ...(item.llantaSnapshot?.codigoAuxiliar == null ? {} : { codigoAuxiliar: String(item.llantaSnapshot.codigoAuxiliar) }) } };
    const catalog = typeof item.productoId === 'string' && !!item.productoId;
    return { ...common, tipo: 'servicio', tipoOriginal: catalog ? 'catalogo' : item.tipoOriginal === 'extra' || item.tipo === 'extra' ? 'extra' : 'servicio',
      servicioId: String(item.servicioId ?? ''), servicioNombre: String(item.servicioNombre ?? item.nombre ?? ''),
      ...(catalog ? { productoId: String(item.productoId) } : {}) };
  });
  const date = row.fechaVenta ?? row.fecha;
  if (!date) throw new Error('La venta no tiene fecha registrada.');
  return { id: row.id, folio: row.folio, cliente: typeof row.cliente === 'string' ? { nombre: row.cliente } : row.cliente,
    items, ...historicalWhiteAmounts(row),
    metodoPago: row.metodoPago, fechaVenta: date, ticketGenerado: row.ticketGenerado === true, facturada: row.facturada === true,
    ...(row.factura ? { factura: row.factura } : {}), garantia: row.garantia ?? { activa: false, fechaInicio: '', fechaFin: '', diasGarantia: 0, condiciones: '' },
    cancelada: row.cancelada === true, motivoCancelacion: row.motivoCancelacion ?? undefined, createdAt: row.createdAt ?? date, updatedAt: row.updatedAt ?? date,
    soloLecturaMigrada: row.imported_read_only === true || (kind === 'ventas_productos' && typeof row.cancelada !== 'boolean'),
    datosOriginalesJson: row.raw_document, datosOriginales: JSON.parse(row.raw_document), storageKind: kind };
}
function selectSql(kind: SaleKind): string {
  return `SELECT v.*,row_to_json(v)::text AS raw_document,
    fiscal.document_text AS white_original_document,fiscal.sha256 AS white_original_sha256,
    coalesce((SELECT array_agg(item_index ORDER BY item_index) FROM shared_runtime.sale_item_scope s
      WHERE s.sale_kind='${kind}' AND s.sale_id=v.id AND s.provider_key='${NEW_TIRES}'),ARRAY[]::integer[]) AS new_tires_indexes
    FROM public.${kind} v LEFT JOIN shared_archive.sale_originals fiscal
      ON fiscal.sale_kind='${kind}' AND fiscal.sale_id=v.id AND fiscal.source_label='blanca'
      AND v.imported_read_only=true AND v.origen_app='negra'`;
}
export async function sharedSales(filters?: { fechaInicio?: string; fechaFin?: string; incluirCanceladas?: boolean }): Promise<Venta[]> {
  const historyReset = whiteSalesHistoryReset();
  const all: Venta[] = [];
  for (const kind of ['ventas', 'ventas_productos'] as const) {
    const date = kind === 'ventas' ? 'v."fechaVenta"' : 'v.fecha';
    let sql = `${selectSql(kind)} WHERE ${kind === 'ventas' ? saleScopeSql : 'true'}`;
    const params: unknown[] = [];
    sql += ` AND ${whiteSalesHistoryPredicate(kind, params, historyReset)}`;
    // JSON access also handles historical product-sales schemas without a cancel column.
    if (!filters?.incluirCanceladas) sql += ` AND coalesce((to_jsonb(v)->>'cancelada')::boolean,false)=false`;
    if (filters?.fechaInicio) { params.push(filters.fechaInicio); sql += ` AND ${date}>=$${params.length}::timestamptz`; }
    if (filters?.fechaFin) { params.push(filters.fechaFin); sql += /^\d{4}-\d{2}-\d{2}$/.test(filters.fechaFin)
      ? ` AND ${date}<($${params.length}::date+INTERVAL '1 day')` : ` AND ${date}<=$${params.length}::timestamptz`; }
    all.push(...(await db.query<SharedSaleRow>(sql, params)).rows.map(r => adaptSharedSale(r, kind)));
  }
  return all.sort((a, b) => Date.parse(b.fechaVenta) - Date.parse(a.fechaVenta) || b.id.localeCompare(a.id));
}
export async function sharedFindSale(value: string, by: 'id' | 'folio' | 'garantia' = 'id', client?: PoolClient): Promise<Venta | null> {
  const historyReset = whiteSalesHistoryReset();
  const found: Venta[] = [];
  const query = client ? client.query.bind(client) : db.query.bind(db);
  for (const kind of ['ventas', 'ventas_productos'] as const) {
    if (by === 'garantia' && kind !== 'ventas') continue;
    const condition = by === 'garantia' ? `upper(v.garantia->>'id')=upper($1)` : `v.${by}=$1`;
    const params: unknown[] = [value];
    const visibility = whiteSalesHistoryPredicate(kind, params, historyReset);
    const result = await query(`${selectSql(kind)} WHERE ${condition} AND ${kind === 'ventas' ? saleScopeSql : 'true'} AND ${visibility}`, params);
    found.push(...(result.rows as SharedSaleRow[]).map(row => adaptSharedSale(row, kind)));
  }
  if (found.length > 1) throw new Error('La referencia coincide con más de un documento; se requiere su módulo de origen.');
  const sale = found[0];
  if (sale && !client && sale.soloLecturaMigrada) {
    const original = await originalSaleJson(sale.storageKind!, sale.id);
    if (original) { sale.datosOriginalesJson = original; sale.datosOriginales = JSON.parse(original); }
  }
  return sale ?? null;
}
/** Internal acknowledgement lookup, never used by public ticket/history routes.
 * A reset changes presentation, not the durable outcome of an earlier request.
 * The caller first proves the white origin and matching request hash. Use the
 * recorded module as well as ID so a collision in the other table is harmless.
 */
async function committedSale(client: PoolClient, kind: SaleKind | null, id: string): Promise<Venta | null> {
  if (kind !== 'ventas' && kind !== 'ventas_productos') throw new Error('La operación confirmada no identifica su módulo de origen.');
  const result = await client.query<SharedSaleRow>(`${selectSql(kind)} WHERE v.id=$1`, [id]);
  if (result.rows.length > 1) throw new Error('La operación confirmada tiene más de un documento.');
  const row = result.rows[0];
  if (!row) return null;
  if (row.origen_app !== 'blanca') throw new Error('La operación confirmada corresponde a otra aplicación.');
  const sale = adaptSharedSale(row, kind);
  if (!whiteSaleBelongsToCurrentHistory(kind, id, row.origen_app)) sale.fueraDelHistorialActual = true;
  return sale;
}
export async function sharedWarranties(): Promise<Venta[]> {
  const today = getMexicoDateString();
  return (await sharedSales()).filter(v => v.garantia.activa && v.garantia.fechaFin >= today).sort((a, b) => a.garantia.fechaFin.localeCompare(b.garantia.fechaFin));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sharedSaleRequestHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
interface Operation { id: string; request_hash: string; status: 'committed' | 'released'; sale_kind: SaleKind | null; sale_id: string | null; application: string }
interface ExistingRequest { id: string; kind: SaleKind; request_hash: string; origen_app: string }
export class SharedDatabaseReleasedError extends Error { readonly operationStatus = 'released' as const; }
function validOperation(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(id)) throw new Error('Falta el identificador estable de la venta.');
}
async function lockOperation(client: PoolClient, id: string): Promise<Operation | undefined> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`shared-sale:${id}`]);
  return (await client.query<Operation>('SELECT * FROM shared_runtime.operations WHERE id=$1', [id])).rows[0];
}
async function existingRequest(client: PoolClient, id: string): Promise<ExistingRequest | undefined> {
  const rows = (await client.query<ExistingRequest>(`SELECT id,'ventas'::text AS kind,request_hash,origen_app FROM ventas WHERE request_id=$1
    UNION ALL SELECT id,'ventas_productos'::text AS kind,request_hash,origen_app FROM ventas_productos WHERE request_id=$1`, [id])).rows;
  if (rows.length > 1) throw new Error('La operación aparece en más de un documento; requiere conciliación.');
  return rows[0];
}
async function committedResult(client: PoolClient, operationId: string, hash: string, previous: ExistingRequest): Promise<Venta> {
  if (previous.origen_app !== 'blanca' || previous.request_hash !== hash) throw new Error('Este identificador ya corresponde a otra venta.');
  const sale = await committedSale(client, previous.kind, previous.id);
  if (!sale) throw new Error('No se encuentra el documento confirmado.');
  await client.query(`INSERT INTO shared_runtime.operations(id,request_hash,application,status,sale_kind,sale_id)
    VALUES($1,$2,'blanca','committed',$3,$4) ON CONFLICT(id) DO NOTHING`, [operationId, hash, previous.kind, previous.id]);
  return sale;
}
function validateSale(input: VentaInput): void {
  validOperation(input.operacionId);
  if (input.generarFactura) throw new Error('La facturación electrónica no está integrada.');
  if (!Array.isArray(input.items) || !input.items.length) throw new Error('La venta debe contener partidas.');
  validarTexto(input.clienteNombre, 'El cliente', 200);
  if (input.clienteTelefono !== undefined) validarTexto(input.clienteTelefono, 'El teléfono', 20, false);
  if (!['efectivo', 'tarjeta', 'transferencia'].includes(input.metodoPago)) throw new Error('Método de pago inválido.');
  for (const item of input.items) {
    if (!['producto', 'catalogo', 'servicio', 'extra'].includes(item.tipo)) throw new Error('Tipo de partida inválido.');
    validarCantidad(item.cantidad);
    if (item.tipo === 'producto') validarBodega(item.bodega as BodegaId);
    if (item.precioCustom !== undefined) calcularImportePartida(item.precioCustom, item.cantidad);
    if (item.tipo === 'extra') { validarTexto(item.nombre ?? '', 'El concepto', 200); if (item.precioCustom === undefined) throw new Error('Falta el precio del concepto.'); }
    else validarTexto(item.id, 'La referencia', 50);
  }
}
export async function sharedCreateSale(input: VentaInput, domain: 'general' | 'sistema' = 'general'): Promise<Venta> {
  // Refuse an invalid runtime policy before the first business transaction.
  whiteSalesHistoryReset();
  if (!['general', 'sistema'].includes(domain)) throw new Error('Dominio de ventas inválido.');
  const request = { input, dominio: domain }; // Matches the previous recoverable-checkout journal.
  const hash = sharedSaleRequestHash(request);
  try { validateSale(input); }
  catch (error) {
    validOperation(input.operacionId);
    const id = input.operacionId;
    const released = await transaction(async client => {
      const prior = await lockOperation(client, id);
      if (prior) return prior.status === 'released';
      if (await existingRequest(client, id)) return false;
      await client.query(`INSERT INTO shared_runtime.operations(id,request_hash,application,status) VALUES($1,$2,'blanca','released')`, [id, hash]);
      return true;
    });
    if (released) throw new SharedDatabaseReleasedError(error instanceof Error ? error.message : 'Venta no válida.');
    throw error;
  }
  const idOperation = input.operacionId!;
  try { return await transaction(async client => {
    const prior = await lockOperation(client, idOperation);
    if (prior) {
      if (prior.status === 'released') throw new SharedDatabaseReleasedError('La operación anterior se canceló. Inicia una nueva venta.');
      if (prior.application !== 'blanca' || prior.request_hash !== hash) throw new Error('Este identificador ya corresponde a otra venta.');
      const sale = prior.sale_id ? await committedSale(client, prior.sale_kind, prior.sale_id) : null;
      if (!sale) throw new Error('La operación confirmada no tiene un documento verificable.');
      return sale;
    }
    const existing = await existingRequest(client, idOperation);
    if (existing) return committedResult(client, idOperation, hash, existing);
    const ids = (type: string) => [...new Set(input.items.filter(i => i.tipo === type).map(i => i.id))].sort();
    const tireIds = ids('producto'), productIds = ids('catalogo'), serviceIds = ids('servicio');
    if (tireIds.length) await client.query('SELECT id FROM llantas WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [tireIds]);
    if (productIds.length) await client.query('SELECT id FROM productos WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [productIds]);
    if (serviceIds.length) await client.query('SELECT id FROM servicios WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [serviceIds]);
    const items: Array<Record<string, unknown> & { precioUnitario: number; cantidad: number; subtotal: number }> = [];
    const saleId = generateId();
    for (const item of input.items) {
      let name = item.nombre ?? '', price = item.precioCustom, cost: number | null = null;
      let attributes: Record<string, unknown> = { tipo: 'servicio', tipoOriginal: item.tipo, servicioId: '', proveedorSnapshot: null, proveedorClave: null };
      if (item.tipo === 'producto') {
        const tire = (await client.query<SharedTire>(`SELECT * FROM llantas WHERE id=$1 AND activo=true AND ${tireScopeSql}`, [item.id])).rows[0];
        if (!tire) throw new Error('Llanta fuera del catálogo permitido o inactiva.');
        const warehouse = item.bodega!; const stock = { ...tire.stockPorBodega };
        validarCantidad(stock[warehouse], true);
        if (stock[warehouse] < item.cantidad) throw new Error('Stock insuficiente de la llanta seleccionada.');
        price ??= Number(tire.precioVenta); cost = tire.precioCompra == null ? null : Number(tire.precioCompra);
        attributes = { tipo: 'producto', tipoOriginal: 'producto', llantaId: tire.id, bodega: warehouse,
          llantaSnapshot: { marca: tire.marca, modelo: tire.modelo, medida: tire.medida, codigoAuxiliar: generarCodigoAuxiliar(tire.medida) },
          proveedorSnapshot: tire.proveedor ?? null, proveedorClave: providerKey(tire.proveedor) };
        stock[warehouse] -= item.cantidad;
        await client.query('UPDATE llantas SET "stockPorBodega"=$2::jsonb,"updatedAt"=NOW() WHERE id=$1', [tire.id, JSON.stringify(stock)]);
        await client.query(`INSERT INTO movimientos_bodega(id,"llantaId","bodegaOrigen","bodegaDestino",cantidad,fecha,dominio,tipo,venta_id)
          VALUES($1,$2,$3,NULL,$4,NOW(),'sistema','venta',$5)`, [generateId(), tire.id, warehouse, item.cantidad, saleId]);
      } else if (item.tipo === 'catalogo') {
        const product = (await client.query<SharedProduct>('SELECT * FROM productos WHERE id=$1 AND activo=true', [item.id])).rows[0];
        if (!product) throw new Error('Producto inexistente o inactivo.');
        if (Number(product.stock) < item.cantidad) throw new Error('Stock insuficiente del producto.');
        name = product.nombre; price ??= Number(product.precioVenta); cost = product.precioCompra == null ? null : Number(product.precioCompra);
        attributes = { ...attributes, tipoOriginal: 'catalogo', productoId: product.id, servicioId: `producto-${product.id}` };
        await client.query('UPDATE productos SET stock=stock-$2,"updatedAt"=NOW() WHERE id=$1', [product.id, item.cantidad]);
      } else if (item.tipo === 'servicio') {
        const service = (await client.query<SharedService>('SELECT * FROM servicios WHERE id=$1 AND activo=true', [item.id])).rows[0];
        if (!service) throw new Error('Servicio inexistente o inactivo.');
        name = service.nombre; price ??= Number(service.precioDefault); attributes.servicioId = service.id;
      }
      const unit = calcularImportePartida(price!, 1);
      items.push({ ...attributes, ...(item.tipo === 'producto' ? {} : { servicioNombre: name }), cantidad: item.cantidad,
        precioUnitario: unit, subtotal: calcularImportePartida(unit, item.cantidad), costoUnitario: cost,
        costoSubtotal: cost === null ? null : calcularImportePartida(cost, item.cantidad), costoEstado: cost === null ? 'desconocido' : 'registrado' });
    }
    const config = domain === 'sistema' ? SISTEMA_CONFIG : CONFIG;
    const days = input.sinGarantia ? 0 : input.diasGarantia ?? config.garantiaDiasPredeterminado; validarCantidad(days, true);
    const start = getMexicoDateString(), end = new Date(`${start}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + days);
    if (!Number.isFinite(end.getTime()) || end.getUTCFullYear() > 9999) throw new Error('Plazo de garantía inválido.');
    const folio = await nextFolio(client, domain === 'sistema' ? 'SI-' : 'V-');
    const warrantyId = days > 0 ? (await client.query<{ id: string }>('SELECT shared_runtime.next_warranty_id($1) AS id', [Number(start.slice(0, 4))])).rows[0].id : undefined;
    const warranty = { ...(warrantyId ? { id: warrantyId } : {}), activa: days > 0, fechaInicio: start, fechaFin: end.toISOString().slice(0, 10), diasGarantia: days,
      condiciones: input.sinGarantia ? 'Sin garantía' : input.condicionesGarantia ?? config.condicionesGarantiaPredeterminado };
    const amounts = calcularImportesVenta(items);
    await client.query(`INSERT INTO ventas(id,folio,cliente,items,subtotal,iva,total,"metodoPago","fechaVenta","ticketGenerado",facturada,garantia,cancelada,dominio,origen_app,iva_politica,request_id,request_hash)
      VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,NOW(),true,false,$9::jsonb,false,$10,'blanca','incluido_16',$11,$12)`,
    [saleId, folio, JSON.stringify({ nombre: input.clienteNombre, ...(input.clienteTelefono === undefined ? {} : { telefono: input.clienteTelefono }) }),
      JSON.stringify(items), amounts.subtotal, amounts.iva, amounts.total, input.metodoPago, JSON.stringify(warranty), domain, idOperation, hash]);
    await client.query(`INSERT INTO shared_runtime.operations(id,request_hash,application,status,sale_kind,sale_id) VALUES($1,$2,'blanca','committed','ventas',$3)`, [idOperation, hash, saleId]);
    const sale = await committedSale(client, 'ventas', saleId); if (!sale) throw new Error('No se pudo recuperar la venta registrada.'); return sale;
  }); } catch (error) {
    if (error instanceof SharedDatabaseReleasedError) throw error;
    // A lost COMMIT acknowledgement is resolved under the same transaction lock.
    // Only a proven absence of sale and outcome permits a durable released ID.
    // A later request with that ID cannot then deduct inventory.
    let recovered: { sale?: Venta; released?: boolean };
    try {
      recovered = await transaction(async client => {
        const prior = await lockOperation(client, idOperation);
        if (prior) {
          if (prior.status === 'released') return { released: true };
          if (prior.application !== 'blanca' || prior.request_hash !== hash || !prior.sale_id) return {};
          const sale = await committedSale(client, prior.sale_kind, prior.sale_id);
          return sale ? { sale } : {};
        }
        const existing = await existingRequest(client, idOperation);
        if (existing) return existing.origen_app === 'blanca' && existing.request_hash === hash
          ? { sale: await committedResult(client, idOperation, hash, existing) } : {};
        await client.query(`INSERT INTO shared_runtime.operations(id,request_hash,application,status) VALUES($1,$2,'blanca','released')`, [idOperation, hash]);
        return { released: true };
      });
    } catch { throw error; }
    if (recovered.sale) return recovered.sale;
    if (recovered.released) throw new SharedDatabaseReleasedError(error instanceof Error ? error.message : 'No se registró la venta.');
    throw error;
  }
}
export async function sharedCancelSale(id: string, reason: string): Promise<Venta | null> {
  validarTexto(reason, 'El motivo', 10000);
  return transaction(async client => {
    const sale = await sharedFindSale(id, 'id', client); if (!sale) return null;
    const kind = sale.storageKind!;
    await client.query(`SELECT id FROM ${kind} WHERE id=$1 FOR UPDATE`, [id]);
    const current = await sharedFindSale(id, 'id', client); if (!current) return null;
    if (current.soloLecturaMigrada) throw new Error('Este documento histórico está protegido y no puede cancelarse.');
    if (current.cancelada) return current;
    if (current.facturada) throw new Error('Primero debe resolverse la cancelación fiscal de la factura.');
    const tires = current.items.filter(i => i.tipo === 'producto');
    const products = current.items.filter(i => i.tipo === 'servicio' && i.productoId);
    if (tires.length) await client.query('SELECT id FROM llantas WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [tires.map(i => i.llantaId)]);
    if (products.length) await client.query('SELECT id FROM productos WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [products.map(i => i.tipo === 'servicio' ? i.productoId : null)]);
    for (const item of tires) {
      validarCantidad(item.cantidad); validarBodega(item.bodega as BodegaId);
      const tire = (await client.query<SharedTire>('SELECT * FROM llantas WHERE id=$1', [item.llantaId])).rows[0];
      if (!tire) throw new Error('La llanta original no existe; no se ha cancelado la venta.');
      const stock = { ...tire.stockPorBodega }, warehouse = item.bodega as BodegaId;
      stock[warehouse] = (stock[warehouse] ?? 0) + item.cantidad; validarCantidad(stock[warehouse], true);
      await client.query('UPDATE llantas SET "stockPorBodega"=$2::jsonb,"updatedAt"=NOW() WHERE id=$1', [tire.id, JSON.stringify(stock)]);
      await client.query(`INSERT INTO movimientos_bodega(id,"llantaId","bodegaOrigen","bodegaDestino",cantidad,fecha,dominio,tipo,motivo,venta_id)
        VALUES($1,$2,NULL,$3,$4,NOW(),'sistema','cancelacion',$5,$6)`, [generateId(), tire.id, warehouse, item.cantidad, reason, id]);
    }
    for (const item of products) {
      if (item.tipo !== 'servicio') continue;
      const product = (await client.query<SharedProduct>('SELECT * FROM productos WHERE id=$1', [item.productoId])).rows[0];
      if (!product) throw new Error('El producto original no existe; no se ha cancelado la venta.');
      const stock = Number(product.stock) + item.cantidad; validarCantidad(stock, true);
      await client.query('UPDATE productos SET stock=$2,"updatedAt"=NOW() WHERE id=$1', [product.id, stock]);
    }
    if (kind === 'ventas') await client.query(`UPDATE ventas SET cancelada=true,"motivoCancelacion"=$2,
      garantia=CASE WHEN garantia IS NULL THEN NULL ELSE garantia||'{"activa":false}'::jsonb END,"updatedAt"=NOW() WHERE id=$1`, [id, reason]);
    else await client.query('UPDATE ventas_productos SET cancelada=true,"motivoCancelacion"=$2 WHERE id=$1', [id, reason]);
    return sharedFindSale(id, 'id', client);
  });
}
export async function sharedMarkInvoiced(id: string, info: FacturaInfo): Promise<Venta | null> {
  return transaction(async client => {
    const sale = await sharedFindSale(id, 'id', client); if (!sale) return null;
    if (sale.storageKind !== 'ventas' || sale.soloLecturaMigrada) throw new Error('Este documento histórico no puede modificarse.');
    await client.query('SELECT id FROM ventas WHERE id=$1 FOR UPDATE', [id]);
    const current = await sharedFindSale(id, 'id', client);
    if (!current || current.cancelada || current.facturada) throw new Error('La venta no admite registrar una factura.');
    validarTexto(info.uuid, 'El UUID', 100); validarTexto(info.folio, 'El folio', 50);
    if (!Number.isFinite(Date.parse(info.fechaTimbrado))) throw new Error('La fecha de factura no es válida.');
    await client.query('UPDATE ventas SET facturada=true,factura=$2::jsonb,"updatedAt"=NOW() WHERE id=$1', [id, JSON.stringify(info)]);
    return sharedFindSale(id, 'id', client);
  });
}
