'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Package, Plus, Search, Filter } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, Badge } from '@/components/ui';
import { obtenerInventario } from './actions';
import { SISTEMA_BODEGAS, generarCodigoAuxiliar } from '@/lib/config-sistema';
import { formatCurrency } from '@/lib/utils/formatters';
import { getTotalStock, type Llanta, type BodegaId } from '@/types';

export default function InventarioPage() {
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [bodegaFiltro, setBodegaFiltro] = useState<BodegaId | ''>('');

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

  // Filtrar inventario
  const inventarioFiltrado = inventario
    .filter((llanta) => {
      if (bodegaFiltro && (llanta.stockPorBodega[bodegaFiltro] || 0) === 0) {
        return false;
      }
      if (busqueda.trim()) {
        const term = busqueda.toLowerCase();
        const codigoAux = generarCodigoAuxiliar(llanta.medida).toLowerCase();
        return (
          llanta.marca.toLowerCase().includes(term) ||
          llanta.modelo.toLowerCase().includes(term) ||
          llanta.medida.toLowerCase().includes(term) ||
          codigoAux.includes(term) ||
          `${llanta.marca} ${llanta.modelo}`.toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const codigoA = generarCodigoAuxiliar(a.medida);
      const codigoB = generarCodigoAuxiliar(b.medida);
      return codigoA.localeCompare(codigoB, undefined, { numeric: true });
    });

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Inventario"
          subtitle="Gestión de llantas en stock"
        />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-[var(--text-muted)]">Cargando inventario...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Inventario"
        subtitle={`${inventario.length} productos en total`}
        actions={
          <Link href="/sistema/inventario/nuevo">
            <button className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Agregar Llanta
            </button>
          </Link>
        }
      />

      {/* Filtros */}
      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            className="input w-full"
            style={{ paddingLeft: '2.5rem' }}
            placeholder="Buscar por marca, modelo, medida o código auxiliar..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--text-muted)]" />
          <select
            className="select"
            value={bodegaFiltro}
            onChange={(e) => setBodegaFiltro(e.target.value as BodegaId | '')}
          >
            <option value="">Todas las bodegas</option>
            {SISTEMA_BODEGAS.map((bodega) => (
              <option key={bodega.id} value={bodega.id}>
                {bodega.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Resultados */}
      {inventarioFiltrado.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No se encontraron productos</p>
              {busqueda || bodegaFiltro ? (
                <button
                  className="mt-2 text-sm text-[var(--accent)] hover:underline"
                  onClick={() => {
                    setBusqueda('');
                    setBodegaFiltro('');
                  }}
                >
                  Limpiar filtros
                </button>
              ) : (
                <Link href="/sistema/inventario/nuevo" className="mt-2 text-sm text-[var(--accent)] hover:underline">
                  Agregar primera llanta
                </Link>
              )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            {/* Mobile View */}
            <div className="md:hidden divide-y divide-[var(--border-color)]">
              {inventarioFiltrado.map((llanta) => {
                const stock = bodegaFiltro
                  ? llanta.stockPorBodega[bodegaFiltro] || 0
                  : getTotalStock(llanta);
                return (
                  <Link
                    key={llanta.id}
                    href={`/inventario/${llanta.id}`}
                    className="block p-4 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-mono text-sm text-[var(--text-muted)]">
                          {generarCodigoAuxiliar(llanta.medida)}
                        </p>
                        <p className="font-medium">{llanta.marca} {llanta.modelo}</p>
                        <p className="text-sm text-[var(--text-muted)]">{llanta.medida}</p>
                      </div>
                      <Badge variant={stock > 5 ? 'success' : stock > 0 ? 'warning' : 'danger'}>
                        {stock} uds
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Precio:</span>
                      <span className="font-medium">{formatCurrency(llanta.precioVenta)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Cód. Aux.</th>
                    <th>Producto</th>
                    <th>Medida</th>
                    <th>P. Compra</th>
                    <th>P. Venta</th>
                    <th>Stock</th>
                    {!bodegaFiltro && SISTEMA_BODEGAS.map((b) => (
                      <th key={b.id} className="text-center text-xs">{b.nombre}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventarioFiltrado.map((llanta) => {
                    const stock = bodegaFiltro
                      ? llanta.stockPorBodega[bodegaFiltro] || 0
                      : getTotalStock(llanta);
                    return (
                      <tr key={llanta.id} className="hover:bg-[var(--bg-hover)]">
                        <td className="font-mono text-sm">
                          {generarCodigoAuxiliar(llanta.medida)}
                        </td>
                        <td>
                          <Link
                            href={`/inventario/${llanta.id}`}
                            className="hover:text-[var(--accent)]"
                          >
                            <p className="font-medium">{llanta.marca} {llanta.modelo}</p>
                            <p className="text-xs text-[var(--text-muted)]">{llanta.proveedor}</p>
                          </Link>
                        </td>
                        <td className="font-mono">{llanta.medida}</td>
                        <td>{formatCurrency(llanta.precioCompra)}</td>
                        <td className="font-medium">{formatCurrency(llanta.precioVenta)}</td>
                        <td>
                          <Badge variant={stock > 5 ? 'success' : stock > 0 ? 'warning' : 'danger'}>
                            {stock}
                          </Badge>
                        </td>
                        {!bodegaFiltro && SISTEMA_BODEGAS.map((b) => (
                          <td key={b.id} className="text-center">
                            {llanta.stockPorBodega[b.id] || 0}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Summary */}
      {inventarioFiltrado.length > 0 && (
        <div className="mt-4 text-sm text-[var(--text-muted)] text-center">
          Mostrando {inventarioFiltrado.length} de {inventario.length} productos
        </div>
      )}
    </div>
  );
}
