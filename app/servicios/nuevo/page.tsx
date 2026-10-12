'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Save } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardFooter, Input } from '@/components/ui';
import { crearServicio } from '../actions';

export default function NuevoServicioPage() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [precio, setPrecio] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const precioDefault = Number(precio);
    if (!nombre.trim() || !precio.trim() || !Number.isFinite(precioDefault) || precioDefault < 0 || precioDefault >= 100000000) {
      setError('Ingresa el nombre y un precio válido.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await crearServicio({ nombre: nombre.trim(), descripcion: descripcion.trim(), precioDefault });
      if (!result.success) {
        setError(result.error || 'Error al crear el servicio');
        return;
      }
      router.push('/servicios');
      router.refresh();
    } catch {
      setError('No se pudo guardar el servicio. Intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Nuevo Servicio" subtitle="Agregar servicio al catálogo" breadcrumbs={[
        { label: 'Servicios', href: '/servicios' }, { label: 'Nuevo Servicio' },
      ]} />
      <form onSubmit={handleSubmit}>
        <Card>
          <CardBody>
            {error && <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input name="nombre" label="Nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} maxLength={200} required autoFocus />
              <Input name="descripcion" label="Descripción" value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
              <Input name="precioDefault" label="Precio Default" type="number" inputMode="decimal" min="0" max="99999999.99" step="0.01"
                value={precio} onChange={(event) => setPrecio(event.target.value)} placeholder="0.00" required />
            </div>
          </CardBody>
          <CardFooter>
            <div className="flex justify-end gap-2">
              <Link href="/servicios" className="btn btn-secondary">Cancelar</Link>
              <Button type="submit" loading={saving}><Save className="w-4 h-4" />Guardar Servicio</Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
