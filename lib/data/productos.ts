import { db, transaction } from '@/lib/db';
import { sharedDatabaseEnabled } from './shared-database';
import { sharedProducts, sharedProduct, sharedCreateProduct, sharedUpdateProduct, sharedAdjustProduct, sharedDeleteCatalog } from './shared-database-catalog';
import type { Producto, ProductoInput } from '@/types';
import { generateId } from '@/lib/utils/formatters';
import { calcularImportePartida } from '@/lib/utils/iva';
import { validarCantidad } from './validation';
import { validateProductId, validateProductInput } from './product-validation';
import type { CambioImagenProducto } from '@/lib/utils/upload-imagen';

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
  if (sharedDatabaseEnabled()) return sharedProducts();
  return (await db.query<ProductoRow>('SELECT * FROM productos WHERE activo=true ORDER BY nombre,id')).rows.map(adaptarProducto);
}
export async function obtenerProducto(id: string): Promise<Producto | null> {
  if (sharedDatabaseEnabled()) return sharedProduct(id);
  const row = (await db.query<ProductoRow>('SELECT * FROM productos WHERE id=$1 AND activo=true', [id])).rows[0];
  return row ? adaptarProducto(row) : null;
}
function assertLegacyImageUnsupported(change: CambioImagenProducto): void {
  if (change.imagen || change.eliminarImagen) throw new Error('Las imágenes de productos requieren la base de datos compartida.');
}
export async function crearProducto(input: ProductoInput, cambioImagen: CambioImagenProducto = { eliminarImagen: false }): Promise<Producto> {
  if (sharedDatabaseEnabled()) return sharedCreateProduct(input, cambioImagen);
  validateProductInput(input); assertLegacyImageUnsupported(cambioImagen);
  const venta = calcularImportePartida(input.precioVenta ?? input.precio, 1);
  const compra = input.precioCompra == null ? null : calcularImportePartida(input.precioCompra, 1);
  const row = (await db.query<ProductoRow>(`INSERT INTO productos (id,nombre,descripcion,precio_compra,precio,stock,activo)
    VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`, [generateId(), input.nombre.trim(), input.descripcion?.trim() || null, compra, venta, input.cantidad])).rows[0];
  return adaptarProducto(row);
}
export async function actualizarProducto(id: string, input: Partial<ProductoInput>, cambioImagen: CambioImagenProducto = { eliminarImagen: false }): Promise<Producto | null> {
  if (sharedDatabaseEnabled()) return sharedUpdateProduct(id, input, cambioImagen);
  validateProductId(id); validateProductInput(input, true); assertLegacyImageUnsupported(cambioImagen);
  return transaction(async (client) => {
    const current = (await client.query<ProductoRow>('SELECT * FROM productos WHERE id=$1 AND activo=true FOR UPDATE', [id])).rows[0];
    if (!current) return null;
    const venta = input.precioVenta ?? input.precio;
    const row = (await client.query<ProductoRow>(`UPDATE productos SET nombre=$1,descripcion=$2,precio_compra=$3,precio=$4,
      stock=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,
    [input.nombre?.trim() ?? current.nombre, input.descripcion === undefined ? current.descripcion : input.descripcion.trim() || null,
      input.precioCompra === undefined ? current.precio_compra : input.precioCompra === null ? null : calcularImportePartida(input.precioCompra, 1),
      venta === undefined ? current.precio : calcularImportePartida(venta, 1), input.cantidad ?? current.stock, id])).rows[0];
    return adaptarProducto(row);
  });
}
export async function ajustarStockProducto(id: string, cantidad: number): Promise<Producto | null> {
  if (sharedDatabaseEnabled()) return sharedAdjustProduct(id, cantidad);
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
  if (sharedDatabaseEnabled()) return sharedDeleteCatalog('productos', id);
  return ((await db.query('UPDATE productos SET activo=false,updated_at=NOW() WHERE id=$1 AND activo=true', [id])).rowCount ?? 0) > 0;
}
