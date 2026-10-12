import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db } from '@/lib/db';
import { commitCentralStock, releaseCentralStock, reserveCentralStock, type StockItem, type StockReservation } from '@/lib/central-inventory';

type Status = 'intent' | 'reserved' | 'local_committed' | 'committed' | 'release_pending' | 'released';
export interface SharedStockOperation {
  id: string; request_hash: string; payload: StockItem[]; reservation: StockReservation | null;
  status: Status; sale_id: string | null;
}
const lockKey = (id: string) => `shared-stock:${id}`;
const terminalMessage = 'La operación anterior se canceló. Inicia una nueva venta.';
export class SharedStockReleasedError extends Error {
  readonly operationStatus = 'released' as const;
}
export function releasedOperationStatus(error: unknown): 'released' | undefined {
  return error instanceof SharedStockReleasedError ? 'released' : undefined;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function sharedRequestHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function validateOperationId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(id)) {
    throw new Error('Falta el identificador estable de la operación de venta. Recarga el formulario.');
  }
}
export function aggregateStockItems(items: StockItem[]): StockItem[] {
  const grouped = new Map<string, StockItem>();
  for (const item of items) {
    const key = `${item.id}\0${item.bodega}`;
    const current = grouped.get(key);
    const cantidad = (current?.cantidad ?? 0) + item.cantidad;
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0 || cantidad > 2147483647) throw new Error('La cantidad de llantas no es válida.');
    grouped.set(key, { id: item.id, bodega: item.bodega, cantidad });
  }
  return [...grouped.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.bodega < b.bodega ? -1 : a.bodega > b.bodega ? 1 : 0);
}
async function readOperation(client: PoolClient, id: string): Promise<SharedStockOperation | undefined> {
  return (await client.query<SharedStockOperation>('SELECT * FROM public.shared_stock_operations WHERE id=$1', [id])).rows[0];
}
async function markPendingError(client: PoolClient, id: string): Promise<void> {
  // Never persist network connection strings or driver messages in the outbox.
  await client.query("UPDATE public.shared_stock_operations SET last_error='Pendiente de conciliar con inventario central',updated_at=NOW() WHERE id=$1", [id]);
}

/** Called only while holding the operation's session advisory lock. */
async function recoverLocked(client: PoolClient, id: string): Promise<void> {
  const operation = await readOperation(client, id);
  if (!operation || operation.status === 'committed' || operation.status === 'released') return;
  if (operation.status === 'local_committed') {
    if (!operation.sale_id) throw new Error('La operación confirmada no tiene una venta vinculada.');
    if (operation.payload.length) {
      const committed = await commitCentralStock(id);
      if (committed.status !== 'committed') throw new Error('No se pudo confirmar la reserva de la venta.');
    }
    await client.query("UPDATE public.shared_stock_operations SET status='committed',last_error=NULL,updated_at=NOW() WHERE id=$1", [id]);
    return;
  }
  // A committed local sale may only be released after a durable cancellation.
  if (operation.sale_id && operation.status !== 'release_pending') throw new Error('Estado de coordinación de venta inconsistente.');
  await client.query("UPDATE public.shared_stock_operations SET status='release_pending',updated_at=NOW() WHERE id=$1", [id]);
  // release_stock also creates a tombstone if reserve timed out before it reached
  // the server. A late reserve can therefore never deduct inventory afterwards.
  if (operation.payload.length) {
    const released = await releaseCentralStock(id);
    if (released.status !== 'released') throw new Error('No se pudo liberar la reserva pendiente.');
  }
  await client.query("UPDATE public.shared_stock_operations SET status='released',last_error=NULL,updated_at=NOW() WHERE id=$1", [id]);
}

async function releaseClient(client: PoolClient, id: string, discard = false): Promise<void> {
  if (!discard) {
    try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey(id)]); }
    catch { discard = true; }
  }
  client.release(discard);
}

/** A validation error can safely unlock an editable checkout only after a local
 * tombstone proves this ID never started. Existing operations remain untouched.
 * Holding the same session lock prevents a concurrent request reserving later.
 */
export async function rejectUnstartedStockOperation(id: unknown, request: unknown, error: unknown): Promise<never> {
  try { validateOperationId(id); } catch { throw error; }
  const client = await db.getClient();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey(id)]);
    locked = true;
    const current = await readOperation(client, id);
    if (!current) {
      await client.query(`INSERT INTO public.shared_stock_operations (id,request_hash,payload,status)
        VALUES ($1,$2,$3::jsonb,'released') ON CONFLICT (id) DO NOTHING`, [id, sharedRequestHash(request), '[]']);
    }
    if (!current || (!current.sale_id && current.status === 'released')) {
      throw new SharedStockReleasedError(error instanceof Error ? error.message : 'Los datos de venta no son válidos.');
    }
    throw error;
  } finally {
    if (locked) await releaseClient(client, id); else client.release(true);
  }
}

