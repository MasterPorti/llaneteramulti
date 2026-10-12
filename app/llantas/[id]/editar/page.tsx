'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardFooter, Button, Input, Select } from '@/components/ui';
import { obtenerLlanta, actualizarLlanta } from '../../actions';
import { MARCAS_LLANTAS, RINES_COMUNES, type LlantaInput } from '@/types';
import { Save } from 'lucide-react';

interface Props {
  params: Promise<{ id: string }>;
}

type EditForm = Pick<LlantaInput, 'marca' | 'modelo' | 'medida' | 'precioCompra' | 'precioVenta' | 'precioMayorista' | 'proveedor' | 'fechaRecepcion' | 'tipoUsada' | 'vida' | 'publicada'>;

export default function EditarLlantaPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [notAvailable, setNotAvailable] = useState(false);
  const initialData = useRef<EditForm | null>(null);

  const [formData, setFormData] = useState<EditForm>({
    marca: '',
    modelo: '',
    medida: '',
    precioCompra: 0,
    precioVenta: 0,
    proveedor: '',
    fechaRecepcion: '',
  });

  const [medidaPartes, setMedidaPartes] = useState({
    ancho: '205',
    perfil: '55',
    rin: '16',
  });

  useEffect(() => {
    async function loadData() {
      const result = await obtenerLlanta(id);
      if (result.success && result.data) {
        const llanta = result.data;
        const values: EditForm = {
          marca: llanta.marca,
          modelo: llanta.modelo,
          medida: llanta.medida,
          precioCompra: llanta.precioCompra,
          precioVenta: llanta.precioVenta,
          precioMayorista: llanta.precioMayorista,
          tipoUsada: llanta.tipoUsada,
          vida: llanta.vida,
          publicada: llanta.publicada,
          proveedor: llanta.proveedor,
          fechaRecepcion: llanta.fechaRecepcion?.slice(0, 10) || '',
        };
        initialData.current = values;
        setFormData(values);
        setMedidaPartes({
          ancho: llanta.ancho.toString(),
          perfil: llanta.perfil.toString(),
          rin: llanta.rin.toString(),
        });
      } else {
        setError('Llanta no encontrada');
        setNotAvailable(true);
      }
      setLoadingData(false);
    }
    loadData();
  }, [id]);

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

    // Preserve every untouched field, including the original timestamp precision.
    const changes = Object.fromEntries(Object.entries(formData).filter(([key, value]) =>
      value !== initialData.current?.[key as keyof EditForm]
    )) as Partial<LlantaInput>;
    const result = await actualizarLlanta(id, changes);

    if (result.success) {
      router.push(`/llantas/${id}`);
    } else {
      setError(result.error || 'Error al actualizar la llanta');
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner" />
      </div>
    );
  }

  if (notAvailable) return <div><PageHeader title="Llanta no disponible para edición" /><Card><CardBody><p>{error}. Los registros inactivos se conservan para consulta.</p><Button variant="secondary" onClick={() => router.push(`/llantas/${id}`)}>Volver al detalle</Button></CardBody></Card></div>;

  const marcasOptions = [...new Set([formData.marca, ...MARCAS_LLANTAS])].map((m) => ({ value: m, label: m }));
  const rinesOptions = [...new Set([medidaPartes.rin, ...RINES_COMUNES.map(String)])].map((r) => ({ value: r, label: `R${r}` }));

  const anchosComunes = ['155', '165', '175', '185', '195', '205', '215', '225', '235', '245', '255', '265', '275', '285'];
  const perfilesComunes = ['30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80'];

  return (
    <div>
      <PageHeader
        title="Editar Llanta"
        subtitle="El stock se ajusta desde la pagina de detalle"
        breadcrumbs={[
          { label: 'Inventario', href: '/llantas' },
          { label: formData.marca, href: `/llantas/${id}` },
          { label: 'Editar' },
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
              <Select
                label="Marca"
                name="marca"
                options={marcasOptions}
                value={formData.marca}
                onChange={(e) => setFormData({ ...formData, marca: e.target.value })}
                required
              />

              <Input
                label="Modelo"
                name="modelo"
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
                  options={[...new Set([medidaPartes.ancho, ...anchosComunes])].map((a) => ({ value: a, label: a }))}
                  value={medidaPartes.ancho}
                  onChange={(e) => handleMedidaChange('ancho', e.target.value)}
                />
                <Select
                  name="perfil"
                  options={[...new Set([medidaPartes.perfil, ...perfilesComunes])].map((p) => ({ value: p, label: p }))}
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
                Medida: <span className="font-mono font-medium">{formData.medida}</span>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Precio de Compra"
                name="precioCompra"
                type="number"
                min="0"
                step="0.01"
                value={formData.precioCompra}
                onChange={(e) =>
                  setFormData({ ...formData, precioCompra: parseFloat(e.target.value) || 0 })
                }
                required
              />

              <Input
                label="Precio de Venta"
                name="precioVenta"
                type="number"
                min="0"
                step="0.01"
                value={formData.precioVenta}
                onChange={(e) =>
                  setFormData({ ...formData, precioVenta: parseFloat(e.target.value) || 0 })
                }
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Precio Mayorista" name="precioMayorista" type="number" min="0" step="0.01" value={formData.precioMayorista ?? ''}
                onChange={(e) => setFormData({ ...formData, precioMayorista: Number(e.target.value) })} />
              <Input label="Tipo de llanta usada" name="tipoUsada" value={formData.tipoUsada ?? ''}
                onChange={(e) => setFormData({ ...formData, tipoUsada: e.target.value })} />
              <Input label="Vida" name="vida" value={formData.vida ?? ''}
                onChange={(e) => setFormData({ ...formData, vida: e.target.value })} />
              <Input label="Publicada" name="publicada" value={formData.publicada ?? ''}
                onChange={(e) => setFormData({ ...formData, publicada: e.target.value })} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Proveedor"
                name="proveedor"
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
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancelar
              </Button>
              <Button type="submit" loading={loading}>
                <Save size={16} /> Guardar Cambios
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
