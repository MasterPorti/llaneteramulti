import type { BodegaId } from '@/types';

// Bodegas del Sistema Inventario
export const SISTEMA_BODEGAS: Array<{ id: BodegaId; nombre: string; ubicacion: string }> = [
  { id: 'bodega-1', nombre: 'Bodega Principal', ubicacion: 'Ubicación principal' },
  { id: 'bodega-2', nombre: 'Bodega Secundaria', ubicacion: 'Sucursal 2' },
  { id: 'bodega-3', nombre: 'Bodega Auxiliar', ubicacion: 'Sucursal 3' },
  { id: 'bodega-4', nombre: 'Bodega Externa', ubicacion: 'Almacén externo' },
  { id: 'bodega-5', nombre: 'Almacen', ubicacion: 'Almacén general' },
];

// Configuración general del Sistema Inventario
export const SISTEMA_CONFIG = {
  nombreNegocio: 'Sistema Inventario',
  logo: '/images/logo.jpeg',

  // Formato de folios
  formatoFolio: 'SI-',
  formatoGarantia: 'GAR-',

  // Garantía predeterminada
  garantiaDiasPredeterminado: 60,
  condicionesGarantiaPredeterminado:
    'Garantía por defectos de fabricación. No cubre daños por mal uso, pinchazos, o desgaste normal.',

  // Métodos de pago disponibles
  metodosPago: [
    { id: 'efectivo', nombre: 'Efectivo' },
    { id: 'tarjeta', nombre: 'Tarjeta' },
    { id: 'transferencia', nombre: 'Transferencia' },
  ] as const,
} as const;

// Genera ID de garantía: GAR-YYYY-NNNN
export function generarGarantiaId(ultimoId: number): string {
  const year = new Date().getFullYear();
  const nextId = ultimoId + 1;
  return `GAR-${year}-${nextId.toString().padStart(4, '0')}`;
}

// Genera folio de venta: SI-NNNN
export function generarFolioSistema(ultimoFolio: number): string {
  const nextFolio = ultimoFolio + 1;
  return `${SISTEMA_CONFIG.formatoFolio}${nextFolio.toString().padStart(4, '0')}`;
}

// Genera código auxiliar a partir de la medida
export function generarCodigoAuxiliar(medida: string): string {
  const cleaned = medida.trim().toUpperCase();

  // Formato "205/55R16"
  const match1 = cleaned.match(/^(\d+)\/(\d+)R(\d+)$/i);
  if (match1) {
    return `${match1[1]} ${match1[2]} ${match1[3]}`;
  }

  // Formato "10.00R20" o "10R20"
  const match2 = cleaned.match(/^(\d+)(?:\.(\d+))?R(\d+)$/i);
  if (match2) {
    const part1 = match2[1];
    const part2 = match2[2] || '00';
    const part3 = match2[3];
    return `${part1} ${part2} ${part3}`;
  }

  // Fallback
  return cleaned.replace(/[\/\.\-R]/gi, ' ').replace(/\s+/g, ' ').trim();
}
