export type BodegaId = 'bodega-1' | 'bodega-2' | 'bodega-3' | 'bodega-4' | 'bodega-5';

export interface Llanta {
  id: string;
  marca: string;
  modelo: string;
  medida: string;
  ancho: number;
  perfil: number;
  rin: number;
  precioCompra: number;
  precioVenta: number;
  stockPorBodega: Record<BodegaId, number>;
  proveedor: string;
  fechaRecepcion: string;
  createdAt: string;
  updatedAt: string;
  activo: boolean;
}

export interface LlantaInput {
  marca: string;
  modelo: string;
  medida: string;
  precioCompra: number;
  precioVenta: number;
  cantidad: number;
  bodega: BodegaId;
  proveedor: string;
  fechaRecepcion: string;
}

export interface LlantaSuggestion {
  id: string;
  marca: string;
  modelo: string;
  medida: string;
  stockTotal: number;
  precioVenta: number;
  displayText: string;
}

export interface MovimientoBodega {
  id: string;
  llantaId: string;
  bodegaOrigen: BodegaId;
  bodegaDestino: BodegaId;
  cantidad: number;
  fecha: string;
}

export function getTotalStock(llanta: Llanta): number {
  if (!llanta.stockPorBodega) return (llanta as unknown as { cantidad?: number }).cantidad || 0;
  return Object.values(llanta.stockPorBodega).reduce((a, b) => a + b, 0);
}

export const MARCAS_LLANTAS = [
  'Michelin',
  'Bridgestone',
  'Goodyear',
  'Continental',
  'Pirelli',
  'Hankook',
  'Yokohama',
  'Dunlop',
  'Firestone',
  'BFGoodrich',
  'Toyo',
  'Kumho',
  'Nexen',
  'Cooper',
  'General Tire',
  'Falken',
  'Nitto',
  'Sumitomo',
  'Federal',
  'Maxxis',
] as const;

export const RINES_COMUNES = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22] as const;
