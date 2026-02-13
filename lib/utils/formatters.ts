export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function parseMedida(medida: string): {
  ancho: number;
  perfil: number;
  rin: number;
} | null {
  const regex = /^(\d{3})\/(\d{2})R?(\d{2})$/i;
  const match = medida.replace(/\s/g, '').match(regex);

  if (!match) return null;

  return {
    ancho: parseInt(match[1]),
    perfil: parseInt(match[2]),
    rin: parseInt(match[3]),
  };
}

export function formatMedida(ancho: number, perfil: number, rin: number): string {
  return `${ancho}/${perfil}R${rin}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function generateFolio(lastFolio: number, prefix: string = 'V-'): string {
  const nextNumber = lastFolio + 1;
  return `${prefix}${nextNumber.toString().padStart(4, '0')}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
