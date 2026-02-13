'use client';

import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Card, CardBody, CardHeader, Button } from '@/components/ui';
import { BODEGAS, CONFIG } from '@/lib/config';
import { obtenerDatosInventario, obtenerDatosCatalogo, type InventarioData, type CatalogoData } from './actions';
import type { BodegaId } from '@/types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
};

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Detect iOS Safari
const isIOSSafari = () => {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const webkit = /WebKit/.test(ua);
  const notChrome = !/CriOS/.test(ua);
  return iOS && webkit && notChrome;
};

// Custom save function for iOS Safari compatibility
const savePDF = (doc: jsPDF, filename: string) => {
  if (isIOSSafari()) {
    // On iOS Safari, open PDF in new tab using data URL
    const pdfData = doc.output('dataurlstring');
    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head>
            <title>${filename}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { margin: 0; padding: 0; }
              iframe { width: 100%; height: 100vh; border: none; }
              .download-hint {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: #3b82f6;
                color: white;
                padding: 12px;
                text-align: center;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 14px;
                z-index: 1000;
              }
            </style>
          </head>
          <body>
            <div class="download-hint">
              Toca y mantén presionado el PDF para guardarlo, o usa el botón de compartir
            </div>
            <iframe src="${pdfData}"></iframe>
          </body>
        </html>
      `);
      newWindow.document.close();
    }
  } else {
    // Normal download for other browsers
    doc.save(filename);
  }
};

export function DescargasSection() {
  const [loading, setLoading] = useState<string | null>(null);
  const [bodegaCatalogo, setBodegaCatalogo] = useState<BodegaId | ''>('');

  const addHeader = async (doc: jsPDF, title: string, subtitle?: string) => {
    const pageWidth = doc.internal.pageSize.getWidth();

    // Try to load logo
    try {
      const logoImg = new Image();
      logoImg.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        logoImg.onload = () => resolve();
        logoImg.onerror = () => reject();
        logoImg.src = CONFIG.logo;
      });
      doc.addImage(logoImg, 'JPEG', 14, 10, 25, 25);
    } catch {
      // Logo not available, continue without it
    }

    // Business name and info
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(CONFIG.nombreNegocio, 45, 18);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(CONFIG.direccion, 45, 25);

    // Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(title, pageWidth / 2, 45, { align: 'center' });

    if (subtitle) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(subtitle, pageWidth / 2, 52, { align: 'center' });
    }

    // Date
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generado: ${new Date().toLocaleDateString('es-MX', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })}`, pageWidth - 14, 18, { align: 'right' });

    // Line separator
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 58, pageWidth - 14, 58);

    return 65; // Return Y position after header
  };

  const handleDescargarInventario = async () => {
    setLoading('inventario');

    const result = await obtenerDatosInventario();
    if (!result.success || !result.data) {
      setLoading(null);
      return;
    }

    const data = result.data;
    const doc = new jsPDF('landscape');

    const startY = await addHeader(doc, 'INVENTARIO COMPLETO', `${data.totales.productos} productos · ${data.totales.unidades} unidades`);

    // Summary cards
    const cardY = startY;
    const cardWidth = 55;
    const cardHeight = 20;
    const cardGap = 10;
    const startX = 14;

    // Card backgrounds
    doc.setFillColor(240, 249, 255);
    doc.roundedRect(startX, cardY, cardWidth, cardHeight, 2, 2, 'F');
    doc.roundedRect(startX + cardWidth + cardGap, cardY, cardWidth, cardHeight, 2, 2, 'F');

    doc.setFillColor(240, 253, 244);
    doc.roundedRect(startX + (cardWidth + cardGap) * 2, cardY, cardWidth, cardHeight, 2, 2, 'F');
    doc.roundedRect(startX + (cardWidth + cardGap) * 3, cardY, cardWidth, cardHeight, 2, 2, 'F');

    // Card content
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Total Productos', startX + 5, cardY + 6);
    doc.text('Total Unidades', startX + cardWidth + cardGap + 5, cardY + 6);
    doc.text('Valor Venta', startX + (cardWidth + cardGap) * 2 + 5, cardY + 6);
    doc.text('Valor Compra', startX + (cardWidth + cardGap) * 3 + 5, cardY + 6);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(data.totales.productos.toString(), startX + 5, cardY + 15);
    doc.text(data.totales.unidades.toString(), startX + cardWidth + cardGap + 5, cardY + 15);
    doc.setTextColor(22, 163, 74);
    doc.text(formatCurrency(data.totales.valorVenta), startX + (cardWidth + cardGap) * 2 + 5, cardY + 15);
    doc.text(formatCurrency(data.totales.valorCompra), startX + (cardWidth + cardGap) * 3 + 5, cardY + 15);

    // Table
    const headers = [
      'Producto',
      'Medida',
      'Rin',
      'P.Compra',
      'P.Venta',
      'Stock',
      ...data.bodegas.map(b => b.nombre),
      'Proveedor',
    ];

    const rows = data.productos.map(p => [
      `${p.marca} ${p.modelo}`,
      p.medida,
      `R${p.rin}`,
      formatCurrency(p.precioCompra),
      formatCurrency(p.precioVenta),
      p.stockTotal.toString(),
      ...data.bodegas.map(b => (p.stockPorBodega[b.id] || 0).toString()),
      p.proveedor,
    ]);

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: cardY + cardHeight + 10,
      styles: {
        fontSize: 8,
        cellPadding: 3,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: 255,
        fontStyle: 'bold',
        minCellWidth: 12,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 35 }, // Producto
        1: { cellWidth: 22 }, // Medida
        2: { cellWidth: 12, halign: 'center' }, // Rin
        3: { cellWidth: 22, halign: 'right' }, // P.Compra
        4: { cellWidth: 22, halign: 'right' }, // P.Venta
        5: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, // Stock
      },
    });

    savePDF(doc, `inventario-completo-${new Date().toISOString().split('T')[0]}.pdf`);
    setLoading(null);
  };

  const handleDescargarCatalogo = async () => {
    setLoading('catalogo');

    const result = await obtenerDatosCatalogo(bodegaCatalogo);
    if (!result.success || !result.data) {
      setLoading(null);
      return;
    }

    const data = result.data;
    // Use landscape when showing all bodegas, portrait when filtering by one
    const orientation = data.bodegaFiltro ? 'portrait' : 'landscape';
    const doc = new jsPDF(orientation);

    const subtitleText = data.bodegaFiltro
      ? `Bodega: ${data.bodegaFiltro} · ${data.totales.productos} productos · ${data.totales.unidades} unidades`
      : `Todas las bodegas · ${data.totales.productos} productos · ${data.totales.unidades} unidades`;

    const startY = await addHeader(doc, 'CATÁLOGO DE PRODUCTOS', subtitleText);

    // Table headers based on whether we're filtering by bodega
    let headers: string[];
    let rows: string[][];

    if (data.bodegaFiltro) {
      headers = ['Producto', 'Medida', 'Rin', 'Precio', 'Stock'];
      rows = data.productos.map(p => [
        `${p.marca} ${p.modelo}`,
        p.medida,
        `R${p.rin}`,
        formatCurrency(p.precioVenta),
        p.stock.toString(),
      ]);
    } else {
      headers = ['Producto', 'Medida', 'Rin', 'Precio', 'Total', ...data.bodegas.map(b => b.nombre)];
      rows = data.productos.map(p => [
        `${p.marca} ${p.modelo}`,
        p.medida,
        `R${p.rin}`,
        formatCurrency(p.precioVenta),
        p.stock.toString(),
        ...data.bodegas.map(b => (p.stockPorBodega?.[b.id] || 0).toString()),
      ]);
    }

    // Different column styles based on orientation
    const columnStyles = data.bodegaFiltro
      ? {
          0: { cellWidth: 60 }, // Producto
          1: { cellWidth: 30 }, // Medida
          2: { cellWidth: 20, halign: 'center' as const }, // Rin
          3: { cellWidth: 30, halign: 'right' as const, fontStyle: 'bold' as const }, // Precio
          4: { cellWidth: 20, halign: 'center' as const, fontStyle: 'bold' as const }, // Stock
        }
      : {
          0: { cellWidth: 50 }, // Producto
          1: { cellWidth: 25 }, // Medida
          2: { cellWidth: 15, halign: 'center' as const }, // Rin
          3: { cellWidth: 25, halign: 'right' as const, fontStyle: 'bold' as const }, // Precio
          4: { cellWidth: 15, halign: 'center' as const, fontStyle: 'bold' as const }, // Total
          // Bodegas columns will auto-size
        };

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: startY,
      styles: {
        fontSize: data.bodegaFiltro ? 10 : 9,
        cellPadding: 4,
      },
      headStyles: {
        fillColor: [34, 197, 94],
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [240, 253, 244],
      },
      columnStyles,
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Página ${i} de ${pageCount}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    const bodegaSlug = data.bodegaFiltro?.toLowerCase().replace(/\s+/g, '-') || 'todas';
    savePDF(doc, `catalogo-${bodegaSlug}-${new Date().toISOString().split('T')[0]}.pdf`);
    setLoading(null);
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold flex items-center gap-2">
          <Download className="w-5 h-5" />
          Descargar Datos
        </h2>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Inventario Completo */}
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="flex items-start gap-3 mb-4">
              <FileText className="w-8 h-8 text-blue-600" />
              <div>
                <h3 className="font-semibold">Inventario Completo</h3>
                <p className="text-sm text-gray-600">
                  Todos los productos con precio de compra, venta y stock por bodega.
                </p>
              </div>
            </div>
            <Button
              onClick={handleDescargarInventario}
              disabled={loading === 'inventario'}
              className="w-full"
            >
              {loading === 'inventario' ? (
                <>
                  <span className="spinner-sm mr-2" />
                  Generando PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Descargar PDF
                </>
              )}
            </Button>
          </div>

          {/* Catálogo */}
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="flex items-start gap-3 mb-4">
              <FileText className="w-8 h-8 text-green-600" />
              <div>
                <h3 className="font-semibold">Catálogo</h3>
                <p className="text-sm text-gray-600">
                  Lista de productos con precio de venta (sin precio de compra).
                </p>
              </div>
            </div>
            <div className="mb-3">
              <label className="label text-sm">Bodega</label>
              <select
                className="input"
                value={bodegaCatalogo}
                onChange={(e) => setBodegaCatalogo(e.target.value as BodegaId | '')}
              >
                <option value="">Todas las bodegas</option>
                {BODEGAS.map((bodega) => (
                  <option key={bodega.id} value={bodega.id}>
                    {bodega.nombre}
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={handleDescargarCatalogo}
              disabled={loading === 'catalogo'}
              variant="secondary"
              className="w-full"
            >
              {loading === 'catalogo' ? (
                <>
                  <span className="spinner-sm mr-2" />
                  Generando PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Descargar Catálogo PDF
                </>
              )}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
