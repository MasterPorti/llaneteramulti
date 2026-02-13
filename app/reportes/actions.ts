'use server';

import { obtenerInventario, obtenerStockBajo } from '@/lib/data/inventario';
import { obtenerVentas, obtenerGarantiasActivas } from '@/lib/data/ventas';
import { daysBetween } from '@/lib/utils/formatters';
import { getTotalStock } from '@/types';
import type { Llanta, Venta, ActionResponse, DateRangeFilter } from '@/types';

export interface ReporteInventario {
  items: Llanta[];
  totalProductos: number;
  totalUnidades: number;
  valorTotal: number;
  sinStock: Llanta[];
}

export async function obtenerReporteInventario(): Promise<ActionResponse<ReporteInventario>> {
  try {
    const [inventario, sinStock] = await Promise.all([
      obtenerInventario(),
      obtenerStockBajo(),
    ]);

    const totalUnidades = inventario.reduce((acc, l) => acc + getTotalStock(l), 0);
    const valorTotal = inventario.reduce((acc, l) => acc + l.precioVenta * getTotalStock(l), 0);

    return {
      success: true,
      data: {
        items: inventario,
        totalProductos: inventario.length,
        totalUnidades,
        valorTotal,
        sinStock,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al generar reporte',
    };
  }
}

export interface ReporteVentas {
  ventas: Venta[];
  totalVentas: number;
  totalIngresos: number;
  promedioVenta: number;
  ventasPorDia: Array<{ fecha: string; total: number; cantidad: number }>;
}

export async function obtenerReporteVentas(
  filtro?: DateRangeFilter
): Promise<ActionResponse<ReporteVentas>> {
  try {
    const ventas = await obtenerVentas(filtro);
    const ventasActivas = ventas.filter((v) => !v.cancelada);

    const totalIngresos = ventasActivas.reduce((acc, v) => acc + v.total, 0);
    const promedioVenta = ventasActivas.length > 0 ? totalIngresos / ventasActivas.length : 0;

    const ventasPorDiaMap = new Map<string, { total: number; cantidad: number }>();
    ventasActivas.forEach((v) => {
      const fecha = v.fechaVenta.split('T')[0];
      const existing = ventasPorDiaMap.get(fecha) || { total: 0, cantidad: 0 };
      ventasPorDiaMap.set(fecha, {
        total: existing.total + v.total,
        cantidad: existing.cantidad + 1,
      });
    });

    const ventasPorDia = Array.from(ventasPorDiaMap.entries())
      .map(([fecha, data]) => ({ fecha, ...data }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    return {
      success: true,
      data: {
        ventas: ventasActivas,
        totalVentas: ventasActivas.length,
        totalIngresos,
        promedioVenta,
        ventasPorDia,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al generar reporte',
    };
  }
}

export interface ProductoVendido {
  llantaId: string;
  marca: string;
  modelo: string;
  medida: string;
  cantidadVendida: number;
  ingresoTotal: number;
}

export async function obtenerProductosMasVendidos(
  filtro?: DateRangeFilter
): Promise<ActionResponse<ProductoVendido[]>> {
  try {
    const ventas = await obtenerVentas(filtro);
    const ventasActivas = ventas.filter((v) => !v.cancelada);

    const productosMap = new Map<string, ProductoVendido>();

    ventasActivas.forEach((v) => {
      v.items.forEach((item) => {
        if (item.tipo === 'producto') {
          const existing = productosMap.get(item.llantaId);
          if (existing) {
            existing.cantidadVendida += item.cantidad;
            existing.ingresoTotal += item.subtotal;
          } else {
            productosMap.set(item.llantaId, {
              llantaId: item.llantaId,
              marca: item.llantaSnapshot.marca,
              modelo: item.llantaSnapshot.modelo,
              medida: item.llantaSnapshot.medida,
              cantidadVendida: item.cantidad,
              ingresoTotal: item.subtotal,
            });
          }
        }
      });
    });

    const productos = Array.from(productosMap.values()).sort(
      (a, b) => b.cantidadVendida - a.cantidadVendida
    );

    return { success: true, data: productos };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al generar reporte',
    };
  }
}

export interface GarantiaActiva {
  venta: Venta;
  diasRestantes: number;
  estado: 'activa' | 'por_vencer' | 'vencida';
}

export async function obtenerReporteGarantias(): Promise<ActionResponse<GarantiaActiva[]>> {
  try {
    const ventas = await obtenerGarantiasActivas();
    const hoy = new Date().toISOString().split('T')[0];

    const garantias: GarantiaActiva[] = ventas.map((v) => {
      const diasRestantes = daysBetween(hoy, v.garantia.fechaFin);
      let estado: 'activa' | 'por_vencer' | 'vencida' = 'activa';

      if (diasRestantes <= 0) {
        estado = 'vencida';
      } else if (diasRestantes <= 7) {
        estado = 'por_vencer';
      }

      return { venta: v, diasRestantes, estado };
    });

    return {
      success: true,
      data: garantias.sort((a, b) => a.diasRestantes - b.diasRestantes),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al generar reporte',
    };
  }
}
