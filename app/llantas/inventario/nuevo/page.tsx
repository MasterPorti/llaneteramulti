'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardFooter, Button, Input, Select } from '@/components/ui';
import { crearLlanta } from '../actions';
import { MARCAS_LLANTAS, RINES_COMUNES, type LlantaInput, type BodegaId } from '@/types';
import { BODEGAS } from '@/lib/config';
import { Save } from 'lucide-react';

export default function NuevaLlantaPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [marcaInput, setMarcaInput] = useState('');
  const [showMarcaSugerencias, setShowMarcaSugerencias] = useState(false);
  const [precioCompraStr, setPrecioCompraStr] = useState('');
  const [precioVentaStr, setPrecioVentaStr] = useState('');
  const [cantidadStr, setCantidadStr] = useState('1');

  const marcasFiltradas = marcaInput.trim()
    ? MARCAS_LLANTAS.filter((m) =>
        m.toLowerCase().includes(marcaInput.toLowerCase())
      )
    : [...MARCAS_LLANTAS];

  const [formData, setFormData] = useState<LlantaInput>({
    marca: '',
    modelo: '',
    medida: '',
    precioCompra: 0,
    precioVenta: 0,
    cantidad: 1,
    bodega: 'bodega-1' as BodegaId,
    proveedor: '',
    fechaRecepcion: new Date().toISOString().split('T')[0],
  });

  const [medidaPartes, setMedidaPartes] = useState({
    ancho: '205',
    perfil: '55',
    rin: '16',
  });

  const handleMedidaChange = (parte: string, valor: string) => {
    const nuevasPartes = { ...medidaPartes, [parte]: valor };
    setMedidaPartes(nuevasPartes);
    setFormData({
      ...formData,
      medida: `${nuevasPartes.ancho}/${nuevasPartes.perfil}R${nuevasPartes.rin}`,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const dataToSend = {
      ...formData,
      precioCompra: parseFloat(precioCompraStr) || 0,
      precioVenta: parseFloat(precioVentaStr) || 0,
      cantidad: parseInt(cantidadStr) || 1,
    };
    const result = await crearLlanta(dataToSend);

    if (result.success) {
      router.push('/inventario');
    } else {
      setError(result.error || 'Error al crear la llanta');
      setLoading(false);
    }
  };

  const rinesOptions = RINES_COMUNES.map((r) => ({ value: r.toString(), label: `R${r}` }));

  const anchosComunes = ['155', '165', '175', '185', '195', '205', '215', '225', '235', '245', '255', '265', '275', '285'];
  const perfilesComunes = ['30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80'];

  return (
    <div>
      <PageHeader
        title="Nueva Llanta"
        subtitle="Agregar llanta al inventario"
        breadcrumbs={[
          { label: 'Inventario', href: '/inventario' },
          { label: 'Nueva Llanta' },
        ]}
      />

      <form onSubmit={handleSubmit}>
        <Card>
          <CardBody>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <label className="label">Marca *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Escribir marca..."
                  value={marcaInput}
                  onChange={(e) => {
                    setMarcaInput(e.target.value);
                    setFormData({ ...formData, marca: e.target.value });
                    setShowMarcaSugerencias(true);
                  }}
                  onFocus={() => setShowMarcaSugerencias(true)}
                  onBlur={() => setTimeout(() => setShowMarcaSugerencias(false), 150)}
                  required
                />
                {showMarcaSugerencias && marcasFiltradas.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {marcasFiltradas.map((marca) => (
                      <button
                        key={marca}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 transition-colors"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setMarcaInput(marca);
                          setFormData({ ...formData, marca });
                          setShowMarcaSugerencias(false);
                        }}
                      >
                        {marca}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Input
                label="Modelo"
                name="modelo"
                placeholder="Ej: Pilot Sport 4"
                value={formData.modelo}
                onChange={(e) => setFormData({ ...formData, modelo: e.target.value })}
                required
              />
            </div>

            <div className="mb-4">
              <label className="label">Medida *</label>
              <div className="grid grid-cols-3 gap-2">
                <Select
                  name="ancho"
                  options={anchosComunes.map((a) => ({ value: a, label: a }))}
                  value={medidaPartes.ancho}
                  onChange={(e) => handleMedidaChange('ancho', e.target.value)}
                />
                <Select
                  name="perfil"
                  options={perfilesComunes.map((p) => ({ value: p, label: p }))}
                  value={medidaPartes.perfil}
                  onChange={(e) => handleMedidaChange('perfil', e.target.value)}
                />
                <Select
                  name="rin"
                  options={rinesOptions}
                  value={medidaPartes.rin}
                  onChange={(e) => handleMedidaChange('rin', e.target.value)}
                />
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Medida: <span className="font-mono font-medium">{formData.medida || '205/55R16'}</span>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Precio de Compra *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input"
                  placeholder="0.00"
                  value={precioCompraStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d*\.?\d{0,2}$/.test(v)) {
                      setPrecioCompraStr(v);
                    }
                  }}
                  required
                />
              </div>

              <div>
                <label className="label">Precio de Venta *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input"
                  placeholder="0.00"
                  value={precioVentaStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d*\.?\d{0,2}$/.test(v)) {
                      setPrecioVentaStr(v);
                    }
                  }}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Cantidad *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  placeholder="1"
                  value={cantidadStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d+$/.test(v)) {
                      setCantidadStr(v);
                    }
                  }}
                  required
                />
              </div>

              <Select
                label="Bodega destino"
                name="bodega"
                value={formData.bodega}
                onChange={(e) => setFormData({ ...formData, bodega: e.target.value as BodegaId })}
                options={BODEGAS.map((b) => ({ value: b.id, label: b.nombre }))}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Proveedor"
                name="proveedor"
                placeholder="Nombre del proveedor"
                value={formData.proveedor}
                onChange={(e) => setFormData({ ...formData, proveedor: e.target.value })}
                required
              />

              <Input
                label="Fecha de Recepcion"
                name="fechaRecepcion"
                type="date"
                value={formData.fechaRecepcion}
                onChange={(e) => setFormData({ ...formData, fechaRecepcion: e.target.value })}
                required
              />
            </div>
          </CardBody>

          <CardFooter>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
              >
                Cancelar
              </Button>
              <Button type="submit" loading={loading}>
                <Save size={16} /> Guardar Llanta
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
