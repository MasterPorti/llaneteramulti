import { PageHeader } from '@/components/layout';
import { ProductoForm } from '../ProductoForm';

export default function NuevoProductoPage() {
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
      <ProductoForm />
    </div>
  );
}
