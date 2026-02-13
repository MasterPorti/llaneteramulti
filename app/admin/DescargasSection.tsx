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
const savePDF = async (doc: jsPDF, filename: string) => {
  if (isIOSSafari()) {
    // iOS Safari ignores the `download` attribute on anchor tags,
    // so we use the Web Share API which triggers the native iOS share sheet
    // letting the user save to Files, share via WhatsApp, AirDrop, etc.
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });

    if (navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return;
      } catch (err) {
        // User cancelled share - that's fine, no fallback needed
        if ((err as Error).name === 'AbortError') return;
      }
    }

    // Fallback: open PDF in new tab so user can use Safari's share button
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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

    await savePDF(doc, `inventario-completo-${new Date().toISOString().split('T')[0]}.pdf`);
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
    // Always use portrait orientation
    const doc = new jsPDF('portrait');

    const subtitleText = data.bodegaFiltro
      ? `Bodega: ${data.bodegaFiltro}`
      : undefined;

    const startY = await addHeader(doc, 'CATÁLOGO DE PRODUCTOS', subtitleText);

    // Sort products by código auxiliar (ascending - menor a mayor)
    const productosOrdenados = [...data.productos].sort((a, b) => {
      // Compare as strings, which works for numeric codes like "205 55 16"
      return a.codigoAuxiliar.localeCompare(b.codigoAuxiliar, undefined, { numeric: true });
    });

    // Table headers based on whether we're filtering by bodega
    let headers: string[];
    let rows: string[][];

    if (data.bodegaFiltro) {
      headers = ['Cód. Aux.', 'Producto', 'Medida', 'Precio', 'Stock'];
      rows = productosOrdenados.map(p => [
        p.codigoAuxiliar,
        `${p.marca} ${p.modelo}`,
        p.medida,
        formatCurrency(p.precioVenta),
        p.stock.toString(),
      ]);
    } else {
      headers = ['Cód. Aux.', 'Producto', 'Medida', 'Precio', 'Total', ...data.bodegas.map(b => b.nombre)];
      rows = productosOrdenados.map(p => [
        p.codigoAuxiliar,
        `${p.marca} ${p.modelo}`,
        p.medida,
        formatCurrency(p.precioVenta),
        p.stock.toString(),
        ...data.bodegas.map(b => (p.stockPorBodega?.[b.id] || 0).toString()),
      ]);
    }

    // Different column styles based on orientation
    const numBodegas = data.bodegas.length;
    const bodegaColStart = 5; // Index where bodega columns start
    const pageWidth = doc.internal.pageSize.getWidth();

    // Calculate table width and center margin (portrait A4 = 210mm, margins ~14mm each side = 182mm usable)
    let tableWidth: number;
    if (data.bodegaFiltro) {
      tableWidth = 20 + 45 + 30 + 25 + 15; // Sum of all column widths = 135mm
    } else {
      tableWidth = 18 + 38 + 25 + 20 + 12 + (numBodegas * 10); // Sum including bodega columns
    }
    const marginLeft = Math.max(14, (pageWidth - tableWidth) / 2);

    const columnStyles = data.bodegaFiltro
      ? {
          0: { cellWidth: 20, halign: 'center' as const }, // Cód. Aux.
          1: { cellWidth: 45 }, // Producto
          2: { cellWidth: 30 }, // Medida
          3: { cellWidth: 25, halign: 'right' as const, fontStyle: 'bold' as const }, // Precio
          4: { cellWidth: 15, halign: 'center' as const, fontStyle: 'bold' as const }, // Stock
        }
      : {
          0: { cellWidth: 18, halign: 'center' as const }, // Cód. Aux.
          1: { cellWidth: 38 }, // Producto
          2: { cellWidth: 25 }, // Medida
          3: { cellWidth: 20, halign: 'right' as const, fontStyle: 'bold' as const }, // Precio
          4: { cellWidth: 12, halign: 'center' as const, fontStyle: 'bold' as const }, // Total
          // Bodega columns - narrower for portrait
          ...Object.fromEntries(
            data.bodegas.map((_, i) => [bodegaColStart + i, { cellWidth: 10, halign: 'center' as const }])
          ),
        };

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: startY,
      margin: { left: marginLeft },
      styles: {
        fontSize: data.bodegaFiltro ? 9 : 7,
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [220, 38, 38], // Rojo
        textColor: 255,
        fontStyle: 'bold',
        minCellHeight: data.bodegaFiltro ? 10 : 25, // Más alto para texto vertical
      },
      alternateRowStyles: {
        fillColor: [254, 242, 242], // Rojo claro
      },
      columnStyles,
      didDrawCell: (hookData) => {
        // Draw vertical text for bodega column headers (only when showing all bodegas)
        if (!data.bodegaFiltro && hookData.section === 'head' && hookData.column.index >= bodegaColStart) {
          const cell = hookData.cell;
          const text = headers[hookData.column.index];

          // Clear the default text by drawing a filled rectangle
          doc.setFillColor(220, 38, 38); // Rojo
          doc.rect(cell.x, cell.y, cell.width, cell.height, 'F');

          // Draw vertical text (rotated -90 for vertical reading from bottom to top)
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(7);
          doc.setFont('helvetica', 'bold');

          const centerX = cell.x + cell.width / 2;
          const centerY = cell.y + 3;

          doc.text(text, centerX, centerY, {
            angle: -90,
            align: 'left',
          });

          // Reset text color for other cells
          doc.setTextColor(0, 0, 0);
        }
      },
    });

    // Disclaimer legend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable?.finalY || startY + 50;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(220, 38, 38); // Rojo
    doc.text(
      'LISTA DE PRECIOS Y EXISTENCIAS SUJETA A CAMBIO SIN PREVIO AVISO',
      doc.internal.pageSize.getWidth() / 2,
      finalY + 8,
      { align: 'center' }
    );

    // Footer with page numbers
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
    await savePDF(doc, `catalogo-${bodegaSlug}-${new Date().toISOString().split('T')[0]}.pdf`);
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
