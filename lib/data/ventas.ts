import type { PoolClient } from 'pg';
import { db, transaction } from '@/lib/db';
import type { Venta, VentaInput, VentaItem, VentaItemProducto, VentaItemServicio, FacturaInfo, BodegaId } from '@/types';
import { generateId, getMexicoDateString } from '@/lib/utils/formatters';
import { calcularImportePartida, calcularImportesVenta } from '@/lib/utils/iva';
import { CONFIG } from '@/lib/config';
import { SISTEMA_CONFIG, generarCodigoAuxiliar } from '@/lib/config-sistema';
import { validarBodega, validarCantidad } from './validation';
import { stockDeFila, validarTexto } from './normalizado';
import { assertCentralSupplier, type StockReservation } from '@/lib/central-inventory';
import { reconcileSharedStock, rejectUnstartedStockOperation, validateOperationId, withSharedStockSale, withSharedStockCancellation } from '@/lib/shared-stock';
import type { ProductoRow } from './productos';
import type { ServicioRow } from './servicios';

type TipoPartida = 'producto' | 'servicio' | 'catalogo' | 'extra';
export interface VentaItemRow {
  id: string | number; venta_id: string; tipo: TipoPartida;
  llanta_id: string | null; bodega_id: BodegaId | null;
  llanta_marca_snapshot: string | null; llanta_modelo_snapshot: string | null; llanta_medida_snapshot: string | null;
  servicio_id: string | null; servicio_nombre: string | null; producto_id: string | null;
  cantidad: number; precio_unitario: number; subtotal: number; costo_unitario: number | null; costo_subtotal: number | null;
  codigo_auxiliar: string | null; orden: number | null;
}
export interface VentaRow {
  id: string; folio: string; cliente_nombre: string; cliente_telefono: string | null;
  subtotal: number; iva: number; total: number; iva_politica: 'incluido_16' | null;
  metodo_pago: Venta['metodoPago']; fecha_venta: string; ticket_generado: boolean | null; facturada: boolean | null;
  factura_uuid: string | null; factura_serie: string | null; factura_folio: string | null; factura_fecha_timbrado: string | null;
  factura_url_pdf: string | null; factura_url_xml: string | null;
  garantia_id: string | null; garantia_activa: boolean | null; garantia_fecha_inicio: string | null;
  garantia_fecha_fin: string | null; garantia_dias: number | null; garantia_condiciones: string | null;
  cancelada: boolean | null; motivo_cancelacion: string | null; created_at: string | null; updated_at: string | null;
  partidas: VentaItemRow[]; solo_lectura_migrada?: boolean; datos_originales_json?: string;
}
const selectVenta = `SELECT v.*,
  COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.orden NULLS LAST,i.id) FROM venta_items i WHERE i.venta_id=v.id),'[]'::jsonb) AS partidas,
  EXISTS(SELECT 1 FROM migration_new_tires.imported_sales m WHERE m.sale_id=v.id) AS solo_lectura_migrada
  FROM ventas v`;
const selectDetalle = selectVenta.replace('SELECT v.*,', `SELECT v.*,
  jsonb_build_object('venta',to_jsonb(v),'partidas',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.orden NULLS LAST,i.id)
    FROM venta_items i WHERE i.venta_id=v.id),'[]'::jsonb))::text AS datos_originales_json,`);

