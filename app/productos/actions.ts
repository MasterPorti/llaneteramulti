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
import { prepararImagenProducto } from '@/lib/utils/upload-imagen';
import { validateProductId, validateProductInput } from '@/lib/data/product-validation';

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
    validateProductId(id);
    const producto = await getProducto(id);
    if (!producto) return { success: false, error: 'Producto no encontrado' };
    return { success: true, data: producto };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al obtener producto' };
  }
}

export async function crearProducto(input: ProductoInput, media?: FormData): Promise<ActionResponse<Producto>> {
  try {
    validateProductInput(input);
    const cambioImagen = await prepararImagenProducto(media);
    const producto = await createProducto(input, cambioImagen);
    revalidatePath('/productos');
    return { success: true, data: producto };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al crear producto' };
  }
}

export async function actualizarProducto(
  id: string,
  input: Partial<ProductoInput>,
  media?: FormData,
): Promise<ActionResponse<Producto>> {
  try {
    validateProductId(id); validateProductInput(input, true);
    const cambioImagen = await prepararImagenProducto(media);
    const producto = await updateProducto(id, input, cambioImagen);
    if (!producto) return { success: false, error: 'Producto no encontrado' };
    revalidatePath('/productos');
    revalidatePath(`/productos/${id}`);
    return { success: true, data: producto };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al actualizar producto' };
  }
}

export async function ajustarStock(id: string, cantidad: number): Promise<ActionResponse<Producto>> {
  try {
    validateProductId(id);
    if (!Number.isSafeInteger(cantidad) || cantidad === 0 || Math.abs(cantidad) > 100000) {
      throw new Error('El ajuste debe ser un entero distinto de cero, entre -100,000 y 100,000.');
    }
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
    validateProductId(id);
    const ok = await deleteProducto(id);
    if (!ok) return { success: false, error: 'Producto no encontrado' };
    revalidatePath('/productos');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al eliminar producto' };
  }
}
