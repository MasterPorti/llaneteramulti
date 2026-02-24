'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardFooter, Button, Input } from '@/components/ui';
import { crearProducto } from '../actions';
import { Save } from 'lucide-react';

export default function NuevoProductoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [precioStr, setPrecioStr] = useState('');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [cantidadStr, setCantidadStr] = useState('1');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return; }
    const precio = parseFloat(precioStr);
    if (!precio || precio <= 0) { setError('Ingresa un precio válido'); return; }

    setLoading(true);
    setError('');

    const result = await crearProducto({
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || undefined,
      precio,
      cantidad: parseInt(cantidadStr) || 1,
    });

    if (result.success) {
      router.push('/productos');
    } else {
      setError(result.error || 'Error al crear el producto');
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Nuevo Producto"
        subtitle="Agregar producto al catálogo"
        breadcrumbs={[
          { label: 'Productos', href: '/productos' },
          { label: 'Nuevo Producto' },
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
              <Input
                label="Nombre del producto *"
                placeholder="Ej: Aceite 5W30, Filtro de aceite..."
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
              <Input
                label="Descripción (opcional)"
                placeholder="Detalles del producto"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Precio *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input"
                  placeholder="0.00"
                  value={precioStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d*\.?\d{0,2}$/.test(v)) setPrecioStr(v);
                  }}
                  required
                />
              </div>

              <div>
                <label className="label">Cantidad inicial *</label>
                <input
                  type="number"
                  inputMode="numeric"
                  className="input"
                  placeholder="1"
                  min="0"
                  value={cantidadStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d+$/.test(v)) setCantidadStr(v);
                  }}
                  required
                />
              </div>
            </div>
          </CardBody>

          <CardFooter>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancelar
              </Button>
              <Button type="submit" loading={loading}>
                <Save size={16} /> Guardar Producto
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
