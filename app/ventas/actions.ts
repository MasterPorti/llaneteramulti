'use server';

import { revalidatePath } from 'next/cache';
import {
  obtenerVentas as getVentas,
  obtenerVenta as getVenta,
  crearVenta as createVenta,
  cancelarVenta as cancelVenta,
  marcarFacturada,
  obtenerGarantiasActivas as getGarantiasActivas,
} from '@/lib/data/ventas';
import type { Venta, VentaInput, ActionResponse } from '@/types';

export async function obtenerVentas(filtros?: {
  fechaInicio?: string;
  fechaFin?: string;
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
  try {
    // Aquí se integraría con la API de Factura Digital existente
    // Por ahora, simulamos la facturación
    const facturaInfo = {
      uuid: `FAC-${Date.now()}`,
      serie: 'A',
      folio: Math.floor(Math.random() * 10000).toString(),
      fechaTimbrado: new Date().toISOString(),
    };

    const venta = await marcarFacturada(id, facturaInfo);
    if (!venta) {
      return { success: false, error: 'Venta no encontrada' };
    }
    revalidatePath('/ventas');
    revalidatePath(`/ventas/${id}`);
    return { success: true, data: venta };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al facturar venta',
    };
  }
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
