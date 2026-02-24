import fs from 'fs/promises';
import path from 'path';
import type { Venta, VentaInput, VentaItem, VentaItemProducto, VentaItemServicio } from '@/types';
import { generateId, generateFolio, addDays } from '@/lib/utils/formatters';
import { obtenerLlanta, ajustarStock } from './inventario';
import { obtenerServicio } from './servicios';
import { CONFIG } from '@/lib/config';

const DATA_PATH = path.join(process.cwd(), 'data', 'ventas.json');

interface VentasData {
  ventas: Venta[];
  metadata: {
    lastUpdated: string;
    ultimoFolio: number;
    version: number;
  };
}

async function readData(): Promise<VentasData> {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      ventas: [],
      metadata: { lastUpdated: '', ultimoFolio: 0, version: 2 },
    };
  }
}

async function writeData(data: VentasData): Promise<void> {
  data.metadata.lastUpdated = new Date().toISOString();
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function obtenerVentas(filtros?: {
  fechaInicio?: string;
  fechaFin?: string;
}): Promise<Venta[]> {
  const data = await readData();
  let ventas = data.ventas.filter((v) => !v.cancelada);

  if (filtros?.fechaInicio) {
    ventas = ventas.filter((v) => v.fechaVenta >= filtros.fechaInicio!);
  }
  if (filtros?.fechaFin) {
    ventas = ventas.filter((v) => v.fechaVenta <= filtros.fechaFin!);
  }

  return ventas.sort(
    (a, b) => new Date(b.fechaVenta).getTime() - new Date(a.fechaVenta).getTime()
  );
}

export async function obtenerVenta(id: string): Promise<Venta | null> {
  const data = await readData();
  return data.ventas.find((v) => v.id === id) || null;
}

export async function crearVenta(input: VentaInput): Promise<Venta> {
  const data = await readData();

  const items: VentaItem[] = [];
  let subtotal = 0;

  for (const item of input.items) {
    if (item.tipo === 'producto') {
      const llanta = await obtenerLlanta(item.id);
      if (!llanta) {
        throw new Error(`Producto no encontrado`);
      }
      const bodega = item.bodega || 'bodega-1';
      const stockBodega = llanta.stockPorBodega?.[bodega] || 0;

      if (stockBodega < item.cantidad) {
        throw new Error(
          `Stock insuficiente para ${llanta.marca} ${llanta.modelo} en bodega. Disponible: ${stockBodega}`
        );
      }

      const precio = item.precioCustom ?? llanta.precioVenta;
      const itemSubtotal = precio * item.cantidad;

      const ventaItem: VentaItemProducto = {
        tipo: 'producto',
        llantaId: llanta.id,
        bodega,
        llantaSnapshot: {
          marca: llanta.marca,
          modelo: llanta.modelo,
          medida: llanta.medida,
        },
        cantidad: item.cantidad,
        precioUnitario: precio,
        subtotal: itemSubtotal,
      };
      items.push(ventaItem);
      subtotal += itemSubtotal;
    } else if (item.tipo === 'catalogo') {
      const { obtenerProducto, ajustarStockProducto } = await import('./productos');
      const producto = await obtenerProducto(item.id);
      if (!producto) throw new Error(`Producto no encontrado`);
      if (producto.stock < item.cantidad) throw new Error(`Stock insuficiente de "${producto.nombre}"`);

      await ajustarStockProducto(item.id, -(item.cantidad));

      const precio = item.precioCustom ?? producto.precio;
      const itemSubtotal = precio * item.cantidad;

      const ventaItem: VentaItemServicio = {
        tipo: 'servicio',
        servicioId: `producto-${item.id}`,
        servicioNombre: producto.nombre,
        cantidad: item.cantidad,
        precioUnitario: precio,
        subtotal: itemSubtotal,
      };
      items.push(ventaItem);
      subtotal += itemSubtotal;
    } else if (item.tipo === 'extra') {
      const precio = item.precioCustom ?? 0;
      const itemSubtotal = precio * item.cantidad;

      const ventaItem: VentaItemServicio = {
        tipo: 'servicio',
        servicioId: 'extra',
        servicioNombre: item.nombre || 'Producto',
        cantidad: item.cantidad,
        precioUnitario: precio,
        subtotal: itemSubtotal,
      };
      items.push(ventaItem);
      subtotal += itemSubtotal;
    } else {
      const servicio = await obtenerServicio(item.id);
      if (!servicio) {
        throw new Error(`Servicio no encontrado`);
      }

      const precio = item.precioCustom ?? servicio.precioDefault;
      const itemSubtotal = precio * item.cantidad;

      const ventaItem: VentaItemServicio = {
        tipo: 'servicio',
        servicioId: servicio.id,
        servicioNombre: servicio.nombre,
        cantidad: item.cantidad,
        precioUnitario: precio,
        subtotal: itemSubtotal,
      };
      items.push(ventaItem);
      subtotal += itemSubtotal;
    }
  }

  const iva = 0;
  const total = subtotal;

  const now = new Date();
  const diasGarantia = input.diasGarantia ?? CONFIG.garantiaDiasPredeterminado;

  const nuevaVenta: Venta = {
    id: generateId(),
    folio: generateFolio(data.metadata.ultimoFolio, CONFIG.formatoFolio),
    cliente: {
      nombre: input.clienteNombre,
      telefono: input.clienteTelefono,
    },
    items,
    subtotal,
    iva,
    total,
    metodoPago: input.metodoPago,
    fechaVenta: now.toISOString(),
    ticketGenerado: true,
    facturada: false,
    garantia: {
      fechaInicio: now.toISOString().split('T')[0],
      fechaFin: addDays(now, diasGarantia).toISOString().split('T')[0],
      diasGarantia,
      condiciones:
        input.condicionesGarantia ?? CONFIG.condicionesGarantiaPredeterminado,
      activa: true,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    cancelada: false,
  };

  // Descontar stock solo para productos
  for (const item of input.items) {
    if (item.tipo === 'producto' && item.bodega) {
      await ajustarStock(item.id, item.bodega, -item.cantidad);
    }
  }

  data.ventas.push(nuevaVenta);
  data.metadata.ultimoFolio += 1;
  await writeData(data);

  return nuevaVenta;
}

export async function cancelarVenta(
  id: string,
  motivo: string
): Promise<Venta | null> {
  const data = await readData();
  const index = data.ventas.findIndex((v) => v.id === id);

  if (index === -1) return null;

  const venta = data.ventas[index];
  if (venta.cancelada) {
    throw new Error('La venta ya está cancelada');
  }

  // Devolver stock de productos
  for (const item of venta.items) {
    if (item.tipo === 'producto') {
      await ajustarStock(item.llantaId, item.bodega, item.cantidad);
    }
  }

  venta.cancelada = true;
  venta.motivoCancelacion = motivo;
  venta.updatedAt = new Date().toISOString();

  data.ventas[index] = venta;
  await writeData(data);

  return venta;
}

export async function marcarFacturada(
  id: string,
  facturaInfo: {
    uuid: string;
    serie: string;
    folio: string;
    fechaTimbrado: string;
    urlPdf?: string;
    urlXml?: string;
  }
): Promise<Venta | null> {
  const data = await readData();
  const index = data.ventas.findIndex((v) => v.id === id);

  if (index === -1) return null;

  data.ventas[index].facturada = true;
  data.ventas[index].factura = facturaInfo;
  data.ventas[index].updatedAt = new Date().toISOString();

  await writeData(data);
  return data.ventas[index];
}

export async function obtenerGarantiasActivas(): Promise<Venta[]> {
  const data = await readData();
  const hoy = new Date().toISOString().split('T')[0];

  return data.ventas.filter(
    (v) => !v.cancelada && v.garantia.activa && v.garantia.fechaFin >= hoy
  );
}

export async function obtenerUltimoFolio(): Promise<number> {
  const data = await readData();
  return data.metadata.ultimoFolio;
}
