import type { Llanta, Producto, Servicio, Venta } from '@/types';
import { BODEGAS } from '@/lib/config';
import { formatDateShort, formatDateTime } from '@/lib/utils/formatters';

export interface PdfReport {
  kind: 'ventas' | 'productos' | 'llantas' | 'servicios';
  title: string;
  description: string;
  filename: string;
  orientation: 'portrait' | 'landscape';
  filters: string[];
  stats: { label: string; value: string }[];
  /** Widths are relative weights; the renderer scales them to the page. */
  columns: { header: string; width?: number; align?: 'left' | 'center' | 'right' }[];
  rows: string[][];
  totalRow?: string[];
  rowStatuses?: ('cancelada' | 'inactiva' | undefined)[];
  note?: string;
}

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const integer = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const zero = BigInt(0);
const hundred = BigInt(100);
const paymentNames = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };

function text(value: string | null | undefined): string {
  return value?.trim() || '—';
}

function cents(value: number): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('El reporte contiene un importe no válido.');
  }
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result)) throw new Error('El importe excede la precisión admitida por el reporte.');
  // Values come from stored currency fields. Do not invent precision or silently
  // round a record containing fractions of a cent. Allow binary number residue.
  if (Math.abs(value - result / 100) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4) {
    throw new Error('El importe registrado contiene fracciones de centavo.');
  }
  return BigInt(result);
}

function money(value: bigint): string {
  const positive = value < zero ? -value : value;
  const decimals = (positive % hundred).toString().padStart(2, '0');
  const formatted = currency.formatToParts(positive / hundred)
    .map((part) => part.type === 'fraction' ? decimals : part.value).join('');
  return value < zero ? `-${formatted}` : formatted;
}

function units(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('El reporte contiene una cantidad no válida.');
  return BigInt(value);
}

function searchFilter(busqueda?: string): string[] {
  return busqueda?.trim() ? [`Búsqueda: ${busqueda.trim()}`] : [];
}

/** Inputs are already selected by the caller; report builders never expand or refilter them. */
export function buildSalesReport(ventas: readonly Venta[], range: { desde: string; hasta: string }): PdfReport {
  let subtotal = zero;
  let iva = zero;
  let total = zero;
  let quantity = zero;
  let cancelled = 0;
  const rows = ventas.map((venta) => {
    const amounts = { subtotal: cents(venta.subtotal), iva: cents(venta.iva), total: cents(venta.total) };
    const saleQuantity = venta.items.reduce((sum, item) => sum + units(item.cantidad), zero);
    if (venta.cancelada) cancelled++;
    else {
      subtotal += amounts.subtotal;
      iva += amounts.iva;
      total += amounts.total;
      quantity += saleQuantity;
    }
    const concepts = venta.items.map((item) => {
      const name = item.tipo === 'producto'
        ? [item.llantaSnapshot.marca, item.llantaSnapshot.modelo, item.llantaSnapshot.medida]
          .filter((value) => value?.trim()).join(' ')
        : item.servicioNombre;
      return `${text(name)} × ${integer.format(units(item.cantidad))}`;
    }).join('\n');
    return [
      formatDateTime(venta.fechaVenta), text(venta.folio), text(venta.cliente?.nombre), concepts || '—',
      integer.format(saleQuantity), money(amounts.subtotal), money(amounts.iva), money(amounts.total),
      paymentNames[venta.metodoPago] ?? text(venta.metodoPago), venta.cancelada ? 'Cancelada' : 'Vigente',
    ];
  });
  const filters = [
    ...(range.desde ? [`Desde: ${formatDateShort(range.desde)}`] : []),
    ...(range.hasta ? [`Hasta: ${formatDateShort(range.hasta)}`] : []),
  ];
  const widths = [29, 19, 34, 60, 12, 24, 22, 24, 24, 21];
  return {
    kind: 'ventas', title: 'Reporte de ventas', description: 'Detalle de las ventas seleccionadas e importes registrados en pesos mexicanos.',
    filename: range.desde || range.hasta ? `ventas_${range.desde || 'inicio'}_${range.hasta || 'fin'}.pdf` : 'ventas_todas.pdf',
    orientation: 'landscape', filters: filters.length ? filters : ['Periodo: Todas las fechas'],
    stats: [
      { label: 'Ventas seleccionadas', value: integer.format(ventas.length) },
      { label: 'Ventas vigentes', value: integer.format(ventas.length - cancelled) },
      { label: 'Canceladas', value: integer.format(cancelled) },
      { label: 'Subtotal vigente', value: money(subtotal) },
      { label: 'IVA registrado vigente', value: money(iva) },
      { label: 'Total vigente', value: money(total) },
    ],
    columns: ['Fecha (CDMX)', 'Folio', 'Cliente', 'Conceptos', 'Cant.', 'Subtotal', 'IVA', 'Total', 'Pago', 'Estado']
      .map((header, index) => ({ header, width: widths[index], align: index >= 4 && index <= 7 ? 'right' as const : 'left' as const })),
    rows, totalRow: ['', '', '', 'TOTALES VIGENTES', integer.format(quantity), money(subtotal), money(iva), money(total), '', ''],
    rowStatuses: ventas.map((venta) => venta.cancelada ? 'cancelada' : undefined),
    note: 'Las ventas canceladas se muestran para consulta y se excluyen de la cantidad y los totales vigentes. Subtotal, IVA y total son los importes almacenados: este reporte no recalcula el IVA ni aplica una tasa. Los IVA registrados en cero se conservan. Fechas en horario de Ciudad de México.',
  };
}

