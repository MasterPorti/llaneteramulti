'use server';

import { obtenerInventario } from '@/app/inventario/actions';
import { BODEGAS } from '@/lib/config';
import { getTotalStock, type BodegaId, type Llanta } from '@/types';

export interface InventarioData {
  productos: Array<{
    id: string;
    marca: string;
    modelo: string;
    medida: string;
    rin: number;
    precioCompra: number;
    precioVenta: number;
    stockTotal: number;
    stockPorBodega: Record<string, number>;
    proveedor: string;
    fechaRecepcion: string;
  }>;
  bodegas: Array<{ id: string; nombre: string }>;
  totales: {
    productos: number;
    unidades: number;
    valorVenta: number;
    valorCompra: number;
  };
}

export interface CatalogoData {
  productos: Array<{
    codigoAuxiliar: string;
    marca: string;
    modelo: string;
    medida: string;
    rin: number;
    precioVenta: number;
    stock: number;
    stockPorBodega?: Record<string, number>;
  }>;
  bodegas: Array<{ id: string; nombre: string }>;
  bodegaFiltro: string | null;
  totales: {
    productos: number;
    unidades: number;
  };
}

// Genera código auxiliar a partir de la medida
// Ejemplos: "205/55R16" -> "205 55 16", "10.00R20" -> "10 00 20"
function generarCodigoAuxiliar(medida: string): string {
  // Remove any leading/trailing whitespace
  const cleaned = medida.trim().toUpperCase();

  // Try to parse format like "205/55R16"
  const match1 = cleaned.match(/^(\d+)\/(\d+)R(\d+)$/i);
  if (match1) {
    return `${match1[1]} ${match1[2]} ${match1[3]}`;
  }

  // Try to parse format like "10.00R20" or "10R20"
  const match2 = cleaned.match(/^(\d+)(?:\.(\d+))?R(\d+)$/i);
  if (match2) {
    const part1 = match2[1];
    const part2 = match2[2] || '00';
    const part3 = match2[3];
    return `${part1} ${part2} ${part3}`;
  }

  // Fallback: just replace common separators with spaces
  return cleaned.replace(/[\/\.\-R]/gi, ' ').replace(/\s+/g, ' ').trim();
}

export async function obtenerDatosInventario(): Promise<{ success: boolean; data?: InventarioData; error?: string }> {
  const result = await obtenerInventario();
  if (!result.success || !result.data) {
    return { success: false, error: 'Error al obtener inventario' };
  }

  const inventario = result.data;

  const productos = inventario.map((llanta) => ({
    id: llanta.id,
    marca: llanta.marca,
    modelo: llanta.modelo,
    medida: llanta.medida,
    rin: llanta.rin,
    precioCompra: llanta.precioCompra,
    precioVenta: llanta.precioVenta,
    stockTotal: getTotalStock(llanta),
    stockPorBodega: BODEGAS.reduce((acc, b) => {
      acc[b.id] = llanta.stockPorBodega[b.id] || 0;
      return acc;
    }, {} as Record<string, number>),
    proveedor: llanta.proveedor,
    fechaRecepcion: llanta.fechaRecepcion,
  }));

  const totales = {
    productos: productos.length,
    unidades: productos.reduce((acc, p) => acc + p.stockTotal, 0),
    valorVenta: productos.reduce((acc, p) => acc + p.stockTotal * p.precioVenta, 0),
    valorCompra: productos.reduce((acc, p) => acc + p.stockTotal * p.precioCompra, 0),
  };

  return {
    success: true,
    data: {
      productos,
      bodegas: BODEGAS.map((b) => ({ id: b.id, nombre: b.nombre })),
      totales,
    },
  };
}

export async function obtenerDatosCatalogo(bodegaId?: BodegaId | ''): Promise<{ success: boolean; data?: CatalogoData; error?: string }> {
  const result = await obtenerInventario();
  if (!result.success || !result.data) {
    return { success: false, error: 'Error al obtener inventario' };
  }

  let inventario = result.data;

  // Filter by bodega if specified
  if (bodegaId) {
    inventario = inventario.filter((llanta) => (llanta.stockPorBodega[bodegaId] || 0) > 0);
  }

  const productos = inventario.map((llanta) => {
    const base = {
      codigoAuxiliar: generarCodigoAuxiliar(llanta.medida),
      marca: llanta.marca,
      modelo: llanta.modelo,
      medida: llanta.medida,
      rin: llanta.rin,
      precioVenta: llanta.precioVenta,
      stock: bodegaId ? (llanta.stockPorBodega[bodegaId] || 0) : getTotalStock(llanta),
    };

    if (!bodegaId) {
      return {
        ...base,
        stockPorBodega: BODEGAS.reduce((acc, b) => {
          acc[b.id] = llanta.stockPorBodega[b.id] || 0;
          return acc;
        }, {} as Record<string, number>),
      };
    }

    return base;
  });

  const bodegaNombre = bodegaId ? BODEGAS.find((b) => b.id === bodegaId)?.nombre || null : null;

  return {
    success: true,
    data: {
      productos,
      bodegas: BODEGAS.map((b) => ({ id: b.id, nombre: b.nombre })),
      bodegaFiltro: bodegaNombre,
      totales: {
        productos: productos.length,
        unidades: productos.reduce((acc, p) => acc + p.stock, 0),
      },
    },
  };
}
