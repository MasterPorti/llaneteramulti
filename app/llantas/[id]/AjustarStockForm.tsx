'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { ajustarStock } from '../actions';
import { Plus, Minus } from 'lucide-react';

interface Props {
  id: string;
  stockActual: number;
}

export function AjustarStockForm({ id, stockActual }: Props) {
  const router = useRouter();
  const [cantidad, setCantidad] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleAjustar = async (tipo: 'entrada' | 'salida') => {
    if (cantidad <= 0) return;

    const ajuste = tipo === 'entrada' ? cantidad : -cantidad;

    if (tipo === 'salida' && cantidad > stockActual) {
      alert('No hay suficiente stock');
      return;
    }

    setLoading(true);
    const result = await ajustarStock(id, 'bodega-1', ajuste);

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
      <p className="text-sm text-gray-500">
        Stock actual: <strong>{stockActual}</strong>
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
          disabled={cantidad <= 0 || cantidad > stockActual}
        >
          <Minus size={14} /> Salida
        </Button>
      </div>
    </div>
  );
}
