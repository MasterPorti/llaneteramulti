import { db, transaction } from '@/lib/db';
import type { Producto, ProductoInput } from '@/types';
import { generateId } from '@/lib/utils/formatters';
import { calcularImportePartida } from '@/lib/utils/iva';
import { validarCantidad, validarImporte } from './validation';
import { validarTexto } from './normalizado';

export interface ProductoRow {
  id: string; nombre: string; descripcion: string | null; precio: number; precio_compra: number | null;
  stock: number; activo: boolean | null; created_at: string | null; updated_at: string | null;
}
export function adaptarProducto(row: ProductoRow): Producto {
  return { id: row.id, nombre: row.nombre, descripcion: row.descripcion ?? undefined, precio: Number(row.precio),
    precioVenta: Number(row.precio), ...(row.precio_compra == null ? {} : { precioCompra: Number(row.precio_compra) }),
    stock: Number(row.stock), activo: row.activo === true, createdAt: row.created_at ?? '', updatedAt: row.updated_at ?? '' };
}
export async function obtenerProductos(): Promise<Producto[]> {
  return (await db.query<ProductoRow>('SELECT * FROM productos WHERE activo=true ORDER BY nombre,id')).rows.map(adaptarProducto);
}
export async function obtenerProducto(id: string): Promise<Producto | null> {
  const row = (await db.query<ProductoRow>('SELECT * FROM productos WHERE id=$1 AND activo=true', [id])).rows[0];
  return row ? adaptarProducto(row) : null;
}
function validar(input: Partial<ProductoInput>) {
  if (input.nombre !== undefined) validarTexto(input.nombre, 'El nombre', 200);
  if (input.cantidad !== undefined) validarCantidad(input.cantidad, true);
  for (const amount of [input.precio, input.precioCompra, input.precioVenta]) if (amount !== undefined) validarImporte(amount);
}
export async function crearProducto(input: ProductoInput): Promise<Producto> {
  validar(input);
  validarCantidad(input.cantidad, true);
  const venta = calcularImportePartida(input.precioVenta ?? input.precio, 1);
  const compra = input.precioCompra === undefined ? null : calcularImportePartida(input.precioCompra, 1);
  const row = (await db.query<ProductoRow>(`INSERT INTO productos (id,nombre,descripcion,precio_compra,precio,stock,activo)
    VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`, [generateId(), input.nombre, input.descripcion ?? null, compra, venta, input.cantidad])).rows[0];
  return adaptarProducto(row);
}
export async function actualizarProducto(id: string, input: Partial<ProductoInput>): Promise<Producto | null> {
  validar(input);
  return transaction(async (client) => {
    const current = (await client.query<ProductoRow>('SELECT * FROM productos WHERE id=$1 AND activo=true FOR UPDATE', [id])).rows[0];
    if (!current) return null;
    const venta = input.precioVenta ?? input.precio;
    const row = (await client.query<ProductoRow>(`UPDATE productos SET nombre=$1,descripcion=$2,precio_compra=$3,precio=$4,
      stock=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,
    [input.nombre ?? current.nombre, input.descripcion === undefined ? current.descripcion : input.descripcion,
      input.precioCompra === undefined ? current.precio_compra : calcularImportePartida(input.precioCompra, 1),
      venta === undefined ? current.precio : calcularImportePartida(venta, 1), input.cantidad ?? current.stock, id])).rows[0];
    return adaptarProducto(row);
  });
}
export async function ajustarStockProducto(id: string, cantidad: number): Promise<Producto | null> {
  if (!Number.isSafeInteger(cantidad)) throw new Error('El ajuste debe ser entero.');
  return transaction(async (client) => {
    const current = (await client.query<ProductoRow>('SELECT * FROM productos WHERE id=$1 AND activo=true FOR UPDATE', [id])).rows[0];
    if (!current) return null;
    const stock = Number(current.stock) + cantidad;
    if (stock < 0) throw new Error('Stock insuficiente.');
    validarCantidad(stock, true);
    const row = (await client.query<ProductoRow>('UPDATE productos SET stock=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [stock, id])).rows[0];
    return adaptarProducto(row);
  });
}
export async function eliminarProducto(id: string): Promise<boolean> {
  return ((await db.query('UPDATE productos SET activo=false,updated_at=NOW() WHERE id=$1 AND activo=true', [id])).rowCount ?? 0) > 0;
}
