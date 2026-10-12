export const APP_TIME_ZONE = 'America/Mexico_City';

const datePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parseAppDate(dateString: string): Date {
  // Una fecha sin hora representa un día calendario, no medianoche UTC.
  // Usar mediodía UTC evita que CDMX la muestre como el día anterior.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return new Date(`${dateString}T12:00:00.000Z`);
  }
  return new Date(dateString);
}

/** Fecha calendario actual de la operación, no la fecha UTC del servidor. */
export function getMexicoDateString(date: Date = new Date()): string {
  return datePartsFormatter.format(date);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);
}

export function formatDate(dateString: string): string {
  const date = parseAppDate(dateString);
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatDateShort(dateString: string): string {
  const date = parseAppDate(dateString);
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: APP_TIME_ZONE,
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
} {
  // Normaliza el error común de captura: letra O en lugar del número 0.
  const clean = medida.trim().toUpperCase().replace(/O/g, '0');

  let ancho = 0;
  let perfil = 0;
  let rin = 0;

  // 1. Estándar: 205/55R16, 205/5516, 225/70R19.5
  const stdMatch = clean.match(/^(\d+)\/(\d+(?:\.\d+)?)R?(\d+(?:\.\d+)?)$/i);
  if (stdMatch) {
    return {
      ancho: parseFloat(stdMatch[1]) || 0,
      perfil: parseFloat(stdMatch[2]) || 0,
      rin: parseFloat(stdMatch[3]) || 0,
    };
  }

  // 2. Off-road: 33x12.50R20, 33X/12.50R20, etc
  const offMatch = clean.match(/^(\d+(?:\.\d+)?)(?:X|X\/|\/)(\d+(?:\.\d+)?)R?(\d+(?:\.\d+)?)$/i);
  if (offMatch) {
    return {
      ancho: parseFloat(offMatch[1]) || 0,
      perfil: parseFloat(offMatch[2]) || 0,
      rin: parseFloat(offMatch[3]) || 0,
    };
  }

  // 3. Sin perfil: 195 R15, 195R15, 195/R15
  const noPerfilMatch = clean.match(/^(\d+)(?:\s+|\/)?R(\d+(?:\.\d+)?)$/i);
  if (noPerfilMatch) {
    return {
      ancho: parseFloat(noPerfilMatch[1]) || 0,
      perfil: 0,
      rin: parseFloat(noPerfilMatch[2]) || 0,
    };
  }

  // 4. Try to parse any numbers fallback
  const nums = clean.match(/\d+(?:\.\d+)?/g);
  if (nums && nums.length >= 3) {
    ancho = parseFloat(nums[0]) || 0;
    perfil = parseFloat(nums[1]) || 0;
    rin = parseFloat(nums[2]) || 0;
  } else if (nums && nums.length === 2) {
    ancho = parseFloat(nums[0]) || 0;
    rin = parseFloat(nums[1]) || 0;
  }

  return { ancho, perfil, rin };
}

export function formatMedida(ancho: number, perfil: number, rin: number): string {
  if (perfil === 0) {
    return `${ancho}R${rin}`;
  }
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
