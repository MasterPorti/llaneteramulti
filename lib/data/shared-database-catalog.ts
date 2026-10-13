import { db, transaction } from '@/lib/db';
import type { Llanta, Producto, ProductoInput, Servicio, ServicioInput, BodegaId, MovimientoBodega } from '@/types';
import { BODEGAS } from '@/lib/config';
import { generateId } from '@/lib/utils/formatters';
import { calcularImportePartida } from '@/lib/utils/iva';
import { validarBodega, validarCantidad, validarImporte } from './validation';
import { validarTexto } from './normalizado';
import { tireScopeSql } from './shared-database';

export interface SharedTire extends Llanta { origen_app: string }
export interface SharedProduct {
  id: string; nombre: string; descripcion: string | null; precioCompra: number | null; precioVenta: number;
  stock: number; activo: boolean; createdAt: string; updatedAt: string; imagen: string | null; imagen_id: string | null;
}
export interface SharedService {
  id: string; nombre: string; descripcion: string | null; precioDefault: number; codigoBarras: string | null;
  activo: boolean; createdAt: string; updatedAt: string;
}
export function adaptSharedTire(row: SharedTire): Llanta {
  if (!row.stockPorBodega || Array.isArray(row.stockPorBodega)) throw new Error('La llanta no tiene existencias verificables por bodega.');
  for (const [key, value] of Object.entries(row.stockPorBodega)) { validarBodega(key as BodegaId); validarCantidad(value, true); }
  return { ...row, precioCompra: Number(row.precioCompra), precioVenta: Number(row.precioVenta),
    ...(row.precioMayorista == null ? {} : { precioMayorista: Number(row.precioMayorista) }),
    stockPorBodega: Object.assign(Object.fromEntries(BODEGAS.map(b => [b.id, 0])), row.stockPorBodega) as Record<BodegaId, number> };
}
export function adaptSharedProduct(row: SharedProduct): Producto {
  return { id: row.id, nombre: row.nombre, descripcion: row.descripcion ?? undefined, precio: Number(row.precioVenta),
    precioVenta: Number(row.precioVenta), ...(row.precioCompra == null ? {} : { precioCompra: Number(row.precioCompra) }),
    stock: Number(row.stock), activo: row.activo, createdAt: row.createdAt, updatedAt: row.updatedAt,
    imagenId: row.imagen_id, imagen: row.imagen_id ? `/api/productos/imagenes/${row.imagen_id}` : row.imagen || undefined };
}
export function adaptSharedService(row: SharedService): Servicio {
  return { ...row, descripcion: row.descripcion ?? '', codigoBarras: row.codigoBarras ?? '', precioDefault: Number(row.precioDefault) };
}
export async function sharedTires(includeInactive = false): Promise<Llanta[]> {
  return (await db.query<SharedTire>(`SELECT * FROM llantas WHERE ${tireScopeSql} ${includeInactive ? '' : 'AND activo=true'} ORDER BY "createdAt" DESC,id`)).rows.map(adaptSharedTire);
}
export async function sharedTire(id: string, includeInactive = false): Promise<Llanta | null> {
  const row = (await db.query<SharedTire>(`SELECT * FROM llantas WHERE id=$1 AND ${tireScopeSql} ${includeInactive ? '' : 'AND activo=true'}`, [id])).rows[0];
  return row ? adaptSharedTire(row) : null;
}
export async function sharedMovements(): Promise<MovimientoBodega[]> {
  return (await db.query<MovimientoBodega>(`SELECT m.* FROM movimientos_bodega m JOIN llantas l ON l.id=m."llantaId"
    WHERE (l.origen_app='blanca' OR upper(regexp_replace(btrim(l.proveedor),'[[:space:]]+',' ','g'))='COMERCIALIZADORA DE NEW TIRES') ORDER BY m.fecha DESC,m.id`)).rows;
}
export async function sharedProducts(): Promise<Producto[]> {
  return (await db.query<SharedProduct>('SELECT * FROM productos WHERE activo=true ORDER BY nombre,id')).rows.map(adaptSharedProduct);
}
export async function sharedProduct(id: string): Promise<Producto | null> {
  const row = (await db.query<SharedProduct>('SELECT * FROM productos WHERE id=$1 AND activo=true', [id])).rows[0];
  return row ? adaptSharedProduct(row) : null;
}
function validateProduct(input: Partial<ProductoInput>): void {
  if (input.nombre !== undefined) validarTexto(input.nombre, 'El nombre', 200);
  if (input.cantidad !== undefined) validarCantidad(input.cantidad, true);
  for (const v of [input.precio, input.precioCompra, input.precioVenta]) if (v !== undefined) validarImporte(v);
}
export async function sharedCreateProduct(input: ProductoInput): Promise<Producto> {
  validateProduct(input); validarCantidad(input.cantidad, true);
  const row = (await db.query<SharedProduct>(`INSERT INTO productos(id,nombre,descripcion,"precioCompra","precioVenta",stock,activo,origen_app)
    VALUES($1,$2,$3,$4,$5,$6,true,'blanca') RETURNING *`, [generateId(), input.nombre, input.descripcion ?? null,
    input.precioCompra === undefined ? null : calcularImportePartida(input.precioCompra, 1), calcularImportePartida(input.precioVenta ?? input.precio, 1), input.cantidad])).rows[0];
  return adaptSharedProduct(row);
}
export async function sharedUpdateProduct(id: string, input: Partial<ProductoInput>): Promise<Producto | null> {
  validateProduct(input);
  return transaction(async client => {
    const row = (await client.query<SharedProduct>('SELECT * FROM productos WHERE id=$1 AND activo=true FOR UPDATE', [id])).rows[0];
    if (!row) return null;
    const price = input.precioVenta ?? input.precio;
    const result = await client.query<SharedProduct>(`UPDATE productos SET nombre=$2,descripcion=$3,"precioCompra"=$4,"precioVenta"=$5,
      stock=$6,"updatedAt"=NOW() WHERE id=$1 RETURNING *`, [id, input.nombre ?? row.nombre, input.descripcion === undefined ? row.descripcion : input.descripcion,
      input.precioCompra === undefined ? row.precioCompra : calcularImportePartida(input.precioCompra, 1), price === undefined ? row.precioVenta : calcularImportePartida(price, 1), input.cantidad ?? row.stock]);
    return adaptSharedProduct(result.rows[0]);
  });
}
export async function sharedAdjustProduct(id: string, amount: number): Promise<Producto | null> {
  if (!Number.isSafeInteger(amount)) throw new Error('El ajuste debe ser entero.');
  return transaction(async client => {
    const row = (await client.query<SharedProduct>('SELECT * FROM productos WHERE id=$1 AND activo=true FOR UPDATE', [id])).rows[0];
    if (!row) return null;
    const stock = Number(row.stock) + amount; validarCantidad(stock, true);
    return adaptSharedProduct((await client.query<SharedProduct>('UPDATE productos SET stock=$2,"updatedAt"=NOW() WHERE id=$1 RETURNING *', [id, stock])).rows[0]);
  });
}
export async function sharedDeleteCatalog(table: 'productos' | 'servicios', id: string): Promise<boolean> {
  return ((await db.query(`UPDATE ${table} SET activo=false,"updatedAt"=NOW() WHERE id=$1 AND activo=true`, [id])).rowCount ?? 0) > 0;
}
export async function sharedServices(term?: string): Promise<Servicio[]> {
  return (await db.query<SharedService>(`SELECT * FROM servicios WHERE activo=true ${term === undefined ? '' : 'AND (nombre ILIKE $1 OR descripcion ILIKE $1)'} ORDER BY "createdAt",id`, term === undefined ? [] : [`%${term}%`])).rows.map(adaptSharedService);
}
export async function sharedService(value: string, byCode = false): Promise<Servicio | null> {
  const row = (await db.query<SharedService>(`SELECT * FROM servicios WHERE ${byCode ? '"codigoBarras"' : 'id'}=$1 AND activo=true`, [value])).rows[0];
  return row ? adaptSharedService(row) : null;
}
export async function sharedSaveService(id: string | null, input: Partial<ServicioInput>): Promise<Servicio | null> {
  if (input.nombre !== undefined) validarTexto(input.nombre, 'El nombre', 200);
  if (input.codigoBarras !== undefined) validarTexto(input.codigoBarras, 'El código', 100, false);
  if (input.precioDefault !== undefined) validarImporte(input.precioDefault);
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(73628109)');
    const current = id ? (await client.query<SharedService>('SELECT * FROM servicios WHERE id=$1 AND activo=true FOR UPDATE', [id])).rows[0] : undefined;
    if (id && !current) return null;
    let code = input.codigoBarras === undefined ? current?.codigoBarras : input.codigoBarras || null;
    if (!id && !code) {
      const max = (await client.query<{ n: string }>(`SELECT coalesce(max(substring("codigoBarras" FROM '^SRV([0-9]+)$')::bigint),0)::text AS n FROM servicios`)).rows[0].n;
      const next = Number(max) + 1; if (!Number.isSafeInteger(next)) throw new Error('El consecutivo de servicios está fuera de rango.');
      code = `SRV${String(next).padStart(3, '0')}`;
    }
    if ((await client.query('SELECT id FROM servicios WHERE "codigoBarras"=$1 AND ($2::text IS NULL OR id<>$2)', [code, id])).rowCount) throw new Error('Ya existe un servicio con ese código.');
    const name = input.nombre ?? current?.nombre; validarTexto(name ?? '', 'El nombre', 200);
    const price = calcularImportePartida(input.precioDefault ?? current?.precioDefault ?? Number.NaN, 1);
    const params = [id ?? generateId(), name, input.descripcion === undefined ? current?.descripcion ?? null : input.descripcion, price, code];
    const row = (await client.query<SharedService>(id ? `UPDATE servicios SET nombre=$2,descripcion=$3,"precioDefault"=$4,"codigoBarras"=$5,"updatedAt"=NOW() WHERE id=$1 RETURNING *`
      : `INSERT INTO servicios(id,nombre,descripcion,"precioDefault","codigoBarras",activo,origen_app) VALUES($1,$2,$3,$4,$5,true,'blanca') RETURNING *`, params)).rows[0];
    return adaptSharedService(row);
  });
}
