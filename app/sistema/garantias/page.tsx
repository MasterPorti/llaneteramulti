'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Shield, Search, CheckCircle, XCircle, Clock, Eye } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { buscarGarantia, obtenerGarantias } from './actions';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';
import { generarCodigoAuxiliar } from '@/lib/config-sistema';
import type { SistemaVenta, GarantiaSistema } from '@/types/sistema';

export default function GarantiasPage() {
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState('');

  const [resultado, setResultado] = useState<{
    venta: SistemaVenta;
    garantia: GarantiaSistema;
  } | null>(null);

  const [garantiasActivas, setGarantiasActivas] = useState<
    Array<{ venta: SistemaVenta; garantia: GarantiaSistema; diasRestantes: number }>
  >([]);

  useEffect(() => {
    loadGarantias();
  }, []);

  const loadGarantias = async () => {
    setLoadingList(true);
    const result = await obtenerGarantias();
    if (result.success && result.data) {
      setGarantiasActivas(result.data);
    }
    setLoadingList(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!busqueda.trim()) return;

    setLoading(true);
    setError('');
    setResultado(null);

    const result = await buscarGarantia(busqueda.trim());

    if (result.success && result.data) {
      setResultado(result.data);
    } else {
      setError(result.error || 'Garantía no encontrada');
    }

    setLoading(false);
  };

  const isGarantiaActiva = (garantia: GarantiaSistema) => {
    if (!garantia.activa) return false;
    return new Date(garantia.fechaFin) >= new Date();
  };

  const getDiasRestantes = (garantia: GarantiaSistema) => {
    const hoy = new Date();
    const fechaFin = new Date(garantia.fechaFin);
    return Math.ceil((fechaFin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div>
      <PageHeader
        title="Garantías"
        subtitle="Buscar y consultar garantías"
      />

      {/* Buscador */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Search className="w-5 h-5" />
            Buscar Garantía
          </h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="relative flex-1">
              <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                className="input w-full"
                style={{ paddingLeft: '2.5rem' }}
                placeholder="Ingrese ID de garantía (ej: GAR-2026-0001)"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value.toUpperCase())}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </form>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {resultado && (
            <div className="mt-4">
              <div
                className={`p-4 rounded-lg border-l-4 ${
                  isGarantiaActiva(resultado.garantia)
                    ? 'bg-green-500/10 border-green-500'
                    : 'bg-red-500/10 border-red-500'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-mono text-2xl font-bold text-[var(--accent)]">
                      {resultado.garantia.id}
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">
                      Venta: {resultado.venta.folio}
                    </p>
                  </div>
                  <Badge
                    variant={isGarantiaActiva(resultado.garantia) ? 'success' : 'danger'}
                  >
                    {isGarantiaActiva(resultado.garantia) ? (
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Activa
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> Expirada
                      </span>
                    )}
                  </Badge>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">Cliente</p>
                    <p className="font-medium">{resultado.venta.cliente.nombre}</p>
                    {resultado.venta.cliente.telefono && (
                      <p className="text-sm">{resultado.venta.cliente.telefono}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">Vigencia</p>
                    <p className="font-medium">
                      {formatDateShort(resultado.garantia.fechaInicio)} -{' '}
                      {formatDateShort(resultado.garantia.fechaFin)}
                    </p>
                    {isGarantiaActiva(resultado.garantia) && (
                      <p className="text-sm text-green-400">
                        {getDiasRestantes(resultado.garantia)} días restantes
                      </p>
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-[var(--text-muted)] mb-2">Productos</p>
                  <div className="space-y-2">
                    {resultado.venta.items.map((item, index) => (
                      <div
                        key={index}
                        className="p-2 rounded bg-[var(--bg-tertiary)] flex justify-between items-center"
                      >
                        <div>
                          <p className="font-mono text-xs text-[var(--text-muted)]">
                            {item.llantaSnapshot.codigoAuxiliar}
                          </p>
                          <p className="text-sm font-medium">
                            {item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {item.llantaSnapshot.medida}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{item.cantidad} uds</p>
                          <p className="text-sm text-[var(--text-muted)]">
                            {formatCurrency(item.subtotal)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded bg-[var(--bg-tertiary)] text-sm">
                  <p className="text-[var(--text-muted)] mb-1">Condiciones:</p>
                  <p>{resultado.garantia.condiciones}</p>
                </div>

                <div className="mt-4 flex justify-between items-center">
                  <p className="text-lg font-bold">
                    Total: {formatCurrency(resultado.venta.total)}
                  </p>
                  <Link href={`/ventas/${resultado.venta.id}`}>
                    <button className="btn btn-secondary flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      Ver Venta
                    </button>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Lista de Garantías Activas */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Garantías Activas ({garantiasActivas.length})
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {loadingList ? (
            <div className="flex items-center justify-center py-12">
              <span className="spinner" />
              <span className="ml-3 text-[var(--text-muted)]">Cargando...</span>
            </div>
          ) : garantiasActivas.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No hay garantías activas</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {garantiasActivas.map(({ venta, garantia, diasRestantes }) => (
                <div
                  key={garantia.id}
                  className="p-4 hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-mono font-bold text-[var(--accent)]">{garantia.id}</p>
                      <p className="text-sm">{venta.cliente.nombre}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {venta.folio} - {formatDateShort(venta.fechaVenta)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          diasRestantes <= 7
                            ? 'danger'
                            : diasRestantes <= 30
                            ? 'warning'
                            : 'success'
                        }
                      >
                        {diasRestantes} días
                      </Badge>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        Vence: {formatDateShort(garantia.fechaFin)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
