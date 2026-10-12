'use client';

import JsBarcode from 'jsbarcode';
import type { Servicio } from '@/types';
import { formatCurrency } from './formatters';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
}

/** Print the persisted service code and price on 80 mm thermal paper. */
export async function imprimirCodigosServicios(servicios: Pick<Servicio, 'id' | 'nombre' | 'codigoBarras' | 'precioDefault'>[]): Promise<void> {
  if (!servicios.length) return;
  const labels = servicios.map((servicio) => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, servicio.codigoBarras || servicio.id, {
      format: 'CODE128', displayValue: true, fontSize: 10, margin: 4, width: 1.5, height: 50,
    });
    return `<section class="label"><h2>${escapeHtml(servicio.nombre)}</h2>` +
      `<img src="${canvas.toDataURL('image/png')}" alt="${escapeHtml(servicio.codigoBarras || servicio.id)}">` +
      `<p>${escapeHtml(formatCurrency(servicio.precioDefault))}</p></section>`;
  }).join('');

  const popup = window.open('', '_blank', 'width=420,height=640');
  if (!popup) throw new Error('Permite las ventanas emergentes para imprimir los códigos de barras.');
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Códigos de servicios</title><style>
      @page { size: 80mm auto; margin: 0; }
      * { box-sizing: border-box; }
      body { width: 72mm; margin: 0 auto; padding: 3mm 2mm; color: #000; background: #fff; font-family: Arial, sans-serif; }
      .label { text-align: center; padding: 3mm 0; border-bottom: 1px dashed #000; break-inside: avoid; page-break-inside: avoid; }
      h2 { margin: 0 0 2mm; font-size: 12px; overflow-wrap: anywhere; }
      img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
      p { margin: 1mm 0 0; font-size: 14px; font-weight: bold; }
    </style></head><body>${labels}</body></html>`);
  popup.document.close();
  try {
    await Promise.all(Array.from(popup.document.images).map((image) => image.decode()));
    if (!popup.closed) {
      popup.focus();
      popup.print();
    }
  } catch {
    popup.close();
    throw new Error('No se pudieron preparar los códigos de barras para imprimir.');
  }
}
