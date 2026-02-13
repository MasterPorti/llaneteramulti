export interface Servicio {
  id: string;
  nombre: string;
  descripcion: string;
  precioDefault: number;
  codigoBarras: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServicioInput {
  nombre: string;
  descripcion: string;
  precioDefault: number;
  codigoBarras?: string;
}
