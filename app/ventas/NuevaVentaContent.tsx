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
  CirclePlus,
  ScanBarcode,
  ShoppingBag,
} from 'lucide-react';
import { obtenerInventario } from '@/app/llantas/actions';
import { obtenerServicios } from '@/app/servicios/actions';
import { obtenerProductos } from '@/app/productos/actions';
import { crearVenta } from './actions';
import { formatCurrency } from '@/lib/utils/formatters';
import { getTotalStock, type Llanta, type Servicio, type Producto, type VentaInput } from '@/types';

type TabType = 'servicios' | 'productos' | 'llantas';
type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';

interface CartItemLlanta {
  tipo: 'producto';
  id: string;
  llanta: Llanta;
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

interface CartItemExtra {
  tipo: 'extra';
  id: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
}

interface CartItemCatalogo {
  tipo: 'catalogo';
  id: string;
  producto: Producto;
  cantidad: number;
  precioUnitario: number;
}

type CartItem = CartItemLlanta | CartItemServicio | CartItemExtra | CartItemCatalogo;

interface NuevaVentaContentProps {
  defaultTab?: TabType;
}

export default function NuevaVentaContent({ defaultTab = 'servicios' }: NuevaVentaContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const llantaIdParam = searchParams.get('llantaId');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Data
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [catalogoProductos, setCatalogoProductos] = useState<Producto[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Tab
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);

  // Llantas tab selection
  const [searchTerm, setSearchTerm] = useState('');
  const [productoSeleccionado, setProductoSeleccionado] = useState<Llanta | null>(null);
  const [cantidadProducto, setCantidadProducto] = useState(1);

  // Cart
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Client
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteTelefono, setClienteTelefono] = useState('');

  // Payment
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const generarFactura = false;

  // Editable prices in cart (index -> string value while typing)
  const [editingPrices, setEditingPrices] = useState<Record<number, string>>({});

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
      const [invResult, servResult, prodResult] = await Promise.all([
        obtenerInventario(),
        obtenerServicios(),
        obtenerProductos(),
      ]);

