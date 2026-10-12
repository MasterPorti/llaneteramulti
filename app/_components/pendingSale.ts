export interface PendingSaleInput {
  operacionId?: string;
  clienteNombre: string;
  items: unknown[];
}

export type SaleFlow = 'general' | 'sistema';

export interface PendingSale<T extends PendingSaleInput> {
  version: 1;
  flow: SaleFlow;
  id: string;
  payload: T;
}

type SaleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readPendingSale<T extends PendingSaleInput>(storage: SaleStorage, key: string): PendingSale<T> | null {
  const serialized = storage.getItem(key);
  if (serialized === null) return null;
  const value = JSON.parse(serialized) as PendingSale<T>;
  if (!value || value.version !== 1 || !['general', 'sistema'].includes(value.flow)
    || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.id)
    || value.payload?.operacionId !== value.id || typeof value.payload.clienteNombre !== 'string'
    || !Array.isArray(value.payload.items) || !value.payload.items.length) {
    throw new Error('La venta pendiente guardada no es válida.');
  }
  return value;
}

/** Persist before contacting the server, including when browser storage is unavailable. */
export function storePendingSale<T extends PendingSaleInput>(storage: SaleStorage, key: string, payload: T, flow: SaleFlow): PendingSale<T> {
  if (!payload.operacionId) throw new Error('La venta necesita un identificador.');
  if (storage.getItem(key) !== null) throw new Error('Primero confirma la venta pendiente.');
  const serialized = JSON.stringify({ version: 1, flow, id: payload.operacionId, payload });
  storage.setItem(key, serialized);
  const saved = readPendingSale<T>(storage, key);
  if (!saved || saved.id !== payload.operacionId) throw new Error('No se pudo guardar la venta pendiente.');
  // Return the serialized snapshot so later edits cannot change the retry payload.
  return saved;
}

export function clearPendingSale(storage: SaleStorage, key: string, id: string): void {
  const saved = readPendingSale(storage, key);
  if (saved && saved.id !== id) throw new Error('Hay otra venta pendiente por confirmar.');
  storage.removeItem(key);
}
