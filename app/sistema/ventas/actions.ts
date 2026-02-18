'use server';

import { revalidatePath } from 'next/cache';
import type { SistemaVenta, SistemaVentaInput, SistemaActionResponse } from '@/types/sistema';
import {
  crearVentaSistema,
  obtenerVentasSistema,
  obtenerVentaSistema,
  cancelarVentaSistema,
  obtenerResumenVentas,
} from '@/lib/data/sistema-ventas';

export async function crearVenta(
  input: SistemaVentaInput
): Promise<SistemaActionResponse<SistemaVenta>> {
  try {
    const result = await crearVentaSistema(input);
    if (result.success) {
      revalidatePath('/sistema/ventas');
      revalidatePath('/sistema/historial');
      revalidatePath('/sistema/garantias');
      revalidatePath('/sistema/inventario');
      revalidatePath('/sistema/bodegas');
      revalidatePath('/sistema');
    }
    return result;
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function obtenerVentas(filtros?: {
  desde?: string;
  hasta?: string;
}): Promise<SistemaActionResponse<SistemaVenta[]>> {
  try {
    const data = await obtenerVentasSistema(filtros);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function obtenerVenta(id: string): Promise<SistemaActionResponse<SistemaVenta>> {
  try {
    const data = await obtenerVentaSistema(id);
    if (!data) {
      return { success: false, error: 'Venta no encontrada' };
    }
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function cancelarVenta(
  id: string,
  motivo: string
): Promise<SistemaActionResponse<SistemaVenta>> {
  try {
    const result = await cancelarVentaSistema(id, motivo);
    if (result.success) {
      revalidatePath('/sistema/ventas');
      revalidatePath(`/sistema/ventas/${id}`);
      revalidatePath('/sistema/historial');
      revalidatePath('/sistema/garantias');
      revalidatePath('/sistema/inventario');
      revalidatePath('/sistema/bodegas');
      revalidatePath('/sistema');
    }
    return result;
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function obtenerResumen(filtros?: {
  desde?: string;
  hasta?: string;
}) {
  try {
    const data = await obtenerResumenVentas(filtros);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
