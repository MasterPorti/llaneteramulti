'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Plus, Trash2, Search, Package, Save, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { buscarLlantas, obtenerInventario } from '../../inventario/actions';
import { crearVenta } from '../actions';
import { SISTEMA_BODEGAS, SISTEMA_CONFIG, generarCodigoAuxiliar } from '@/lib/config-sistema';
import { formatCurrency } from '@/lib/utils/formatters';
import type { Llanta, BodegaId, LlantaSuggestion } from '@/types';

interface ItemVenta {
  llanta: Llanta;
  bodega: BodegaId;
  cantidad: number;
  precioUnitario: number;
}

export default function NuevaVentaPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Inventario para selección
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<LlantaSuggestion[]>([]);

  // Items de la venta
  const [items, setItems] = useState<ItemVenta[]>([]);

  // Datos del cliente
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteTelefono, setClienteTelefono] = useState('');
  const [metodoPago, setMetodoPago] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo');

  useEffect(() => {
    loadInventario();
  }, []);

  const loadInventario = async () => {
    const result = await obtenerInventario();
    if (result.success && result.data) {
      setInventario(result.data);
    }
  };

  const handleBusqueda = async (term: string) => {
    setBusqueda(term);
    if (term.trim().length >= 2) {
      const result = await buscarLlantas(term);
      if (result.success && result.data) {
        setSugerencias(result.data);
      }
    } else {
      setSugerencias([]);
    }
  };

  const agregarItem = (llanta: Llanta) => {
    // Encontrar primera bodega con stock
    const bodegaConStock = SISTEMA_BODEGAS.find(
      (b) => (llanta.stockPorBodega[b.id] || 0) > 0
    );

    if (!bodegaConStock) {
      setError(`${llanta.marca} ${llanta.modelo} no tiene stock disponible`);
      return;
    }

    // Verificar si ya está en la lista
    const existente = items.find(
      (i) => i.llanta.id === llanta.id && i.bodega === bodegaConStock.id
    );
    if (existente) {
      setError('Este producto ya está en la lista');
      return;
    }

    setItems([
      ...items,
      {
        llanta,
        bodega: bodegaConStock.id,
        cantidad: 1,
        precioUnitario: llanta.precioVenta,
      },
    ]);

    setBusqueda('');
    setSugerencias([]);
    setError('');
  };

  const actualizarItem = (index: number, updates: Partial<ItemVenta>) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], ...updates };
    setItems(newItems);
  };

  const eliminarItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const calcularTotal = () => {
    return items.reduce((acc, item) => acc + item.cantidad * item.precioUnitario, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (items.length === 0) {
      setError('Agrega al menos un producto');
      return;
    }

    if (!clienteNombre.trim()) {
      setError('Ingresa el nombre del cliente');
      return;
    }

    // Validar stock
    for (const item of items) {
      const stockDisponible = item.llanta.stockPorBodega[item.bodega] || 0;
      if (item.cantidad > stockDisponible) {
        setError(
          `Stock insuficiente para ${item.llanta.marca} ${item.llanta.modelo}. Disponible: ${stockDisponible}`
        );
        return;
      }
    }

    setLoading(true);
    setError('');

    const result = await crearVenta({
      clienteNombre: clienteNombre.trim(),
      clienteTelefono: clienteTelefono.trim() || undefined,
      items: items.map((item) => ({
        llantaId: item.llanta.id,
        bodega: item.bodega,
        cantidad: item.cantidad,
        precioCustom: item.precioUnitario !== item.llanta.precioVenta ? item.precioUnitario : undefined,
      })),
      metodoPago,
    });

    if (result.success && result.data) {
      router.push(`/sistema/ventas/${result.data.id}`);
    } else {
      setError(result.error || 'Error al crear venta');
    }

    setLoading(false);
  };

  return (
    <div>
      <PageHeader
        title="Nueva Venta"
        subtitle="Registrar venta de llantas"
        breadcrumbs={[
          { label: 'Ventas', href: '/ventas' },
          { label: 'Nueva Venta' },
        ]}
        actions={
          <Link href="/sistema/ventas">
            <button className="btn btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Volver
            </button>
          </Link>
        }
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Columna Principal */}
          <div className="lg:col-span-2 space-y-6">
            {/* Buscar Productos */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Agregar Productos
                </h2>
              </CardHeader>
              <CardBody>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    className="input w-full"
                    style={{ paddingLeft: '2.5rem' }}
                    placeholder="Buscar por marca, modelo, medida..."
                    value={busqueda}
                    onChange={(e) => handleBusqueda(e.target.value)}
                  />
                </div>

                {sugerencias.length > 0 && (
                  <div className="mt-2 border border-[var(--border-color)] rounded-lg overflow-hidden">
                    {sugerencias.map((s) => {
                      const llanta = inventario.find((l) => l.id === s.id);
                      if (!llanta) return null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => agregarItem(llanta)}
                          className="w-full text-left p-3 hover:bg-[var(--bg-hover)] transition-colors flex justify-between items-center border-b border-[var(--border-color)] last:border-b-0"
                        >
                          <div>
                            <p className="font-mono text-sm text-[var(--text-muted)]">
                              {generarCodigoAuxiliar(s.medida)}
                            </p>
                            <p className="font-medium">{s.marca} {s.modelo}</p>
                            <p className="text-sm text-[var(--text-muted)]">{s.medida}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold">{formatCurrency(s.precioVenta)}</p>
                            <Badge variant={s.stockTotal > 0 ? 'success' : 'danger'}>
                              {s.stockTotal} disp.
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Items de la Venta */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" />
                  Productos ({items.length})
                </h2>
              </CardHeader>
              <CardBody>
                {items.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-muted)]">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>Busca y agrega productos a la venta</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {items.map((item, index) => {
                      const stockDisponible = item.llanta.stockPorBodega[item.bodega] || 0;
                      return (
                        <div
                          key={`${item.llanta.id}-${item.bodega}`}
                          className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="font-mono text-sm text-[var(--text-muted)]">
                                {generarCodigoAuxiliar(item.llanta.medida)}
                              </p>
                              <p className="font-medium">{item.llanta.marca} {item.llanta.modelo}</p>
                              <p className="text-sm text-[var(--text-muted)]">{item.llanta.medida}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => eliminarItem(index)}
                              className="p-1 text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="label text-xs">Bodega</label>
                              <select
                                className="select w-full text-sm"
                                value={item.bodega}
                                onChange={(e) =>
                                  actualizarItem(index, { bodega: e.target.value as BodegaId })
                                }
                              >
                                {SISTEMA_BODEGAS.filter(
                                  (b) => (item.llanta.stockPorBodega[b.id] || 0) > 0
                                ).map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.nombre} ({item.llanta.stockPorBodega[b.id]})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="label text-xs">Cantidad (máx: {stockDisponible})</label>
                              <input
                                type="number"
                                className="input w-full text-sm"
                                min="1"
                                max={stockDisponible}
                                value={item.cantidad}
                                onChange={(e) =>
                                  actualizarItem(index, { cantidad: parseInt(e.target.value) || 1 })
                                }
                              />
                            </div>
                            <div>
                              <label className="label text-xs">Precio Unit.</label>
                              <input
                                type="number"
                                className="input w-full text-sm"
                                min="0"
                                step="0.01"
                                value={item.precioUnitario}
                                onChange={(e) =>
                                  actualizarItem(index, {
                                    precioUnitario: parseFloat(e.target.value) || 0,
                                  })
                                }
                              />
                            </div>
                          </div>

                          <div className="mt-2 text-right">
                            <span className="text-sm text-[var(--text-muted)]">Subtotal: </span>
                            <span className="font-bold">
                              {formatCurrency(item.cantidad * item.precioUnitario)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Columna Lateral */}
          <div className="space-y-6">
            {/* Datos del Cliente */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Datos del Cliente</h2>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <label className="label">Nombre *</label>
                  <input
                    type="text"
                    className="input w-full"
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                    placeholder="Nombre del cliente"
                    required
                  />
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input
                    type="tel"
                    className="input w-full"
                    value={clienteTelefono}
                    onChange={(e) => setClienteTelefono(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
                <div>
                  <label className="label">Método de Pago</label>
                  <select
                    className="select w-full"
                    value={metodoPago}
                    onChange={(e) =>
                      setMetodoPago(e.target.value as 'efectivo' | 'tarjeta' | 'transferencia')
                    }
                  >
                    {SISTEMA_CONFIG.metodosPago.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </CardBody>
            </Card>

            {/* Resumen */}
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Resumen</h2>
              </CardHeader>
              <CardBody>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Productos</span>
                    <span>{items.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Unidades</span>
                    <span>{items.reduce((acc, i) => acc + i.cantidad, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Garantía</span>
                    <span>{SISTEMA_CONFIG.garantiaDiasPredeterminado} días</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-[var(--border-color)]">
                  <div className="flex justify-between items-center mb-4">
                    <span className="font-bold text-lg">Total</span>
                    <span className="font-bold text-2xl">{formatCurrency(calcularTotal())}</span>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || items.length === 0}
                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <span className="spinner" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Completar Venta
                      </>
                    )}
                  </button>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
