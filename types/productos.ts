export interface Producto {
  id: string;
  nombre: string;
  descripcion?: string;
  precio: number;
  precioCompra?: number;
  precioVenta?: number;
  imagen?: string;
  imagenId?: string | null;
  stock: number;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductoInput {
  nombre: string;
  descripcion?: string;
  precio: number;
  precioCompra?: number;
  precioVenta?: number;
  cantidad: number;
}
