import type { BodegaId } from './inventario';

export interface VentaItemProducto {
  tipo: 'producto';
  llantaId: string;
  bodega: BodegaId;
  llantaSnapshot: {
    marca: string;
    modelo: string;
    medida: string;
  };
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface VentaItemServicio {
  tipo: 'servicio';
  servicioId: string;
  servicioNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export type VentaItem = VentaItemProducto | VentaItemServicio;

export interface VentaCliente {
  nombre: string;
  telefono?: string;
}

export interface Garantia {
  fechaInicio: string;
  fechaFin: string;
  diasGarantia: number;
  condiciones: string;
  activa: boolean;
}

export interface FacturaInfo {
  uuid: string;
  serie: string;
  folio: string;
  fechaTimbrado: string;
  urlPdf?: string;
  urlXml?: string;
}

export interface Venta {
  id: string;
  folio: string;
  cliente: VentaCliente;
  items: VentaItem[];
  subtotal: number;
  iva: number;
  total: number;
  metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';
  fechaVenta: string;
  ticketGenerado: boolean;
  facturada: boolean;
  factura?: FacturaInfo;
  garantia: Garantia;
  createdAt: string;
  updatedAt: string;
  cancelada: boolean;
  motivoCancelacion?: string;
}

export interface VentaInput {
  clienteNombre: string;
  clienteTelefono?: string;
  items: Array<{
    tipo: 'producto' | 'servicio';
    id: string;
    cantidad: number;
    bodega?: BodegaId;
    precioCustom?: number;
  }>;
  metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';
  diasGarantia?: number;
  condicionesGarantia?: string;
  generarFactura: boolean;
}

export type EstadoGarantia = 'activa' | 'por_vencer' | 'vencida';
