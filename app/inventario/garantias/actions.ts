'use server';

import type { SistemaActionResponse, SistemaVenta, GarantiaSistema } from '@/types/sistema';
import { buscarGarantiaPorId, obtenerGarantiasActivas } from '@/lib/data/sistema-ventas';

export async function buscarGarantia(
  garantiaId: string
): Promise<SistemaActionResponse<{ venta: SistemaVenta; garantia: GarantiaSistema }>> {
  try {
    const result = await buscarGarantiaPorId(garantiaId);
    return result;
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function obtenerGarantias(): Promise<
  SistemaActionResponse<
    Array<{ venta: SistemaVenta; garantia: GarantiaSistema; diasRestantes: number }>
  >
> {
  try {
    const data = await obtenerGarantiasActivas();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
