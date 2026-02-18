import fs from 'fs/promises';
import path from 'path';
import type { Llanta, LlantaInput, LlantaSuggestion, BodegaId, MovimientoBodega } from '@/types';
import { getTotalStock } from '@/types';
import type { SistemaInventarioData } from '@/types/sistema';
import { generateId, parseMedida } from '@/lib/utils/formatters';
import { generarCodigoAuxiliar } from '@/lib/config-sistema';

const DATA_PATH = path.join(process.cwd(), 'data', 'sistema-inventario.json');

const emptyStock = (): Record<BodegaId, number> => ({
  'bodega-1': 0,
  'bodega-2': 0,
  'bodega-3': 0,
  'bodega-4': 0,
  'bodega-5': 0,
});

async function readData(): Promise<SistemaInventarioData> {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      llantas: [],
      movimientos: [],
      metadata: { lastUpdated: '', version: 1 },
    };
  }
}

async function writeData(data: SistemaInventarioData): Promise<void> {
  data.metadata.lastUpdated = new Date().toISOString();
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// Obtener todo el inventario activo
export async function obtenerInventarioSistema(): Promise<Llanta[]> {
  const data = await readData();
  return data.llantas.filter((l) => l.activo);
}

// Obtener una llanta por ID
export async function obtenerLlantaSistema(id: string): Promise<Llanta | null> {
  const data = await readData();
  return data.llantas.find((l) => l.id === id && l.activo) || null;
}

// Buscar llantas para autocompletado
export async function buscarLlantasSistema(termino: string): Promise<LlantaSuggestion[]> {
  const data = await readData();
  const terminoLower = termino.toLowerCase();

  return data.llantas
    .filter((l) => l.activo)
    .filter(
      (l) =>
        l.marca.toLowerCase().includes(terminoLower) ||
        l.modelo.toLowerCase().includes(terminoLower) ||
        l.medida.toLowerCase().includes(terminoLower) ||
        generarCodigoAuxiliar(l.medida).includes(terminoLower) ||
        `${l.marca} ${l.modelo}`.toLowerCase().includes(terminoLower)
    )
    .slice(0, 10)
    .map((l) => {
      const total = getTotalStock(l);
      return {
        id: l.id,
        marca: l.marca,
        modelo: l.modelo,
        medida: l.medida,
        stockTotal: total,
        precioVenta: l.precioVenta,
        displayText: `${l.marca} ${l.modelo} - ${l.medida} (${total} disp.)`,
      };
    });
}

// Crear nueva llanta
export async function crearLlantaSistema(input: LlantaInput): Promise<Llanta> {
  const data = await readData();

  const medidaParsed = parseMedida(input.medida);
  if (!medidaParsed) {
    throw new Error('Formato de medida inválido. Use el formato: 205/55R16');
  }

  const now = new Date().toISOString();
  const stock = emptyStock();
  stock[input.bodega] = input.cantidad;

  const nuevaLlanta: Llanta = {
    id: generateId(),
    marca: input.marca,
    modelo: input.modelo,
    medida: input.medida,
    ancho: medidaParsed.ancho,
    perfil: medidaParsed.perfil,
    rin: medidaParsed.rin,
    precioCompra: input.precioCompra,
    precioVenta: input.precioVenta,
    stockPorBodega: stock,
    proveedor: input.proveedor,
    fechaRecepcion: input.fechaRecepcion,
    createdAt: now,
    updatedAt: now,
    activo: true,
  };

  data.llantas.push(nuevaLlanta);
  await writeData(data);

  return nuevaLlanta;
}

// Actualizar llanta existente
export async function actualizarLlantaSistema(
  id: string,
  input: Partial<LlantaInput>
): Promise<Llanta | null> {
  const data = await readData();
  const index = data.llantas.findIndex((l) => l.id === id && l.activo);

  if (index === -1) return null;

  const llanta = data.llantas[index];

  if (input.medida && input.medida !== llanta.medida) {
    const medidaParsed = parseMedida(input.medida);
    if (!medidaParsed) {
      throw new Error('Formato de medida inválido. Use el formato: 205/55R16');
    }
    llanta.ancho = medidaParsed.ancho;
    llanta.perfil = medidaParsed.perfil;
    llanta.rin = medidaParsed.rin;
  }

  if (input.marca !== undefined) llanta.marca = input.marca;
  if (input.modelo !== undefined) llanta.modelo = input.modelo;
  if (input.medida !== undefined) llanta.medida = input.medida;
  if (input.precioCompra !== undefined) llanta.precioCompra = input.precioCompra;
  if (input.precioVenta !== undefined) llanta.precioVenta = input.precioVenta;
  if (input.proveedor !== undefined) llanta.proveedor = input.proveedor;
  if (input.fechaRecepcion !== undefined) llanta.fechaRecepcion = input.fechaRecepcion;

  llanta.updatedAt = new Date().toISOString();
  data.llantas[index] = llanta;
  await writeData(data);

  return llanta;
}

// Eliminar llanta (soft delete)
export async function eliminarLlantaSistema(id: string): Promise<boolean> {
  const data = await readData();
  const index = data.llantas.findIndex((l) => l.id === id && l.activo);

  if (index === -1) return false;

  data.llantas[index].activo = false;
  data.llantas[index].updatedAt = new Date().toISOString();
  await writeData(data);

  return true;
}

// Ajustar stock en una bodega
export async function ajustarStockSistema(
  id: string,
  bodega: BodegaId,
  cantidad: number
): Promise<Llanta | null> {
  const data = await readData();
  const index = data.llantas.findIndex((l) => l.id === id && l.activo);

  if (index === -1) return null;

  const llanta = data.llantas[index];
  if (!llanta.stockPorBodega) {
    llanta.stockPorBodega = emptyStock();
  }

  llanta.stockPorBodega[bodega] = Math.max(0, (llanta.stockPorBodega[bodega] || 0) + cantidad);
  llanta.updatedAt = new Date().toISOString();

  data.llantas[index] = llanta;
  await writeData(data);
  return llanta;
}

// Mover stock entre bodegas
export async function moverStockSistema(
  llantaId: string,
  bodegaOrigen: BodegaId,
  bodegaDestino: BodegaId,
  cantidad: number
): Promise<Llanta | null> {
  const data = await readData();
  const index = data.llantas.findIndex((l) => l.id === llantaId && l.activo);

  if (index === -1) return null;

  const llanta = data.llantas[index];
  const stockOrigen = llanta.stockPorBodega[bodegaOrigen] || 0;

  if (stockOrigen < cantidad) {
    throw new Error(`Stock insuficiente en bodega origen. Disponible: ${stockOrigen}`);
  }

  llanta.stockPorBodega[bodegaOrigen] -= cantidad;
  llanta.stockPorBodega[bodegaDestino] = (llanta.stockPorBodega[bodegaDestino] || 0) + cantidad;
  llanta.updatedAt = new Date().toISOString();

  data.movimientos.push({
    id: generateId(),
    llantaId,
    bodegaOrigen,
    bodegaDestino,
    cantidad,
    fecha: new Date().toISOString(),
  });

  data.llantas[index] = llanta;
  await writeData(data);
  return llanta;
}

// Obtener historial de movimientos
export async function obtenerMovimientosSistema(): Promise<MovimientoBodega[]> {
  const data = await readData();
  return (data.movimientos || []).sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}

// Obtener llantas con stock bajo (cero)
export async function obtenerStockBajoSistema(): Promise<Llanta[]> {
  const data = await readData();
  return data.llantas.filter((l) => l.activo && getTotalStock(l) === 0);
}

// Deducir stock por venta
export async function deducirStockPorVenta(
  llantaId: string,
  bodega: BodegaId,
  cantidad: number
): Promise<boolean> {
  const data = await readData();
  const index = data.llantas.findIndex((l) => l.id === llantaId && l.activo);

  if (index === -1) return false;

  const llanta = data.llantas[index];
  const stockActual = llanta.stockPorBodega[bodega] || 0;

  if (stockActual < cantidad) {
    throw new Error(`Stock insuficiente. Disponible: ${stockActual}`);
  }

  llanta.stockPorBodega[bodega] -= cantidad;
  llanta.updatedAt = new Date().toISOString();

  data.llantas[index] = llanta;
  await writeData(data);
  return true;
}

// Restaurar stock por cancelación de venta
export async function restaurarStockPorCancelacion(
  llantaId: string,
  bodega: BodegaId,
  cantidad: number
): Promise<boolean> {
  const data = await readData();
  const index = data.llantas.findIndex((l) => l.id === llantaId);

  if (index === -1) return false;

  const llanta = data.llantas[index];
  llanta.stockPorBodega[bodega] = (llanta.stockPorBodega[bodega] || 0) + cantidad;
  llanta.updatedAt = new Date().toISOString();

  data.llantas[index] = llanta;
  await writeData(data);
  return true;
}
