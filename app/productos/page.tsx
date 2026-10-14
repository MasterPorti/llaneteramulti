'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Plus, Search, ShoppingBag, Minus, Pencil, Archive } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, Badge } from '@/components/ui';
import { DownloadPdfButton } from '@/components/ui/DownloadPdfButton';
import { obtenerProductos, ajustarStock, eliminarProducto } from './actions';
import { formatCurrency } from '@/lib/utils/formatters';
import { buildProductsReport } from '@/lib/reports/data';
import { filtrarProductos } from './producto-search';
import type { Producto } from '@/types';

export default function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [ajustando, setAjustando] = useState<Record<string, number>>({});
  const [desactivando, setDesactivando] = useState<Record<string, boolean>>({});
  const busyProducts = useRef(new Set<string>());
  const hasPendingChanges = Object.keys(ajustando).length > 0 || Object.keys(desactivando).length > 0;

  const loadProductos = useCallback(async () => {
    setLoading(true);
    try {
      const result = await obtenerProductos();
      if (result.success && result.data) {
        setProductos(result.data);
        setError(null);
      } else {
        setError(result.error || 'No se pudieron cargar los productos');
      }
    } catch {
      setError('No se pudieron cargar los productos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProductos();
  }, [loadProductos]);

  const productosFiltrados = filtrarProductos(productos, busqueda);

  const handleAjustar = async (id: string, delta: number, stockActual: number) => {
    if (busyProducts.current.has(id) || (delta < 0 && stockActual + delta < 0)) return;
    busyProducts.current.add(id);
    setAjustando((prev) => ({ ...prev, [id]: 1 }));
    try {
      const result = await ajustarStock(id, delta);
      if (result.success && result.data) {
        setProductos((prev) =>
          prev.map((p) => (p.id === id ? result.data! : p))
        );
      } else {
        setError(result.error || 'No se pudo confirmar el ajuste de stock. Recarga los productos.');
      }
    } catch {
      setError('No se pudo confirmar el ajuste de stock. Recarga los productos.');
    } finally {
      busyProducts.current.delete(id);
      setAjustando((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleDesactivar = async (producto: Producto) => {
    if (busyProducts.current.has(producto.id)) return;
    if (!window.confirm(`¿Desactivar "${producto.nombre}"? Dejará de estar disponible para nuevas ventas. Su historial se conserva.`)) return;
    busyProducts.current.add(producto.id);
    setDesactivando((current) => ({ ...current, [producto.id]: true }));
    try {
      const result = await eliminarProducto(producto.id);
      if (result.success) {
        setProductos((current) => current.filter((item) => item.id !== producto.id));
      } else {
        setError(result.error || 'No se pudo confirmar la desactivación. Recarga los productos.');
      }
    } catch {
      setError('No se pudo confirmar la desactivación. Recarga los productos.');
    } finally {
      busyProducts.current.delete(producto.id);
      setDesactivando((current) => {
        const next = { ...current };
        delete next[producto.id];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Productos" subtitle="Inventario de productos" />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-gray-500">Cargando...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle={`${productos.length} productos en catálogo`}
        actions={
          <div className="flex flex-wrap gap-2">
            <DownloadPdfButton
              getReport={() => buildProductsReport(productosFiltrados, { busqueda })}
              disabled={loading || !!error || !productosFiltrados.length || hasPendingChanges}
            />
            <Link href="/productos/nuevo">
              <button className="btn btn-primary flex items-center gap-2">
                <Plus size={16} /> Nuevo Producto
              </button>
            </Link>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-red-600">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={loadProductos} disabled={hasPendingChanges}>
            Recargar productos
          </button>
        </div>
      )}

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            className="input"
            style={{ paddingLeft: '2.5rem' }}
            placeholder="Buscar por nombre o descripción..."
            aria-label="Buscar productos por nombre o descripción"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <p className="mt-2 text-sm text-gray-500" role="status">
          {productosFiltrados.length} de {productos.length} productos
        </p>
      </div>

      {productosFiltrados.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-12 text-gray-400">
              <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-50" />
              {busqueda ? (
                <p>No se encontraron productos para &quot;{busqueda}&quot;</p>
              ) : (
                <div>
                  <p>No hay productos en el catálogo.</p>
                  <Link href="/productos/nuevo">
                    <button className="btn btn-primary mt-4 flex items-center gap-2 mx-auto">
                      <Plus size={16} /> Agregar primer producto
                    </button>
                  </Link>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="max-h-[min(65vh,40rem)] overflow-auto overscroll-contain" role="region" aria-label="Catálogo de productos" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10">Producto</th>
                  <th className="sticky top-0 z-10">Precio de venta</th>
                  <th className="sticky top-0 z-10">Costo de compra</th>
                  <th className="sticky top-0 z-10">Stock</th>
                  <th className="sticky top-0 z-10">Ajustar</th>
                  <th className="sticky top-0 z-10">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map((producto) => (
                  <tr key={producto.id} className="hover:bg-gray-50">
                    <td className="min-w-[12rem] max-w-sm">
                      {producto.imagen && <Image src={producto.imagen} alt={producto.nombre} width={64} height={64} unoptimized className="mb-2 h-16 w-16 object-contain" />}
                      <p className="font-medium whitespace-normal [overflow-wrap:anywhere]">{producto.nombre}</p>
                      {producto.descripcion && (
                        <p className="text-xs text-gray-500 whitespace-normal [overflow-wrap:anywhere]">{producto.descripcion}</p>
                      )}
                    </td>
                    <td>{formatCurrency(producto.precioVenta ?? producto.precio)}</td>
                    <td>{producto.precioCompra == null ? <span className="text-sm text-gray-500">Sin costo registrado</span> : formatCurrency(producto.precioCompra)}</td>
                    <td>
                      <Badge
                        variant={
                          producto.stock === 0
                            ? 'danger'
                            : producto.stock <= 3
                            ? 'warning'
                            : 'success'
                        }
                      >
                        {producto.stock}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAjustar(producto.id, -1, producto.stock)}
                          disabled={producto.stock === 0 || !!ajustando[producto.id] || !!desactivando[producto.id]}
                          className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 disabled:opacity-30"
                          title="Quitar 1"
                          aria-label={`Quitar 1 de ${producto.nombre}`}
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center text-sm font-medium">{producto.stock}</span>
                        <button
                          onClick={() => handleAjustar(producto.id, 1, producto.stock)}
                          disabled={!!ajustando[producto.id] || !!desactivando[producto.id]}
                          className="p-1 rounded hover:bg-green-100 text-gray-400 hover:text-green-600 disabled:opacity-30"
                          title="Agregar 1"
                          aria-label={`Agregar 1 a ${producto.nombre}`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        {!!ajustando[producto.id] || !!desactivando[producto.id] ? (
                          <span className="btn btn-secondary btn-sm opacity-50" aria-disabled="true"><Pencil size={14} /> Editar</span>
                        ) : (
                          <Link href={`/productos/${producto.id}/editar`} className="btn btn-secondary btn-sm" aria-label={`Editar ${producto.nombre}`}><Pencil size={14} /> Editar</Link>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm text-red-600"
                          onClick={() => handleDesactivar(producto)}
                          disabled={!!ajustando[producto.id] || !!desactivando[producto.id]}
                          aria-label={`Desactivar ${producto.nombre}`}
                        >
                          <Archive size={14} /> {desactivando[producto.id] ? 'Desactivando...' : 'Desactivar'}
                        </button>
                      </div>
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
