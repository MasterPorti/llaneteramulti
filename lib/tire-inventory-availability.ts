import { getTotalStock, type BodegaId, type Llanta } from '../types/inventario';

/** Display availability only; never changes the tire or its stock. */
export function tireHasInventoryStock(llanta: Llanta, bodega: BodegaId | '' = ''): boolean {
  return getTotalStock(llanta) > 0 && (!bodega || (llanta.stockPorBodega?.[bodega] || 0) > 0);
}
