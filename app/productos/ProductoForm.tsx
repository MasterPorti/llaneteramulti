'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Card, CardBody, CardFooter, Button, Input } from '@/components/ui';
import type { Producto } from '@/types';
import { actualizarProducto, crearProducto } from './actions';
import { ProductoImageField } from './ProductoImageField';
import { buildProductoInput, type ProductoFormValues } from './producto-form-values';

export function ProductoForm({ producto }: { producto?: Producto }) {
  const router = useRouter();
  const saving = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<ProductoFormValues>(() => ({
    nombre: producto?.nombre ?? '',
    descripcion: producto?.descripcion ?? '',
    precioVenta: producto ? String(producto.precioVenta ?? producto.precio) : '',
    precioCompra: producto?.precioCompra == null ? '' : String(producto.precioCompra),
    cantidad: '0',
  }));
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  function setValue(field: keyof ProductoFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    setError('');
    // Validate before entering the save state or making a request.
    let createInput;
    let editInput;
    try {
      if (producto) editInput = buildProductoInput(values, 'edit');
      else createInput = buildProductoInput(values, 'create');
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Revisa los datos del producto.');
      return;
    }

    saving.current = true;
    setLoading(true);
    try {
      let media: FormData | undefined;
      if (image || removeImage) {
        media = new FormData();
        if (image) media.set('imagen', image);
        if (removeImage) media.set('eliminarImagen', 'true');
      }
      const result = producto
        ? await actualizarProducto(producto.id, editInput!, media)
        : await crearProducto(createInput!, media);
      if (!result.success) {
        setError(result.error || 'No se pudo guardar el producto.');
        saving.current = false;
        setLoading(false);
        return;
      }
      router.push('/productos');
      router.refresh();
    } catch {
      setError('No se pudo confirmar el guardado. Revisa el catálogo antes de intentarlo de nuevo.');
      saving.current = false;
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <fieldset disabled={loading} className="min-w-0">
        <Card>
          <CardBody>
            {error && <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
            <Input
              name="nombre"
              label="Nombre del producto"
              placeholder="Ej: Aceite 5W30, Filtro de aceite..."
              value={values.nombre}
              onChange={(event) => setValue('nombre', event.target.value)}
              maxLength={200}
              required
            />
            <div className="mb-4">
              <label htmlFor="descripcion" className="label">Descripción <span className="font-normal text-gray-500">(opcional)</span></label>
              <textarea
                id="descripcion"
                name="descripcion"
                className="input min-h-24 resize-y"
                rows={3}
                placeholder="Detalles del producto"
                value={values.descripcion}
                onChange={(event) => setValue('descripcion', event.target.value)}
                maxLength={2000}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                name="precioVenta"
                label="Precio de venta"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={values.precioVenta}
                onChange={(event) => setValue('precioVenta', event.target.value)}
                required
              />
              <div>
                <Input
                  name="precioCompra"
                  label="Costo de compra (opcional)"
                  type="text"
                  inputMode="decimal"
                  placeholder="Sin costo registrado"
                  value={values.precioCompra}
                  onChange={(event) => setValue('precioCompra', event.target.value)}
                  aria-describedby="precioCompra-help"
                />
                <p id="precioCompra-help" className="-mt-2 mb-4 text-xs text-gray-500">Déjalo vacío si se desconoce. Introduce 0 únicamente si el costo real es cero.</p>
              </div>
            </div>
            {producto ? (
              <p className="mb-6 text-sm text-gray-500">El stock se ajusta desde la lista de productos. Guardar estos datos no cambia las existencias.</p>
            ) : (
              <Input
                name="cantidad"
                label="Stock inicial"
                type="number"
                inputMode="numeric"
                min={0}
                max={2147483647}
                step={1}
                value={values.cantidad}
                onChange={(event) => setValue('cantidad', event.target.value)}
                required
              />
            )}
            <ProductoImageField
              currentImage={producto?.imagen}
              disabled={loading}
              onChange={(file, removeExisting) => { setImage(file); setRemoveImage(removeExisting); }}
            />
          </CardBody>
          <CardFooter>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => router.push('/productos')} disabled={loading}>Cancelar</Button>
              <Button type="submit" loading={loading}>
                <Save size={16} /> {producto ? 'Guardar cambios' : 'Guardar Producto'}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </fieldset>
    </form>
  );
}
