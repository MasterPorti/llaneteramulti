'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Search, ShoppingBag, Minus } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, Badge, Button } from '@/components/ui';
import { obtenerProductos, ajustarStock } from './actions';
import { formatCurrency } from '@/lib/utils/formatters';
import type { Producto } from '@/types';

export default function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [ajustando, setAjustando] = useState<Record<string, number>>({});

  const loadProductos = useCallback(async () => {
    setLoading(true);
    const result = await obtenerProductos();
    if (result.success && result.data) {
      setProductos(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProductos();
  }, [loadProductos]);

  const productosFiltrados = productos.filter((p) => {
    if (!busqueda.trim()) return true;
    const term = busqueda.toLowerCase();
    return (
      p.nombre.toLowerCase().includes(term) ||
      (p.descripcion && p.descripcion.toLowerCase().includes(term))
    );
  });

  const handleAjustar = async (id: string, delta: number, stockActual: number) => {
    if (delta < 0 && stockActual + delta < 0) return;
    const result = await ajustarStock(id, delta);
    if (result.success && result.data) {
      setProductos((prev) =>
        prev.map((p) => (p.id === id ? result.data! : p))
      );
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
          <Link href="/productos/nuevo">
            <button className="btn btn-primary flex items-center gap-2">
              <Plus size={16} /> Nuevo Producto
            </button>
          </Link>
        }
      />

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            className="input"
            style={{ paddingLeft: '2.5rem' }}
            placeholder="Buscar por nombre o descripción..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
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
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Ajustar</th>
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map((producto) => (
                  <tr key={producto.id} className="hover:bg-gray-50">
                    <td>
                      <p className="font-medium">{producto.nombre}</p>
                      {producto.descripcion && (
                        <p className="text-xs text-gray-500">{producto.descripcion}</p>
                      )}
                    </td>
                    <td>{formatCurrency(producto.precio)}</td>
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
                          disabled={producto.stock === 0}
                          className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 disabled:opacity-30"
                          title="Quitar 1"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center text-sm font-medium">{producto.stock}</span>
                        <button
                          onClick={() => handleAjustar(producto.id, 1, producto.stock)}
                          className="p-1 rounded hover:bg-green-100 text-gray-400 hover:text-green-600"
                          title="Agregar 1"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
