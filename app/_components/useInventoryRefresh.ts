'use client';

import { useEffect, useRef, useState } from 'react';

interface InventoryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Refresh stock without replacing the form, its filters, or the cart. */
export function useInventoryRefresh<T>(
  load: () => Promise<InventoryResult<T>>,
  onData: (data: T) => void,
  paused = false,
  refreshKey?: string | null,
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latest = useRef({ load, onData, paused });

  useEffect(() => {
    latest.current = { load, onData, paused };
  }, [load, onData, paused]);

  useEffect(() => {
    let mounted = true;
    let inFlight = false;

    const refresh = async (initial = false) => {
      if (inFlight || (!initial && (document.visibilityState !== 'visible' || latest.current.paused))) return;
      inFlight = true;
      try {
        const result = await latest.current.load();
        if (!mounted || (!initial && latest.current.paused)) return;
        if (result.success && result.data !== undefined) {
          latest.current.onData(result.data);
          setError('');
        } else {
          setError(result.error || 'No se pudo actualizar el inventario.');
        }
      } catch {
        if (mounted) setError('No se pudo actualizar el inventario. Se volverá a intentar.');
      } finally {
        inFlight = false;
        if (mounted && initial) setLoading(false);
      }
    };

    const onVisible = () => { void refresh(); };
    void refresh(true);
    const interval = window.setInterval(onVisible, 20_000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshKey]);

  return { loading, error };
}