/** Presentation only: nullable historical fields remain untouched in PostgreSQL. */
export function adaptarVenta(row: VentaRow): Venta {
  const items = row.partidas.map((item): VentaItem => {
    const amounts = { cantidad: Number(item.cantidad), precioUnitario: Number(item.precio_unitario), subtotal: Number(item.subtotal),
      ...(item.costo_unitario == null ? {} : { costoUnitario: Number(item.costo_unitario) }),
      ...(item.costo_subtotal == null ? {} : { costoSubtotal: Number(item.costo_subtotal) }) };
    if (item.tipo === 'producto') return { ...amounts, tipo: 'producto', tipoOriginal: item.tipo,
      llantaId: item.llanta_id ?? '', bodega: item.bodega_id ?? '',
      llantaSnapshot: { marca: item.llanta_marca_snapshot ?? '', modelo: item.llanta_modelo_snapshot ?? '',
        medida: item.llanta_medida_snapshot ?? '', ...(item.codigo_auxiliar == null ? {} : { codigoAuxiliar: item.codigo_auxiliar }) } };
    // The published backend previously encoded catalog references this way.
    const productoId = item.producto_id ?? (item.tipo === 'servicio' && item.servicio_id?.startsWith('producto-') ? item.servicio_id.slice(9) : undefined);
    return { ...amounts, tipo: 'servicio', tipoOriginal: item.tipo, servicioId: item.servicio_id ?? '',
      servicioNombre: item.servicio_nombre ?? '', ...(productoId ? { productoId } : {}) };
  });
  return {
    id: row.id, folio: row.folio, cliente: { nombre: row.cliente_nombre, ...(row.cliente_telefono == null ? {} : { telefono: row.cliente_telefono }) },
    items, subtotal: Number(row.subtotal), iva: Number(row.iva), total: Number(row.total), ivaPolitica: row.iva_politica,
    metodoPago: row.metodo_pago, fechaVenta: row.fecha_venta, ticketGenerado: row.ticket_generado === true, facturada: row.facturada === true,
    ...(row.factura_uuid == null ? {} : { factura: { uuid: row.factura_uuid, serie: row.factura_serie ?? '', folio: row.factura_folio ?? '',
      fechaTimbrado: row.factura_fecha_timbrado ?? '', urlPdf: row.factura_url_pdf ?? undefined, urlXml: row.factura_url_xml ?? undefined } }),
    garantia: { ...(row.garantia_id == null ? {} : { id: row.garantia_id }), activa: row.garantia_activa === true,
      fechaInicio: row.garantia_fecha_inicio ?? '', fechaFin: row.garantia_fecha_fin ?? '', diasGarantia: row.garantia_dias ?? 0,
      condiciones: row.garantia_condiciones ?? '' },
    cancelada: row.cancelada === true, motivoCancelacion: row.motivo_cancelacion ?? undefined,
    createdAt: row.created_at ?? '', updatedAt: row.updated_at ?? '', soloLecturaMigrada: row.solo_lectura_migrada === true,
    ...(row.datos_originales_json ? { datosOriginalesJson: row.datos_originales_json, datosOriginales: JSON.parse(row.datos_originales_json) } : {}),
  };
}
export async function obtenerVentas(filtros?: { fechaInicio?: string; fechaFin?: string; incluirCanceladas?: boolean }): Promise<Venta[]> {
  await reconcileSharedStock();
  let sql = `${selectVenta} WHERE ${filtros?.incluirCanceladas ? 'true' : 'v.cancelada IS NOT TRUE'}`;
  const params: unknown[] = [];
  if (filtros?.fechaInicio) { params.push(filtros.fechaInicio); sql += ` AND v.fecha_venta >= $${params.length}::timestamptz`; }
  if (filtros?.fechaFin) {
    params.push(filtros.fechaFin);
    sql += /^\d{4}-\d{2}-\d{2}$/.test(filtros.fechaFin)
      ? ` AND v.fecha_venta < ($${params.length}::date + INTERVAL '1 day')`
      : ` AND v.fecha_venta <= $${params.length}::timestamptz`;
  }
  return (await db.query<VentaRow>(sql + ' ORDER BY v.fecha_venta DESC,v.id', params)).rows.map(adaptarVenta);
}
async function adaptarDetalle(row: VentaRow): Promise<Venta> {
  if (row.solo_lectura_migrada) {
    // Preserve the authenticated pre-IVA document for download, independent of the live projection.
    const original = await db.query<{ original: string }>(`SELECT (row_data->'before_row')::text AS original
      FROM migration_new_tires.source_rows WHERE dataset='new_tires' AND source_table='migration_control.sale_iva_adjustments'
      AND row_data->>'sale_id'=$1`, [row.id]);
    if (original.rows[0]) row = { ...row, datos_originales_json: original.rows[0].original };
    else {
      const archived = await db.query<{ original: string }>(`SELECT row_text AS original FROM migration_new_tires.source_rows
        WHERE dataset='new_tires' AND source_table='public.ventas' AND row_data->>'id'=$1`, [row.id]);
      if (archived.rows[0]) row = { ...row, datos_originales_json: archived.rows[0].original };
    }
  }
  return adaptarVenta(row);
}
export async function obtenerVenta(id: string): Promise<Venta | null> {
  await reconcileSharedStock();
  const row = (await db.query<VentaRow>(`${selectDetalle} WHERE v.id=$1`, [id])).rows[0];
  return row ? adaptarDetalle(row) : null;
}
export async function obtenerVentaFolio(folio: string): Promise<Venta | null> {
  await reconcileSharedStock();
  const row = (await db.query<VentaRow>(`${selectDetalle} WHERE v.folio=$1`, [folio])).rows[0];
  return row ? adaptarDetalle(row) : null;
}
export async function comprobarVentaEditable(client: PoolClient, id: string): Promise<void> {
  if ((await client.query('SELECT 1 FROM migration_new_tires.imported_sales WHERE sale_id=$1', [id])).rowCount) {
    throw new Error('Esta venta es un historial migrado de solo lectura. No se puede modificar, facturar ni cancelar desde este sistema.');
  }
}
function siguienteContador(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || !Number.isSafeInteger(number + 1)) throw new Error('La secuencia de ventas o garantías no es válida.');
  return number + 1;
}
async function reservarFolio(client: PoolClient, dominio: 'general' | 'sistema', garantiaActiva: boolean, fecha: string) {
  // Stable locking order protects both counters and the shared warranty namespace.
  const rows = (await client.query<{ key: string; value: { ultimoFolio?: number; ultimoGarantiaId?: number } }>(
    "SELECT key,value FROM app_metadata WHERE key IN ('ventas_seq','sistema_ventas_seq') ORDER BY key FOR UPDATE")).rows;
  const metadata = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  if (!metadata.ventas_seq || !metadata.sistema_ventas_seq) throw new Error('Faltan las secuencias operativas verificadas.');
  const key = dominio === 'sistema' ? 'sistema_ventas_seq' : 'ventas_seq';
  const prefijo = dominio === 'sistema' ? SISTEMA_CONFIG.formatoFolio : CONFIG.formatoFolio;
  const maxima = (await client.query<{ folio: string; garantia: string }>(`SELECT
    coalesce(max(substring(folio from $1)::bigint),0)::text AS folio,
    coalesce(max(substring(garantia_id from '^GAR-[0-9]{4}-([0-9]+)$')::bigint),0)::text AS garantia FROM ventas`,
  [`^${prefijo}([0-9]+)$`])).rows[0];
  const folio = siguienteContador(Math.max(Number(metadata[key].ultimoFolio), Number(maxima.folio)));
  const garantia = garantiaActiva ? siguienteContador(Math.max(Number(metadata.sistema_ventas_seq.ultimoGarantiaId), Number(maxima.garantia))) : undefined;
  const changes: Record<string, number> = { ultimoFolio: folio };
  if (key === 'sistema_ventas_seq' && garantia !== undefined) changes.ultimoGarantiaId = garantia;
  await client.query('UPDATE app_metadata SET value=value || $1::jsonb,updated_at=NOW() WHERE key=$2', [JSON.stringify(changes), key]);
  if (key !== 'sistema_ventas_seq' && garantia !== undefined) await client.query(
    "UPDATE app_metadata SET value=value || $1::jsonb,updated_at=NOW() WHERE key='sistema_ventas_seq'", [JSON.stringify({ ultimoGarantiaId: garantia })]);
  return { folio: `${prefijo}${String(folio).padStart(4, '0')}`, garantiaId: garantia === undefined ? null : `GAR-${fecha.slice(0, 4)}-${String(garantia).padStart(4, '0')}` };
}
function bodegaPartida(bodega: BodegaId | '' | undefined): BodegaId {
  if (!bodega) throw new Error('Selecciona la bodega real de la llanta.');
  validarBodega(bodega); return bodega;
}
async function leerVenta(client: PoolClient, id: string): Promise<Venta> {
  const row = (await client.query<VentaRow>(`${selectVenta} WHERE v.id=$1`, [id])).rows[0];
  if (!row) throw new Error('No se pudo recuperar la venta registrada.');
  return adaptarVenta(row);
}
function prepareSale(input: VentaInput, dominioInterno: 'general' | 'sistema') {
  if (!['general', 'sistema'].includes(dominioInterno)) throw new Error('Dominio de ventas inválido.');
  if (input.generarFactura) throw new Error('La facturación electrónica no está integrada. Registra la venta sin generar una factura.');
  if (!Array.isArray(input.items) || !input.items.length) throw new Error('La venta debe contener al menos una partida.');
  validarTexto(input.clienteNombre, 'El nombre del cliente', 200);
  if (input.clienteTelefono !== undefined) validarTexto(input.clienteTelefono, 'El teléfono', 20, false);
  if (!['efectivo', 'tarjeta', 'transferencia'].includes(input.metodoPago)) throw new Error('Método de pago inválido.');
  for (const item of input.items) {
    if (!['producto', 'servicio', 'catalogo', 'extra'].includes(item.tipo)) throw new Error('Tipo de partida inválido.');
    validarCantidad(item.cantidad);
    if (item.precioCustom !== undefined) calcularImportePartida(item.precioCustom, item.cantidad);
    if (item.tipo === 'producto') bodegaPartida(item.bodega);
    if (item.tipo === 'extra') {
      validarTexto(item.nombre ?? '', 'El concepto adicional', 200);
      if (item.precioCustom === undefined) throw new Error('Indica el precio del concepto adicional.');
    } else validarTexto(item.id, 'La referencia de la partida', 50);
  }
  const config = dominioInterno === 'sistema' ? SISTEMA_CONFIG : CONFIG;
  const dias = input.sinGarantia ? 0 : input.diasGarantia ?? config.garantiaDiasPredeterminado;
  validarCantidad(dias, true);
  const fechaInicio = getMexicoDateString();
  const fechaFinDate = new Date(`${fechaInicio}T12:00:00Z`);
  fechaFinDate.setUTCDate(fechaFinDate.getUTCDate() + dias);
  if (!Number.isFinite(fechaFinDate.getTime()) || fechaFinDate.getUTCFullYear() > 9999) throw new Error('El plazo de garantía está fuera de rango.');
  const fechaFin = fechaFinDate.toISOString().slice(0, 10);
  const garantiaActiva = !input.sinGarantia && dias > 0;
  return { config, dias, fechaInicio, fechaFin, garantiaActiva };
}
/** dominioInterno is supplied by server wrappers, never read from submitted input. */
export async function crearVenta(input: VentaInput, dominioInterno: 'general' | 'sistema' = 'general'): Promise<Venta> {
  let prepared;
  try {
    prepared = prepareSale(input, dominioInterno);
    validateOperationId(input.operacionId);
  } catch (error) {
    return rejectUnstartedStockOperation(input?.operacionId, { input, dominio: dominioInterno }, error);
  }
  const { config, dias, fechaInicio, fechaFin, garantiaActiva } = prepared;
  const tireInput = input.items.filter((item) => item.tipo === 'producto');
  const save = async (client: PoolClient, reservation?: StockReservation) => {
    const { folio, garantiaId } = await reservarFolio(client, dominioInterno, garantiaActiva, fechaInicio);
    const productoIds = [...new Set(input.items.filter((i) => i.tipo === 'catalogo').map((i) => i.id))].sort();
    const servicioIds = [...new Set(input.items.filter((i) => i.tipo === 'servicio').map((i) => i.id))].sort();
    if (productoIds.length) await client.query('SELECT id FROM productos WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [productoIds]);
    if (servicioIds.length) await client.query('SELECT id FROM servicios WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [servicioIds]);
    const items: VentaItem[] = [];
    for (const item of input.items) {
      if (item.tipo === 'producto') {
        const llanta = reservation?.snapshots[item.id];
        if (!llanta || llanta.activo !== true) throw new Error('Llanta no encontrada o inactiva en la reserva central.');
        assertCentralSupplier(llanta);
        const bodega = bodegaPartida(item.bodega), stock = stockDeFila(llanta);
        if (stock[bodega] < item.cantidad) throw new Error(`Stock insuficiente para ${llanta.marca} ${llanta.modelo}. Disponible: ${stock[bodega]}`);
        const precioUnitario = calcularImportePartida(item.precioCustom ?? Number(llanta.precio_venta), 1);
        const costoUnitario = Number(llanta.precio_compra);
        items.push({ tipo: 'producto', tipoOriginal: 'producto', llantaId: llanta.id, bodega,
          llantaSnapshot: { marca: llanta.marca, modelo: llanta.modelo, medida: llanta.medida, codigoAuxiliar: generarCodigoAuxiliar(llanta.medida) },
          cantidad: item.cantidad, precioUnitario, subtotal: calcularImportePartida(precioUnitario, item.cantidad),
          costoUnitario, costoSubtotal: calcularImportePartida(costoUnitario, item.cantidad) });

      } else if (item.tipo === 'catalogo') {
        const producto = (await client.query<ProductoRow>('SELECT * FROM productos WHERE id=$1 AND activo=true', [item.id])).rows[0];
        if (!producto) throw new Error('Producto de catálogo no encontrado o inactivo.');
        if (Number(producto.stock) < item.cantidad) throw new Error(`Stock insuficiente de ${producto.nombre}.`);
        const precioUnitario = calcularImportePartida(item.precioCustom ?? Number(producto.precio), 1);
        items.push({ tipo: 'servicio', tipoOriginal: 'catalogo', productoId: producto.id, servicioId: '', servicioNombre: producto.nombre,
          cantidad: item.cantidad, precioUnitario, subtotal: calcularImportePartida(precioUnitario, item.cantidad),
          ...(producto.precio_compra == null ? {} : { costoUnitario: Number(producto.precio_compra), costoSubtotal: calcularImportePartida(Number(producto.precio_compra), item.cantidad) }) });
        await client.query('UPDATE productos SET stock=stock-$1,updated_at=NOW() WHERE id=$2', [item.cantidad, producto.id]);
      } else if (item.tipo === 'extra') {
        const precioUnitario = calcularImportePartida(item.precioCustom!, 1);
        items.push({ tipo: 'servicio', tipoOriginal: 'extra', servicioId: '', servicioNombre: item.nombre!, cantidad: item.cantidad,
          precioUnitario, subtotal: calcularImportePartida(precioUnitario, item.cantidad) });
      } else {
        const servicio = (await client.query<ServicioRow>('SELECT * FROM servicios WHERE id=$1 AND activo=true', [item.id])).rows[0];
        if (!servicio) throw new Error('Servicio no encontrado o inactivo.');
        const precioUnitario = calcularImportePartida(item.precioCustom ?? Number(servicio.precio_default), 1);
        items.push({ tipo: 'servicio', tipoOriginal: 'servicio', servicioId: servicio.id, servicioNombre: servicio.nombre,
          cantidad: item.cantidad, precioUnitario, subtotal: calcularImportePartida(precioUnitario, item.cantidad) });
      }
    }
    const { subtotal, iva, total } = calcularImportesVenta(items), id = generateId();
    await client.query(`INSERT INTO ventas (id,folio,cliente_nombre,cliente_telefono,subtotal,iva,total,metodo_pago,fecha_venta,
      ticket_generado,facturada,garantia_activa,garantia_fecha_inicio,garantia_fecha_fin,garantia_dias,garantia_condiciones,
      garantia_id,cancelada,dominio,iva_politica)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),true,false,$9,$10::date,$11::date,$12,$13,$14,false,$15,'incluido_16')`,
    [id, folio, input.clienteNombre, input.clienteTelefono ?? null, subtotal, iva, total, input.metodoPago, garantiaActiva,
      fechaInicio, fechaFin, dias, input.sinGarantia ? 'Sin garantía' : input.condicionesGarantia ?? config.condicionesGarantiaPredeterminado,
      garantiaId, dominioInterno]);
    if (reservation) await client.query('UPDATE public.shared_stock_operations SET sale_id=$2,updated_at=NOW() WHERE id=$1', [input.operacionId, id]);
    for (const [index, item] of items.entries()) {
      const tire = item.tipo === 'producto' ? item : null;
      const service = item.tipo === 'servicio' ? item : null;
      await client.query(`INSERT INTO venta_items (venta_id,tipo,llanta_id,bodega_id,llanta_marca_snapshot,llanta_modelo_snapshot,
        llanta_medida_snapshot,servicio_id,servicio_nombre,cantidad,precio_unitario,subtotal,costo_unitario,costo_subtotal,codigo_auxiliar,producto_id,orden,shared_stock_operation_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, item.tipoOriginal, tire?.llantaId ?? null, tire?.bodega ?? null, tire?.llantaSnapshot.marca ?? null,
        tire?.llantaSnapshot.modelo ?? null, tire?.llantaSnapshot.medida ?? null, service?.servicioId || null,
        service?.servicioNombre ?? null, item.cantidad, item.precioUnitario, item.subtotal, item.costoUnitario ?? null,
        item.costoSubtotal ?? null, tire?.llantaSnapshot.codigoAuxiliar ?? null, service?.productoId ?? null, index + 1, tire ? input.operacionId : null]);
    }
    return { saleId: id, result: await leerVenta(client, id) };
  };
  return withSharedStockSale({
    id: input.operacionId!, request: { input, dominio: dominioInterno },
    items: tireInput.map((item) => ({ id: item.id, bodega: bodegaPartida(item.bodega), cantidad: item.cantidad })),
    save, readSale: leerVenta,
  });
}
export async function cancelarVenta(id: string, motivo: string): Promise<Venta | null> {
  validarTexto(motivo, 'El motivo de cancelación', 10000);
  const shared = (await db.query<{ id: string }>('SELECT id FROM public.shared_stock_operations WHERE sale_id=$1', [id])).rows[0];
  const cancel = async (client: PoolClient) => {
    await comprobarVentaEditable(client, id);
    if (!(await client.query('SELECT id FROM ventas WHERE id=$1 FOR UPDATE', [id])).rowCount) return null;
    await comprobarVentaEditable(client, id);
    const venta = await leerVenta(client, id);
    if (venta.cancelada) return venta;
    if (venta.facturada) throw new Error('La venta está facturada. Primero debe resolverse la cancelación fiscal correspondiente.');
    const tireItems = venta.items.filter((item): item is VentaItemProducto => item.tipo === 'producto');
    const catalogItems = venta.items.filter((item): item is VentaItemServicio => item.tipo === 'servicio' && (item.tipoOriginal === 'catalogo' || !!item.productoId));
    if (tireItems.length && !shared) throw new Error('Esta venta de llantas no tiene una operación central verificable. Revisa su origen antes de cancelar.');
    const catalogIds = [...new Set(catalogItems.map((item) => item.productoId).filter((value): value is string => !!value))];
    if (catalogIds.length) await client.query('SELECT id FROM productos WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [catalogIds]);
    for (const item of catalogItems) {
      if (!item.productoId) throw new Error('La partida de catálogo no tiene una referencia verificable al producto.');
      validarCantidad(item.cantidad);
      const row = (await client.query<ProductoRow>('SELECT * FROM productos WHERE id=$1 FOR UPDATE', [item.productoId])).rows[0];
      if (!row) throw new Error('No se puede restaurar un producto de catálogo ausente.');
      const stock = Number(row.stock) + item.cantidad; validarCantidad(stock, true);
      await client.query('UPDATE productos SET stock=$1,updated_at=NOW() WHERE id=$2', [stock, item.productoId]);
    }
    await client.query('UPDATE ventas SET cancelada=true,motivo_cancelacion=$1,garantia_activa=false,updated_at=NOW() WHERE id=$2', [motivo, id]);
    if (shared) await client.query("UPDATE public.shared_stock_operations SET status='release_pending',updated_at=NOW() WHERE id=$1", [shared.id]);
    return leerVenta(client, id);
  };
  return shared ? withSharedStockCancellation(shared.id, cancel) : transaction(cancel);
}
export async function marcarFacturada(id: string, facturaInfo: FacturaInfo): Promise<Venta | null> {
  validarTexto(facturaInfo.uuid, 'El UUID de factura', 100);
  validarTexto(facturaInfo.serie, 'La serie de factura', 20, false);
  validarTexto(facturaInfo.folio, 'El folio de factura', 50);
  if (!Number.isFinite(Date.parse(facturaInfo.fechaTimbrado))) throw new Error('La fecha de timbrado no es válida.');
  return transaction(async (client) => {
    await comprobarVentaEditable(client, id);
    const current = (await client.query<{ cancelada: boolean; facturada: boolean }>('SELECT cancelada,facturada FROM ventas WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!current) return null;
    await comprobarVentaEditable(client, id);
    if (current.cancelada) throw new Error('No se puede facturar una venta cancelada.');
    if (current.facturada) throw new Error('La venta ya tiene una factura registrada.');
    await client.query(`UPDATE ventas SET facturada=true,factura_uuid=$1,factura_serie=$2,factura_folio=$3,
      factura_fecha_timbrado=$4::timestamp,factura_url_pdf=$5,factura_url_xml=$6,updated_at=NOW() WHERE id=$7`,
    [facturaInfo.uuid, facturaInfo.serie, facturaInfo.folio, facturaInfo.fechaTimbrado, facturaInfo.urlPdf ?? null, facturaInfo.urlXml ?? null, id]);
    return leerVenta(client, id);
  });
}
export async function obtenerGarantiasActivas(): Promise<Venta[]> {
  await reconcileSharedStock();
  return (await db.query<VentaRow>(`${selectVenta} WHERE v.cancelada IS NOT TRUE AND v.garantia_activa=true
    AND v.garantia_fecha_fin >= $1::date ORDER BY v.garantia_fecha_fin,v.id`, [getMexicoDateString()])).rows.map(adaptarVenta);
}
export async function obtenerUltimoFolio(): Promise<number> {
  const row = (await db.query<{ value: { ultimoFolio: number } }>("SELECT value FROM app_metadata WHERE key='ventas_seq'")).rows[0];
  if (!row) throw new Error('Falta la secuencia de folios generales.');
  return Number(row.value.ultimoFolio);
}
export async function obtenerVentaPorGarantia(garantiaId: string): Promise<Venta | null> {
  await reconcileSharedStock();
  if (!garantiaId.trim()) return null;
  const row = (await db.query<VentaRow>(`${selectDetalle} WHERE UPPER(v.garantia_id)=UPPER($1)`, [garantiaId.trim()])).rows[0];
  return row ? adaptarDetalle(row) : null;
}
