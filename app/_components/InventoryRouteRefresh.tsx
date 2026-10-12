'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function InventoryRouteRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !pending) {
        startTransition(() => router.refresh());
      }
    };
    const interval = window.setInterval(refresh, 20_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, pending]);

  return null;
}
