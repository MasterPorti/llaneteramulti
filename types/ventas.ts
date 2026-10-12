import type { BodegaId } from './inventario';

export interface VentaItemProducto {
  tipo: 'producto';
  tipoOriginal?: 'producto' | 'servicio' | 'catalogo' | 'extra';
  llantaId: string;
  bodega: BodegaId | '';
  llantaSnapshot: {
    marca: string;
    modelo: string;
    medida: string;
    codigoAuxiliar?: string;
  };
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  costoUnitario?: number;
  costoSubtotal?: number;
}

export interface VentaItemServicio {
  tipo: 'servicio';
  tipoOriginal?: 'producto' | 'servicio' | 'catalogo' | 'extra';
  servicioId: string;
  servicioNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  productoId?: string;
  costoUnitario?: number;
  costoSubtotal?: number;
}

export type VentaItem = VentaItemProducto | VentaItemServicio;

export interface VentaCliente {
  nombre: string;
  telefono?: string;
}

export interface Garantia {
  id?: string;
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
  ivaPolitica?: 'incluido_16' | null;
  soloLecturaMigrada?: boolean;
  datosOriginales?: Record<string, unknown>;
  datosOriginalesJson?: string;
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
    tipo: 'producto' | 'servicio' | 'extra' | 'catalogo';
    nombre?: string;
    id: string;
    cantidad: number;
    bodega?: BodegaId;
    precioCustom?: number;
  }>;
  metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';
  diasGarantia?: number;
  condicionesGarantia?: string;
  generarFactura: boolean;
  sinGarantia?: boolean;
}

export type EstadoGarantia = 'activa' | 'por_vencer' | 'vencida';
