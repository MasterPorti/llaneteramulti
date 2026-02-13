export * from './inventario';
export * from './ventas';
export * from './servicios';

export interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DateRangeFilter {
  fechaInicio: string;
  fechaFin: string;
}
