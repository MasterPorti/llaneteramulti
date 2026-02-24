'use client';

import { useEffect, useState } from 'react';
import { Printer, Share2 } from 'lucide-react';

interface Props {
  ventaId: string;
  garantiaId: string;
}

export function ImprimirGarantiaBtn({ ventaId, garantiaId }: Props) {
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share);
  }, []);

  const garantiaUrl = () => `${window.location.origin}/inventario/ventas/${ventaId}/garantia`;

  const handleImprimir = () => {
    window.open(garantiaUrl(), '_blank', 'width=920,height=780');
  };

  const handleCompartir = async () => {
    try {
      await navigator.share({
        title: `Garantía ${garantiaId}`,
        text: `Póliza de Garantía ${garantiaId} - Llanta Usada`,
        url: garantiaUrl(),
      });
    } catch {
      // usuario canceló
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleImprimir} className="btn btn-secondary flex items-center gap-2">
        <Printer className="w-4 h-4" />
        Imprimir
      </button>
      {canShare && (
        <button onClick={handleCompartir} className="btn btn-secondary flex items-center gap-2">
          <Share2 className="w-4 h-4" />
          Compartir
        </button>
      )}
    </div>
  );
}
