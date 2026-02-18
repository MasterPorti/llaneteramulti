'use client';

import { useState, useEffect } from 'react';
import { ArrowRightLeft, Search, ArrowRight, Package } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { obtenerInventario, moverStock } from '../../inventario/actions';
import { SISTEMA_BODEGAS, generarCodigoAuxiliar } from '@/lib/config-sistema';
import type { Llanta, BodegaId } from '@/types';

export default function MoverStockPage() {
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [moviendo, setMoviendo] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [busqueda, setBusqueda] = useState('');
  const [llantaSeleccionada, setLlantaSeleccionada] = useState<Llanta | null>(null);
  const [bodegaOrigen, setBodegaOrigen] = useState<BodegaId | ''>('');
  const [bodegaDestino, setBodegaDestino] = useState<BodegaId | ''>('');
  const [cantidad, setCantidad] = useState('1');

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

  const limpiarFormulario = () => {
    setLlantaSeleccionada(null);
    setBodegaOrigen('');
    setBodegaDestino('');
    setCantidad('1');
    setBusqueda('');
    setError('');
  };

  const handleMover = async () => {
    if (!llantaSeleccionada || !bodegaOrigen || !bodegaDestino) {
      setError('Selecciona producto, bodega origen y destino');
      return;
    }

    const cantidadNum = parseInt(cantidad) || 0;
    if (cantidadNum <= 0) {
      setError('La cantidad debe ser mayor a 0');
      return;
    }

    const stockDisponible = llantaSeleccionada.stockPorBodega[bodegaOrigen] || 0;
    if (cantidadNum > stockDisponible) {
      setError(`Solo hay ${stockDisponible} unidades disponibles en la bodega origen`);
      return;
    }

    setMoviendo(true);
    setError('');
    setSuccess('');

    const result = await moverStock(llantaSeleccionada.id, bodegaOrigen, bodegaDestino, cantidadNum);

    if (result.success) {
      const bodegaOrigenNombre = SISTEMA_BODEGAS.find((b) => b.id === bodegaOrigen)?.nombre;
      const bodegaDestinoNombre = SISTEMA_BODEGAS.find((b) => b.id === bodegaDestino)?.nombre;
      setSuccess(
        `${cantidadNum} unidad(es) de ${llantaSeleccionada.marca} ${llantaSeleccionada.modelo} movidas de ${bodegaOrigenNombre} a ${bodegaDestinoNombre}`
      );
      limpiarFormulario();
      await loadInventario();
    } else {
      setError(result.error || 'Error al mover stock');
    }

    setMoviendo(false);
  };

  // Filtrar productos
  const productosFiltrados = busqueda.trim()
    ? inventario.filter((l) => {
        const term = busqueda.toLowerCase();
        return (
          l.marca.toLowerCase().includes(term) ||
          l.modelo.toLowerCase().includes(term) ||
          l.medida.toLowerCase().includes(term) ||
          generarCodigoAuxiliar(l.medida).toLowerCase().includes(term)
        );
      })
    : [];

  // Obtener stock disponible en bodega origen
  const stockDisponible = llantaSeleccionada && bodegaOrigen
    ? llantaSeleccionada.stockPorBodega[bodegaOrigen] || 0
    : 0;

  if (loading) {
    return (
      <div>
        <PageHeader title="Mover Stock" subtitle="Transferir inventario entre bodegas" />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-[var(--text-muted)]">Cargando...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Mover Stock"
        subtitle="Transferir inventario entre bodegas"
        breadcrumbs={[
          { label: 'Bodegas', href: '/bodegas' },
          { label: 'Mover Stock' },
        ]}
        actions={
          <Link href="/sistema/bodegas">
            <button className="btn btn-secondary">Volver a Bodegas</button>
          </Link>
        }
      />

      {/* Mensajes */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
          {success}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Buscar Producto */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold flex items-center gap-2">
              <Search className="w-5 h-5" />
              1. Seleccionar Producto
            </h2>
          </CardHeader>
          <CardBody>
            <div className="relative mb-4">
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

            {llantaSeleccionada ? (
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-mono text-sm text-[var(--text-muted)]">
                      {generarCodigoAuxiliar(llantaSeleccionada.medida)}
                    </p>
                    <p className="font-medium">
                      {llantaSeleccionada.marca} {llantaSeleccionada.modelo}
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">{llantaSeleccionada.medida}</p>
                  </div>
                  <button
                    onClick={() => setLlantaSeleccionada(null)}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Cambiar
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {SISTEMA_BODEGAS.map((b) => (
                    <div key={b.id} className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{b.nombre}:</span>
                      <span className="font-medium">{llantaSeleccionada.stockPorBodega[b.id] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : busqueda.trim() ? (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {productosFiltrados.length === 0 ? (
                  <p className="text-center text-[var(--text-muted)] py-4">
                    No se encontraron productos
                  </p>
                ) : (
                  productosFiltrados.map((llanta) => (
                    <button
                      key={llanta.id}
                      onClick={() => {
                        setLlantaSeleccionada(llanta);
                        setBusqueda('');
                      }}
                      className="w-full text-left p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <p className="font-mono text-sm text-[var(--text-muted)]">
                        {generarCodigoAuxiliar(llanta.medida)}
                      </p>
                      <p className="font-medium">{llanta.marca} {llanta.modelo}</p>
                      <p className="text-sm text-[var(--text-muted)]">{llanta.medida}</p>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>Escribe para buscar un producto</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Configurar Movimiento */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5" />
              2. Configurar Movimiento
            </h2>
          </CardHeader>
          <CardBody>
            {!llantaSeleccionada ? (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <ArrowRightLeft className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>Selecciona un producto primero</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Bodega Origen */}
                <div>
                  <label className="label">Bodega Origen</label>
                  <select
                    className="select w-full"
                    value={bodegaOrigen}
                    onChange={(e) => setBodegaOrigen(e.target.value as BodegaId)}
                  >
                    <option value="">Seleccionar bodega origen</option>
                    {SISTEMA_BODEGAS.filter(
                      (b) => (llantaSeleccionada.stockPorBodega[b.id] || 0) > 0
                    ).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre} ({llantaSeleccionada.stockPorBodega[b.id] || 0} disponibles)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Flecha */}
                <div className="flex justify-center">
                  <ArrowRight className="w-6 h-6 text-[var(--text-muted)]" />
                </div>

                {/* Bodega Destino */}
                <div>
                  <label className="label">Bodega Destino</label>
                  <select
                    className="select w-full"
                    value={bodegaDestino}
                    onChange={(e) => setBodegaDestino(e.target.value as BodegaId)}
                  >
                    <option value="">Seleccionar bodega destino</option>
                    {SISTEMA_BODEGAS.filter((b) => b.id !== bodegaOrigen).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre} ({llantaSeleccionada.stockPorBodega[b.id] || 0} actuales)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Cantidad */}
                <div>
                  <label className="label">
                    Cantidad a mover
                    {stockDisponible > 0 && (
                      <span className="text-[var(--text-muted)]"> (máx: {stockDisponible})</span>
                    )}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input w-full"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="1"
                  />
                </div>

                {/* Botón */}
                <button
                  onClick={handleMover}
                  disabled={moviendo || !bodegaOrigen || !bodegaDestino || !cantidad}
                  className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                  {moviendo ? (
                    <>
                      <span className="spinner" />
                      Moviendo...
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4" />
                      Mover Stock
                    </>
                  )}
                </button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
