'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer, ArrowLeft, Share2 } from 'lucide-react';

interface Props {
  ventaId: string;
  garantiaId: string;
}

export function GarantiaActions({ ventaId, garantiaId }: Props) {
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share);
  }, []);

  const handleAction = async () => {
    if (canShare) {
      try {
        await navigator.share({
          title: `Garantía ${garantiaId}`,
          text: `Póliza de Garantía ${garantiaId} - Llanta Usada`,
          url: window.location.href,
        });
      } catch {
        // Usuario canceló o falló, no hacer nada
      }
    } else {
      window.print();
    }
  };

  return (
    <div className="no-print mb-6 flex items-center gap-4">
      <Link
        href={`/inventario/ventas/${ventaId}`}
        className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver a la venta
      </Link>
      <button
        onClick={handleAction}
        className="btn btn-primary flex items-center gap-2"
      >
        {canShare ? (
          <>
            <Share2 className="w-4 h-4" />
            Compartir Garantía
          </>
        ) : (
          <>
            <Printer className="w-4 h-4" />
            Imprimir / Guardar PDF
          </>
        )}
      </button>
    </div>
  );
}
