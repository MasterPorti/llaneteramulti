'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Package } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { actualizarLlanta } from '../../actions';

interface LlantaData {
  id: string;
  marca: string;
  modelo: string;
  medida: string;
  precioCompra: number;
  precioVenta: number;
  proveedor: string;
  fechaRecepcion: string;
}

export default function EditarLlantaPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState<LlantaData>({
    id: '',
    marca: '',
    modelo: '',
    medida: '',
    precioCompra: 0,
    precioVenta: 0,
    proveedor: '',
    fechaRecepcion: '',
  });

  useEffect(() => {
    loadLlanta();
  }, [id]);

  const loadLlanta = async () => {
    try {
      const response = await fetch(`/api/inventario/inventario/${id}`);
      if (response.ok) {
        const llanta = await response.json();
        setFormData({
          id: llanta.id,
          marca: llanta.marca,
          modelo: llanta.modelo,
          medida: llanta.medida,
          precioCompra: llanta.precioCompra,
          precioVenta: llanta.precioVenta,
          proveedor: llanta.proveedor || '',
          fechaRecepcion: llanta.fechaRecepcion || '',
        });
      } else {
        setError('Llanta no encontrada');
      }
    } catch {
      setError('Error al cargar la llanta');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const result = await actualizarLlanta(id, {
      marca: formData.marca,
      modelo: formData.modelo,
      medida: formData.medida,
      precioCompra: formData.precioCompra,
      precioVenta: formData.precioVenta,
      proveedor: formData.proveedor,
      fechaRecepcion: formData.fechaRecepcion,
    });

    if (result.success) {
      router.push(`/inventario/inventario/${id}`);
    } else {
      setError(result.error || 'Error al guardar');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Editar Llanta" subtitle="Cargando..." />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-[var(--text-muted)]">Cargando datos...</span>
        </div>
      </div>
    );
  }

  if (error && !formData.id) {
    return (
      <div>
        <PageHeader title="Error" subtitle="Llanta no encontrada" />
        <Card>
          <CardBody className="text-center py-12">
            <p className="text-red-400 mb-4">{error}</p>
            <Link href="/inventario/inventario" className="btn btn-primary">
              Volver al inventario
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Editar Llanta"
        subtitle={`${formData.marca} ${formData.modelo}`}
        breadcrumbs={[
          { label: 'Inventario', href: '/inventario/inventario' },
          { label: formData.medida, href: `/inventario/inventario/${id}` },
          { label: 'Editar' },
        ]}
      />

      <div className="mb-6">
        <Link
          href={`/inventario/inventario/${id}`}
          className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al detalle
        </Link>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Información del Producto
          </h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                {error}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="label">Marca *</label>
                <input
                  type="text"
                  className="input w-full"
                  value={formData.marca}
                  onChange={(e) => setFormData({ ...formData, marca: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Modelo *</label>
                <input
                  type="text"
                  className="input w-full"
                  value={formData.modelo}
                  onChange={(e) => setFormData({ ...formData, modelo: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Medida *</label>
                <input
                  type="text"
                  className="input w-full"
                  value={formData.medida}
                  onChange={(e) => setFormData({ ...formData, medida: e.target.value })}
                  placeholder="205/55R16"
                  required
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Formato: ancho/perfilRrin (ej: 205/55R16)
                </p>
              </div>

              <div>
                <label className="label">Proveedor</label>
                <input
                  type="text"
                  className="input w-full"
                  value={formData.proveedor}
                  onChange={(e) => setFormData({ ...formData, proveedor: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Precio de Compra *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                    $
                  </span>
                  <input
                    type="number"
                    className="input w-full pl-7"
                    value={formData.precioCompra || ''}
                    onChange={(e) => setFormData({ ...formData, precioCompra: parseFloat(e.target.value) || 0 })}
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label">Precio de Venta *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                    $
                  </span>
                  <input
                    type="number"
                    className="input w-full pl-7"
                    value={formData.precioVenta || ''}
                    onChange={(e) => setFormData({ ...formData, precioVenta: parseFloat(e.target.value) || 0 })}
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label">Fecha de Recepción</label>
                <input
                  type="date"
                  className="input w-full"
                  value={formData.fechaRecepcion}
                  onChange={(e) => setFormData({ ...formData, fechaRecepcion: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
              <Link href={`/inventario/inventario/${id}`} className="btn btn-secondary">
                Cancelar
              </Link>
              <button
                type="submit"
                className="btn btn-primary flex items-center gap-2"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <span className="spinner w-4 h-4" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Guardar Cambios
                  </>
                )}
              </button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
