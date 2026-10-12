import type { Venta } from '@/types';
import type { SistemaVenta, SistemaVentaInput, GarantiaSistema, SistemaActionResponse } from '@/types/sistema';
import { generarCodigoAuxiliar } from '@/lib/config-sistema';
import { getMexicoDateString } from '@/lib/utils/formatters';
import { releasedOperationStatus } from '@/lib/shared-stock';
import { crearVenta, obtenerVentas, obtenerVenta, obtenerVentaFolio, cancelarVenta, obtenerVentaPorGarantia, obtenerGarantiasActivas as consultarGarantias } from './ventas';

/** Shared SQL records projected for the legacy tire-specific screens. */
export function adaptarVentaSistema(venta: Venta): SistemaVenta {
  return {
    ...venta,
    garantia: { ...venta.garantia, id: venta.garantia.id || '' },
    items: venta.items.map((item) => item.tipo === 'producto' ? {
      ...item, llantaSnapshot: { ...item.llantaSnapshot, codigoAuxiliar: item.llantaSnapshot.codigoAuxiliar ?? generarCodigoAuxiliar(item.llantaSnapshot.medida) },
    } : {
      ...item, llantaId: '', bodega: '' as const,
      llantaSnapshot: { marca: item.servicioNombre, modelo: '', medida: '', codigoAuxiliar: '' },
    }),
  };
}

export async function crearVentaSistema(input: SistemaVentaInput): Promise<SistemaActionResponse<SistemaVenta>> {
  try {
    const venta = await crearVenta({ ...input, generarFactura: false, items: input.items.map((item) => ({
      tipo: 'producto' as const, id: item.llantaId, bodega: item.bodega, cantidad: item.cantidad, precioCustom: item.precioCustom,
    })) }, 'sistema');
    return { success: true, data: adaptarVentaSistema(venta) };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Error al crear la venta.', operationStatus: releasedOperationStatus(error) }; }
}

export async function obtenerVentasSistema(filtros?: { desde?: string; hasta?: string; incluirCanceladas?: boolean }): Promise<SistemaVenta[]> {
  return (await obtenerVentas({ fechaInicio: filtros?.desde, fechaFin: filtros?.hasta, incluirCanceladas: filtros?.incluirCanceladas })).map(adaptarVentaSistema);
}

export async function obtenerVentaSistema(id: string): Promise<SistemaVenta | null> {
  const venta = await obtenerVenta(id);
  return venta ? adaptarVentaSistema(venta) : null;
}

export async function obtenerVentaPorFolio(folio: string): Promise<SistemaVenta | null> {
  const venta = await obtenerVentaFolio(folio);
  return venta ? adaptarVentaSistema(venta) : null;
}

export async function cancelarVentaSistema(id: string, motivo: string): Promise<SistemaActionResponse<SistemaVenta>> {
  try {
    const venta = await cancelarVenta(id, motivo);
    return venta ? { success: true, data: adaptarVentaSistema(venta) } : { success: false, error: 'Venta no encontrada.' };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Error al cancelar la venta.' }; }
}

export async function buscarGarantiaPorId(garantiaId: string): Promise<SistemaActionResponse<{ venta: SistemaVenta; garantia: GarantiaSistema }>> {
  const result = await obtenerVentaPorGarantia(garantiaId);
  if (!result) return { success: false, error: 'Garantía no encontrada.' };
  const venta = adaptarVentaSistema(result);
  return { success: true, data: { venta, garantia: venta.garantia } };
}

export async function obtenerGarantiasActivas(): Promise<Array<{ venta: SistemaVenta; garantia: GarantiaSistema; diasRestantes: number }>> {
  const today = new Date(`${getMexicoDateString()}T12:00:00Z`).getTime();
  return (await consultarGarantias()).map(adaptarVentaSistema).map((venta) => ({
    venta, garantia: venta.garantia, diasRestantes: Math.ceil((new Date(`${venta.garantia.fechaFin}T12:00:00Z`).getTime() - today) / 86400000),
  })).sort((a,b) => a.diasRestantes - b.diasRestantes);
}

export async function obtenerResumenVentas(filtros?: { desde?: string; hasta?: string }): Promise<{ ventas: SistemaVenta[]; totalVentas: number; totalIngresos: number; totalUnidades: number }> {
  const ventas = await obtenerVentasSistema({ ...filtros, incluirCanceladas: true });
  const vigentes = ventas.filter((venta) => !venta.cancelada);
  return { ventas, totalVentas: ventas.length,
    totalIngresos: vigentes.reduce((total, venta) => total + venta.total, 0),
    totalUnidades: vigentes.reduce((total, venta) => total + venta.items.reduce((units,item) => units + item.cantidad, 0), 0),
  };
}
