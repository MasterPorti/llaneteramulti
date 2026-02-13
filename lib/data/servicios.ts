import fs from 'fs/promises';
import path from 'path';
import type { Servicio, ServicioInput } from '@/types';
import { generateId } from '@/lib/utils/formatters';
import { SERVICIOS_INICIALES } from '@/lib/config';

const DATA_PATH = path.join(process.cwd(), 'data', 'servicios.json');

interface ServiciosData {
  servicios: Servicio[];
  metadata: {
    lastUpdated: string;
    version: number;
    initialized: boolean;
  };
}

async function readData(): Promise<ServiciosData> {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    const now = new Date().toISOString();
    const data: ServiciosData = {
      servicios: SERVICIOS_INICIALES.map((s, index) => ({
        id: generateId(),
        nombre: s.nombre,
        descripcion: s.descripcion,
        precioDefault: s.precioDefault,
        codigoBarras: `SRV${String(index + 1).padStart(3, '0')}`,
        activo: true,
        createdAt: now,
        updatedAt: now,
      })),
      metadata: {
        lastUpdated: now,
        version: 1,
        initialized: true,
      },
    };
    await writeData(data);
    return data;
  }
}

async function writeData(data: ServiciosData): Promise<void> {
  data.metadata.lastUpdated = new Date().toISOString();
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function obtenerServicios(): Promise<Servicio[]> {
  const data = await readData();
  return data.servicios.filter((s) => s.activo);
}

export async function obtenerServicio(id: string): Promise<Servicio | null> {
  const data = await readData();
  return data.servicios.find((s) => s.id === id && s.activo) || null;
}

export async function obtenerServicioPorCodigo(codigoBarras: string): Promise<Servicio | null> {
  const data = await readData();
  return data.servicios.find((s) => s.codigoBarras === codigoBarras && s.activo) || null;
}

export async function crearServicio(input: ServicioInput): Promise<Servicio> {
  const data = await readData();
  const now = new Date().toISOString();

  // Auto-generate barcode if not provided
  let codigoBarras = input.codigoBarras;
  if (!codigoBarras) {
    const maxCode = data.servicios
      .map((s) => {
        const match = s.codigoBarras?.match(/^SRV(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .reduce((max, num) => Math.max(max, num), 0);
    codigoBarras = `SRV${String(maxCode + 1).padStart(3, '0')}`;
  }

  const nuevo: Servicio = {
    id: generateId(),
    nombre: input.nombre,
    descripcion: input.descripcion,
    precioDefault: input.precioDefault,
    codigoBarras,
    activo: true,
    createdAt: now,
    updatedAt: now,
  };

  data.servicios.push(nuevo);
  await writeData(data);
  return nuevo;
}

export async function actualizarServicio(
  id: string,
  input: Partial<ServicioInput>
): Promise<Servicio | null> {
  const data = await readData();
  const index = data.servicios.findIndex((s) => s.id === id && s.activo);

  if (index === -1) return null;

  if (input.nombre !== undefined) data.servicios[index].nombre = input.nombre;
  if (input.descripcion !== undefined) data.servicios[index].descripcion = input.descripcion;
  if (input.precioDefault !== undefined) data.servicios[index].precioDefault = input.precioDefault;
  data.servicios[index].updatedAt = new Date().toISOString();

  await writeData(data);
  return data.servicios[index];
}

export async function eliminarServicio(id: string): Promise<boolean> {
  const data = await readData();
  const index = data.servicios.findIndex((s) => s.id === id && s.activo);

  if (index === -1) return false;

  data.servicios[index].activo = false;
  data.servicios[index].updatedAt = new Date().toISOString();
  await writeData(data);
  return true;
}

export async function buscarServicios(termino: string): Promise<Servicio[]> {
  const data = await readData();
  const terminoLower = termino.toLowerCase();
  return data.servicios
    .filter((s) => s.activo)
    .filter(
      (s) =>
        s.nombre.toLowerCase().includes(terminoLower) ||
        s.descripcion.toLowerCase().includes(terminoLower)
    );
}
