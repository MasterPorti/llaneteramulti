'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Table } from '@/components/ui';
import type { Venta } from '@/types';
import { formatCurrency, formatDateTime, formatDate } from '@/lib/utils/formatters';
import { Download } from 'lucide-react';

interface VentasTableProps {
  ventas: Venta[];
}

type Periodo = 'hoy' | 'semana' | 'mes' | 'personalizado';

function getRango(periodo: Periodo, fechaInicio: string, fechaFin: string) {
  const hoy = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const toISO = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (periodo === 'hoy') {
    const s = toISO(hoy);
    return { desde: s, hasta: s };
  }
  if (periodo === 'semana') {
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    return { desde: toISO(lunes), hasta: toISO(hoy) };
  }
  if (periodo === 'mes') {
    const desde = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-01`;
    return { desde, hasta: toISO(hoy) };
  }
  return { desde: fechaInicio, hasta: fechaFin };
}

function descargarCSV(ventas: Venta[], desde: string, hasta: string) {
  const rows: string[][] = [
    ['Folio', 'Fecha', 'Cliente', 'Concepto', 'Subtotal', 'IVA (16%)', 'Total', 'Método de Pago'],
  ];

  for (const v of ventas.filter((v) => !v.cancelada)) {
    const concepto = v.items
      .map((item) =>
        item.tipo === 'producto'
          ? `${item.llantaSnapshot.marca} ${item.llantaSnapshot.modelo} ${item.llantaSnapshot.medida} x${item.cantidad}`
          : `${item.servicioNombre} x${item.cantidad}`
      )
      .join(' | ');

    const subtotal = v.total / 1.16;
    const iva = v.total - subtotal;

    rows.push([
      v.folio,
      formatDate(v.fechaVenta),
      v.cliente.nombre,
      concepto,
      subtotal.toFixed(2),
      iva.toFixed(2),
      v.total.toFixed(2),
      v.metodoPago,
    ]);
  }

  // Totales al final
  const totalGeneral = ventas.filter((v) => !v.cancelada).reduce((acc, v) => acc + v.total, 0);
  const subtotalGeneral = totalGeneral / 1.16;
  const ivaGeneral = totalGeneral - subtotalGeneral;
  rows.push([]);
  rows.push(['', '', '', 'TOTALES', subtotalGeneral.toFixed(2), ivaGeneral.toFixed(2), totalGeneral.toFixed(2), '']);

  const csv = rows
    .map((row) => row.map((cell) => `"${cell}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ventas_${desde}_${hasta}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function VentasTable({ ventas }: VentasTableProps) {
  const router = useRouter();

  const hoy = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const hoyStr = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
  const mesStr = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-01`;

  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [fechaInicio, setFechaInicio] = useState(mesStr);
  const [fechaFin, setFechaFin] = useState(hoyStr);

  const { desde, hasta } = getRango(periodo, fechaInicio, fechaFin);

  const ventasFiltradas = useMemo(() => {
    return ventas.filter((v) => {
      const fecha = v.fechaVenta.split('T')[0];
      return fecha >= desde && fecha <= hasta;
    });
  }, [ventas, desde, hasta]);

  const totalFiltrado = ventasFiltradas
    .filter((v) => !v.cancelada)
    .reduce((acc, v) => acc + v.total, 0);

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
      render: (item: Venta) => <span>{item.items.length} producto(s)</span>,
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
      key: 'fechaVenta',
      header: 'Fecha',
      render: (item: Venta) => formatDateTime(item.fechaVenta),
    },
  ];

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100">
        <div className="flex gap-1">
          {(['hoy', 'semana', 'mes'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                periodo === p
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Esta semana' : 'Este mes'}
            </button>
          ))}
          <button
            onClick={() => setPeriodo('personalizado')}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              periodo === 'personalizado'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Personalizado
          </button>
        </div>

        {periodo === 'personalizado' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="date"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm text-gray-500">
            <span className="font-medium text-gray-800">{ventasFiltradas.length}</span> ventas ·{' '}
            <span className="font-medium text-gray-800">{formatCurrency(totalFiltrado)}</span>
          </span>
          <button
            onClick={() => descargarCSV(ventasFiltradas, desde, hasta)}
            disabled={ventasFiltradas.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="w-4 h-4" />
            Descargar CSV
          </button>
        </div>
      </div>

      <Table
        columns={columns}
        data={ventasFiltradas}
        keyExtractor={(item) => item.id}
        onRowClick={(item) => router.push(`/ventas/${item.id}`)}
        emptyMessage="No hay ventas en el período seleccionado."
      />
    </div>
  );
}
