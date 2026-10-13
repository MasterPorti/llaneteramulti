import { db } from '@/lib/db';
import { sharedDatabaseEnabled } from './shared-database';
import { sharedTires, sharedTire, sharedMovements } from './shared-database-catalog';
import { centralInventory, CENTRAL_SUPPLIER, assertCentralSupplier } from '@/lib/central-inventory';
import { reconcileSharedStock } from '@/lib/shared-stock';
import type { Llanta, LlantaInput, LlantaSuggestion, BodegaId, MovimientoBodega } from '@/types';
import { getTotalStock } from '@/types';
import { generarCodigoAuxiliar } from '@/lib/config-sistema';
import { validarBodega, validarCantidad, validarProveedor } from './validation';
import { adaptarLlanta, type LlantaRow } from './normalizado';

const DOMINIO = 'sistema';
export const CENTRAL_MANAGEMENT_MESSAGE = 'Las llantas se administran exclusivamente desde Sistema Bodega, el inventario central. Abre esa aplicación para registrar o modificar existencias.';
function adaptCentral(row: LlantaRow): Llanta {
  assertCentralSupplier(row);
  return adaptarLlanta(row);
}
export async function obtenerInventarioSistema(filtros?: { incluirInactivos?: boolean }): Promise<Llanta[]> {
  if (sharedDatabaseEnabled()) return sharedTires(filtros?.incluirInactivos);
  await reconcileSharedStock();
  const result = await centralInventory.query<LlantaRow>(`SELECT * FROM multi_inventory.llantas
    WHERE dominio=$1 AND upper(regexp_replace(btrim(proveedor),'[[:space:]]+',' ','g'))=$2
    ${filtros?.incluirInactivos ? '' : 'AND activo=true'} ORDER BY created_at DESC,id`, [DOMINIO, CENTRAL_SUPPLIER]);
  return result.rows.map(adaptCentral);
}
export async function obtenerLlantaSistema(id: string, incluirInactivos = false): Promise<Llanta | null> {
  if (sharedDatabaseEnabled()) return sharedTire(id, incluirInactivos);
  await reconcileSharedStock();
  const row = (await centralInventory.query<LlantaRow>(`SELECT * FROM multi_inventory.llantas
    WHERE id=$1 AND dominio=$2 AND upper(regexp_replace(btrim(proveedor),'[[:space:]]+',' ','g'))=$3
    ${incluirInactivos ? '' : 'AND activo=true'}`, [id, DOMINIO, CENTRAL_SUPPLIER])).rows[0];
  return row ? adaptCentral(row) : null;
}
export async function buscarLlantasSistema(termino: string): Promise<LlantaSuggestion[]> {
  const term = termino.trim().toLocaleLowerCase('es-MX');
  return (await obtenerInventarioSistema()).filter((llanta) => [llanta.marca, llanta.modelo, llanta.medida, llanta.proveedor,
    `${llanta.marca} ${llanta.modelo}`, generarCodigoAuxiliar(llanta.medida)]
    .some((value) => (value || '').toLocaleLowerCase('es-MX').includes(term))).slice(0, 10).map((llanta) => ({
      id: llanta.id, marca: llanta.marca, modelo: llanta.modelo, medida: llanta.medida, stockTotal: getTotalStock(llanta),
      precioVenta: llanta.precioVenta, displayText: `${llanta.marca} ${llanta.modelo} - ${llanta.medida} (${getTotalStock(llanta)} disp.)`,
    }));
}
export async function obtenerOpcionesUnicasSistema() {
  const llantas = await obtenerInventarioSistema();
  const unique = (field: 'marca' | 'modelo' | 'proveedor') => [...new Set(llantas.map((row) => row[field]).filter(Boolean))].sort();
  return { marcas: unique('marca'), modelos: unique('modelo'), proveedores: unique('proveedor') };
}
export async function crearLlantaSistema(input: LlantaInput): Promise<Llanta> {
  if (input.proveedor !== undefined) validarProveedor(input.proveedor);
  throw new Error(CENTRAL_MANAGEMENT_MESSAGE);
}
export async function actualizarLlantaSistema(_id: string, _input: Partial<LlantaInput>): Promise<Llanta | null> {
  void _id; void _input;
  throw new Error(CENTRAL_MANAGEMENT_MESSAGE);
}
export async function eliminarLlantaSistema(_id: string): Promise<boolean> {
  void _id;
  throw new Error(CENTRAL_MANAGEMENT_MESSAGE);
}
export async function ajustarStockSistema(_id: string, bodega: BodegaId, cantidad: number): Promise<Llanta | null> {
  validarBodega(bodega);
  if (!Number.isSafeInteger(cantidad)) throw new Error('El ajuste debe ser entero.');
  throw new Error(CENTRAL_MANAGEMENT_MESSAGE);
}
export async function moverStockSistema(_llantaId: string, bodegaOrigen: BodegaId, bodegaDestino: BodegaId, cantidad: number): Promise<Llanta | null> {
  validarBodega(bodegaOrigen); validarBodega(bodegaDestino); validarCantidad(cantidad);
  if (bodegaOrigen === bodegaDestino) throw new Error('Selecciona dos bodegas distintas.');
  throw new Error(CENTRAL_MANAGEMENT_MESSAGE);
}
export async function obtenerMovimientosSistema(): Promise<MovimientoBodega[]> {
  if (sharedDatabaseEnabled()) return sharedMovements();
  const ids = (await obtenerInventarioSistema({ incluirInactivos: true })).map((llanta) => llanta.id);
  if (!ids.length) return [];
  const result = await db.query<{ id: string; llanta_id: string; bodega_origen: BodegaId | null; bodega_destino: BodegaId | null;
    cantidad: number; fecha: string; tipo: string | null; motivo: string | null; venta_id: string | null }>(
  'SELECT * FROM movimientos_bodega WHERE dominio=$1 AND llanta_id=ANY($2::text[]) ORDER BY fecha DESC,id', [DOMINIO, ids]);
  return result.rows.map((row) => ({ id: row.id, llantaId: row.llanta_id, bodegaOrigen: row.bodega_origen ?? '',
    bodegaDestino: row.bodega_destino ?? '', cantidad: Number(row.cantidad), fecha: row.fecha,
    tipo: row.tipo ?? undefined, motivo: row.motivo ?? undefined, ventaId: row.venta_id ?? undefined }));
}
export async function obtenerStockBajoSistema(): Promise<Llanta[]> {
  return (await obtenerInventarioSistema()).filter((llanta) => getTotalStock(llanta) === 0);
}
export async function deducirStockPorVenta(llantaId: string, bodega: BodegaId, cantidad: number): Promise<boolean> {
  validarCantidad(cantidad); return !!(await ajustarStockSistema(llantaId, bodega, -cantidad));
}
export async function restaurarStockPorCancelacion(llantaId: string, bodega: BodegaId, cantidad: number): Promise<boolean> {
  validarCantidad(cantidad); return !!(await ajustarStockSistema(llantaId, bodega, cantidad));
}
