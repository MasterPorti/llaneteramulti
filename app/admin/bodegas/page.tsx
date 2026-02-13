'use client';

import { useState, useEffect, useCallback } from 'react';
import { Warehouse, ArrowRight, Package, ChevronLeft, MoveRight, X, Search, Plus } from 'lucide-react';
import Link from 'next/link';
import { BODEGAS } from '@/lib/config';
import { obtenerInventario, moverStockAction } from '@/app/inventario/actions';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { formatCurrency } from '@/lib/utils/formatters';
import { type Llanta, type BodegaId } from '@/types';

type Vista = 'bodegas' | 'detalle';

export default function BodegasPage() {
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [moviendo, setMoviendo] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Vista
  const [vista, setVista] = useState<Vista>('bodegas');
  const [bodegaActiva, setBodegaActiva] = useState<BodegaId | null>(null);

  // Busqueda
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDetalle, setBusquedaDetalle] = useState('');

  // Modal mover
  const [moverProducto, setMoverProducto] = useState<Llanta | null>(null);
  const [moverDestino, setMoverDestino] = useState<BodegaId | ''>('');
  const [moverCantidadStr, setMoverCantidadStr] = useState('1');

  const loadInventario = useCallback(async () => {
    setLoading(true);
    const result = await obtenerInventario();
    if (result.success && result.data) {
      setInventario(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadInventario();
  }, [loadInventario]);

  const getProductosEnBodega = (bodegaId: BodegaId) => {
    return inventario.filter((l) => (l.stockPorBodega[bodegaId] || 0) > 0);
  };

  const getTotalItemsBodega = (bodegaId: BodegaId) => {
    return inventario.reduce((total, l) => total + (l.stockPorBodega[bodegaId] || 0), 0);
  };

  const getProductoCount = (bodegaId: BodegaId) => {
    return inventario.filter((l) => (l.stockPorBodega[bodegaId] || 0) > 0).length;
  };

  const getValorBodega = (bodegaId: BodegaId) => {
    return inventario.reduce((total, l) => total + (l.stockPorBodega[bodegaId] || 0) * l.precioVenta, 0);
  };

  const resultadosBusqueda = busqueda.trim()
    ? inventario.filter((l) => {
        const term = busqueda.toLowerCase();
        return (
          l.marca.toLowerCase().includes(term) ||
          l.modelo.toLowerCase().includes(term) ||
          l.medida.toLowerCase().includes(term) ||
          `${l.marca} ${l.modelo}`.toLowerCase().includes(term)
        );
      })
    : [];

  const getBodegaNombre = (id: BodegaId) => {
    return BODEGAS.find((b) => b.id === id)?.nombre || id;
  };

  const abrirBodega = (bodegaId: BodegaId) => {
    setBodegaActiva(bodegaId);
    setVista('detalle');
    setBusquedaDetalle('');
    setError('');
    setSuccessMsg('');
  };

  const volverABodegas = () => {
    setVista('bodegas');
    setBodegaActiva(null);
    setMoverProducto(null);
    setBusquedaDetalle('');
    setError('');
    setSuccessMsg('');
  };

  const abrirMover = (llanta: Llanta) => {
    setMoverProducto(llanta);
    setMoverDestino('');
    setMoverCantidadStr('1');
    setError('');
    setSuccessMsg('');
  };

  const cerrarMover = () => {
    setMoverProducto(null);
    setMoverDestino('');
    setMoverCantidadStr('1');
  };

  const handleMover = async () => {
    if (!moverProducto || !bodegaActiva || !moverDestino) return;

    const cantidad = parseInt(moverCantidadStr) || 0;

    if (cantidad <= 0) {
      setError('La cantidad debe ser mayor a 0');
      return;
    }

    const stockDisponible = moverProducto.stockPorBodega[bodegaActiva] || 0;
    if (cantidad > stockDisponible) {
      setError(`Solo hay ${stockDisponible} unidades disponibles`);
      return;
    }

    setMoviendo(true);
    setError('');

    const result = await moverStockAction(
      moverProducto.id,
      bodegaActiva,
      moverDestino as BodegaId,
      cantidad
    );

    if (result.success) {
      setSuccessMsg(`${cantidad} unidad(es) de ${moverProducto.marca} ${moverProducto.modelo} movidas a ${getBodegaNombre(moverDestino as BodegaId)}`);
      cerrarMover();
      await loadInventario();
    } else {
      setError(result.error || 'Error al mover stock');
    }

    setMoviendo(false);
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Bodegas"
          subtitle="Administra el inventario por bodega"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Bodegas' },
          ]}
        />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-gray-500">Cargando inventario...</span>
        </div>
      </div>
    );
  }

  // VISTA: Detalle de bodega
  if (vista === 'detalle' && bodegaActiva) {
    const todosProductos = getProductosEnBodega(bodegaActiva);
    const productos = busquedaDetalle.trim()
      ? todosProductos.filter((l) => {
          const term = busquedaDetalle.toLowerCase();
          return (
            l.marca.toLowerCase().includes(term) ||
            l.modelo.toLowerCase().includes(term) ||
            l.medida.toLowerCase().includes(term) ||
            `${l.marca} ${l.modelo}`.toLowerCase().includes(term)
          );
        })
      : todosProductos;
    const totalItems = getTotalItemsBodega(bodegaActiva);
    const valor = getValorBodega(bodegaActiva);

    return (
      <div>
        <PageHeader
          title={getBodegaNombre(bodegaActiva)}
          subtitle={`${todosProductos.length} productos / ${totalItems} unidades / ${formatCurrency(valor)} valor`}
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Bodegas', href: '/admin/bodegas' },
            { label: getBodegaNombre(bodegaActiva) },
          ]}
          actions={
            <button
              type="button"
              onClick={volverABodegas}
              className="btn btn-secondary flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Todas las bodegas
            </button>
          }
        />

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg">
            {successMsg}
          </div>
        )}

        {/* Buscador */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              className="input"
              style={{ paddingLeft: '2.5rem' }}
              placeholder="Buscar por marca, modelo o medida..."
              value={busquedaDetalle}
              onChange={(e) => setBusquedaDetalle(e.target.value)}
            />
          </div>
          {busquedaDetalle.trim() && (
            <p className="text-sm text-gray-500 mt-2">
              Mostrando {productos.length} de {todosProductos.length} productos
            </p>
          )}
        </div>

        {/* Move modal/panel - desktop only */}
        {moverProducto && (
          <div className="hidden md:block mb-6 p-4 bg-amber-50 border-2 border-amber-300 rounded-lg">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <MoveRight className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <h3 className="font-semibold">
                    Mover: {moverProducto.marca} {moverProducto.modelo}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {moverProducto.medida} — {moverProducto.stockPorBodega[bodegaActiva] || 0} unidades en {getBodegaNombre(bodegaActiva)}
                  </p>
                </div>
              </div>
              <button type="button" onClick={cerrarMover} className="p-1 hover:bg-amber-100 rounded shrink-0">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-4">
              <div className="flex-1">
                <label className="label">Mover a</label>
                <select
                  className="select"
                  value={moverDestino}
                  onChange={(e) => setMoverDestino(e.target.value as BodegaId)}
                >
                  <option value="" disabled>Seleccionar bodega destino</option>
                  {BODEGAS.filter((b) => b.id !== bodegaActiva).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre} ({moverProducto.stockPorBodega[b.id] || 0} actuales)
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full md:w-28">
                <label className="label">Cantidad</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={moverCantidadStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setMoverCantidadStr(val);
                  }}
                  placeholder="1"
                />
              </div>
              <button
                type="button"
                onClick={handleMover}
                disabled={moviendo || !moverDestino || !moverCantidadStr || parseInt(moverCantidadStr) <= 0}
                className="btn btn-primary flex items-center justify-center gap-2 w-full md:w-auto"
              >
                {moviendo ? (
                  <>
                    <span className="spinner" />
                    Moviendo...
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4" />
                    Mover
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Product list */}
        {productos.length === 0 ? (
          <Card>
            <CardBody>
              <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Esta bodega esta vacia</p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="p-0">
              {/* Mobile view - card layout */}
              <div className="md:hidden">
                {productos.map((llanta) => {
                  const stock = llanta.stockPorBodega[bodegaActiva] || 0;
                  const isMoving = moverProducto?.id === llanta.id;
                  return (
                    <div key={llanta.id} className="p-4 border-b border-gray-100 last:border-b-0">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium">{llanta.marca} {llanta.modelo}</p>
                          <p className="text-sm text-gray-500">{llanta.proveedor}</p>
                          <p className="text-sm text-gray-500 font-mono">{llanta.medida}</p>
                        </div>
                        <Badge variant={stock > 5 ? 'success' : stock > 2 ? 'warning' : 'danger'}>
                          {stock} uds
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <div>
                          <span className="text-gray-500">Precio: </span>
                          <span>{formatCurrency(llanta.precioVenta)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Valor: </span>
                          <span className="font-medium">{formatCurrency(stock * llanta.precioVenta)}</span>
                        </div>
                      </div>

                      {/* Mobile inline move panel */}
                      {isMoving ? (
                        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <MoveRight className="w-4 h-4 text-amber-600" />
                              <span className="font-medium text-sm">Mover {stock} disponibles</span>
                            </div>
                            <button type="button" onClick={cerrarMover} className="p-1 hover:bg-amber-100 rounded">
                              <X className="w-4 h-4 text-gray-500" />
                            </button>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label className="label">Destino</label>
                              <select
                                className="select"
                                value={moverDestino}
                                onChange={(e) => setMoverDestino(e.target.value as BodegaId)}
                              >
                                <option value="" disabled>Seleccionar bodega</option>
                                {BODEGAS.filter((b) => b.id !== bodegaActiva).map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.nombre} ({llanta.stockPorBodega[b.id] || 0} actuales)
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="label">Cantidad</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                className="input"
                                value={moverCantidadStr}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9]/g, '');
                                  setMoverCantidadStr(val);
                                }}
                                placeholder="1"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleMover}
                              disabled={moviendo || !moverDestino || !moverCantidadStr || parseInt(moverCantidadStr) <= 0}
                              className="btn btn-primary w-full flex items-center justify-center gap-2"
                            >
                              {moviendo ? (
                                <>
                                  <span className="spinner" />
                                  Moviendo...
                                </>
                              ) : (
                                <>
                                  <ArrowRight className="w-4 h-4" />
                                  Mover
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => abrirMover(llanta)}
                          className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                        >
                          <MoveRight className="w-4 h-4" />
                          Mover a otra bodega
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="p-4 bg-gray-50 flex justify-between items-center">
                  <div>
                    <span className="font-bold">Total: </span>
                    <span>{totalItems} unidades</span>
                  </div>
                  <span className="font-bold text-lg">{formatCurrency(valor)}</span>
                </div>
              </div>

              {/* Desktop view - table layout */}
              <div className="hidden md:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Medida</th>
                      <th>Precio Venta</th>
                      <th>Unidades</th>
                      <th>Valor</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.map((llanta) => {
                      const stock = llanta.stockPorBodega[bodegaActiva] || 0;
                      return (
                        <tr key={llanta.id} className="hover:bg-gray-50">
                          <td>
                            <div>
                              <p className="font-medium">{llanta.marca} {llanta.modelo}</p>
                              <p className="text-xs text-gray-500">{llanta.proveedor}</p>
                            </div>
                          </td>
                          <td className="font-mono">{llanta.medida}</td>
                          <td>{formatCurrency(llanta.precioVenta)}</td>
                          <td>
                            <Badge variant={stock > 5 ? 'success' : stock > 2 ? 'warning' : 'danger'}>
                              {stock}
                            </Badge>
                          </td>
                          <td className="font-medium">{formatCurrency(stock * llanta.precioVenta)}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => abrirMover(llanta)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                            >
                              <MoveRight className="w-3.5 h-3.5" />
                              Mover
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 font-bold">
                      <td colSpan={3}>TOTAL</td>
                      <td>{totalItems}</td>
                      <td>{formatCurrency(valor)}</td>
                      <td></td>
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

  // VISTA: Grid de bodegas
  return (
    <div>
      <PageHeader
        title="Bodegas"
        subtitle="Administra el inventario por bodega"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Bodegas' },
        ]}
        actions={
          <Link href="/inventario/nuevo">
            <button className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Nueva Llanta
            </button>
          </Link>
        }
      />

      {/* Buscador */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            className="input"
            style={{ paddingLeft: '2.5rem' }}
            placeholder="Buscar llanta por marca, modelo o medida..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        {/* Resultados de busqueda */}
        {busqueda.trim() && (
          <div className="mt-3">
            {resultadosBusqueda.length === 0 ? (
              <p className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">
                No se encontraron productos para &quot;{busqueda}&quot;
              </p>
            ) : (
              <div className="space-y-2">
                {resultadosBusqueda.map((llanta) => {
                  const totalStock = BODEGAS.reduce(
                    (acc, b) => acc + (llanta.stockPorBodega[b.id] || 0),
                    0
                  );

                  return (
                    <div
                      key={llanta.id}
                      className="p-4 bg-white border border-gray-200 rounded-lg"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold">
                            {llanta.marca} {llanta.modelo}
                          </p>
                          <p className="text-sm text-gray-500">
                            {llanta.medida} — {formatCurrency(llanta.precioVenta)}
                          </p>
                        </div>
                        <Badge variant={totalStock > 0 ? 'success' : 'danger'}>
                          {totalStock} total
                        </Badge>
                      </div>

                      {totalStock === 0 ? (
                        <p className="text-sm text-red-500">Sin stock en ninguna bodega</p>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {BODEGAS.map((bodega) => {
                            const stock = llanta.stockPorBodega[bodega.id] || 0;
                            return (
                              <div
                                key={bodega.id}
                                className={`text-center p-2 rounded text-xs ${
                                  stock > 0
                                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                    : 'bg-gray-50 text-gray-400'
                                }`}
                              >
                                <p className="font-medium">{bodega.nombre}</p>
                                <p className="text-lg font-bold">{stock}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {BODEGAS.map((bodega) => {
          const productos = getProductosEnBodega(bodega.id);
          const totalItems = getTotalItemsBodega(bodega.id);
          const productoCount = getProductoCount(bodega.id);
          const valor = getValorBodega(bodega.id);

          return (
            <button
              key={bodega.id}
              type="button"
              onClick={() => abrirBodega(bodega.id)}
              className="text-left transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Warehouse className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{bodega.nombre}</h3>
                      <p className="text-sm text-gray-500">
                        {productoCount} productos / {totalItems} unidades
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-gray-500">Valor total</span>
                    <span className="font-bold text-lg">{formatCurrency(valor)}</span>
                  </div>

                  {productos.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-2">Sin productos</p>
                  ) : (
                    <div className="space-y-1.5">
                      {productos.slice(0, 4).map((llanta) => (
                        <div
                          key={llanta.id}
                          className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded"
                        >
                          <span className="truncate mr-2">
                            {llanta.marca} {llanta.modelo}
                          </span>
                          <Badge variant={llanta.stockPorBodega[bodega.id] > 5 ? 'success' : llanta.stockPorBodega[bodega.id] > 2 ? 'warning' : 'danger'}>
                            {llanta.stockPorBodega[bodega.id]}
                          </Badge>
                        </div>
                      ))}
                      {productos.length > 4 && (
                        <p className="text-xs text-center text-blue-500 pt-1">
                          +{productos.length - 4} mas...
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