export function buildProductsReport(productos: readonly Producto[], filters: { busqueda?: string }): PdfReport {
  const stock = productos.reduce((sum, producto) => sum + units(producto.stock), zero);
  const active = productos.filter((producto) => producto.activo).length;
  return {
    kind: 'productos', title: 'Reporte de productos', description: 'Precios y existencias de los productos seleccionados.',
    filename: 'productos.pdf', orientation: 'portrait', filters: searchFilter(filters.busqueda),
    stats: [
      { label: 'Productos', value: integer.format(productos.length) },
      { label: 'Activos', value: integer.format(active) },
      { label: 'Inactivos', value: integer.format(productos.length - active) },
      { label: 'Existencias seleccionadas', value: integer.format(stock) },
    ],
    columns: [
      { header: 'Nombre', width: 48 }, { header: 'Descripción', width: 82 },
      { header: 'Precio', width: 32, align: 'right' }, { header: 'Stock', width: 20, align: 'right' },
    ],
    rows: productos.map((producto) => [text(producto.nombre), text(producto.descripcion), money(cents(producto.precio)), integer.format(units(producto.stock))]),
    totalRow: ['EXISTENCIAS', '', '', integer.format(stock)],
    rowStatuses: productos.map((producto) => producto.activo ? undefined : 'inactiva'),
    note: 'Precios registrados en pesos mexicanos. Las existencias corresponden únicamente a los productos incluidos; si la selección contiene inactivos, sus existencias también se muestran.',
  };
}

function tireStock(llanta: Llanta): { total: bigint; detail: string } {
  if (!llanta.stockPorBodega || typeof llanta.stockPorBodega !== 'object') {
    throw new Error('Faltan las existencias por bodega de una llanta.');
  }
  const stock = Object.entries(llanta.stockPorBodega).map(([id, value]) => ({ id, quantity: units(value) }));
  const known = new Set<string>(BODEGAS.map((bodega) => bodega.id));
  const warehouses = [
    ...BODEGAS.map((bodega) => ({ id: bodega.id, nombre: bodega.nombre })),
    // Preserve any recorded reference outside the configured catalog by its real
    // identifier; never invent a warehouse name or omit its recorded units.
    ...stock.filter((entry) => !known.has(entry.id)).map((entry) => ({ id: entry.id, nombre: entry.id })),
  ];
  const detail = warehouses.flatMap((warehouse) => {
    const entry = stock.find((value) => value.id === warehouse.id);
    return entry && entry.quantity !== zero ? [`${warehouse.nombre}: ${integer.format(entry.quantity)}`] : [];
  }).join('\n');
  return { total: stock.reduce((sum, entry) => sum + entry.quantity, zero), detail: detail || 'Sin existencias' };
}

