import fs from 'fs/promises';
import path from 'path';
import type { Producto, ProductoInput } from '@/types';
import { generateId } from '@/lib/utils/formatters';

const DATA_PATH = path.join(process.cwd(), 'data', 'productos.json');

interface ProductosData {
  productos: Producto[];
  metadata: { lastUpdated: string; version: number };
}

async function readData(): Promise<ProductosData> {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { productos: [], metadata: { lastUpdated: '', version: 1 } };
  }
}

async function writeData(data: ProductosData): Promise<void> {
  data.metadata.lastUpdated = new Date().toISOString();
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function obtenerProductos(): Promise<Producto[]> {
  const data = await readData();
  return data.productos.filter((p) => p.activo);
}

export async function obtenerProducto(id: string): Promise<Producto | null> {
  const data = await readData();
  return data.productos.find((p) => p.id === id && p.activo) || null;
}

export async function crearProducto(input: ProductoInput): Promise<Producto> {
  const data = await readData();
  const now = new Date().toISOString();

  const nuevo: Producto = {
    id: generateId(),
    nombre: input.nombre,
    descripcion: input.descripcion,
    precio: input.precio,
    stock: input.cantidad,
    activo: true,
    createdAt: now,
    updatedAt: now,
  };

  data.productos.push(nuevo);
  await writeData(data);
  return nuevo;
}

export async function actualizarProducto(
  id: string,
  input: Partial<ProductoInput>
): Promise<Producto | null> {
  const data = await readData();
  const index = data.productos.findIndex((p) => p.id === id && p.activo);
  if (index === -1) return null;

  const p = data.productos[index];
  if (input.nombre !== undefined) p.nombre = input.nombre;
  if (input.descripcion !== undefined) p.descripcion = input.descripcion;
  if (input.precio !== undefined) p.precio = input.precio;
  if (input.cantidad !== undefined) p.stock = input.cantidad;
  p.updatedAt = new Date().toISOString();

  data.productos[index] = p;
  await writeData(data);
  return p;
}

export async function ajustarStockProducto(id: string, cantidad: number): Promise<Producto | null> {
  const data = await readData();
  const index = data.productos.findIndex((p) => p.id === id && p.activo);
  if (index === -1) return null;

  data.productos[index].stock = Math.max(0, data.productos[index].stock + cantidad);
  data.productos[index].updatedAt = new Date().toISOString();

  await writeData(data);
  return data.productos[index];
}

export async function eliminarProducto(id: string): Promise<boolean> {
  const data = await readData();
  const index = data.productos.findIndex((p) => p.id === id && p.activo);
  if (index === -1) return false;

  data.productos[index].activo = false;
  data.productos[index].updatedAt = new Date().toISOString();
  await writeData(data);
  return true;
}
