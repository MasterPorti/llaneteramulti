import type { VentaItemServicio } from '@/types';

export function descripcionTipoPartida(item: VentaItemServicio): string {
  if (item.tipoOriginal === 'catalogo' || item.productoId) return 'Producto de catálogo';
  if (item.tipoOriginal === 'extra') return 'Extra / Material';
  return 'Servicio';
}
