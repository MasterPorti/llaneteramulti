'use server';

import { revalidatePath } from 'next/cache';
import {
  obtenerVentas as getVentas,
  obtenerVenta as getVenta,
  crearVenta as createVenta,
  cancelarVenta as cancelVenta,
  obtenerGarantiasActivas as getGarantiasActivas,
} from '@/lib/data/ventas';
import type { Venta, VentaInput, ActionResponse } from '@/types';

export async function obtenerVentas(filtros?: {
  fechaInicio?: string;
  fechaFin?: string;
  incluirCanceladas?: boolean;
}): Promise<ActionResponse<Venta[]>> {
  try {
    const ventas = await getVentas(filtros);
    return { success: true, data: ventas };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener ventas',
    };
  }
}

export async function obtenerVenta(id: string): Promise<ActionResponse<Venta>> {
  try {
    const venta = await getVenta(id);
    if (!venta) {
      return { success: false, error: 'Venta no encontrada' };
    }
    return { success: true, data: venta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener venta',
    };
  }
}

export async function crearVenta(input: VentaInput): Promise<ActionResponse<Venta>> {
  try {
    const venta = await createVenta(input);
    revalidatePath('/ventas');
    revalidatePath('/inventario');
    revalidatePath('/llantas');
    revalidatePath('/productos');
    revalidatePath('/inventario/inventario');
    revalidatePath('/inventario/ventas');
    revalidatePath('/');
    return { success: true, data: venta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al crear venta',
    };
  }
}

export async function cancelarVenta(
  id: string,
  motivo: string
): Promise<ActionResponse<Venta>> {
  try {
    const venta = await cancelVenta(id, motivo);
    if (!venta) {
      return { success: false, error: 'Venta no encontrada' };
    }
    revalidatePath('/ventas');
    revalidatePath(`/ventas/${id}`);
    revalidatePath('/inventario');
    revalidatePath('/llantas');
    revalidatePath('/productos');
    revalidatePath('/inventario/inventario');
    revalidatePath('/inventario/ventas');
    revalidatePath('/');
    return { success: true, data: venta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al cancelar venta',
    };
  }
}

export async function facturarVenta(id: string): Promise<ActionResponse<Venta>> {
  if (!id) return { success: false, error: 'Venta no encontrada' };
  return {
    success: false,
    error: 'La facturación electrónica no está habilitada. No se ha generado ni enviado ningún CFDI.',
  };
}

export async function obtenerGarantiasActivas(): Promise<ActionResponse<Venta[]>> {
  try {
    const ventas = await getGarantiasActivas();
    return { success: true, data: ventas };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener garantías',
    };
  }
}