      if (invResult.success && invResult.data) {
        setInventario(invResult.data);
      }
      if (servResult.success && servResult.data) {
        setServicios(servResult.data.filter((s) => s.activo));
      }
      if (prodResult.success && prodResult.data) {
        setCatalogoProductos(prodResult.data);
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
        setActiveTab('llantas');
      }
    }
  }, [llantaIdParam, inventario, productoSeleccionado]);

  // Barcode scanner handler
  const handleBarcodeSubmit = useCallback((code: string) => {
    const servicio = servicios.find((s) => s.codigoBarras === code);
    if (servicio) {
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
      barcodeBufferRef.current = '';
      setBarcodeBuffer('');
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

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

      if (e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        barcodeBufferRef.current += e.key.toUpperCase();
        setBarcodeBuffer(barcodeBufferRef.current);

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

  // Filtered llantas for search
  const filteredProducts = inventario.filter((l) => {
    if (!searchTerm.trim()) return getTotalStock(l) > 0;
    const term = searchTerm.toLowerCase();
    const termNorm = term.replace(/[/rR\s-]/g, '');
    const medidaNorm = l.medida.toLowerCase().replace(/[/rR\s-]/g, '');
    return (
      l.marca.toLowerCase().includes(term) ||
      l.modelo.toLowerCase().includes(term) ||
      l.medida.toLowerCase().includes(term) ||
      medidaNorm.includes(termNorm) ||
      `${l.marca} ${l.modelo}`.toLowerCase().includes(term) ||
      `${l.marca} ${l.modelo} ${l.medida}`.toLowerCase().includes(term)
    );
  });

  // Add llanta to cart (always uses bodega-1)
  const addProductToCart = () => {
    if (!productoSeleccionado) return;

    const stockDisponible = getTotalStock(productoSeleccionado);

    const existingItem = cartItems.find(
      (item) => item.tipo === 'producto' && item.id === productoSeleccionado.id
    ) as CartItemLlanta | undefined;

    const alreadyInCart = existingItem ? existingItem.cantidad : 0;
    const available = stockDisponible - alreadyInCart;

    if (cantidadProducto > available) {
      setError(`Solo hay ${available} unidades disponibles${alreadyInCart > 0 ? ` (${alreadyInCart} ya en el carrito)` : ''}`);
      return;
    }

    if (cantidadProducto <= 0) {
      setError('La cantidad debe ser mayor a 0');
      return;
    }

    if (existingItem) {
      setCartItems(
        cartItems.map((item) =>
          item.tipo === 'producto' && item.id === productoSeleccionado.id
            ? { ...item, cantidad: item.cantidad + cantidadProducto }
            : item
        )
      );
    } else {
      const newItem: CartItemLlanta = {
        tipo: 'producto',
        id: productoSeleccionado.id,
        llanta: productoSeleccionado,
        cantidad: cantidadProducto,
        precioUnitario: productoSeleccionado.precioVenta,
      };
      setCartItems([...cartItems, newItem]);
    }

    setProductoSeleccionado(null);
    setSearchTerm('');
    setCantidadProducto(1);
    setError('');
  };

  // Add catalog product to cart
  const addCatalogoToCart = (producto: Producto) => {
    if (producto.stock === 0) return;

    const existing = cartItems.find(
      (item) => item.tipo === 'catalogo' && item.id === producto.id
    ) as CartItemCatalogo | undefined;

    const alreadyInCart = existing ? existing.cantidad : 0;
    if (alreadyInCart >= producto.stock) {
      setError(`Solo hay ${producto.stock} unidades disponibles de "${producto.nombre}"`);
      return;
    }

    if (existing) {
      setCartItems(cartItems.map((item) =>
        item.tipo === 'catalogo' && item.id === producto.id
          ? { ...item, cantidad: item.cantidad + 1 }
          : item
      ));
    } else {
      const newItem: CartItemCatalogo = {
        tipo: 'catalogo',
        id: producto.id,
        producto,
        cantidad: 1,
        precioUnitario: producto.precio,
      };
      setCartItems([...cartItems, newItem]);
    }
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

  // Add extra to cart (quick-add in servicios tab)
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
      const productItem = item as CartItemLlanta;
      const stockDisponible = getTotalStock(productItem.llanta);
      if (newQty > stockDisponible) {
        setError(`Solo hay ${stockDisponible} unidades disponibles`);
        return;
      }
    } else if (item.tipo === 'catalogo') {
      const catItem = item as CartItemCatalogo;
      if (newQty > catItem.producto.stock) {
        setError(`Solo hay ${catItem.producto.stock} unidades disponibles`);
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

  // Submit sale
  const handleSubmit = async () => {
    if (cartItems.length === 0) {
      setError('Agrega al menos un producto o servicio');
      return;
    }


    setLoading(true);
    setError('');

    const input: VentaInput = {
      clienteNombre: clienteNombre.trim() || 'Cliente general',
      clienteTelefono: clienteTelefono.trim() || undefined,
      items: cartItems.map((item) => {
        if (item.tipo === 'producto') {
          const prodItem = item as CartItemLlanta;
          return {
            tipo: 'producto' as const,
            id: prodItem.id,
            cantidad: prodItem.cantidad,
            bodega: 'bodega-1' as const,
            precioCustom: prodItem.precioUnitario !== prodItem.llanta.precioVenta ? prodItem.precioUnitario : undefined,
          };
        } else if (item.tipo === 'catalogo') {
          const catItem = item as CartItemCatalogo;
          return {
            tipo: 'catalogo' as const,
            id: catItem.id,
            cantidad: catItem.cantidad,
            precioCustom: catItem.precioUnitario !== catItem.producto.precio ? catItem.precioUnitario : undefined,
          };
        } else if (item.tipo === 'extra') {
          const extraItem = item as CartItemExtra;
          return {
            tipo: 'extra' as const,
            id: extraItem.id,
            nombre: extraItem.nombre,
            cantidad: extraItem.cantidad,
            precioCustom: extraItem.precioUnitario,
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
      diasGarantia: 0,
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
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="card">
            <div className="flex border-b">
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
              <button
                type="button"
                onClick={() => setActiveTab('productos')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'productos'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                Productos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('llantas')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'llantas'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Package className="w-4 h-4" />
                Llantas
              </button>
            </div>

            <div className="card-body">
              {/* Servicios Tab */}
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

                  {/* Quick-add extra */}
                  <div className="border-t pt-4">
                    <p className="text-xs font-medium text-gray-500 mb-2">Extra / Material adicional</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input flex-1"
                        placeholder="Nota (opcional)"
                        value={extraNota}
                        onChange={(e) => setExtraNota(e.target.value)}
                      />
                      <input
                        type="number"
                        className="input w-24"
                        placeholder="Precio"
                        value={extraPrecio}
                        onChange={(e) => setExtraPrecio(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary flex items-center gap-1"
                        onClick={addExtraToCart}
                      >
                        <CirclePlus className="w-4 h-4" />
                        Agregar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Productos Tab (catalog) */}
              {activeTab === 'productos' && (
                <div className="space-y-4">
                  {catalogoProductos.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No hay productos en el catálogo.</p>
                      <a href="/productos/nuevo" className="text-blue-500 text-sm hover:underline">
                        Agregar productos
                      </a>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {catalogoProductos.map((producto) => {
                        const enCarrito = cartItems
                          .filter((i) => i.tipo === 'catalogo' && i.id === producto.id)
                          .reduce((s, i) => s + i.cantidad, 0);
                        const disponible = producto.stock - enCarrito;
                        return (
                          <button
                            key={producto.id}
                            type="button"
                            onClick={() => addCatalogoToCart(producto)}
                            disabled={disponible <= 0}
                            className={`p-4 border-2 rounded-lg transition-all text-left group ${
                              disponible > 0
                                ? 'border-gray-200 hover:border-orange-400 hover:bg-orange-50'
                                : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <ShoppingBag className="w-4 h-4 text-gray-400 group-hover:text-orange-500 shrink-0" />
                              <span className="font-medium text-sm line-clamp-1">{producto.nombre}</span>
                            </div>
                            {producto.descripcion && (
                              <p className="text-xs text-gray-500 mb-1 line-clamp-1">{producto.descripcion}</p>
                            )}
                            <div className="flex items-center justify-between mt-2">
                              <p className="text-sm font-bold text-orange-600">
                                {formatCurrency(producto.precio)}
                              </p>
                              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                disponible > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                              }`}>
                                {disponible} disp.
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Llantas Tab */}
              {activeTab === 'llantas' && (
                <div className="space-y-4">
                  {/* Search filter */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      className="input"
                      style={{ paddingLeft: '2.5rem' }}
                      placeholder="Filtrar por marca, modelo o medida..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        if (productoSeleccionado) setProductoSeleccionado(null);
                      }}
                    />
                  </div>

                  {/* Selected Llanta Info */}
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
                          <p className="text-xs text-blue-600 mt-1">
                            {getTotalStock(productoSeleccionado)} unidades disponibles
                          </p>
                        </div>
                        <button
                          type="button"
                          className="text-blue-400 hover:text-blue-600 text-xs"
                          onClick={() => setProductoSeleccionado(null)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex gap-3 items-center">
                        <div className="flex items-center border border-blue-300 rounded-lg overflow-hidden">
                          <button
                            type="button"
                            className="px-3 py-2 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40"
                            onClick={() => setCantidadProducto((q) => Math.max(1, q - 1))}
                            disabled={cantidadProducto <= 1}
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="px-4 py-2 font-bold text-blue-900 min-w-[2.5rem] text-center">
                            {cantidadProducto}
                          </span>
                          <button
                            type="button"
                            className="px-3 py-2 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40"
                            onClick={() => setCantidadProducto((q) => Math.min(getTotalStock(productoSeleccionado), q + 1))}
                            disabled={cantidadProducto >= getTotalStock(productoSeleccionado)}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary flex items-center gap-2"
                          onClick={addProductToCart}
                        >
                          <Plus className="w-4 h-4" />
                          Agregar al carrito
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Grid of llantas */}
                  {filteredProducts.length === 0 ? (
                    <p className="text-center py-8 text-gray-500 text-sm">
                      {searchTerm.trim() ? 'No se encontraron llantas' : 'No hay llantas con stock disponible'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-96 overflow-y-auto pr-1">
                      {filteredProducts.map((llanta) => {
                        const totalStock = getTotalStock(llanta);
                        const isSelected = productoSeleccionado?.id === llanta.id;
                        return (
                          <button
                            key={llanta.id}
                            type="button"
                            onClick={() => {
                              setProductoSeleccionado(llanta);
                              setCantidadProducto(1);
                            }}
                            className={`p-3 border-2 rounded-lg transition-all text-left group ${
                              isSelected
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <Package className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400 group-hover:text-blue-500'}`} />
                              <span className="font-medium text-sm line-clamp-1">
                                {llanta.marca} {llanta.modelo}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 font-mono mb-2">{llanta.medida}</p>
                            <div className="flex items-center justify-between">
                              <p className={`text-sm font-bold ${isSelected ? 'text-blue-700' : 'text-blue-600'}`}>
                                {formatCurrency(llanta.precioVenta)}
                              </p>
                              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                                {totalStock} disp.
                              </span>
                            </div>
                          </button>
                        );
                      })}
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
                    Nombre del cliente <span className="text-gray-400 text-xs ml-1">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Cliente general"
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

          {/* Cart */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold">
                Carrito ({cartItems.length})
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
                        item.tipo === 'producto' ? 'bg-blue-100' :
                        item.tipo === 'catalogo' || item.tipo === 'extra' ? 'bg-orange-100' : 'bg-amber-100'
                      }`}>
                        {item.tipo === 'producto' ? (
                          <Package className="w-3 h-3 text-blue-600" />
                        ) : item.tipo === 'catalogo' || item.tipo === 'extra' ? (
                          <ShoppingBag className="w-3 h-3 text-orange-600" />
                        ) : (
                          <Wrench className="w-3 h-3 text-amber-600" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        {item.tipo === 'producto' ? (
                          <p className="font-medium text-sm">
                            {(item as CartItemLlanta).llanta.marca}{' '}
                            {(item as CartItemLlanta).llanta.modelo}
                          </p>
                        ) : item.tipo === 'catalogo' ? (
                          <p className="font-medium text-sm">{(item as CartItemCatalogo).producto.nombre}</p>
                        ) : item.tipo === 'extra' ? (
                          <p className="font-medium text-sm">{(item as CartItemExtra).nombre}</p>
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

                      {/* Price (editable) */}
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-20 text-right text-sm font-medium border border-gray-100 hover:border-gray-300 focus:border-blue-400 focus:outline-none rounded px-1 py-0.5 bg-transparent focus:bg-white"
                          value={editingPrices[index] ?? item.precioUnitario.toString()}
                          title="Precio unitario"
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '' || /^\d*\.?\d{0,2}$/.test(v)) {
                              setEditingPrices((prev) => ({ ...prev, [index]: v }));
                              const num = parseFloat(v);
                              if (!isNaN(num) && num >= 0) updateItemPrice(index, num);
                            }
                          }}
                          onFocus={(e) => {
                            setEditingPrices((prev) => ({ ...prev, [index]: item.precioUnitario.toString() }));
                            e.target.select();
                          }}
                          onBlur={() => {
                            setEditingPrices((prev) => {
                              const next = { ...prev };
                              delete next[index];
                              return next;
                            });
                          }}
                        />
                        {item.cantidad > 1 && (
                          <p className="text-xs text-gray-400">= {formatCurrency(item.precioUnitario * item.cantidad)}</p>
                        )}
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
