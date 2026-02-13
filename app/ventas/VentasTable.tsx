'use client';

import { useRouter } from 'next/navigation';
import { Table, Badge } from '@/components/ui';
import type { Venta } from '@/types';
import { formatCurrency, formatDateTime } from '@/lib/utils/formatters';

interface VentasTableProps {
  ventas: Venta[];
}

export function VentasTable({ ventas }: VentasTableProps) {
  const router = useRouter();

  const columns = [
    {
      key: 'folio',
      header: 'Folio',
      render: (item: Venta) => (
        <span className="font-mono font-medium">{item.folio}</span>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (item: Venta) => item.cliente.nombre,
    },
    {
      key: 'items',
      header: 'Productos',
      render: (item: Venta) => (
        <span>{item.items.length} producto(s)</span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      render: (item: Venta) => (
        <span className="font-medium">{formatCurrency(item.total)}</span>
      ),
    },
    {
      key: 'metodoPago',
      header: 'Pago',
      render: (item: Venta) => {
        const labels: Record<string, string> = {
          efectivo: 'Efectivo',
          tarjeta: 'Tarjeta',
          transferencia: 'Transferencia',
        };
        return labels[item.metodoPago];
      },
    },
    {
      key: 'facturada',
      header: 'Factura',
      render: (item: Venta) => (
        <Badge variant={item.facturada ? 'success' : 'neutral'}>
          {item.facturada ? 'Facturada' : 'Sin factura'}
        </Badge>
      ),
    },
    {
      key: 'fechaVenta',
      header: 'Fecha',
      render: (item: Venta) => formatDateTime(item.fechaVenta),
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (item: Venta) => (
        <Badge variant={item.cancelada ? 'danger' : 'success'}>
          {item.cancelada ? 'Cancelada' : 'Completada'}
        </Badge>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={ventas}
      keyExtractor={(item) => item.id}
      onRowClick={(item) => router.push(`/ventas/${item.id}`)}
      emptyMessage="No hay ventas registradas."
    />
  );
}
