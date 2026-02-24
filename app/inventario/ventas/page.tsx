'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Plus, Eye, Shield } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, Badge } from '@/components/ui';
import { obtenerVentas } from './actions';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';
import type { SistemaVenta } from '@/types/sistema';

export default function VentasPage() {
  const [ventas, setVentas] = useState<SistemaVenta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVentas();
  }, []);

  const loadVentas = async () => {
    setLoading(true);
    const result = await obtenerVentas();
    if (result.success && result.data) {
      setVentas(result.data);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Ventas" subtitle="Historial de ventas" />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-[var(--text-muted)]">Cargando ventas...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Ventas"
        subtitle={`${ventas.length} ventas registradas`}
        actions={
          <Link href="/inventario/ventas/nueva">
            <button className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Nueva Venta
            </button>
          </Link>
        }
      />

      {ventas.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-12 text-[var(--text-muted)]">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No hay ventas registradas</p>
              <Link
                href="/inventario/ventas/nueva"
                className="mt-2 inline-block text-sm text-[var(--accent)] hover:underline"
              >
                Crear primera venta
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
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
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-1 text-[var(--text-muted)]">
                      <Shield className="w-3 h-3" />
                      <span className="font-mono">{venta.garantia.id}</span>
                    </div>
                    <span className="font-bold">{formatCurrency(venta.total)}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {formatDateShort(venta.fechaVenta)}
                  </p>
                </Link>
              ))}
            </div>

            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Cliente</th>
                    <th>Garantía</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((venta) => (
                    <tr key={venta.id} className="hover:bg-[var(--bg-hover)]">
                      <td className="font-bold">{venta.folio}</td>
                      <td>
                        <p>{venta.cliente.nombre}</p>
                        {venta.cliente.telefono && (
                          <p className="text-xs text-[var(--text-muted)]">{venta.cliente.telefono}</p>
                        )}
                      </td>
                      <td>
                        <span className="font-mono text-sm text-[var(--accent)]">
                          {venta.garantia.id}
                        </span>
                      </td>
                      <td>{venta.items.length} producto(s)</td>
                      <td className="font-bold">{formatCurrency(venta.total)}</td>
                      <td>{formatDateShort(venta.fechaVenta)}</td>
                      <td>
                        <Badge variant={venta.cancelada ? 'danger' : 'success'}>
                          {venta.cancelada ? 'Cancelada' : 'Completada'}
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
          </CardBody>
        </Card>
      )}
    </div>
  );
}
