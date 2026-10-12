'use client';

import { useEffect, useState } from 'react';
import { clearPendingSale, readPendingSale, storePendingSale, type PendingSale, type PendingSaleInput, type SaleFlow } from './pendingSale';

const key = 'llantera.pending-sale';

export function usePendingSale<T extends PendingSaleInput>(flow: SaleFlow) {
  const [pending, setPending] = useState<PendingSale<T> | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    // Read the browser-only snapshot after hydration, before enabling checkout.
    const restore = () => {
      try {
        setPending(readPendingSale<T>(window.sessionStorage, key));
      } catch {
        setStorageError('No se pudo recuperar la venta pendiente. Revisa el historial antes de continuar.');
      } finally {
        setReady(true);
      }
    };
    restore();
  }, []);

  const store = (payload: T) => {
    try {
      const saved = storePendingSale(window.sessionStorage, key, payload, flow);
      setPending(saved);
      setStorageError('');
      return saved;
    } catch {
      setStorageError('No se pudo guardar la venta pendiente en este navegador. La venta no se envió.');
      return null;
    }
  };

  const clear = (id: string) => {
    try {
      clearPendingSale(window.sessionStorage, key, id);
      setPending(null);
      setStorageError('');
      return true;
    } catch {
      setStorageError('No se pudo cerrar la venta pendiente en este navegador. Revisa el historial antes de continuar.');
      return false;
    }
  };

  return { pending, ready, storageError, store, clear };
}
