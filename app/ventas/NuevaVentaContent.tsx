'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  Package,
  Wrench,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  ShieldCheck,
  CirclePlus,
  ScanBarcode,
} from 'lucide-react';
import { obtenerInventario } from '@/app/inventario/actions';
import { obtenerServicios } from '@/app/servicios/actions';
import { crearVenta } from './actions';
import { formatCurrency } from '@/lib/utils/formatters';
import { BODEGAS, CONFIG } from '@/lib/config';
import { getTotalStock, type Llanta, type Servicio, type BodegaId, type VentaInput } from '@/types';

type TabType = 'productos' | 'servicios';
type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';

interface CartItemProducto {
  tipo: 'producto';
  id: string;
  llanta: Llanta;
  bodega: BodegaId;
  cantidad: number;
  precioUnitario: number;
}

interface CartItemServicio {
  tipo: 'servicio';
  id: string;
  servicio: Servicio;
  cantidad: number;
  precioUnitario: number;
}

type CartItem = CartItemProducto | CartItemServicio;

interface NuevaVentaContentProps {
  defaultTab?: TabType;
}

export default function NuevaVentaContent({ defaultTab = 'productos' }: NuevaVentaContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const llantaIdParam = searchParams.get('llantaId');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Data
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Tab
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);

  // Product selection
  const [searchTerm, setSearchTerm] = useState('');
  const [productoSeleccionado, setProductoSeleccionado] = useState<Llanta | null>(null);
  const [bodegaSeleccionada, setBodegaSeleccionada] = useState<BodegaId | ''>('');
  const [cantidadProducto, setCantidadProducto] = useState(1);
  const [showDropdown, setShowDropdown] = useState(false);

  // Cart
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Client
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteTelefono, setClienteTelefono] = useState('');

  // Payment
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const [diasGarantia, setDiasGarantia] = useState<number>(0);
  const generarFactura = false;

  // Extra quick-add
  const [extraPrecio, setExtraPrecio] = useState('50');
  const [extraNota, setExtraNota] = useState('');

  // Barcode scanner
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [lastScannedService, setLastScannedService] = useState<string | null>(null);
  const barcodeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const barcodeBufferRef = useRef('');

  // Load data
  useEffect(() => {
    async function loadData() {
      setDataLoading(true);
      const [invResult, servResult] = await Promise.all([
        obtenerInventario(),
        obtenerServicios(),
      ]);

      if (invResult.success && invResult.data) {
        setInventario(invResult.data);
      }
      if (servResult.success && servResult.data) {
        setServicios(servResult.data.filter((s) => s.activo));
      }
      setDataLoading(false);
    }
    loadData();
  }, []);

  // Auto-select product from URL param
  useEffect(() => {
    if (llantaIdParam && inventario.length > 0 && !productoSeleccionado) {
      const llanta = inventario.find((l) => l.id === llantaIdParam);
      if (llanta) {
        setProductoSeleccionado(llanta);
        setSearchTerm(`${llanta.marca} ${llanta.modelo} - ${llanta.medida}`);
        setActiveTab('productos');
      }
    }
  }, [llantaIdParam, inventario, productoSeleccionado]);

  // Barcode scanner handler
  const handleBarcodeSubmit = useCallback((code: string) => {
    const servicio = servicios.find((s) => s.codigoBarras === code);
    if (servicio) {
      // Add service to cart (inline to avoid dependency on addServiceToCart)
      setCartItems((prevItems) => {
        const existingItem = prevItems.find(
          (item) => item.tipo === 'servicio' && item.id === servicio.id
        );
        if (existingItem) {
          return prevItems.map((item) =>
            item.tipo === 'servicio' && item.id === servicio.id
              ? { ...item, cantidad: item.cantidad + 1 }
              : item
          );
        } else {
          const newItem: CartItemServicio = {
            tipo: 'servicio',
            id: servicio.id,
            servicio,
            cantidad: 1,
            precioUnitario: servicio.precioDefault,
          };
          return [...prevItems, newItem];
        }
      });
      setLastScannedService(servicio.nombre);
      setTimeout(() => setLastScannedService(null), 2000);
    } else {
      setError(`Codigo de barras no encontrado: ${code}`);
      setTimeout(() => setError(''), 3000);
    }
  }, [servicios]);

  // Barcode scanner keyboard listener
  useEffect(() => {
    if (activeTab !== 'servicios') {
      // Clear buffer when leaving servicios tab
      barcodeBufferRef.current = '';
      setBarcodeBuffer('');
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is on an input element
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      // Clear timeout on each keystroke
      if (barcodeTimeoutRef.current) {
        clearTimeout(barcodeTimeoutRef.current);
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const code = barcodeBufferRef.current.trim();
        if (code) {
          handleBarcodeSubmit(code);
        }
        barcodeBufferRef.current = '';
        setBarcodeBuffer('');
        return;
      }

      // Only accept alphanumeric characters for barcode
      if (e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        barcodeBufferRef.current += e.key.toUpperCase();
        setBarcodeBuffer(barcodeBufferRef.current);

        // Auto-clear buffer after 500ms of inactivity (scanner types fast)
        barcodeTimeoutRef.current = setTimeout(() => {
          barcodeBufferRef.current = '';
          setBarcodeBuffer('');
        }, 500);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (barcodeTimeoutRef.current) {
        clearTimeout(barcodeTimeoutRef.current);
      }
    };
  }, [activeTab, handleBarcodeSubmit]);

  // Filtered products for search
  const filteredProducts = inventario.filter((l) => {
    if (!searchTerm.trim()) return false;
    const term = searchTerm.toLowerCase();
    return (
      l.marca.toLowerCase().includes(term) ||
      l.modelo.toLowerCase().includes(term) ||
      l.medida.toLowerCase().includes(term) ||
      `${l.marca} ${l.modelo}`.toLowerCase().includes(term) ||
      `${l.marca} ${l.modelo} ${l.medida}`.toLowerCase().includes(term)
    );
  });

  // Select a product from dropdown
  const selectProduct = (llanta: Llanta) => {
    setProductoSeleccionado(llanta);
    setSearchTerm(`${llanta.marca} ${llanta.modelo} - ${llanta.medida}`);
    setShowDropdown(false);
    setBodegaSeleccionada('');
    setCantidadProducto(1);
  };

  // Add product to cart
  const addProductToCart = () => {
    if (!productoSeleccionado || !bodegaSeleccionada) return;

    const stockEnBodega = productoSeleccionado.stockPorBodega[bodegaSeleccionada] || 0;

    const existingItem = cartItems.find(
      (item) =>
        item.tipo === 'producto' &&
        item.id === productoSeleccionado.id &&
        (item as CartItemProducto).bodega === bodegaSeleccionada
    ) as CartItemProducto | undefined;

    const alreadyInCart = existingItem ? existingItem.cantidad : 0;
    const available = stockEnBodega - alreadyInCart;

    if (cantidadProducto > available) {
      setError(`Solo hay ${available} unidades disponibles en esta bodega${alreadyInCart > 0 ? ` (${alreadyInCart} ya en el carrito)` : ''}`);
      return;
    }

    if (cantidadProducto <= 0) {
      setError('La cantidad debe ser mayor a 0');
      return;
    }

    if (existingItem) {
      setCartItems(
        cartItems.map((item) =>
          item.tipo === 'producto' &&
          item.id === productoSeleccionado.id &&
          (item as CartItemProducto).bodega === bodegaSeleccionada
            ? { ...item, cantidad: item.cantidad + cantidadProducto }
            : item
        )
      );
    } else {
      const newItem: CartItemProducto = {
        tipo: 'producto',
        id: productoSeleccionado.id,
        llanta: productoSeleccionado,
        bodega: bodegaSeleccionada,
        cantidad: cantidadProducto,
        precioUnitario: productoSeleccionado.precioVenta,
      };
      setCartItems([...cartItems, newItem]);
    }

    setProductoSeleccionado(null);
    setSearchTerm('');
    setBodegaSeleccionada('');
    setCantidadProducto(1);
    setError('');
  };

  // Add service to cart
  const addServiceToCart = (servicio: Servicio) => {
    const existingItem = cartItems.find(
      (item) => item.tipo === 'servicio' && item.id === servicio.id
    );

    if (existingItem) {
      setCartItems(
        cartItems.map((item) =>
          item.tipo === 'servicio' && item.id === servicio.id
            ? { ...item, cantidad: item.cantidad + 1 }
            : item
        )
      );
    } else {
      const newItem: CartItemServicio = {
        tipo: 'servicio',
        id: servicio.id,
        servicio,
        cantidad: 1,
        precioUnitario: servicio.precioDefault,
      };
      setCartItems([...cartItems, newItem]);
    }
  };

  // Add extra to cart (always new line item)
  const addExtraToCart = () => {
    const precio = parseFloat(extraPrecio) || 0;
    if (precio <= 0) return;

    const extraServicio = servicios.find((s) => s.nombre === 'Extra / Material');
    if (!extraServicio) {
      setError('Servicio "Extra / Material" no encontrado. Agrégalo en /servicios');
      return;
    }

    const newItem: CartItemServicio = {
      tipo: 'servicio',
      id: extraServicio.id,
      servicio: {
        ...extraServicio,
        descripcion: extraNota.trim() || extraServicio.descripcion,
      },
      cantidad: 1,
      precioUnitario: precio,
    };
    setCartItems([...cartItems, newItem]);
    setExtraPrecio('50');
    setExtraNota('');
  };

  // Update item quantity
  const updateItemQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      removeItem(index);
      return;
    }

    const item = cartItems[index];
    if (item.tipo === 'producto') {
      const productItem = item as CartItemProducto;
      const stockEnBodega = productItem.llanta.stockPorBodega[productItem.bodega] || 0;
      if (newQty > stockEnBodega) {
        setError(`Solo hay ${stockEnBodega} unidades disponibles`);
        return;
      }
    }

    setCartItems(
      cartItems.map((cartItem, i) => (i === index ? { ...cartItem, cantidad: newQty } : cartItem))
    );
    setError('');
  };

  // Update service price inline
  const updateItemPrice = (index: number, newPrice: number) => {
    setCartItems(
      cartItems.map((item, i) => (i === index ? { ...item, precioUnitario: newPrice } : item))
    );
  };

  // Remove item from cart
  const removeItem = (index: number) => {
    setCartItems(cartItems.filter((_, i) => i !== index));
  };

  // Calculations
  const subtotal = cartItems.reduce((acc, item) => acc + item.precioUnitario * item.cantidad, 0);
  const total = subtotal;

  // Check if cart has products (not just services)
  const hasProducts = cartItems.some((item) => item.tipo === 'producto');

  // Submit sale
  const handleSubmit = async () => {
    if (cartItems.length === 0) {
      setError('Agrega al menos un producto o servicio');
      return;
    }

    // Client name required only if there are products
    if (hasProducts && !clienteNombre.trim()) {
      setError('Ingresa el nombre del cliente');
      return;
    }

    setLoading(true);
    setError('');

    const input: VentaInput = {
      clienteNombre: clienteNombre.trim() || 'Cliente general',
      clienteTelefono: clienteTelefono.trim() || undefined,
      items: cartItems.map((item) => {
        if (item.tipo === 'producto') {
          const prodItem = item as CartItemProducto;
          return {
            tipo: 'producto' as const,
            id: prodItem.id,
            cantidad: prodItem.cantidad,
            bodega: prodItem.bodega,
            precioCustom: prodItem.precioUnitario !== prodItem.llanta.precioVenta ? prodItem.precioUnitario : undefined,
          };
        } else {
          const servItem = item as CartItemServicio;
          return {
            tipo: 'servicio' as const,
            id: servItem.id,
            cantidad: servItem.cantidad,
            precioCustom: servItem.precioUnitario !== servItem.servicio.precioDefault ? servItem.precioUnitario : undefined,
          };
        }
      }),
      metodoPago,
      diasGarantia,
      generarFactura,
    };

    const result = await crearVenta(input);

    if (result.success && result.data) {
      router.push(`/ventas/${result.data.id}`);
    } else {
      setError(result.error || 'Error al crear la venta');
      setLoading(false);
    }
  };

  const getBodegaNombre = (id: BodegaId) => {
    return BODEGAS.find((b) => b.id === id)?.nombre || id;
  };

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
        <span className="ml-3 text-gray-500">Cargando datos...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <nav className="text-sm text-gray-500 mb-2">
          <a href="/ventas" className="hover:text-gray-700">Ventas</a>
          <span className="mx-2">/</span>
          <span className="text-gray-700">Nueva Venta</span>
        </nav>
        <h1 className="page-title">Nueva Venta</h1>
        <p className="page-subtitle">Registra productos y servicios para la venta</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN: Products/Services and Cart */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="card">
            <div className="flex border-b">
              <button
                type="button"
                onClick={() => setActiveTab('productos')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'productos'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Package className="w-4 h-4" />
                Productos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('servicios')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'servicios'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Wrench className="w-4 h-4" />
                Servicios
              </button>
            </div>

            <div className="card-body">
              {/* Products Tab */}
              {activeTab === 'productos' && (
                <div className="space-y-4">
                  {/* Search */}
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        className="input"
                        style={{ paddingLeft: '2.5rem' }}
                        placeholder="Buscar producto por marca, modelo o medida..."
                        value={searchTerm}
                        onChange={(e) => {
                          setSearchTerm(e.target.value);
                          setShowDropdown(true);
                          if (!e.target.value.trim()) {
                            setProductoSeleccionado(null);
                          }
                        }}
                        onFocus={() => {
                          if (searchTerm.trim()) setShowDropdown(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => setShowDropdown(false), 200);
                        }}
                      />
                    </div>

                    {/* Dropdown Results */}
                    {showDropdown && filteredProducts.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredProducts.map((llanta) => {
                          const totalStock = getTotalStock(llanta);
                          return (
                            <button
                              key={llanta.id}
                              type="button"
                              className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between border-b last:border-b-0"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectProduct(llanta);
                              }}
                            >
                              <div>
                                <p className="font-medium text-sm">
                                  {llanta.marca} {llanta.modelo}
                                </p>
                                <p className="text-xs text-gray-500">{llanta.medida}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-medium text-sm text-blue-600">
                                  {formatCurrency(llanta.precioVenta)}
                                </p>
                                <p className="text-xs text-gray-500">{totalStock} disponibles</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {showDropdown && searchTerm.trim() && filteredProducts.length === 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-sm text-gray-500">
                        No se encontraron productos
                      </div>
                    )}
                  </div>

                  {/* Selected Product Info */}
                  {productoSeleccionado && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-semibold text-blue-900">
                            {productoSeleccionado.marca} {productoSeleccionado.modelo}
                          </h4>
                          <p className="text-sm text-blue-700">{productoSeleccionado.medida}</p>
                          <p className="text-lg font-bold text-blue-800 mt-1">
                            {formatCurrency(productoSeleccionado.precioVenta)}
                          </p>
                        </div>
                      </div>

                      {/* Stock per bodega */}
                      <div className="mb-4">
                        <p className="text-xs font-medium text-blue-800 mb-2">Stock por bodega:</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {BODEGAS.map((bodega) => {
                            const stock = productoSeleccionado.stockPorBodega[bodega.id] || 0;
                            return (
                              <div
                                key={bodega.id}
                                className={`text-center p-2 rounded text-xs ${
                                  stock > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-400'
                                }`}
                              >
                                <p className="font-medium">{bodega.nombre}</p>
                                <p className="text-lg font-bold">{stock}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Bodega selection + Quantity + Add button */}
                      <div className="flex gap-3 items-end">
                        <div className="flex-1">
                          <label className="label text-blue-800">Bodega</label>
                          <select
                            className="select"
                            value={bodegaSeleccionada}
                            onChange={(e) => {
                              setBodegaSeleccionada(e.target.value as BodegaId);
                              setCantidadProducto(1);
                            }}
                          >
                            <option value="" disabled>Seleccionar bodega</option>
                            {BODEGAS.filter((b) => (productoSeleccionado.stockPorBodega[b.id] || 0) > 0).map(
                              (bodega) => (
                                <option key={bodega.id} value={bodega.id}>
                                  {bodega.nombre} ({productoSeleccionado.stockPorBodega[bodega.id]} disp.)
                                </option>
                              )
                            )}
                          </select>
                        </div>
                        <div className="w-24">
                          <label className="label text-blue-800">Cantidad</label>
                          <input
                            type="number"
                            className="input"
                            min={1}
                            max={
                              bodegaSeleccionada
                                ? productoSeleccionado.stockPorBodega[bodegaSeleccionada] || 0
                                : 1
                            }
                            value={cantidadProducto}
                            onChange={(e) => setCantidadProducto(parseInt(e.target.value) || 1)}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary flex items-center gap-2"
                          onClick={addProductToCart}
                          disabled={!bodegaSeleccionada}
                        >
                          <Plus className="w-4 h-4" />
                          Agregar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Services Tab */}
              {activeTab === 'servicios' && (
                <div className="space-y-4">
                  {/* Barcode Scanner Indicator */}
                  <div className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                    barcodeBuffer
                      ? 'border-green-400 bg-green-50'
                      : 'border-dashed border-gray-300 bg-gray-50'
                  }`}>
                    <ScanBarcode className={`w-5 h-5 ${barcodeBuffer ? 'text-green-600' : 'text-gray-400'}`} />
                    <div className="flex-1">
                      {barcodeBuffer ? (
                        <p className="text-sm font-mono font-bold text-green-700">{barcodeBuffer}</p>
                      ) : (
                        <p className="text-sm text-gray-500">Escanea un codigo de barras o haz clic en un servicio</p>
                      )}
                    </div>
                    {lastScannedService && (
                      <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full animate-pulse">
                        {lastScannedService} agregado
                      </span>
                    )}
                  </div>

                  {servicios.length === 0 ? (
                    <p className="text-center py-8 text-gray-500">No hay servicios configurados</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {servicios.map((servicio) => (
                        <button
                          key={servicio.id}
                          type="button"
                          onClick={() => addServiceToCart(servicio)}
                          className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-left group"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Wrench className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                            <span className="font-medium text-sm">{servicio.nombre}</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-1 line-clamp-2">{servicio.descripcion}</p>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-blue-600">
                              {formatCurrency(servicio.precioDefault)}
                            </p>
                            <span className="text-xs font-mono text-gray-400">{servicio.codigoBarras}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          {/* Client Section */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Cliente</h2>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    Nombre del cliente {hasProducts && <span className="text-red-600">*</span>}
                    {!hasProducts && <span className="text-gray-400 text-xs ml-1">(opcional)</span>}
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder={hasProducts ? 'Nombre del cliente' : 'Cliente general'}
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Telefono (opcional)</label>
                  <input
                    type="tel"
                    className="input"
                    placeholder="Telefono"
                    value={clienteTelefono}
                    onChange={(e) => setClienteTelefono(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Payment, Summary */}
        <div className="space-y-6">
          {/* Payment Method */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Metodo de Pago</h2>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setMetodoPago('efectivo')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                    metodoPago === 'efectivo'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-500'
                  }`}
                >
                  <Banknote className="w-6 h-6" />
                  <span className="text-xs font-medium">Efectivo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMetodoPago('tarjeta')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                    metodoPago === 'tarjeta'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-500'
                  }`}
                >
                  <CreditCard className="w-6 h-6" />
                  <span className="text-xs font-medium">Tarjeta</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMetodoPago('transferencia')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                    metodoPago === 'transferencia'
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-500'
                  }`}
                >
                  <ArrowLeftRight className="w-6 h-6" />
                  <span className="text-xs font-medium">Transferencia</span>
                </button>
              </div>
            </div>
          </div>

          {/* Cart / Items List */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold">
                Productos y servicios ({cartItems.length})
              </h2>
              <div className="text-right">
                <span className="text-sm text-gray-500 mr-2">Total:</span>
                <span className="text-xl font-bold text-blue-600">{formatCurrency(total)}</span>
              </div>
            </div>
            <div className="card-body p-0">
              {cartItems.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Agrega productos o servicios</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {cartItems.map((item, index) => (
                    <div
                      key={`${item.tipo}-${item.id}-${index}`}
                      className="flex items-center gap-3 p-3"
                    >
                      {/* Icon */}
                      <div className={`p-1.5 rounded shrink-0 ${
                        item.tipo === 'producto' ? 'bg-blue-100' : 'bg-amber-100'
                      }`}>
                        {item.tipo === 'producto' ? (
                          <Package className="w-3 h-3 text-blue-600" />
                        ) : (
                          <Wrench className="w-3 h-3 text-amber-600" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        {item.tipo === 'producto' ? (
                          <p className="font-medium text-sm">
                            {(item as CartItemProducto).llanta.marca}{' '}
                            {(item as CartItemProducto).llanta.modelo}
                          </p>
                        ) : (
                          <p className="font-medium text-sm">
                            {(item as CartItemServicio).servicio.nombre}
                          </p>
                        )}
                      </div>

                      {/* Quantity controls */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateItemQuantity(index, item.cantidad - 1)}
                          className="p-0.5 rounded hover:bg-gray-200 text-gray-500"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-xs font-medium">{item.cantidad}</span>
                        <button
                          type="button"
                          onClick={() => updateItemQuantity(index, item.cantidad + 1)}
                          className="p-0.5 rounded hover:bg-gray-200 text-gray-500"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Price */}
                      <div className="w-20 text-right shrink-0">
                        <p className="font-medium text-sm">
                          {formatCurrency(item.precioUnitario * item.cantidad)}
                        </p>
                      </div>

                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Warranty */}
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-gray-500" />
                <h2 className="font-semibold">Garantia</h2>
              </div>
            </div>
            <div className="card-body">
              <label className="label">Dias de garantia</label>
              <select
                className="select"
                value={diasGarantia}
                onChange={(e) => setDiasGarantia(parseInt(e.target.value))}
              >
                <option value={0}>No aplica</option>
                <option value={30}>30 dias</option>
                <option value={60}>60 dias</option>
                <option value={90}>90 dias</option>
                <option value={180}>180 dias</option>
                <option value={365}>1 ano</option>
              </select>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || cartItems.length === 0}
            className={`w-full py-4 px-6 rounded-lg text-white font-bold text-lg transition-all ${
              loading || cartItems.length === 0
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-lg hover:shadow-xl'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Procesando...
              </span>
            ) : (
              `Completar Venta - ${formatCurrency(total)}`
            )}
          </button>

          <button
            type="button"
            onClick={() => router.back()}
            className="w-full py-2 px-4 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
