import type { BodegaId } from "@/types";

// Bodegas del Sistema Inventario
export const SISTEMA_BODEGAS: Array<{
  id: BodegaId;
  nombre: string;
  ubicacion: string;
  tipo: "nueva" | "usada";
}> = [
  { id: "bodega-1", nombre: "Local", ubicacion: "Local", tipo: "nueva" },
  { id: "bodega-2", nombre: "Escaleras", ubicacion: "Escaleras", tipo: "nueva" },
  { id: "bodega-3", nombre: "Benitos Usadas", ubicacion: "Benito", tipo: "usada" },
  { id: "bodega-4", nombre: "Hacienda ", ubicacion: "Hacienda ", tipo: "nueva" },
  { id: "bodega-5", nombre: "Coacalco Usadas", ubicacion: "Coacalco", tipo: "usada" },
  { id: "bodega-6", nombre: "Hacienda 2", ubicacion: "Hacienda 2", tipo: "nueva" },
  { id: "bodega-7", nombre: "Claudia Usadas Hacienda", ubicacion: "Hacienda", tipo: "usada" },
  { id: "bodega-8", nombre: "Jose Manuel Teyahualco", ubicacion: "Teyahualco", tipo: "usada" },
];

// Helpers
export const BODEGAS_USADAS = SISTEMA_BODEGAS.filter((b) => b.tipo === "usada");
export const BODEGAS_NUEVAS = SISTEMA_BODEGAS.filter((b) => b.tipo === "nueva");
export const BODEGAS_USADAS_IDS: BodegaId[] = BODEGAS_USADAS.map((b) => b.id);
export const BODEGAS_NUEVAS_IDS: BodegaId[] = BODEGAS_NUEVAS.map((b) => b.id);

export function llantaTieneStockUsado(stockPorBodega: Record<string, number>): boolean {
  return BODEGAS_USADAS_IDS.some((id) => (stockPorBodega[id] || 0) > 0);
}

// Configuración general del Sistema Inventario
export const SISTEMA_CONFIG = {
  nombreNegocio: "Sistema Inventario",
  logo: "/images/logo.jpeg",

  // Formato de folios
  formatoFolio: "SI-",
  formatoGarantia: "GAR-",

  // Garantía predeterminada
  garantiaDiasPredeterminado: 180,
  condicionesGarantiaPredeterminado: `TÉRMINOS Y CONDICIONES DE GARANTÍA
Toda llanta que ostente marca y serie, siempre que sea utilizada en condiciones normales, está garantizada por 6 meses contra defectos de fabricación, de acuerdo con las siguientes condiciones.

PARA HACER VÁLIDA ESTA GARANTÍA:
1. Factura o nota de compra de la llanta
2. Identificación oficial (INE)
3. Formato de garantía

LA GARANTÍA NO ES VÁLIDA PARA:
1. Llantas reparadas
2. Rodadas con baja presión
3. Rodadas con alta presión
4. Cortadas con objeto punzocortante
5. Impacto en costados (banquetazos)
6. Impacto por baches
7. Exceso de carga`,

  // Métodos de pago disponibles
  metodosPago: [
    { id: "efectivo", nombre: "Efectivo" },
    { id: "tarjeta", nombre: "Tarjeta" },
    { id: "transferencia", nombre: "Transferencia" },
  ] as const,
} as const;

// Genera ID de garantía: GAR-YYYY-NNNN
export function generarGarantiaId(ultimoId: number): string {
  const year = new Date().getFullYear();
  const nextId = ultimoId + 1;
  return `GAR-${year}-${nextId.toString().padStart(4, "0")}`;
}

// Genera folio de venta: SI-NNNN
export function generarFolioSistema(ultimoFolio: number): string {
  const nextFolio = ultimoFolio + 1;
  return `${SISTEMA_CONFIG.formatoFolio}${nextFolio
    .toString()
    .padStart(4, "0")}`;
}

// Genera código auxiliar a partir de la medida
export function generarCodigoAuxiliar(medida: string): string {
  // En medidas capturadas manualmente es común escribir O en lugar de 0.
  const cleaned = medida.trim().toUpperCase().replace(/O/g, "0");

  // Formato "205/55R16"
  const match1 = cleaned.match(/^(\d+)\/(\d+)R(\d+(?:\.\d+)?)$/i);
  if (match1) {
    return `${match1[1]} ${match1[2]} ${match1[3]}`;
  }

  // Formato "10.00R20" o "10R20" o "750R16"
  const match2 = cleaned.match(/^(\d+)(?:\.(\d+))?R(\d+(?:\.\d+)?)$/i);
  if (match2) {
    const part1 = match2[1];
    const part2 = match2[2];
    const part3 = match2[3];
    return part2 ? `${part1} ${part2} ${part3}` : `${part1} ${part3}`;
  }

  // Fallback
  return cleaned
    .replace(/[\/\.\-R]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
