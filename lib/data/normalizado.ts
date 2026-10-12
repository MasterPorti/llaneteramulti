import type { PoolClient } from 'pg';
import type { BodegaId, Llanta } from '@/types';
import { BODEGAS } from '@/lib/config';
import { generateId } from '@/lib/utils/formatters';
import { validarBodega, validarCantidad } from './validation';

export interface LlantaRow {
  id: string; marca: string; modelo: string; medida: string;
  ancho: number; perfil: number; rin: number;
  precio_compra: number; precio_venta: number; precio_mayorista: number | null;
  stock: number; stock_por_bodega: Record<string, number> | null;
  proveedor: string | null; fecha_recepcion: string | null; fecha_recepcion_original: string | null;
  tipo_usada: string | null; vida: string | null; publicada: string | null;
  activo: boolean | null; created_at: string | null; updated_at: string | null;
}

export function validarTexto(value: string, nombre: string, max: number, obligatorio = true): void {
  if (typeof value !== 'string' || (obligatorio && !value.trim()) || [...value].length > max) {
    throw new Error(`${nombre} debe ${obligatorio ? 'contener texto y ' : ''}tener como máximo ${max} caracteres.`);
  }
}

export function totalStock(stock: Record<string, number>): number {
  let total = 0;
  for (const [bodega, cantidad] of Object.entries(stock)) {
    validarBodega(bodega as BodegaId);
    validarCantidad(cantidad, true);
    total += cantidad;
  }
  validarCantidad(total, true);
  return total;
}

/** Never assign an unknown scalar stock to an invented warehouse. */
export function stockDeFila(row: Pick<LlantaRow, 'stock' | 'stock_por_bodega'>): Record<BodegaId, number> {
  if (!row.stock_por_bodega || Array.isArray(row.stock_por_bodega) || typeof row.stock_por_bodega !== 'object') {
    throw new Error('El inventario no tiene una distribución de existencias por bodega verificable.');
  }
  if (totalStock(row.stock_por_bodega) !== Number(row.stock)) {
    throw new Error('La existencia total no coincide con las existencias por bodega.');
  }
  return Object.assign(Object.fromEntries(BODEGAS.map(({ id }) => [id, 0])), row.stock_por_bodega) as Record<BodegaId, number>;
}

export function adaptarLlanta(row: LlantaRow): Llanta {
  return {
    id: row.id, marca: row.marca, modelo: row.modelo, medida: row.medida,
    ancho: Number(row.ancho), perfil: Number(row.perfil), rin: Number(row.rin),
    precioCompra: Number(row.precio_compra), precioVenta: Number(row.precio_venta),
    ...(row.precio_mayorista == null ? {} : { precioMayorista: Number(row.precio_mayorista) }),
    ...(row.tipo_usada == null ? {} : { tipoUsada: row.tipo_usada }),
    ...(row.vida == null ? {} : { vida: row.vida }),
    ...(row.publicada == null ? {} : { publicada: row.publicada }),
    stockPorBodega: stockDeFila(row), proveedor: row.proveedor ?? '',
    fechaRecepcion: row.fecha_recepcion_original ?? row.fecha_recepcion ?? '',
    activo: row.activo === true, createdAt: row.created_at ?? '', updatedAt: row.updated_at ?? '',
  };
}

export async function guardarStock(client: PoolClient, id: string, stock: Record<BodegaId, number>): Promise<LlantaRow> {
  const result = await client.query<LlantaRow>(
    'UPDATE llantas SET stock=$1, stock_por_bodega=$2::jsonb, updated_at=NOW() WHERE id=$3 RETURNING *',
    [totalStock(stock), JSON.stringify(stock), id]);
  if (!result.rows[0]) throw new Error('La llanta ya no existe.');
  return result.rows[0];
}

export async function registrarMovimiento(client: PoolClient, input: {
  llantaId: string; origen?: BodegaId | null; destino?: BodegaId | null; cantidad: number;
  tipo: 'ajuste' | 'traslado' | 'venta' | 'cancelacion' | 'recepcion'; motivo?: string; ventaId?: string;
}): Promise<void> {
  validarCantidad(input.cantidad);
  if (input.origen) validarBodega(input.origen);
  if (input.destino) validarBodega(input.destino);
  await client.query(`INSERT INTO movimientos_bodega
    (id,llanta_id,bodega_origen,bodega_destino,cantidad,fecha,dominio,tipo,motivo,venta_id)
    VALUES ($1,$2,$3,$4,$5,NOW(),'sistema',$6,$7,$8)`,
  [generateId(), input.llantaId, input.origen ?? null, input.destino ?? null, input.cantidad, input.tipo, input.motivo ?? null, input.ventaId ?? null]);
}
