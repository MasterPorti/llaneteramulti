'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Table } from '@/components/ui';
import type { Venta } from '@/types';
import { formatCurrency, formatDateTime, getMexicoDateString } from '@/lib/utils/formatters';
import { Download } from 'lucide-react';

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

function descargarCSV(ventas: Venta[], desde: string, hasta: string) {
  const rows: string[][] = [
    ['Folio', 'Fecha', 'Cliente', 'Concepto', 'Subtotal', 'IVA', 'Total', 'Método de Pago'],
  ];

  for (const v of ventas.filter((v) => !v.cancelada)) {
    const concepto = v.items
      .map((item) =>
        item.tipo === 'producto'
          ? `${item.llantaSnapshot.marca} ${item.llantaSnapshot.modelo} ${item.llantaSnapshot.medida} x${item.cantidad}`
          : `${item.servicioNombre} x${item.cantidad}`
      )
      .join(' | ');

    rows.push([
      v.folio,
      getMexicoDateString(new Date(v.fechaVenta)),
      v.cliente.nombre,
      concepto,
      v.subtotal.toFixed(2),
      v.iva.toFixed(2),
      v.total.toFixed(2),
      v.metodoPago,
    ]);
  }

  // Totales al final
  const vigentes = ventas.filter((v) => !v.cancelada);
  const totalGeneral = vigentes.reduce((acc, v) => acc + Math.round(v.total * 100), 0) / 100;
  const subtotalGeneral = vigentes.reduce((acc, v) => acc + Math.round(v.subtotal * 100), 0) / 100;
  const ivaGeneral = vigentes.reduce((acc, v) => acc + Math.round(v.iva * 100), 0) / 100;
  rows.push(Array(8).fill(''));
  rows.push(['', '', '', 'TOTALES', subtotalGeneral.toFixed(2), ivaGeneral.toFixed(2), totalGeneral.toFixed(2), '']);

  // CSV estándar: comas entre columnas, comillas escapadas y filas CRLF.
  // El BOM conserva los acentos cuando Excel abre el archivo directamente.
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\r\n') + '\r\n';

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = desde || hasta ? `ventas_${desde}_${hasta}.csv` : 'ventas_todas.csv';
  a.click();
  URL.revokeObjectURL(url);
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

  const columns = [
    {
      key: 'folio',
      header: 'Folio',
      render: (item: Venta) => (
        <span className="font-mono font-medium">
          {item.folio}
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
