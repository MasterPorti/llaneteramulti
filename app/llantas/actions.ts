'use server';

import { revalidatePath } from 'next/cache';
import {
  obtenerInventario as getInventario,
  obtenerLlanta as getLlanta,
  buscarLlantas as searchLlantas,
  crearLlanta as createLlanta,
  actualizarLlanta as updateLlanta,
  eliminarLlanta as deleteLlanta,
  ajustarStock as adjustStock,
  obtenerStockBajo as getStockBajo,
  moverStock as moveStock,
} from '@/lib/data/inventario';
import type { Llanta, LlantaInput, LlantaSuggestion, BodegaId, ActionResponse } from '@/types';

export async function obtenerInventario(): Promise<ActionResponse<Llanta[]>> {
  try {
    const inventario = await getInventario();
    return { success: true, data: inventario };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener inventario',
    };
  }
}

export async function obtenerLlanta(id: string): Promise<ActionResponse<Llanta>> {
  try {
    const llanta = await getLlanta(id);
    if (!llanta) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    return { success: true, data: llanta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener llanta',
    };
  }
}

export async function buscarLlantas(termino: string): Promise<ActionResponse<LlantaSuggestion[]>> {
  try {
    const sugerencias = await searchLlantas(termino);
    return { success: true, data: sugerencias };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error en la búsqueda',
    };
  }
}

export async function crearLlanta(input: LlantaInput): Promise<ActionResponse<Llanta>> {
  try {
    const llanta = await createLlanta(input);
    revalidatePath('/llantas');
    revalidatePath('/');
    return { success: true, data: llanta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al crear llanta',
    };
  }
}

export async function actualizarLlanta(
  id: string,
  input: Partial<LlantaInput>
): Promise<ActionResponse<Llanta>> {
  try {
    const llanta = await updateLlanta(id, input);
    if (!llanta) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    revalidatePath('/llantas');
    revalidatePath(`/llantas/${id}`);
    revalidatePath('/');
    return { success: true, data: llanta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al actualizar llanta',
    };
  }
}

export async function eliminarLlanta(id: string): Promise<ActionResponse> {
  try {
    const eliminada = await deleteLlanta(id);
    if (!eliminada) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    revalidatePath('/llantas');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al eliminar llanta',
    };
  }
}

export async function ajustarStock(
  id: string,
  bodega: BodegaId,
  cantidad: number
): Promise<ActionResponse<Llanta>> {
  try {
    const llanta = await adjustStock(id, bodega, cantidad);
    if (!llanta) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    revalidatePath('/llantas');
    revalidatePath(`/llantas/${id}`);
    revalidatePath('/');
    return { success: true, data: llanta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al ajustar stock',
    };
  }
}

export async function obtenerStockBajo(): Promise<ActionResponse<Llanta[]>> {
  try {
    const llantas = await getStockBajo();
    return { success: true, data: llantas };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener stock bajo',
    };
  }
}

export async function moverStockAction(
  llantaId: string,
  bodegaOrigen: BodegaId,
  bodegaDestino: BodegaId,
  cantidad: number
): Promise<ActionResponse<Llanta>> {
  try {
    const llanta = await moveStock(llantaId, bodegaOrigen, bodegaDestino, cantidad);
    if (!llanta) return { success: false, error: 'Producto no encontrado' };
    revalidatePath('/llantas');
    revalidatePath('/admin/bodegas');
    return { success: true, data: llanta };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error al mover stock' };
  }
}
