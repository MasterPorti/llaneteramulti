'use server';

import { revalidatePath } from 'next/cache';
import type { Llanta, LlantaInput, BodegaId } from '@/types';
import type { SistemaActionResponse } from '@/types/inventario';
import {
  obtenerInventarioSistema,
  obtenerLlantaSistema,
  crearLlantaSistema,
  actualizarLlantaSistema,
  eliminarLlantaSistema,
  ajustarStockSistema,
  moverStockSistema,
  buscarLlantasSistema,
} from '@/lib/data/sistema-inventario';

export async function obtenerInventario(): Promise<SistemaActionResponse<Llanta[]>> {
  try {
    const data = await obtenerInventarioSistema();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function obtenerLlanta(id: string): Promise<SistemaActionResponse<Llanta>> {
  try {
    const data = await obtenerLlantaSistema(id);
    if (!data) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function buscarLlantas(termino: string) {
  try {
    const data = await buscarLlantasSistema(termino);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function crearLlanta(input: LlantaInput): Promise<SistemaActionResponse<Llanta>> {
  try {
    const data = await crearLlantaSistema(input);
    revalidatePath('/inventario/inventario');
    revalidatePath('/inventario/bodegas');
    revalidatePath('/inventario');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function actualizarLlanta(
  id: string,
  input: Partial<LlantaInput>
): Promise<SistemaActionResponse<Llanta>> {
  try {
    const data = await actualizarLlantaSistema(id, input);
    if (!data) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    revalidatePath('/inventario/inventario');
    revalidatePath(`/inventario/inventario/${id}`);
    revalidatePath('/inventario/bodegas');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function eliminarLlanta(id: string): Promise<SistemaActionResponse> {
  try {
    const result = await eliminarLlantaSistema(id);
    if (!result) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    revalidatePath('/inventario/inventario');
    revalidatePath('/inventario/bodegas');
    revalidatePath('/inventario');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function ajustarStock(
  id: string,
  bodega: BodegaId,
  cantidad: number
): Promise<SistemaActionResponse<Llanta>> {
  try {
    const data = await ajustarStockSistema(id, bodega, cantidad);
    if (!data) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    revalidatePath('/inventario/inventario');
    revalidatePath(`/inventario/inventario/${id}`);
    revalidatePath('/inventario/bodegas');
    revalidatePath('/inventario');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function moverStock(
  llantaId: string,
  bodegaOrigen: BodegaId,
  bodegaDestino: BodegaId,
  cantidad: number
): Promise<SistemaActionResponse<Llanta>> {
  try {
    const data = await moverStockSistema(llantaId, bodegaOrigen, bodegaDestino, cantidad);
    if (!data) {
      return { success: false, error: 'Llanta no encontrada' };
    }
    revalidatePath('/inventario/inventario');
    revalidatePath(`/inventario/inventario/${llantaId}`);
    revalidatePath('/inventario/bodegas');
    revalidatePath('/inventario/bodegas/mover');
    revalidatePath('/inventario');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
