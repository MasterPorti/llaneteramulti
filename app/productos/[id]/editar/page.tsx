'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody } from '@/components/ui';
import type { Producto } from '@/types';
import { obtenerProducto } from '../../actions';
import { ProductoForm } from '../../ProductoForm';

export default function EditarProductoPage() {
  const { id } = useParams<{ id: string }>();
  const [producto, setProducto] = useState<Producto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const retryLoad = useCallback(() => setRetry((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function loadProducto() {
      setLoading(true);
      setProducto(null);
      setError('');
      try {
        const result = await obtenerProducto(id);
        if (cancelled) return;
        if (result.success && result.data) setProducto(result.data);
        else setError(result.error || 'No se pudo cargar el producto.');
      } catch {
        if (!cancelled) setError('No se pudo cargar el producto.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProducto();
    return () => { cancelled = true; };
  }, [id, retry]);

  return (
    <div>
      <PageHeader
        title="Editar Producto"
        subtitle={producto?.nombre ?? 'Actualizar los datos del producto'}
        breadcrumbs={[
          { label: 'Productos', href: '/productos' },
          { label: 'Editar Producto' },
        ]}
      />
      {loading ? (
        <div role="status" className="flex items-center justify-center py-20">
          <span className="spinner" /><span className="ml-3 text-gray-500">Cargando producto...</span>
        </div>
      ) : error ? (
        <Card>
          <CardBody>
            <p role="alert" className="mb-4 text-red-600">{error}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={retryLoad}>Reintentar</Button>
              <Link className="btn btn-secondary" href="/productos">Volver a productos</Link>
            </div>
          </CardBody>
        </Card>
      ) : producto ? (
        <ProductoForm key={producto.id} producto={producto} />
      ) : null}
    </div>
  );
}
