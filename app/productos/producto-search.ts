import type { Producto } from '@/types';

type ProductoBusqueda = Pick<Producto, 'nombre' | 'descripcion'>;

function normalizarBusqueda(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es-MX')
    .trim()
    .replace(/\s+/g, ' ');
}

export function filtrarProductos<T extends ProductoBusqueda>(productos: readonly T[], busqueda: string): T[] {
  const palabras = normalizarBusqueda(busqueda).split(' ').filter(Boolean);
  if (palabras.length === 0) return [...productos];

  return productos.filter((producto) => {
    const texto = normalizarBusqueda(`${producto.nombre} ${producto.descripcion || ''}`);
    return palabras.every((palabra) => texto.includes(palabra));
  });
}
