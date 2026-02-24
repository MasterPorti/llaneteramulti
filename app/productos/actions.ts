'use server';

import { revalidatePath } from 'next/cache';
import {
  obtenerProductos as getProductos,
  obtenerProducto as getProducto,
  crearProducto as createProducto,
  actualizarProducto as updateProducto,
  ajustarStockProducto as adjustStock,
  eliminarProducto as deleteProducto,
} from '@/lib/data/productos';
import type { Producto, ProductoInput, ActionResponse } from '@/types';

export async function obtenerProductos(): Promise<ActionResponse<Producto[]>> {
  try {
    const productos = await getProductos();
    return { success: true, data: productos };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al obtener productos' };
  }
}

export async function obtenerProducto(id: string): Promise<ActionResponse<Producto>> {
  try {
    const producto = await getProducto(id);
    if (!producto) return { success: false, error: 'Producto no encontrado' };
    return { success: true, data: producto };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al obtener producto' };
  }
}

export async function crearProducto(input: ProductoInput): Promise<ActionResponse<Producto>> {
  try {
    const producto = await createProducto(input);
    revalidatePath('/productos');
    return { success: true, data: producto };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al crear producto' };
  }
}

export async function actualizarProducto(
  id: string,
  input: Partial<ProductoInput>
): Promise<ActionResponse<Producto>> {
  try {
    const producto = await updateProducto(id, input);
    if (!producto) return { success: false, error: 'Producto no encontrado' };
    revalidatePath('/productos');
    return { success: true, data: producto };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al actualizar producto' };
  }
}

export async function ajustarStock(id: string, cantidad: number): Promise<ActionResponse<Producto>> {
  try {
    const producto = await adjustStock(id, cantidad);
    if (!producto) return { success: false, error: 'Producto no encontrado' };
    revalidatePath('/productos');
    return { success: true, data: producto };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al ajustar stock' };
  }
}

export async function eliminarProducto(id: string): Promise<ActionResponse> {
  try {
    const ok = await deleteProducto(id);
    if (!ok) return { success: false, error: 'Producto no encontrado' };
    revalidatePath('/productos');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al eliminar producto' };
  }
}
