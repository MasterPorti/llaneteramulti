'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Table } from '@/components/ui';
import type { Venta } from '@/types';
import { formatCurrency, formatDateTime, getMexicoDateString } from '@/lib/utils/formatters';
import { DownloadPdfButton } from '@/components/ui/DownloadPdfButton';
import { buildSalesReport } from '@/lib/reports/data';

interface VentasTableProps {
  ventas: Venta[];
}

type Periodo = 'hoy' | 'semana' | 'mes' | 'todos' | 'personalizado';

function getRango(periodo: Periodo, fechaInicio: string, fechaFin: string) {
  const hoyStr = getMexicoDateString();
  const hoy = new Date(`${hoyStr}T12:00:00Z`);

  if (periodo === 'hoy') {
    return { desde: hoyStr, hasta: hoyStr };
  }
  if (periodo === 'semana') {
    const lunes = new Date(hoy);
    lunes.setUTCDate(hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7));
    return { desde: lunes.toISOString().split('T')[0], hasta: hoyStr };
  }
  if (periodo === 'mes') {
    return { desde: `${hoyStr.slice(0, 7)}-01`, hasta: hoyStr };
  }
  if (periodo === 'todos') return { desde: '', hasta: '' };
  return { desde: fechaInicio, hasta: fechaFin };
}

export function VentasTable({ ventas }: VentasTableProps) {
  const router = useRouter();

  const hoyStr = getMexicoDateString();
  const mesStr = `${hoyStr.slice(0, 7)}-01`;

  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [fechaInicio, setFechaInicio] = useState(mesStr);
  const [fechaFin, setFechaFin] = useState(hoyStr);

  const { desde, hasta } = getRango(periodo, fechaInicio, fechaFin);

  const ventasFiltradas = useMemo(() => {
    return ventas.filter((v) => {
      const fecha = getMexicoDateString(new Date(v.fechaVenta));
      return (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
    });
  }, [ventas, desde, hasta]);

  const totalFiltrado = ventasFiltradas
    .filter((v) => !v.cancelada)
    .reduce((acc, v) => acc + Math.round(v.total * 100), 0) / 100;
  const mostrarNewTires = ventas.some(v => v.importeNewTires !== undefined);
  const totalNewTires = ventasFiltradas.filter(v => !v.cancelada)
    .reduce((sum, v) => sum + Math.round((v.importeNewTires ?? 0) * 100), 0) / 100;

  const columns = [
    {
      key: 'folio',
      header: 'Folio',
      render: (item: Venta) => (
        <span className="font-mono font-medium">
          {item.folio}
          {item.storageKind === 'ventas_productos' && <span className="ml-2 font-sans text-xs text-gray-500">Productos</span>}
          {item.cancelada && <span className="ml-2 font-sans text-xs text-red-600">Cancelada</span>}
        </span>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (item: Venta) => item.cliente.nombre,
    },
    {
      key: 'items',
      header: 'Partidas',
      render: (item: Venta) => <span>{item.items.length} partida(s)</span>,
    },
    {
      key: 'subtotal',
      header: 'Subtotal',
      render: (item: Venta) => formatCurrency(item.subtotal),
    },
    {
      key: 'iva',
      header: 'IVA',
      render: (item: Venta) => formatCurrency(item.iva),
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
  if (mostrarNewTires) columns.splice(6, 0, { key: 'importeNewTires', header: 'Importe New Tires',
    render: (item: Venta) => <span>{formatCurrency(item.importeNewTires ?? 0)}</span> });

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100">
        <div className="flex gap-1">
          {(['hoy', 'semana', 'mes', 'todos'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                periodo === p
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Esta semana' : p === 'mes' ? 'Este mes' : 'Todos'}
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
            {mostrarNewTires && <span className="block text-xs">New Tires: {formatCurrency(totalNewTires)} · importe de partidas; sin repartir IVA</span>}
          </span>
          <DownloadPdfButton
            getReport={() => buildSalesReport(ventasFiltradas, { desde, hasta })}
            disabled={ventasFiltradas.length === 0 || Boolean(desde && hasta && desde > hasta)}
          />
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
