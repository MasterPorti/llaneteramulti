'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Warehouse, ArrowRightLeft, Package, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { obtenerInventario } from '../inventario/actions';
import { SISTEMA_BODEGAS, generarCodigoAuxiliar } from '@/lib/config-sistema';
import { formatCurrency } from '@/lib/utils/formatters';
import type { Llanta, BodegaId } from '@/types';

export default function BodegasPage() {
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [bodegaActiva, setBodegaActiva] = useState<BodegaId | null>(null);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    loadInventario();
  }, []);

  const loadInventario = async () => {
    setLoading(true);
    const result = await obtenerInventario();
    if (result.success && result.data) {
      setInventario(result.data);
    }
    setLoading(false);
  };

  const getProductosEnBodega = (bodegaId: BodegaId) => {
    return inventario.filter((l) => (l.stockPorBodega[bodegaId] || 0) > 0);
  };

  const getTotalUnidades = (bodegaId: BodegaId) => {
    return inventario.reduce((acc, l) => acc + (l.stockPorBodega[bodegaId] || 0), 0);
  };

  const getValorBodega = (bodegaId: BodegaId) => {
    return inventario.reduce(
      (acc, l) => acc + (l.stockPorBodega[bodegaId] || 0) * l.precioVenta,
      0
    );
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Bodegas" subtitle="Gestión de inventario por bodega" />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-[var(--text-muted)]">Cargando...</span>
        </div>
      </div>
    );
  }

  // Vista de detalle de bodega
  if (bodegaActiva) {
    const bodega = SISTEMA_BODEGAS.find((b) => b.id === bodegaActiva);
    const productos = getProductosEnBodega(bodegaActiva).filter((l) => {
      if (!busqueda.trim()) return true;
      const term = busqueda.toLowerCase();
      return (
        l.marca.toLowerCase().includes(term) ||
        l.modelo.toLowerCase().includes(term) ||
        l.medida.toLowerCase().includes(term) ||
        generarCodigoAuxiliar(l.medida).toLowerCase().includes(term)
      );
    });
    const totalUnidades = getTotalUnidades(bodegaActiva);
    const valor = getValorBodega(bodegaActiva);

    return (
      <div>
        <PageHeader
          title={bodega?.nombre || 'Bodega'}
          subtitle={`${productos.length} productos · ${totalUnidades} unidades · ${formatCurrency(valor)}`}
          breadcrumbs={[
            { label: 'Bodegas', href: '/bodegas' },
            { label: bodega?.nombre || '' },
          ]}
          actions={
            <div className="flex gap-2">
              <Link href="/inventario/bodegas/mover">
                <button className="btn btn-primary flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" />
                  Mover Stock
                </button>
              </Link>
              <button
                onClick={() => {
                  setBodegaActiva(null);
                  setBusqueda('');
                }}
                className="btn btn-secondary"
              >
                Volver
              </button>
            </div>
          }
        />

        {/* Buscador */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              className="input w-full"
              style={{ paddingLeft: '2.5rem' }}
              placeholder="Buscar por marca, modelo, medida..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>

        {productos.length === 0 ? (
          <Card>
            <CardBody>
              <div className="text-center py-12 text-[var(--text-muted)]">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No hay productos en esta bodega</p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="p-0">
              {/* Mobile */}
              <div className="md:hidden divide-y divide-[var(--border-color)]">
                {productos.map((llanta) => {
                  const stock = llanta.stockPorBodega[bodegaActiva] || 0;
                  return (
                    <div key={llanta.id} className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-mono text-sm text-[var(--text-muted)]">
                            {generarCodigoAuxiliar(llanta.medida)}
                          </p>
                          <p className="font-medium">{llanta.marca} {llanta.modelo}</p>
                          <p className="text-sm text-[var(--text-muted)]">{llanta.medida}</p>
                        </div>
                        <Badge variant={stock > 5 ? 'success' : stock > 2 ? 'warning' : 'danger'}>
                          {stock} uds
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-[var(--text-muted)]">Valor:</span>
                        <span className="font-medium">{formatCurrency(stock * llanta.precioVenta)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop */}
              <div className="hidden md:block">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Cód. Aux.</th>
                      <th>Producto</th>
                      <th>Medida</th>
                      <th>Precio</th>
                      <th>Unidades</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.map((llanta) => {
                      const stock = llanta.stockPorBodega[bodegaActiva] || 0;
                      return (
                        <tr key={llanta.id}>
                          <td className="font-mono text-sm">
                            {generarCodigoAuxiliar(llanta.medida)}
                          </td>
                          <td>
                            <p className="font-medium">{llanta.marca} {llanta.modelo}</p>
                            <p className="text-xs text-[var(--text-muted)]">{llanta.proveedor}</p>
                          </td>
                          <td className="font-mono">{llanta.medida}</td>
                          <td>{formatCurrency(llanta.precioVenta)}</td>
                          <td>
                            <Badge variant={stock > 5 ? 'success' : stock > 2 ? 'warning' : 'danger'}>
                              {stock}
                            </Badge>
                          </td>
                          <td className="font-medium">{formatCurrency(stock * llanta.precioVenta)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--bg-tertiary)] font-bold">
                      <td colSpan={4}>TOTAL</td>
                      <td>{totalUnidades}</td>
                      <td>{formatCurrency(valor)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    );
  }

  // Vista de grid de bodegas
  return (
    <div>
      <PageHeader
        title="Bodegas"
        subtitle="Gestión de inventario por bodega"
        actions={
          <Link href="/inventario/bodegas/mover">
            <button className="btn btn-primary flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              Mover Stock
            </button>
          </Link>
        }
      />

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
        {SISTEMA_BODEGAS.map((bodega) => {
          const productos = getProductosEnBodega(bodega.id);
          const totalUnidades = getTotalUnidades(bodega.id);
          const valor = getValorBodega(bodega.id);

          return (
            <button
              key={bodega.id}
              type="button"
              onClick={() => setBodegaActiva(bodega.id)}
              className="text-left transition-all hover:scale-[1.02]"
            >
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/20">
                      <Warehouse className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{bodega.nombre}</h3>
                      <p className="text-sm text-[var(--text-muted)]">
                        {productos.length} productos · {totalUnidades} unidades
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-sm text-[var(--text-muted)]">Valor total</span>
                    <span className="font-bold text-lg">{formatCurrency(valor)}</span>
                  </div>

                  {productos.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] text-center py-2">
                      Sin productos
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {productos.slice(0, 3).map((llanta) => (
                        <div
                          key={llanta.id}
                          className="flex items-center justify-between text-sm p-2 rounded bg-[var(--bg-tertiary)]"
                        >
                          <span className="truncate mr-2">
                            {llanta.marca} {llanta.modelo}
                          </span>
                          <Badge
                            variant={
                              llanta.stockPorBodega[bodega.id] > 5
                                ? 'success'
                                : llanta.stockPorBodega[bodega.id] > 2
                                ? 'warning'
                                : 'danger'
                            }
                          >
                            {llanta.stockPorBodega[bodega.id]}
                          </Badge>
                        </div>
                      ))}
                      {productos.length > 3 && (
                        <p className="text-xs text-center text-[var(--text-muted)] pt-1">
                          +{productos.length - 3} más...
                        </p>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
