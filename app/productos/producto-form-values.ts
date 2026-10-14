import type { ProductoInput } from '@/types';

export interface ProductoFormValues {
  nombre: string;
  descripcion: string;
  precioVenta: string;
  precioCompra: string;
  cantidad: string;
}

type ProductoEditInput = Omit<ProductoInput, 'cantidad'>;

function parseImporte(value: string, label: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) {
    throw new Error(`${label} debe ser un importe no negativo, con un máximo de dos decimales.`);
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount > 99999999.99) {
    throw new Error(`${label} no puede superar $99,999,999.99.`);
  }
  return amount;
}

export function buildProductoInput(values: ProductoFormValues, mode: 'create'): ProductoInput;
export function buildProductoInput(values: ProductoFormValues, mode: 'edit'): ProductoEditInput;
export function buildProductoInput(values: ProductoFormValues, mode: 'create' | 'edit'): ProductoInput | ProductoEditInput {
  const nombre = values.nombre.trim();
  const descripcion = values.descripcion.trim();
  if (!nombre || nombre.length > 200) throw new Error('El nombre es obligatorio y debe tener un máximo de 200 caracteres.');
  if (descripcion.length > 2000) throw new Error('La descripción debe tener un máximo de 2,000 caracteres.');

  const precioVenta = parseImporte(values.precioVenta, 'El precio de venta');
  const input: ProductoEditInput = {
    nombre,
    descripcion,
    precio: precioVenta,
    precioVenta,
    // A blank cost is unknown. An explicitly entered zero remains a real zero.
    precioCompra: values.precioCompra.trim() === '' ? null : parseImporte(values.precioCompra, 'El costo de compra'),
  };
  // Stock is managed separately; an edit must never resend an old stock snapshot.
  if (mode === 'edit') return input;

  const cantidad = Number(values.cantidad);
  if (!/^\d+$/.test(values.cantidad.trim()) || !Number.isSafeInteger(cantidad) || cantidad > 2147483647) {
    throw new Error('El stock inicial debe ser un entero entre 0 y 2,147,483,647.');
  }
  return { ...input, cantidad };
}
