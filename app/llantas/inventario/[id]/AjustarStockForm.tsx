'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import { ajustarStock } from '../actions';
import { BODEGAS } from '@/lib/config';
import type { BodegaId } from '@/types';
import { Plus, Minus } from 'lucide-react';

interface Props {
  id: string;
  stockPorBodega: Record<BodegaId, number>;
}

export function AjustarStockForm({ id, stockPorBodega }: Props) {
  const router = useRouter();
  const [bodega, setBodega] = useState<BodegaId>('bodega-1');
  const [cantidad, setCantidad] = useState(0);
  const [loading, setLoading] = useState(false);

  const stockEnBodega = stockPorBodega?.[bodega] || 0;

  const handleAjustar = async (tipo: 'entrada' | 'salida') => {
    if (cantidad <= 0) return;

    const ajuste = tipo === 'entrada' ? cantidad : -cantidad;

    if (tipo === 'salida' && cantidad > stockEnBodega) {
      alert('No hay suficiente stock en esta bodega');
      return;
    }

    setLoading(true);
    const result = await ajustarStock(id, bodega, ajuste);

    if (result.success) {
      setCantidad(0);
      router.refresh();
    } else {
      alert(result.error || 'Error al ajustar stock');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <Select
        label="Bodega"
        name="bodega"
        value={bodega}
        onChange={(e) => setBodega(e.target.value as BodegaId)}
        options={BODEGAS.map((b) => ({ value: b.id, label: b.nombre }))}
      />
      <p className="text-sm text-gray-500">
        Stock en {BODEGAS.find((b) => b.id === bodega)?.nombre}: <strong>{stockEnBodega}</strong>
      </p>
      <Input
        label="Cantidad"
        name="cantidad"
        type="number"
        min="1"
        value={cantidad || ''}
        onChange={(e) => setCantidad(parseInt(e.target.value) || 0)}
      />
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => handleAjustar('entrada')}
          loading={loading}
          disabled={cantidad <= 0}
        >
          <Plus size={14} /> Entrada
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="flex-1"
          onClick={() => handleAjustar('salida')}
          loading={loading}
          disabled={cantidad <= 0 || cantidad > stockEnBodega}
        >
          <Minus size={14} /> Salida
        </Button>
      </div>
    </div>
  );
}
