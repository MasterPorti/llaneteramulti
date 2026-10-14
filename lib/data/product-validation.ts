import type { ProductoInput } from '@/types';
import { validarCantidad, validarImporte } from './validation';
import { validarTexto } from './normalizado';

/** One contract for both legacy storage and the shared product catalogue. */
export function validateProductInput(input: Partial<ProductoInput>, partial = false): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Datos de producto inválidos.');
  if (!partial || input.nombre !== undefined) validarTexto(input.nombre as string, 'El nombre', 200);
  if (input.descripcion !== undefined) validarTexto(input.descripcion, 'La descripción', 2000, false);
  if ('imagen' in input || 'imagenId' in input || 'imagen_id' in input) {
    throw new Error('Selecciona un archivo de imagen desde el formulario.');
  }
  if (!partial || input.cantidad !== undefined) validarCantidad(input.cantidad as number, true);
  for (const amount of [input.precio, input.precioVenta]) if (amount !== undefined) validarImporte(amount);
  if (!partial) validarImporte((input.precioVenta ?? input.precio) as number);
  // undefined preserves a recorded cost on edit; null explicitly means unknown.
  if (input.precioCompra !== undefined && input.precioCompra !== null) validarImporte(input.precioCompra);
}

export function validateProductId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(id)) throw new Error('Producto inválido.');
}