/** Bounded opportunistic recovery; active sales retain their session locks. */
export async function reconcileSharedStock(limit = 5): Promise<void> {
  const pending = await db.query<{ id: string }>(`SELECT id FROM public.shared_stock_operations
    WHERE status IN ('intent','reserved','local_committed','release_pending') ORDER BY updated_at,id LIMIT $1`, [limit]);
  for (const { id } of pending.rows) {
    const client = await db.getClient();
    let locked = false;
    try {
      locked = (await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lockKey(id)])).rows[0].locked;
      if (locked) {
        try { await recoverLocked(client, id); }
        catch {
          await markPendingError(client, id);
          // A central outage should not cause one full connection timeout per
          // pending sale whenever someone opens the local sales history.
          return;
        }
      }
    } finally {
      if (locked) await releaseClient(client, id);
      else client.release();
    }
  }
}

/** Reserve centrally, persist sale locally, then finish its durable outbox.
 * A failure acknowledging local COMMIT is resolved by rereading local state;
 * inventory is never compensated just because a network call threw.
 */
export async function withSharedStockSale<T>(options: {
  id: string; request: unknown; items: StockItem[];
  save: (client: PoolClient, reservation?: StockReservation) => Promise<{ saleId: string; result: T }>;
  readSale: (client: PoolClient, id: string) => Promise<T>;
}): Promise<T> {
  validateOperationId(options.id);
  const payload = aggregateStockItems(options.items);
  const hash = sharedRequestHash(options.request);
  const client = await db.getClient();
  let locked = false, inTransaction = false, discard = false, ownsRequest = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey(options.id)]);
    locked = true;
    await client.query(`INSERT INTO public.shared_stock_operations (id,request_hash,payload,status)
      VALUES ($1,$2,$3::jsonb,'intent') ON CONFLICT (id) DO NOTHING`, [options.id, hash, JSON.stringify(payload)]);
    const previous = await readOperation(client, options.id);
    if (!previous) throw new Error('No se pudo recuperar la intención de venta.');
    // A confirmed release is terminal even if the user corrected the cart after
    // the failure. Report it before the hash comparison so the UI can safely
    // start a new operation. An uncertain release never gives that permission.
    if (!previous.sale_id && previous.status === 'released') throw new SharedStockReleasedError(terminalMessage);
    if (!previous.sale_id && previous.status === 'release_pending') {
      try { await recoverLocked(client, options.id); }
      catch { throw new Error('La operación está pendiente de conciliación. Reintenta esta misma venta en unos momentos.'); }
      throw new SharedStockReleasedError(terminalMessage);
    }
    if (previous.request_hash !== hash) throw new Error('Este identificador de venta ya se utilizó con otros datos.');
    ownsRequest = true;
    if (previous.sale_id) {
      try { await recoverLocked(client, options.id); } catch { await markPendingError(client, options.id); }
      return await options.readSale(client, previous.sale_id);
    }
    const reservation = payload.length ? await reserveCentralStock(options.id, payload) : undefined;
    if (reservation?.status === 'released') throw new SharedStockReleasedError(terminalMessage);
    if (reservation && reservation.status !== 'reserved') throw new Error('La reserva central no coincide con la intención local de venta.');
    await client.query("UPDATE public.shared_stock_operations SET status='reserved',reservation=$2::jsonb,last_error=NULL,updated_at=NOW() WHERE id=$1", [options.id, reservation ? JSON.stringify(reservation) : null]);
    await client.query('BEGIN');
    inTransaction = true;
    const saved = await options.save(client, reservation);
    await client.query("UPDATE public.shared_stock_operations SET status='local_committed',sale_id=$2,updated_at=NOW() WHERE id=$1", [options.id, saved.saleId]);
    await client.query('COMMIT');
    inTransaction = false;
    // The sale is already durable and its units reserved. A remote outage only
    // leaves local_committed for recovery; it must not turn success into a retry.
    try { await recoverLocked(client, options.id); }
    catch { try { await markPendingError(client, options.id); } catch { discard = true; } }
    return saved.result;
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); inTransaction = false; }
      catch { discard = true; }
    }
    let releaseConfirmed = false;
    if (locked && ownsRequest && !discard) {
      // This reread distinguishes a failed transaction from a committed sale
      // whose COMMIT response was lost. It also serializes with cancellation.
      try { await recoverLocked(client, options.id); }
      catch { try { await markPendingError(client, options.id); } catch { discard = true; } }
      if (!discard) {
        try {
          const current = await readOperation(client, options.id);
          releaseConfirmed = current?.status === 'released' && !current.sale_id;
        } catch { discard = true; }
      }
    }
    if (releaseConfirmed) throw new SharedStockReleasedError(error instanceof Error ? error.message : terminalMessage);
    throw error;
  } finally {
    if (locked) await releaseClient(client, options.id, discard);
    else client.release(true);
  }
}

/** The caller cancels the local sale and marks release_pending in one transaction. */
export async function withSharedStockCancellation<T>(id: string, cancel: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  let locked = false, inTransaction = false, discard = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey(id)]);
    locked = true;
    await client.query('BEGIN'); inTransaction = true;
    const result = await cancel(client);
    await client.query('COMMIT'); inTransaction = false;
    try { await recoverLocked(client, id); }
    catch { try { await markPendingError(client, id); } catch { discard = true; } }
    return result;
  } catch (error) {
    if (inTransaction) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
    // A lost COMMIT acknowledgement is left to the same durable recovery rules.
    if (locked && !discard) { try { await recoverLocked(client, id); } catch { /* Retain pending state. */ } }
    throw error;
  } finally {
    if (locked) await releaseClient(client, id, discard); else client.release(true);
  }
}
