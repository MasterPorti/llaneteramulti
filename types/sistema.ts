import type { BodegaId } from './inventario';

// Garantía con identificador único para búsqueda
export interface GarantiaSistema {
  id: string; // Formato: GAR-YYYY-NNNN (ej: GAR-2026-0001)
  fechaInicio: string;
  fechaFin: string;
  diasGarantia: number;
  condiciones: string;
  activa: boolean;
}

// Item de venta del Sistema (solo llantas, sin servicios)
export interface SistemaVentaItem {
  llantaId: string;
  bodega: BodegaId;
  llantaSnapshot: {
    marca: string;
    modelo: string;
    medida: string;
    codigoAuxiliar: string;
  };
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

// Cliente del Sistema
export interface SistemaCliente {
  nombre: string;
  telefono?: string;
}

// Venta del Sistema Inventario
export interface SistemaVenta {
  id: string;
  folio: string; // Formato: SI-0001
  cliente: SistemaCliente;
  items: SistemaVentaItem[];
  subtotal: number;
  total: number;
  metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';
  fechaVenta: string;
  garantia: GarantiaSistema;
  createdAt: string;
  updatedAt: string;
  cancelada: boolean;
  motivoCancelacion?: string;
}

// Input para crear venta
export interface SistemaVentaInput {
  clienteNombre: string;
  clienteTelefono?: string;
  items: Array<{
    llantaId: string;
    bodega: BodegaId;
    cantidad: number;
    precioCustom?: number;
  }>;
  metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';
  diasGarantia?: number;
  condicionesGarantia?: string;
}

// Estructura de datos del archivo sistema-inventario.json
export interface SistemaInventarioData {
  llantas: import('./inventario').Llanta[];
  movimientos: import('./inventario').MovimientoBodega[];
  metadata: {
    lastUpdated: string;
    version: number;
  };
}

// Estructura de datos del archivo sistema-ventas.json
export interface SistemaVentasData {
  ventas: SistemaVenta[];
  metadata: {
    lastUpdated: string;
    ultimoFolio: number;
    ultimoGarantiaId: number;
    version: number;
  };
}

// Respuesta de acciones del servidor
export interface SistemaActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}
