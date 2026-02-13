'use server';

import { revalidatePath } from 'next/cache';
import {
  obtenerServicios as getServicios,
  obtenerServicio as getServicio,
  obtenerServicioPorCodigo as getServicioPorCodigo,
  crearServicio as createServicio,
  actualizarServicio as updateServicio,
  eliminarServicio as deleteServicio,
} from '@/lib/data/servicios';
import type { Servicio, ServicioInput, ActionResponse } from '@/types';

export async function obtenerServicios(): Promise<ActionResponse<Servicio[]>> {
  try {
    const servicios = await getServicios();
    return { success: true, data: servicios };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener servicios',
    };
  }
}

export async function obtenerServicio(id: string): Promise<ActionResponse<Servicio>> {
  try {
    const servicio = await getServicio(id);
    if (!servicio) {
      return { success: false, error: 'Servicio no encontrado' };
    }
    return { success: true, data: servicio };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener servicio',
    };
  }
}

export async function obtenerServicioPorCodigo(codigoBarras: string): Promise<ActionResponse<Servicio>> {
  try {
    const servicio = await getServicioPorCodigo(codigoBarras);
    if (!servicio) {
      return { success: false, error: 'Servicio no encontrado' };
    }
    return { success: true, data: servicio };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener servicio',
    };
  }
}

export async function crearServicio(input: ServicioInput): Promise<ActionResponse<Servicio>> {
  try {
    const servicio = await createServicio(input);
    revalidatePath('/servicios');
    revalidatePath('/ventas/nueva');
    return { success: true, data: servicio };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al crear servicio',
    };
  }
}

export async function actualizarServicio(
  id: string,
  input: Partial<ServicioInput>
): Promise<ActionResponse<Servicio>> {
  try {
    const servicio = await updateServicio(id, input);
    if (!servicio) {
      return { success: false, error: 'Servicio no encontrado' };
    }
    revalidatePath('/servicios');
    revalidatePath('/ventas/nueva');
    return { success: true, data: servicio };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al actualizar servicio',
    };
  }
}

export async function eliminarServicio(id: string): Promise<ActionResponse> {
  try {
    const eliminado = await deleteServicio(id);
    if (!eliminado) {
      return { success: false, error: 'Servicio no encontrado' };
    }
    revalidatePath('/servicios');
    revalidatePath('/ventas/nueva');
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al eliminar servicio',
    };
  }
}