export function buildTiresReport(inventario: readonly Llanta[], filters: { busqueda?: string; estado?: string; bodega?: string }): PdfReport {
  const stocks = inventario.map(tireStock);
  const active = inventario.filter((llanta) => llanta.activo).length;
  let activeStock = zero;
  let inactiveStock = zero;
  inventario.forEach((llanta, index) => {
    if (llanta.activo) activeStock += stocks[index].total;
    else inactiveStock += stocks[index].total;
  });
  const stateNames: Record<string, string> = { activos: 'Activas', inactivos: 'Inactivas', todos: 'Todas' };
  const reportFilters = searchFilter(filters.busqueda);
  if (filters.estado) reportFilters.push(`Estado: ${stateNames[filters.estado] ?? filters.estado}`);
  if (filters.bodega) reportFilters.push(`Bodega: ${BODEGAS.find((bodega) => bodega.id === filters.bodega)?.nombre ?? filters.bodega}`);
  return {
    kind: 'llantas', title: 'Reporte de inventario de llantas', description: 'Llantas seleccionadas y sus existencias registradas por bodega.',
    filename: 'inventario_llantas.pdf', orientation: 'landscape', filters: reportFilters,
    stats: [
      { label: 'Registros', value: integer.format(inventario.length) },
      { label: 'Activas', value: integer.format(active) },
      { label: 'Inactivas', value: integer.format(inventario.length - active) },
      { label: 'Piezas activas', value: integer.format(activeStock) },
      { label: 'Piezas inactivas', value: integer.format(inactiveStock) },
      { label: 'Piezas totales', value: integer.format(activeStock + inactiveStock) },
    ],
    columns: [
      { header: 'Marca', width: 28 }, { header: 'Modelo', width: 32 }, { header: 'Medida', width: 27 },
      { header: 'Estado', width: 19 }, { header: 'Proveedor', width: 38 }, { header: 'Precio de venta', width: 25, align: 'right' },
      { header: 'Stock total', width: 19, align: 'right' }, { header: 'Existencias por bodega', width: 81 },
    ],
    rows: inventario.map((llanta, index) => [text(llanta.marca), text(llanta.modelo), text(llanta.medida), llanta.activo ? 'Activa' : 'Inactiva',
      text(llanta.proveedor), money(cents(llanta.precioVenta)), integer.format(stocks[index].total), stocks[index].detail]),
    totalRow: ['EXISTENCIAS', '', '', '', '', '', integer.format(activeStock + inactiveStock), ''],
    rowStatuses: inventario.map((llanta) => llanta.activo ? undefined : 'inactiva'),
    note: 'El stock total y el desglose abarcan todas las bodegas de cada llanta seleccionada, incluso cuando se filtró por una bodega. Se omiten únicamente las bodegas con cantidad cero. Las existencias inactivas se conservan y se resumen por separado; no se presentan como stock activo.',
  };
}

export function buildServicesReport(servicios: readonly Servicio[]): PdfReport {
  const active = servicios.filter((servicio) => servicio.activo).length;
  return {
    kind: 'servicios', title: 'Reporte de servicios', description: 'Catálogo seleccionado de servicios y sus precios registrados.',
    filename: 'servicios.pdf', orientation: 'portrait', filters: [],
    stats: [
      { label: 'Servicios', value: integer.format(servicios.length) },
      { label: 'Activos', value: integer.format(active) },
      { label: 'Inactivos', value: integer.format(servicios.length - active) },
      { label: 'Moneda', value: 'MXN' },
    ],
    columns: [
      { header: 'Código', width: 30 }, { header: 'Nombre', width: 43 }, { header: 'Descripción', width: 62 },
      { header: 'Precio', width: 27, align: 'right' }, { header: 'Estado', width: 20 },
    ],
    rows: servicios.map((servicio) => [text(servicio.codigoBarras), text(servicio.nombre), text(servicio.descripcion),
      money(cents(servicio.precioDefault)), servicio.activo ? 'Activo' : 'Inactivo']),
    rowStatuses: servicios.map((servicio) => servicio.activo ? undefined : 'inactiva'),
    note: 'Los precios corresponden al catálogo registrado; este reporte no calcula importes de ventas ni impuestos.',
  };
}
