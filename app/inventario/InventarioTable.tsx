'use client';

import { useRouter } from 'next/navigation';
import { Table, Badge } from '@/components/ui';
import { getTotalStock, type Llanta } from '@/types';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';
import { BODEGAS } from '@/lib/config';

interface InventarioTableProps {
  inventario: Llanta[];
}

export function InventarioTable({ inventario }: InventarioTableProps) {
  const router = useRouter();

  const columns = [
    {
      key: 'marca',
      header: 'Marca',
      render: (item: Llanta) => (
        <span className="font-medium">{item.marca}</span>
      ),
    },
    {
      key: 'modelo',
      header: 'Modelo',
    },
    {
      key: 'medida',
      header: 'Medida',
      render: (item: Llanta) => (
        <span className="font-mono">{item.medida}</span>
      ),
    },
    {
      key: 'stock',
      header: 'Stock Total',
      render: (item: Llanta) => {
        const total = getTotalStock(item);
        return (
          <Badge variant={total === 0 ? 'danger' : total <= 3 ? 'warning' : 'success'}>
            {total}
          </Badge>
        );
      },
    },
    ...BODEGAS.map((b) => ({
      key: b.id,
      header: b.nombre.replace('Bodega ', 'B'),
      render: (item: Llanta) => {
        const stock = item.stockPorBodega?.[b.id] || 0;
        return <span className={stock === 0 ? 'text-gray-300' : ''}>{stock}</span>;
      },
    })),
    {
      key: 'precioVenta',
      header: 'Precio',
      render: (item: Llanta) => formatCurrency(item.precioVenta),
    },
    {
      key: 'proveedor',
      header: 'Proveedor',
    },
  ];

  return (
    <Table
      columns={columns}
      data={inventario}
      keyExtractor={(item) => item.id}
      onRowClick={(item) => router.push(`/inventario/${item.id}`)}
      emptyMessage="No hay llantas en inventario. Agrega la primera."
    />
  );
}
