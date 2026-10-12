export const TASA_IVA = 0.16;

const MAX_CENTAVOS = 9_999_999_999;

export interface ImportesVenta {
  subtotal: number;
  iva: number;
  total: number;
}

function aCentavos(importe: number): number {
  if (!Number.isFinite(importe) || importe < 0) {
    throw new Error('El importe debe ser un número no negativo.');
  }
  if (importe >= 100_000_000) {
    throw new Error('El importe no puede superar $99,999,999.99.');
  }
  if (importe < 0.005) return 0;

  // Read decimal digits instead of multiplying a binary float: 1.005 must
  // round to 1.01. This range is always printed without an exponent.
  const [entero, decimales = ''] = importe.toString().split('.');
  const centavos = Number(entero) * 100
    + Number(decimales.padEnd(2, '0').slice(0, 2))
    + (Number(decimales[2] || '0') >= 5 ? 1 : 0);
  if (centavos > MAX_CENTAVOS) {
    throw new Error('El importe no puede superar $99,999,999.99.');
  }
  return centavos;
}

function importePartidaCentavos(precio: number, cantidad: number): number {
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
    throw new Error('La cantidad debe ser un entero mayor a cero.');
  }
  const precioCentavos = aCentavos(precio);
  if (precioCentavos > 0 && cantidad > Math.floor(MAX_CENTAVOS / precioCentavos)) {
    throw new Error('El importe de la partida no puede superar $99,999,999.99.');
  }
  return precioCentavos * cantidad;
}

function desglosarCentavos(totalCentavos: number): ImportesVenta {
  // Prices include 16% IVA. Integer rational arithmetic gives half-up rounding
  // once per sale, and the difference preserves the exact amount charged.
  const subtotalCentavos = Math.floor((totalCentavos * 100 + 58) / 116);
  return {
    subtotal: subtotalCentavos / 100,
    iva: (totalCentavos - subtotalCentavos) / 100,
    total: totalCentavos / 100,
  };
}

export function calcularImportePartida(precio: number, cantidad: number): number {
  return importePartidaCentavos(precio, cantidad) / 100;
}

export function desglosarIvaIncluido(total: number): ImportesVenta {
  return desglosarCentavos(aCentavos(total));
}

export function calcularImportesVenta(
  items: readonly { precioUnitario: number; cantidad: number }[],
): ImportesVenta {
  let totalCentavos = 0;
  for (const item of items) {
    const partidaCentavos = importePartidaCentavos(item.precioUnitario, item.cantidad);
    if (partidaCentavos > MAX_CENTAVOS - totalCentavos) {
      throw new Error('El total de la venta no puede superar $99,999,999.99.');
    }
    totalCentavos += partidaCentavos;
  }
  return desglosarCentavos(totalCentavos);
}
