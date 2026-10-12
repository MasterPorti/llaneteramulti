import { db, transaction } from '@/lib/db';
import type { Servicio, ServicioInput } from '@/types';
import { generateId } from '@/lib/utils/formatters';
import { calcularImportePartida } from '@/lib/utils/iva';
import { validarImporte } from './validation';
import { validarTexto } from './normalizado';

export interface ServicioRow {
  id: string; nombre: string; descripcion: string | null; precio_default: number;
  codigo_barras: string | null; activo: boolean | null; created_at: string | null; updated_at: string | null;
}
export function adaptarServicio(row: ServicioRow): Servicio {
  return { id: row.id, nombre: row.nombre, descripcion: row.descripcion ?? '', precioDefault: Number(row.precio_default),
    codigoBarras: row.codigo_barras ?? '', activo: row.activo === true, createdAt: row.created_at ?? '', updatedAt: row.updated_at ?? '' };
}

// Reading an empty catalog never creates synthetic services.
export async function obtenerServicios(): Promise<Servicio[]> {
  return (await db.query<ServicioRow>('SELECT * FROM servicios WHERE activo=true ORDER BY created_at ASC,id')).rows.map(adaptarServicio);
}
export async function obtenerServicio(id: string): Promise<Servicio | null> {
  const row = (await db.query<ServicioRow>('SELECT * FROM servicios WHERE id=$1 AND activo=true', [id])).rows[0];
  return row ? adaptarServicio(row) : null;
}
export async function obtenerServicioPorCodigo(codigoBarras: string): Promise<Servicio | null> {
  const row = (await db.query<ServicioRow>('SELECT * FROM servicios WHERE codigo_barras=$1 AND activo=true', [codigoBarras])).rows[0];
  return row ? adaptarServicio(row) : null;
}
function validar(input: Partial<ServicioInput>) {
  if (input.nombre !== undefined) validarTexto(input.nombre, 'El nombre', 200);
  if (input.codigoBarras !== undefined) validarTexto(input.codigoBarras, 'El código', 50, false);
  if (input.precioDefault !== undefined) validarImporte(input.precioDefault);
}
export async function crearServicio(input: ServicioInput): Promise<Servicio> {
  validar(input);
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(73628109)');
    let codigo = input.codigoBarras;
    if (!codigo) {
      const found = await client.query<{ codigo_barras: string | null }>('SELECT codigo_barras FROM servicios');
      const max = found.rows.reduce((n, row) => Math.max(n, Number(row.codigo_barras?.match(/^SRV(\d+)$/)?.[1] ?? 0)), 0);
      if (!Number.isSafeInteger(max + 1)) throw new Error('La secuencia de códigos de servicios está fuera de rango.');
      codigo = `SRV${String(max + 1).padStart(3, '0')}`;
    }
    const duplicate = await client.query('SELECT id FROM servicios WHERE codigo_barras=$1', [codigo]);
    if (duplicate.rowCount) throw new Error('Ya existe un servicio con ese código.');
    const result = await client.query<ServicioRow>(`INSERT INTO servicios (id,nombre,descripcion,precio_default,codigo_barras,activo)
      VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
    [generateId(), input.nombre, input.descripcion, calcularImportePartida(input.precioDefault, 1), codigo]);
    return adaptarServicio(result.rows[0]);
  });
}
export async function actualizarServicio(id: string, input: Partial<ServicioInput>): Promise<Servicio | null> {
  validar(input);
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(73628109)');
    const current = (await client.query<ServicioRow>('SELECT * FROM servicios WHERE id=$1 AND activo=true FOR UPDATE', [id])).rows[0];
    if (!current) return null;
    const codigo = input.codigoBarras === undefined ? current.codigo_barras : input.codigoBarras || null;
    if ((await client.query('SELECT id FROM servicios WHERE codigo_barras=$1 AND id<>$2', [codigo, id])).rowCount) {
      throw new Error('Ya existe un servicio con ese código.');
    }
    const row = (await client.query<ServicioRow>(`UPDATE servicios SET nombre=$1,descripcion=$2,precio_default=$3,
      codigo_barras=$4,updated_at=NOW() WHERE id=$5 RETURNING *`,
    [input.nombre ?? current.nombre, input.descripcion === undefined ? current.descripcion : input.descripcion,
      input.precioDefault === undefined ? current.precio_default : calcularImportePartida(input.precioDefault, 1), codigo, id])).rows[0];
    return adaptarServicio(row);
  });
}
export async function eliminarServicio(id: string): Promise<boolean> {
  return ((await db.query('UPDATE servicios SET activo=false,updated_at=NOW() WHERE id=$1 AND activo=true', [id])).rowCount ?? 0) > 0;
}
export async function buscarServicios(termino: string): Promise<Servicio[]> {
  return (await db.query<ServicioRow>('SELECT * FROM servicios WHERE activo=true AND (nombre ILIKE $1 OR descripcion ILIKE $1) ORDER BY nombre,id', [`%${termino}%`])).rows.map(adaptarServicio);
}
