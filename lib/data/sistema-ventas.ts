import fs from 'fs/promises';
import path from 'path';
import type {
  SistemaVenta,
  SistemaVentaInput,
  SistemaVentasData,
  GarantiaSistema,
  SistemaActionResponse,
} from '@/types/sistema';
import { generateId, addDays } from '@/lib/utils/formatters';
import {
  SISTEMA_CONFIG,
  generarGarantiaId,
  generarFolioSistema,
  generarCodigoAuxiliar,
} from '@/lib/config-sistema';
import {
  obtenerLlantaSistema,
  deducirStockPorVenta,
  restaurarStockPorCancelacion,
} from './sistema-inventario';

const DATA_PATH = path.join(process.cwd(), 'data', 'sistema-ventas.json');

async function readData(): Promise<SistemaVentasData> {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      ventas: [],
      metadata: {
        lastUpdated: '',
        ultimoFolio: 0,
        ultimoGarantiaId: 0,
        version: 1,
      },
    };
  }
}

async function writeData(data: SistemaVentasData): Promise<void> {
  data.metadata.lastUpdated = new Date().toISOString();
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// Crear nueva venta con garantía
export async function crearVentaSistema(
  input: SistemaVentaInput
): Promise<SistemaActionResponse<SistemaVenta>> {
  const data = await readData();
  const now = new Date().toISOString();

  // Validar y preparar items
  const items = [];
  let subtotal = 0;

  for (const item of input.items) {
    const llanta = await obtenerLlantaSistema(item.llantaId);
    if (!llanta) {
      return { success: false, error: `Llanta no encontrada: ${item.llantaId}` };
    }

    const stockDisponible = llanta.stockPorBodega[item.bodega] || 0;
    if (stockDisponible < item.cantidad) {
      return {
        success: false,
        error: `Stock insuficiente para ${llanta.marca} ${llanta.modelo}. Disponible: ${stockDisponible}`,
      };
    }

    const precioUnitario = item.precioCustom || llanta.precioVenta;
    const itemSubtotal = precioUnitario * item.cantidad;

    items.push({
      llantaId: item.llantaId,
      bodega: item.bodega,
      llantaSnapshot: {
        marca: llanta.marca,
        modelo: llanta.modelo,
        medida: llanta.medida,
        codigoAuxiliar: generarCodigoAuxiliar(llanta.medida),
      },
      cantidad: item.cantidad,
      precioUnitario,
      subtotal: itemSubtotal,
    });

    subtotal += itemSubtotal;
  }

  // Generar garantía con ID único
  const diasGarantia = input.diasGarantia || SISTEMA_CONFIG.garantiaDiasPredeterminado;
  const fechaInicio = now.split('T')[0];
  const fechaFin = addDays(new Date(fechaInicio), diasGarantia).toISOString().split('T')[0];

  const garantia: GarantiaSistema = {
    id: generarGarantiaId(data.metadata.ultimoGarantiaId),
    fechaInicio,
    fechaFin,
    diasGarantia,
    condiciones: input.condicionesGarantia || SISTEMA_CONFIG.condicionesGarantiaPredeterminado,
    activa: true,
  };

  // Crear venta
  const venta: SistemaVenta = {
    id: generateId(),
    folio: generarFolioSistema(data.metadata.ultimoFolio),
    cliente: {
      nombre: input.clienteNombre,
      telefono: input.clienteTelefono,
    },
    items,
    subtotal,
    total: subtotal, // Sin IVA por ahora
    metodoPago: input.metodoPago,
    fechaVenta: now,
    garantia,
    createdAt: now,
    updatedAt: now,
    cancelada: false,
  };

  // Deducir stock
  for (const item of input.items) {
    await deducirStockPorVenta(item.llantaId, item.bodega, item.cantidad);
  }

  // Guardar venta y actualizar metadata
  data.ventas.push(venta);
  data.metadata.ultimoFolio += 1;
  data.metadata.ultimoGarantiaId += 1;
  await writeData(data);

  return { success: true, data: venta };
}

// Obtener todas las ventas
export async function obtenerVentasSistema(filtros?: {
  desde?: string;
  hasta?: string;
}): Promise<SistemaVenta[]> {
  const data = await readData();
  let ventas = data.ventas.filter((v) => !v.cancelada);

  if (filtros?.desde) {
    ventas = ventas.filter((v) => v.fechaVenta >= filtros.desde!);
  }
  if (filtros?.hasta) {
    ventas = ventas.filter((v) => v.fechaVenta <= filtros.hasta!);
  }

  return ventas.sort(
    (a, b) => new Date(b.fechaVenta).getTime() - new Date(a.fechaVenta).getTime()
  );
}

// Obtener venta por ID
export async function obtenerVentaSistema(id: string): Promise<SistemaVenta | null> {
  const data = await readData();
  return data.ventas.find((v) => v.id === id) || null;
}

// Obtener venta por folio
export async function obtenerVentaPorFolio(folio: string): Promise<SistemaVenta | null> {
  const data = await readData();
  return data.ventas.find((v) => v.folio === folio) || null;
}

// Cancelar venta y restaurar stock
export async function cancelarVentaSistema(
  id: string,
  motivo: string
): Promise<SistemaActionResponse<SistemaVenta>> {
  const data = await readData();
  const index = data.ventas.findIndex((v) => v.id === id);

  if (index === -1) {
    return { success: false, error: 'Venta no encontrada' };
  }

  const venta = data.ventas[index];

  if (venta.cancelada) {
    return { success: false, error: 'La venta ya está cancelada' };
  }

  // Restaurar stock
  for (const item of venta.items) {
    await restaurarStockPorCancelacion(item.llantaId, item.bodega, item.cantidad);
  }

  // Marcar como cancelada
  venta.cancelada = true;
  venta.motivoCancelacion = motivo;
  venta.garantia.activa = false;
  venta.updatedAt = new Date().toISOString();

  data.ventas[index] = venta;
  await writeData(data);

  return { success: true, data: venta };
}

// Buscar garantía por ID
export async function buscarGarantiaPorId(
  garantiaId: string
): Promise<SistemaActionResponse<{ venta: SistemaVenta; garantia: GarantiaSistema }>> {
  const data = await readData();

  const venta = data.ventas.find(
    (v) => v.garantia.id.toUpperCase() === garantiaId.toUpperCase()
  );

  if (!venta) {
    return { success: false, error: 'Garantía no encontrada' };
  }

  return {
    success: true,
    data: {
      venta,
      garantia: venta.garantia,
    },
  };
}

// Obtener garantías activas
export async function obtenerGarantiasActivas(): Promise<
  Array<{ venta: SistemaVenta; garantia: GarantiaSistema; diasRestantes: number }>
> {
  const data = await readData();
  const hoy = new Date();

  return data.ventas
    .filter((v) => !v.cancelada && v.garantia.activa)
    .filter((v) => new Date(v.garantia.fechaFin) >= hoy)
    .map((v) => {
      const fechaFin = new Date(v.garantia.fechaFin);
      const diasRestantes = Math.ceil(
        (fechaFin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        venta: v,
        garantia: v.garantia,
        diasRestantes,
      };
    })
    .sort((a, b) => a.diasRestantes - b.diasRestantes);
}

// Obtener historial de ventas con resumen
export async function obtenerResumenVentas(filtros?: {
  desde?: string;
  hasta?: string;
}): Promise<{
  ventas: SistemaVenta[];
  totalVentas: number;
  totalIngresos: number;
  totalUnidades: number;
}> {
  const ventas = await obtenerVentasSistema(filtros);

  const totalIngresos = ventas.reduce((acc, v) => acc + v.total, 0);
  const totalUnidades = ventas.reduce(
    (acc, v) => acc + v.items.reduce((itemAcc, item) => itemAcc + item.cantidad, 0),
    0
  );

  return {
    ventas,
    totalVentas: ventas.length,
    totalIngresos,
    totalUnidades,
  };
}
