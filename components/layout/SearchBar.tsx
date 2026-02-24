'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Package, Wrench, X } from 'lucide-react';
import { buscarLlantas } from '@/app/llantas/actions';
import type { LlantaSuggestion, Servicio } from '@/types';

interface SearchBarProps {
  servicios?: Servicio[];
}

export function SearchBar({ servicios = [] }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [productos, setProductos] = useState<LlantaSuggestion[]>([]);
  const [serviciosFiltrados, setServiciosFiltrados] = useState<Servicio[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = useCallback(
    async (termino: string) => {
      if (termino.trim().length < 2) {
        setProductos([]);
        setServiciosFiltrados([]);
        setIsOpen(false);
        return;
      }

      setLoading(true);

      try {
        const resultado = await buscarLlantas(termino);
        if (resultado.success && resultado.data) {
          setProductos(resultado.data.slice(0, 5));
        } else {
          setProductos([]);
        }
      } catch {
        setProductos([]);
      }

      const terminoLower = termino.toLowerCase();
      const serviciosMatch = servicios.filter(
        (s) =>
          s.activo &&
          (s.nombre.toLowerCase().includes(terminoLower) ||
            s.descripcion.toLowerCase().includes(terminoLower))
      );
      setServiciosFiltrados(serviciosMatch.slice(0, 5));

      setLoading(false);
      setIsOpen(true);
    },
    [servicios]
  );

  const handleChange = (value: string) => {
    setQuery(value);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      buscar(value);
    }, 300);
  };

  const handleClear = () => {
    setQuery('');
    setProductos([]);
    setServiciosFiltrados([]);
    setIsOpen(false);
  };

  const handleProductClick = (producto: LlantaSuggestion) => {
    setIsOpen(false);
    setQuery('');
    router.push(`/inventario/${producto.id}`);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const hasResults = productos.length > 0 || serviciosFiltrados.length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto">
      <div
        className={`
          flex items-center gap-3 bg-white border rounded-full px-5 py-2.5
          transition-all duration-200
          ${isFocused
            ? 'shadow-lg border-gray-300'
            : 'shadow-sm border-gray-200 hover:shadow-md'
          }
        `}
      >
        <Search className="w-5 h-5 text-gray-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            if (query.trim().length >= 2) setIsOpen(true);
          }}
          onBlur={() => setIsFocused(false)}
          placeholder="Buscar llantas, servicios..."
          className="flex-1 bg-transparent outline-none text-base md:text-sm text-gray-700 placeholder-gray-400"
        />
        {loading && <span className="spinner" />}
        {query && !loading && (
          <button
            onClick={handleClear}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {isOpen && (hasResults || loading) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden z-50">
          {productos.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 flex items-center gap-2">
                <Package className="w-3.5 h-3.5" />
                Productos
              </div>
              {productos.map((producto) => (
                <button
                  key={producto.id}
                  onClick={() => handleProductClick(producto)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between border-b border-gray-100 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {producto.marca} {producto.modelo}{' '}
                      <span className="text-gray-500">- {producto.medida}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>Stock: {producto.stockTotal}</span>
                    <span className="font-medium text-gray-700">
                      ${producto.precioVenta.toLocaleString('es-MX', {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {serviciosFiltrados.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5" />
                Servicios
              </div>
              {serviciosFiltrados.map((servicio) => (
                <div
                  key={servicio.id}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between border-b border-gray-100 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {servicio.nombre}
                    </p>
                  </div>
                  <div className="text-xs text-gray-500">
                    <span className="font-medium text-gray-700">
                      ${servicio.precioDefault.toLocaleString('es-MX', {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!hasResults && !loading && query.trim().length >= 2 && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No se encontraron resultados para &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
