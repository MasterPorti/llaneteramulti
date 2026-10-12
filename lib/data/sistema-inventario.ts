import { db, transaction } from '@/lib/db';
import type { Llanta, LlantaInput, LlantaSuggestion, BodegaId, MovimientoBodega } from '@/types';
import { getTotalStock } from '@/types';
import { BODEGAS } from '@/lib/config';
import { generarCodigoAuxiliar } from '@/lib/config-sistema';
import { generateId, parseMedida } from '@/lib/utils/formatters';
import { calcularImportePartida } from '@/lib/utils/iva';
import { validarBodega, validarCantidad, validarImporte, validarProveedor } from './validation';
import { adaptarLlanta, stockDeFila, totalStock, guardarStock, registrarMovimiento, validarTexto, type LlantaRow } from './normalizado';

const DOMINIO = 'sistema';
export async function obtenerInventarioSistema(filtros?: { incluirInactivos?: boolean }): Promise<Llanta[]> {
  return (await db.query<LlantaRow>(`SELECT * FROM llantas WHERE dominio=$1 ${filtros?.incluirInactivos ? '' : 'AND activo=true'} ORDER BY created_at DESC,id`, [DOMINIO])).rows.map(adaptarLlanta);
}
export async function obtenerLlantaSistema(id: string, incluirInactivos = false): Promise<Llanta | null> {
  const row = (await db.query<LlantaRow>(`SELECT * FROM llantas WHERE id=$1 AND dominio=$2 ${incluirInactivos ? '' : 'AND activo=true'}`, [id, DOMINIO])).rows[0];
  return row ? adaptarLlanta(row) : null;
}
export async function buscarLlantasSistema(termino: string): Promise<LlantaSuggestion[]> {
  const term = termino.trim().toLocaleLowerCase('es-MX');
  return (await obtenerInventarioSistema()).filter((llanta) => [llanta.marca, llanta.modelo, llanta.medida, llanta.proveedor,
    `${llanta.marca} ${llanta.modelo}`, generarCodigoAuxiliar(llanta.medida)]
    .some((value) => (value || '').toLocaleLowerCase('es-MX').includes(term))).slice(0, 10).map((llanta) => ({
      id: llanta.id, marca: llanta.marca, modelo: llanta.modelo, medida: llanta.medida, stockTotal: getTotalStock(llanta),
      precioVenta: llanta.precioVenta, displayText: `${llanta.marca} ${llanta.modelo} - ${llanta.medida} (${getTotalStock(llanta)} disp.)`,
    }));
}
export async function obtenerOpcionesUnicasSistema() {
  const llantas = await obtenerInventarioSistema();
  const unique = (field: 'marca' | 'modelo' | 'proveedor') => [...new Set(llantas.map((row) => row[field]).filter(Boolean))].sort();
  return { marcas: unique('marca'), modelos: unique('modelo'), proveedores: unique('proveedor') };
}
function validarDatos(input: Partial<LlantaInput>) {
  if (input.proveedor !== undefined) { validarTexto(input.proveedor, 'El proveedor', 200); validarProveedor(input.proveedor); }
  if (input.marca !== undefined) validarTexto(input.marca, 'La marca', 100);
  if (input.modelo !== undefined) validarTexto(input.modelo, 'El modelo', 100);
  if (input.medida !== undefined) validarTexto(input.medida, 'La medida', 50);
  for (const amount of [input.precioCompra, input.precioVenta, input.precioMayorista]) if (amount !== undefined) validarImporte(amount);
  if (input.fechaRecepcion !== undefined && (!/^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(input.fechaRecepcion) || !Number.isFinite(Date.parse(input.fechaRecepcion)))) {
    throw new Error('La fecha de recepción no es válida.');
  }
}
export async function crearLlantaSistema(input: LlantaInput): Promise<Llanta> {
  validarDatos(input);
  const parsed = parseMedida(input.medida);
  const stock = Object.fromEntries(BODEGAS.map(({ id }) => [id, 0])) as Record<BodegaId, number>;
  if (input.stockPorBodega) {
    totalStock(input.stockPorBodega);
    Object.assign(stock, input.stockPorBodega);
  } else {
    validarBodega(input.bodega); validarCantidad(input.cantidad, true); stock[input.bodega] = input.cantidad;
  }
  return transaction(async (client) => {
    const row = (await client.query<LlantaRow>(`INSERT INTO llantas
      (id,marca,modelo,medida,ancho,perfil,rin,precio_compra,precio_venta,precio_mayorista,stock,stock_por_bodega,
       proveedor,fecha_recepcion,fecha_recepcion_original,tipo_usada,vida,publicada,dominio,activo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,
        timezone('America/Mexico_City',$14::timestamptz)::date,$14::timestamptz,$15,$16,$17,$18,true) RETURNING *`,
    [generateId(), input.marca, input.modelo, input.medida, parsed.ancho, parsed.perfil, parsed.rin,
      calcularImportePartida(input.precioCompra, 1), calcularImportePartida(input.precioVenta, 1),
      input.precioMayorista === undefined ? null : calcularImportePartida(input.precioMayorista, 1), totalStock(stock), JSON.stringify(stock),
      input.proveedor, input.fechaRecepcion, input.tipoUsada ?? null, input.vida ?? null, input.publicada ?? null, DOMINIO])).rows[0];
    for (const [bodega, cantidad] of Object.entries(stock)) if (cantidad > 0) {
      await registrarMovimiento(client, { llantaId: row.id, destino: bodega as BodegaId, cantidad, tipo: 'recepcion' });
    }
    return adaptarLlanta(row);
  });
}
export async function actualizarLlantaSistema(id: string, input: Partial<LlantaInput>): Promise<Llanta | null> {
  validarDatos(input);
  // Stock adjustments have their own atomic operation and audit trail.
  if (input.stockPorBodega !== undefined || input.cantidad !== undefined || input.bodega !== undefined) {
    throw new Error('Utiliza el ajuste de existencias para cambiar cantidades o bodegas de una llanta existente.');
  }
  const fields: Record<string, unknown> = {};
  const columns = { marca: 'marca', modelo: 'modelo', medida: 'medida', precioCompra: 'precio_compra', precioVenta: 'precio_venta',
    precioMayorista: 'precio_mayorista', proveedor: 'proveedor', tipoUsada: 'tipo_usada', vida: 'vida', publicada: 'publicada' } as const;
  for (const [key, column] of Object.entries(columns) as Array<[keyof typeof columns, string]>) {
    const value = input[key];
    if (value !== undefined) fields[column] = typeof value === 'number' ? calcularImportePartida(value, 1) : value;
  }
  if (input.medida !== undefined) Object.assign(fields, parseMedida(input.medida));
  const values = Object.values(fields);
  const assignments = Object.keys(fields).map((key, index) => `${key}=$${index + 1}`);
  if (input.fechaRecepcion !== undefined) {
    values.push(input.fechaRecepcion);
    assignments.push(`fecha_recepcion_original=$${values.length}::timestamptz`, `fecha_recepcion=timezone('America/Mexico_City',$${values.length}::timestamptz)::date`);
  }
  if (!assignments.length) return obtenerLlantaSistema(id);
  const row = (await db.query<LlantaRow>(`UPDATE llantas SET ${assignments.join(',')},updated_at=NOW()
    WHERE id=$${values.length + 1} AND dominio=$${values.length + 2} AND activo=true RETURNING *`, [...values, id, DOMINIO])).rows[0];
  return row ? adaptarLlanta(row) : null;
}
export async function eliminarLlantaSistema(id: string): Promise<boolean> {
  return ((await db.query('UPDATE llantas SET activo=false,updated_at=NOW() WHERE id=$1 AND dominio=$2 AND activo=true', [id, DOMINIO])).rowCount ?? 0) > 0;
}
export async function ajustarStockSistema(id: string, bodega: BodegaId, cantidad: number): Promise<Llanta | null> {
  validarBodega(bodega);
  if (!Number.isSafeInteger(cantidad)) throw new Error('El ajuste debe ser entero.');
  return transaction(async (client) => {
    const row = (await client.query<LlantaRow>('SELECT * FROM llantas WHERE id=$1 AND dominio=$2 AND activo=true FOR UPDATE', [id, DOMINIO])).rows[0];
    if (!row) return null;
    const stock = stockDeFila(row);
    stock[bodega] += cantidad;
    if (stock[bodega] < 0) throw new Error('Stock insuficiente para realizar el ajuste.');
    if (cantidad === 0) return adaptarLlanta(row);
    const updated = await guardarStock(client, id, stock);
    await registrarMovimiento(client, { llantaId: id, origen: cantidad < 0 ? bodega : null,
      destino: cantidad > 0 ? bodega : null, cantidad: Math.abs(cantidad), tipo: 'ajuste' });
    return adaptarLlanta(updated);
  });
}
export async function moverStockSistema(llantaId: string, bodegaOrigen: BodegaId, bodegaDestino: BodegaId, cantidad: number): Promise<Llanta | null> {
  validarBodega(bodegaOrigen); validarBodega(bodegaDestino); validarCantidad(cantidad);
  if (bodegaOrigen === bodegaDestino) throw new Error('Selecciona dos bodegas distintas.');
  return transaction(async (client) => {
    const row = (await client.query<LlantaRow>('SELECT * FROM llantas WHERE id=$1 AND dominio=$2 AND activo=true FOR UPDATE', [llantaId, DOMINIO])).rows[0];
    if (!row) return null;
    const stock = stockDeFila(row);
    if (stock[bodegaOrigen] < cantidad) throw new Error('Stock insuficiente en bodega de origen.');
    stock[bodegaOrigen] -= cantidad; stock[bodegaDestino] += cantidad;
    const updated = await guardarStock(client, llantaId, stock);
    await registrarMovimiento(client, { llantaId, origen: bodegaOrigen, destino: bodegaDestino, cantidad, tipo: 'traslado' });
    return adaptarLlanta(updated);
  });
}
export async function obtenerMovimientosSistema(): Promise<MovimientoBodega[]> {
  const result = await db.query<{ id: string; llanta_id: string; bodega_origen: BodegaId | null; bodega_destino: BodegaId | null;
    cantidad: number; fecha: string; tipo: string | null; motivo: string | null; venta_id: string | null }>(
  'SELECT * FROM movimientos_bodega WHERE dominio=$1 ORDER BY fecha DESC,id', [DOMINIO]);
  return result.rows.map((row) => ({ id: row.id, llantaId: row.llanta_id, bodegaOrigen: row.bodega_origen ?? '',
    bodegaDestino: row.bodega_destino ?? '', cantidad: Number(row.cantidad), fecha: row.fecha,
    tipo: row.tipo ?? undefined, motivo: row.motivo ?? undefined, ventaId: row.venta_id ?? undefined }));
}
export async function obtenerStockBajoSistema(): Promise<Llanta[]> {
  return (await obtenerInventarioSistema()).filter((llanta) => getTotalStock(llanta) === 0);
}
export async function deducirStockPorVenta(llantaId: string, bodega: BodegaId, cantidad: number): Promise<boolean> {
  validarCantidad(cantidad); return !!(await ajustarStockSistema(llantaId, bodega, -cantidad));
}
export async function restaurarStockPorCancelacion(llantaId: string, bodega: BodegaId, cantidad: number): Promise<boolean> {
  validarCantidad(cantidad); return !!(await ajustarStockSistema(llantaId, bodega, cantidad));
}
