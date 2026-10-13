import type { jsPDF as PdfDocument } from 'jspdf';
import type { Styles } from 'jspdf-autotable';
import { CONFIG } from '@/lib/config';
import { formatDateTime } from '@/lib/utils/formatters';
import type { PdfReport } from './data';

const INK: [number, number, number] = [27, 42, 68];
const MUTED: [number, number, number] = [91, 103, 119];
const GOLD: [number, number, number] = [219, 184, 35];
const MARGIN = 14;

function pdfText(value: string): string {
  return value.replace(/[\u2010-\u2015]/g, '-').replace(/\u00a0/g, ' ');
}

/** Render structured text only: no HTML, scripts, remote PDF viewers or user images. */
export async function createReportPdf(
  report: PdfReport,
  logo: Uint8Array,
  generatedAt: Date = new Date(),
): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc: PdfDocument = new jsPDF({
    orientation: report.orientation,
    unit: 'mm',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
  });
  doc.setProperties({ title: `${CONFIG.nombreNegocio} - ${report.title}`, author: CONFIG.nombreNegocio });
  doc.setCreationDate(generatedAt);
  doc.setFont('helvetica', 'normal');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const generated = formatDateTime(generatedAt.toISOString());
  const image = doc.getImageProperties(logo);
  const imageScale = Math.min(25 / image.width, 25 / image.height);

  const drawHeader = (first: boolean) => {
    doc.addImage(logo, 'JPEG', MARGIN, 12, image.width * imageScale, image.height * imageScale, 'business-logo');
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(CONFIG.nombreNegocio.toUpperCase(), MARGIN + 30, 18);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.setFontSize(8);
    const address = doc.splitTextToSize(CONFIG.direccion, contentWidth - 32);
    doc.text(address, MARGIN + 30, 24);
    doc.text(`Tel. ${CONFIG.telefono}  |  RFC: ${CONFIG.rfc}`, MARGIN + 30, 24 + address.length * 3.4 + 2);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.8);
    doc.line(MARGIN, 41, pageWidth - MARGIN, 41);
    if (!first) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...INK);
      doc.setFontSize(10);
      doc.text(report.title, MARGIN, 48);
    }
  };

  drawHeader(true);
  let y = 51;
  const nextPage = () => {
    doc.addPage();
    drawHeader(false);
    y = 55;
  };
  const writeText = (text: string, size: number, color: [number, number, number], bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines: string[] = doc.splitTextToSize(pdfText(text), contentWidth);
    for (const line of lines) {
      if (y + size * 0.42 > pageHeight - 25) {
        nextPage();
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(...color);
      }
      doc.text(line, MARGIN, y);
      y += size * 0.42;
    }
    y += 2;
  };
  writeText(report.title, 20, INK, true);
  writeText(report.description, 9, MUTED);
  writeText(`Emitido: ${generated} (Ciudad de México)  |  Importes en MXN`, 8, MUTED);
  for (const filter of report.filters) writeText(filter, 8.5, INK);
  y += 2;

  const perRow = Math.min(report.stats.length, report.orientation === 'portrait' ? 2 : report.stats.length > 4 ? 3 : 4);
  const gap = 3;
  const statRows = report.kind === 'ventas' && report.orientation === 'landscape' && report.stats.length === 7
    ? [report.stats.slice(0, 3), report.stats.slice(3)]
    : Array.from({ length: perRow ? Math.ceil(report.stats.length / perRow) : 0 }, (_, index) => report.stats.slice(index * perRow, (index + 1) * perRow));
  for (const stats of statRows) {
    const columns = report.stats.length === 7 && report.kind === 'ventas' ? stats.length : perRow;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const labels = stats.map(stat => doc.splitTextToSize(pdfText(stat.label), cardWidth - 8) as string[]);
    const cardHeight = Math.max(...labels.map(lines => lines.length)) * 3.5 + 15;
    if (y + cardHeight > pageHeight - 28) nextPage();
    stats.forEach((stat, index) => {
      const x = MARGIN + index * (cardWidth + gap);
      doc.setFillColor(244, 246, 249);
      doc.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5, 'F');
      doc.setTextColor(...MUTED);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(labels[index], x + 4, y + 5);
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'bold');
      const value = pdfText(stat.value);
      let fontSize = 14;
      doc.setFontSize(fontSize);
      while (doc.getTextWidth(value) > cardWidth - 8 && fontSize > 8) doc.setFontSize(--fontSize);
      doc.text(value, x + 4, y + cardHeight - 4);
    });
    y += cardHeight + gap;
  }
  y += 2;
  if (report.note) writeText(report.note, 8, MUTED);
  if (y + 20 > pageHeight - 20) nextPage();

  const tableFirstPage = doc.getNumberOfPages();
  const widthSum = report.columns.reduce((sum, col) => sum + (col.width ?? 1), 0);
  const columnStyles = Object.fromEntries(report.columns.map((col, index) => [index, {
    halign: col.align ?? 'left',
    ...(report.columns.every(column => column.width !== undefined)
      ? { cellWidth: contentWidth * (col.width ?? 1) / widthSum }
      : {}),
  } satisfies Partial<Styles>]));

  autoTable(doc, {
    startY: y,
    margin: { top: 54, left: MARGIN, right: MARGIN, bottom: 20 },
    tableWidth: contentWidth,
    head: [report.columns.map(column => pdfText(column.header))],
    body: report.rows.map(row => row.map(pdfText)),
    foot: report.totalRow ? [report.totalRow.map(pdfText)] : undefined,
    showHead: 'everyPage',
    showFoot: 'lastPage',
    rowPageBreak: 'avoid',
    theme: 'plain',
    styles: {
      font: 'helvetica', fontSize: 8, textColor: INK,
      cellPadding: { top: 2.7, right: 2.2, bottom: 2.7, left: 2.2 },
      overflow: 'linebreak', valign: 'top', lineColor: [225, 230, 237], lineWidth: { bottom: 0.15 },
    },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, valign: 'middle' },
    footStyles: { fillColor: [233, 237, 244], fontStyle: 'bold', textColor: INK },
    alternateRowStyles: { fillColor: [247, 249, 251] },
    columnStyles,
    didParseCell: data => {
      const column = report.columns[data.column.index];
      if (column?.align) data.cell.styles.halign = column.align;
      if (data.section === 'body' && report.rowStatuses?.[data.row.index] === 'cancelada') {
        data.cell.styles.fillColor = [253, 240, 238];
        data.cell.styles.textColor = [128, 49, 41];
      }
    },
    willDrawPage: () => {
      if (doc.getNumberOfPages() !== tableFirstPage) drawHeader(false);
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setDrawColor(218, 224, 232);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, pageHeight - 15, pageWidth - MARGIN, pageHeight - 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`${CONFIG.nombreNegocio} | ${report.title}`, MARGIN, pageHeight - 10);
    doc.text(`Página ${page} de ${pageCount}`, pageWidth - MARGIN, pageHeight - 10, { align: 'right' });
  }
  return doc.output('arraybuffer');
}

export async function downloadReportPdf(report: PdfReport): Promise<void> {
  const response = await fetch(CONFIG.logo);
  if (!response.ok) throw new Error('No se pudo cargar el logo del negocio. Intenta descargar de nuevo.');
  const logo = new Uint8Array(await response.arrayBuffer());
  const bytes = await createReportPdf(report, logo);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = report.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Keep the URL alive until the browser has accepted the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
