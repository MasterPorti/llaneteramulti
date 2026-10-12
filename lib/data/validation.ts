import { BODEGAS } from '@/lib/config';
import type { BodegaId } from '@/types';

export function validarBodega(bodega: BodegaId): void {
  if (!BODEGAS.some((entry) => entry.id === bodega)) throw new Error('Bodega inválida.');
}

export function validarCantidad(cantidad: number, permitirCero = false): void {
  if (!Number.isSafeInteger(cantidad) || cantidad > 2147483647 || cantidad < (permitirCero ? 0 : 1)) throw new Error('La cantidad debe ser un entero ' + (permitirCero ? 'no negativo' : 'mayor a cero') + ' y no superar 2,147,483,647.');
}

export function validarImporte(importe: number): void {
  if (!Number.isFinite(importe) || importe < 0 || importe >= 100000000) throw new Error('El importe debe estar entre $0 y $99,999,999.99.');
}

export function validarProveedor(proveedor: string): void {
  const esperado = process.env.LLANTERA_SUPPLIER || 'COMERCIALIZADORA DE NEW TIRES';
  const normalizar = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX');
  if (normalizar(proveedor) !== normalizar(esperado)) throw new Error(`Este sistema opera exclusivamente con el proveedor ${esperado}.`);
}
