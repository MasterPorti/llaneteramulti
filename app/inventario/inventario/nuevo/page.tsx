'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Save, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { crearLlanta } from '../actions';
import { SISTEMA_BODEGAS } from '@/lib/config-sistema';
import type { BodegaId } from '@/types';

export default function NuevaLlantaPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    marca: '',
    modelo: '',
    medida: '',
    precioCompra: '',
    precioVenta: '',
    proveedor: '',
    fechaRecepcion: new Date().toISOString().split('T')[0],
    bodega: 'bodega-1' as BodegaId,
    cantidad: '1',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await crearLlanta({
      marca: formData.marca,
      modelo: formData.modelo,
      medida: formData.medida,
      precioCompra: parseFloat(formData.precioCompra) || 0,
      precioVenta: parseFloat(formData.precioVenta) || 0,
      proveedor: formData.proveedor,
      fechaRecepcion: formData.fechaRecepcion,
      bodega: formData.bodega,
      cantidad: parseInt(formData.cantidad) || 1,
    });

    if (result.success) {
      router.push('/inventario/inventario');
    } else {
      setError(result.error || 'Error al crear llanta');
    }
    setLoading(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div>
      <PageHeader
        title="Agregar Llanta"
        subtitle="Registrar nueva llanta en inventario"
        breadcrumbs={[
          { label: 'Inventario', href: '/inventario' },
          { label: 'Nueva Llanta' },
        ]}
        actions={
          <Link href="/inventario/inventario">
            <button className="btn btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Volver
            </button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Datos de la Llanta
          </h2>
        </CardHeader>
        <CardBody>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Marca */}
              <div>
                <label className="label">Marca *</label>
                <input
                  type="text"
                  name="marca"
                  className="input w-full"
                  value={formData.marca}
                  onChange={handleChange}
                  placeholder="Ej: Michelin, Pirelli, Bridgestone"
                  required
                />
              </div>

              {/* Modelo */}
              <div>
                <label className="label">Modelo *</label>
                <input
                  type="text"
                  name="modelo"
                  className="input w-full"
                  value={formData.modelo}
                  onChange={handleChange}
                  placeholder="Ej: Pilot Sport 4, Cinturato P7"
                  required
                />
              </div>

              {/* Medida */}
              <div>
                <label className="label">Medida *</label>
                <input
                  type="text"
                  name="medida"
                  className="input w-full"
                  value={formData.medida}
                  onChange={handleChange}
                  placeholder="Ej: 205/55R16"
                  required
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Formato: ancho/perfilRrin (ej: 205/55R16)
                </p>
              </div>

              {/* Proveedor */}
              <div>
                <label className="label">Proveedor</label>
                <input
                  type="text"
                  name="proveedor"
                  className="input w-full"
                  value={formData.proveedor}
                  onChange={handleChange}
                  placeholder="Nombre del proveedor"
                />
              </div>

              {/* Precio Compra */}
              <div>
                <label className="label">Precio de Compra *</label>
                <input
                  type="number"
                  name="precioCompra"
                  className="input w-full"
                  value={formData.precioCompra}
                  onChange={handleChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  required
                />
              </div>

              {/* Precio Venta */}
              <div>
                <label className="label">Precio de Venta *</label>
                <input
                  type="number"
                  name="precioVenta"
                  className="input w-full"
                  value={formData.precioVenta}
                  onChange={handleChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  required
                />
              </div>

              {/* Fecha Recepción */}
              <div>
                <label className="label">Fecha de Recepción</label>
                <input
                  type="date"
                  name="fechaRecepcion"
                  className="input w-full"
                  value={formData.fechaRecepcion}
                  onChange={handleChange}
                />
              </div>

              {/* Bodega */}
              <div>
                <label className="label">Bodega Inicial *</label>
                <select
                  name="bodega"
                  className="select w-full"
                  value={formData.bodega}
                  onChange={handleChange}
                  required
                >
                  {SISTEMA_BODEGAS.map((bodega) => (
                    <option key={bodega.id} value={bodega.id}>
                      {bodega.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cantidad Inicial */}
              <div>
                <label className="label">Cantidad Inicial *</label>
                <input
                  type="number"
                  name="cantidad"
                  className="input w-full"
                  value={formData.cantidad}
                  onChange={handleChange}
                  min="1"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
              <Link href="/inventario/inventario">
                <button type="button" className="btn btn-secondary">
                  Cancelar
                </button>
              </Link>
              <button
                type="submit"
                className="btn btn-primary flex items-center gap-2"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Guardar Llanta
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
