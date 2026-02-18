'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { History, Eye, Filter, TrendingUp, Package, DollarSign } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { obtenerResumen } from '../ventas/actions';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';
import type { SistemaVenta } from '@/types/sistema';

export default function HistorialPage() {
  const [ventas, setVentas] = useState<SistemaVenta[]>([]);
  const [loading, setLoading] = useState(true);

  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  const [totales, setTotales] = useState({
    totalVentas: 0,
    totalIngresos: 0,
    totalUnidades: 0,
  });

  useEffect(() => {
    loadHistorial();
  }, []);

  const loadHistorial = async (desde?: string, hasta?: string) => {
    setLoading(true);
    const result = await obtenerResumen({
      desde: desde || undefined,
      hasta: hasta || undefined,
    });

    if (result.success && result.data) {
      setVentas(result.data.ventas);
      setTotales({
        totalVentas: result.data.totalVentas,
        totalIngresos: result.data.totalIngresos,
        totalUnidades: result.data.totalUnidades,
      });
    }
    setLoading(false);
  };

  const handleFiltrar = () => {
    loadHistorial(fechaDesde, fechaHasta);
  };

  const handleLimpiar = () => {
    setFechaDesde('');
    setFechaHasta('');
    loadHistorial();
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Historial" subtitle="Historial de ventas" />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-[var(--text-muted)]">Cargando historial...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Historial de Ventas"
        subtitle={`${totales.totalVentas} ventas registradas`}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">Ventas</p>
                <p className="text-xl font-bold">{totales.totalVentas}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <DollarSign className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">Ingresos</p>
                <p className="text-xl font-bold">{formatCurrency(totales.totalIngresos)}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <Package className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">Unidades</p>
                <p className="text-xl font-bold">{totales.totalUnidades}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filtrar por Fecha
          </h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="label">Desde</label>
              <input
                type="date"
                className="input w-full"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="label">Hasta</label>
              <input
                type="date"
                className="input w-full"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleFiltrar} className="btn btn-primary">
                Filtrar
              </button>
              <button onClick={handleLimpiar} className="btn btn-secondary">
                Limpiar
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Lista de Ventas */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <History className="w-5 h-5" />
            Ventas
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {ventas.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No hay ventas en el período seleccionado</p>
            </div>
          ) : (
            <>
              {/* Mobile View */}
              <div className="md:hidden divide-y divide-[var(--border-color)]">
                {ventas.map((venta) => (
                  <Link
                    key={venta.id}
                    href={`/ventas/${venta.id}`}
                    className="block p-4 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold">{venta.folio}</p>
                        <p className="text-sm text-[var(--text-muted)]">{venta.cliente.nombre}</p>
                      </div>
                      <Badge variant={venta.cancelada ? 'danger' : 'success'}>
                        {venta.cancelada ? 'Cancelada' : 'Completada'}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-muted)]">
                        {formatDateShort(venta.fechaVenta)}
                      </span>
                      <span className="font-bold">{formatCurrency(venta.total)}</span>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Garantía</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventas.map((venta) => (
                      <tr key={venta.id} className="hover:bg-[var(--bg-hover)]">
                        <td className="font-bold">{venta.folio}</td>
                        <td>{formatDateShort(venta.fechaVenta)}</td>
                        <td>
                          <p>{venta.cliente.nombre}</p>
                          {venta.cliente.telefono && (
                            <p className="text-xs text-[var(--text-muted)]">
                              {venta.cliente.telefono}
                            </p>
                          )}
                        </td>
                        <td>
                          <span className="font-mono text-sm text-[var(--accent)]">
                            {venta.garantia.id}
                          </span>
                        </td>
                        <td>
                          {venta.items.reduce((acc, i) => acc + i.cantidad, 0)} unidades
                        </td>
                        <td className="font-bold">{formatCurrency(venta.total)}</td>
                        <td>
                          <Badge variant={venta.cancelada ? 'danger' : 'success'}>
                            {venta.cancelada ? 'Cancelada' : 'OK'}
                          </Badge>
                        </td>
                        <td>
                          <Link href={`/ventas/${venta.id}`}>
                            <button className="btn btn-ghost p-2">
                              <Eye className="w-4 h-4" />
                            </button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
