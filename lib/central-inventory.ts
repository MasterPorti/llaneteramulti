import { Pool, type QueryResultRow } from 'pg';
import type { BodegaId } from '@/types';
import type { LlantaRow } from '@/lib/data/normalizado';

export const CENTRAL_SUPPLIER = 'COMERCIALIZADORA DE NEW TIRES';
export interface StockItem { id: string; bodega: BodegaId; cantidad: number }
export interface StockReservation {
  operationId: string;
  status: 'reserved' | 'committed' | 'released';
  items: StockItem[];
  snapshots: Record<string, LlantaRow>;
}

declare global {
  var _multiCentralInventory: { url: string; pool: Pool } | undefined;
}

function getPool(): Pool {
  const url = process.env.CENTRAL_INVENTORY_DATABASE_URL;
  if (!url) throw new Error('Falta configurar el inventario central de llantas.');
  if (url === process.env.DATABASE_URL) throw new Error('El inventario central debe usar su conexión limitada independiente.');
  if (!global._multiCentralInventory || global._multiCentralInventory.url !== url) {
    const previous = global._multiCentralInventory;
    global._multiCentralInventory = { url, pool: new Pool({
      connectionString: url,
      application_name: 'llaneteramulti_shared_inventory',
      options: '-c timezone=America/Mexico_City -c search_path=multi_inventory -c statement_timeout=15000',
      connectionTimeoutMillis: 10000,
      max: 5,
      ssl: process.env.CENTRAL_INVENTORY_REQUIRE_SSL === 'true'
        ? { rejectUnauthorized: process.env.CENTRAL_INVENTORY_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
    }) };
    if (previous) void previous.pool.end();
  }
  return global._multiCentralInventory.pool;
}

/** This connection has SELECT on the supplier view and EXECUTE on stock operations only. */
export const centralInventory = {
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
    return getPool().query<T>(sql, params);
  },
};

export function assertCentralSupplier(row: LlantaRow): void {
  if ((row.proveedor ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX') !== CENTRAL_SUPPLIER) {
    throw new Error('El inventario central devolvió una llanta fuera del proveedor autorizado.');
  }
}

async function stockOperation(name: 'reserve_stock' | 'commit_stock' | 'release_stock' | 'get_stock_operation', id: string, items?: StockItem[]): Promise<StockReservation | null> {
  const params = items === undefined ? [id] : [id, JSON.stringify(items)];
  const result = await centralInventory.query<{ operation: StockReservation | null }>(
    `SELECT multi_inventory.${name}($1${items === undefined ? '' : ',$2::jsonb'}) AS operation`, params);
  const value = result.rows[0]?.operation;
  if (value == null && name === 'get_stock_operation') return null;
  if (!value || value.operationId !== id || !['reserved', 'committed', 'released'].includes(value.status)) {
    throw new Error('La respuesta de la operación de inventario central no es válida.');
  }
  for (const snapshot of Object.values(value.snapshots ?? {})) assertCentralSupplier(snapshot);
  return value;
}

export const reserveCentralStock = (id: string, items: StockItem[]) => stockOperation('reserve_stock', id, items) as Promise<StockReservation>;
export const commitCentralStock = (id: string) => stockOperation('commit_stock', id) as Promise<StockReservation>;
export const releaseCentralStock = (id: string) => stockOperation('release_stock', id) as Promise<StockReservation>;
export const getCentralStockOperation = (id: string) => stockOperation('get_stock_operation', id);
