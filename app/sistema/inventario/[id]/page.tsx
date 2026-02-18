import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Package, Edit, Trash2, ArrowLeft, Warehouse, Calendar, DollarSign, Tag, Ruler } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { obtenerLlantaSistema, eliminarLlantaSistema } from '@/lib/data/sistema-inventario';
import { SISTEMA_BODEGAS, generarCodigoAuxiliar } from '@/lib/config-sistema';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';
import { getTotalStock } from '@/types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LlantaDetallePage({ params }: PageProps) {
  const { id } = await params;
  const llanta = await obtenerLlantaSistema(id);

  if (!llanta) {
    notFound();
  }

  const totalStock = getTotalStock(llanta);
  const codigoAuxiliar = generarCodigoAuxiliar(llanta.medida);

  async function handleEliminar() {
    'use server';
    await eliminarLlantaSistema(id);
    revalidatePath('/sistema/inventario');
    redirect('/sistema/inventario');
  }

  return (
    <div>
      <PageHeader
        title={`${llanta.marca} ${llanta.modelo}`}
        subtitle={llanta.medida}
        breadcrumbs={[
          { label: 'Inventario', href: '/sistema/inventario' },
          { label: llanta.medida },
        ]}
      />

      <div className="mb-6">
        <Link
          href="/sistema/inventario"
          className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al inventario
        </Link>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Información Principal */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Package className="w-5 h-5" />
                Información del Producto
              </h2>
              <div className="flex gap-2">
                <Link href={`/sistema/inventario/${id}/editar`}>
                  <button className="btn btn-secondary flex items-center gap-2">
                    <Edit className="w-4 h-4" />
                    Editar
                  </button>
                </Link>
                <form action={handleEliminar}>
                  <button
                    type="submit"
                    className="btn btn-danger flex items-center gap-2"
                    onClick={(e) => {
                      if (!confirm('¿Estás seguro de eliminar este producto?')) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar
                  </button>
                </form>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1">Marca</p>
                <p className="font-medium text-lg">{llanta.marca}</p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1">Modelo</p>
                <p className="font-medium text-lg">{llanta.modelo}</p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-1">
                  <Ruler className="w-3 h-3" /> Medida
                </p>
                <p className="font-medium text-lg">{llanta.medida}</p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Código Auxiliar
                </p>
                <p className="font-mono font-bold text-lg text-[var(--accent)]">
                  {codigoAuxiliar}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1">Dimensiones</p>
                <p className="text-sm">
                  Ancho: <span className="font-medium">{llanta.ancho}mm</span> ·
                  Perfil: <span className="font-medium">{llanta.perfil}</span> ·
                  Rin: <span className="font-medium">{llanta.rin}</span>
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1">Proveedor</p>
                <p className="font-medium">{llanta.proveedor || 'No especificado'}</p>
              </div>
            </div>

            <div className="border-t border-[var(--border-color)] mt-6 pt-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Precio Compra
                  </p>
                  <p className="font-bold text-lg">{formatCurrency(llanta.precioCompra)}</p>
                </div>
                <div>
                  <p className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Precio Venta
                  </p>
                  <p className="font-bold text-lg text-green-400">{formatCurrency(llanta.precioVenta)}</p>
                </div>
                <div>
                  <p className="text-sm text-[var(--text-muted)] mb-1">Margen</p>
                  <p className="font-bold text-lg">
                    {formatCurrency(llanta.precioVenta - llanta.precioCompra)}
                    <span className="text-sm text-[var(--text-muted)] ml-1">
                      ({Math.round(((llanta.precioVenta - llanta.precioCompra) / llanta.precioCompra) * 100)}%)
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--border-color)] mt-6 pt-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Fecha de Recepción
                  </p>
                  <p className="font-medium">
                    {llanta.fechaRecepcion ? formatDateShort(llanta.fechaRecepcion) : 'No especificada'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--text-muted)] mb-1">Última Actualización</p>
                  <p className="font-medium">{formatDateShort(llanta.updatedAt)}</p>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Stock por Bodega */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold flex items-center gap-2">
                <Warehouse className="w-5 h-5" />
                Stock Total
              </h2>
            </CardHeader>
            <CardBody className="text-center py-6">
              <p className="text-5xl font-bold mb-2">{totalStock}</p>
              <p className="text-[var(--text-muted)]">unidades disponibles</p>
              {totalStock === 0 && (
                <Badge variant="danger" className="mt-4">Sin Stock</Badge>
              )}
              {totalStock > 0 && totalStock <= 5 && (
                <Badge variant="warning" className="mt-4">Stock Bajo</Badge>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Stock por Bodega</h2>
                <Link
                  href="/sistema/bodegas/mover"
                  className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Mover stock
                </Link>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-[var(--border-color)]">
                {SISTEMA_BODEGAS.map((bodega) => {
                  const stock = llanta.stockPorBodega[bodega.id] || 0;
                  return (
                    <div
                      key={bodega.id}
                      className="p-4 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium">{bodega.nombre}</p>
                        <p className="text-xs text-[var(--text-muted)]">{bodega.ubicacion}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-bold ${stock > 0 ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>
                          {stock}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {/* Valor en Inventario */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Valor en Inventario</h2>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Costo total</span>
                  <span className="font-medium">{formatCurrency(llanta.precioCompra * totalStock)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Valor venta</span>
                  <span className="font-bold text-green-400">{formatCurrency(llanta.precioVenta * totalStock)}</span>
                </div>
                <div className="border-t border-[var(--border-color)] pt-3 flex justify-between">
                  <span className="text-[var(--text-muted)]">Ganancia potencial</span>
                  <span className="font-bold">
                    {formatCurrency((llanta.precioVenta - llanta.precioCompra) * totalStock)}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
