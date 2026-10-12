'use client';

import Link from 'next/link';
import type { PendingSale, PendingSaleInput, SaleFlow } from './pendingSale';

export default function PendingSaleRecovery({ pending, storageError, loading, onRetry, historyHref, currentFlow }: {
  pending: PendingSale<PendingSaleInput> | null;
  storageError: string;
  loading: boolean;
  onRetry: () => void;
  historyHref: string;
  currentFlow: SaleFlow;
}) {
  if (!pending && !storageError) return null;
  return (
    <div role="status" className="mb-6 rounded-lg border border-amber-400/50 bg-amber-500/10 p-4 space-y-3">
      {pending && <>
        <p className="font-semibold">Venta pendiente de confirmar</p>
        <p className="text-sm">
          {pending.payload.clienteNombre} · {pending.payload.items.length} partidas.
          {' '}Confirma el resultado de esta venta antes de registrar otra. Se conservarán los mismos productos, cantidades y precios.
        </p>
      </>}
      {storageError && <p className="text-sm">{storageError}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {pending && (pending.flow === currentFlow ? (
          <button type="button" className="btn btn-primary" disabled={loading} onClick={onRetry}>
            {loading ? 'Confirmando venta...' : 'Reintentar confirmación'}
          </button>
        ) : (
          <Link className="btn btn-primary" href={pending.flow === 'sistema' ? '/inventario/ventas/nueva' : '/ventas/nueva'}>
            Abrir venta pendiente
          </Link>
        ))}
        <Link href={historyHref} className="text-sm underline">Revisar ventas</Link>
      </div>
    </div>
  );
}
