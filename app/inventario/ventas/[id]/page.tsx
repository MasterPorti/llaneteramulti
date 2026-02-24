import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ShoppingCart,
  User,
  Phone,
  Calendar,
  Shield,
  CreditCard,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { CancelarVentaForm } from './CancelarVentaForm';
import { ImprimirGarantiaBtn } from './ImprimirGarantiaBtn';
import { obtenerVentaSistema, cancelarVentaSistema } from '@/lib/data/sistema-ventas';
import { formatCurrency, formatDateShort, formatDateTime } from '@/lib/utils/formatters';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VentaDetallePage({ params }: PageProps) {
  const { id } = await params;
  const venta = await obtenerVentaSistema(id);

  if (!venta) {
    notFound();
  }

  const garantiaExpirada = new Date(venta.garantia.fechaFin) < new Date();
  const diasRestantes = Math.ceil(
    (new Date(venta.garantia.fechaFin).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  async function handleCancelar(formData: FormData) {
    'use server';
    const motivo = formData.get('motivo') as string;
    if (!motivo) return;

    await cancelarVentaSistema(id, motivo);
    revalidatePath('/inventario/ventas');
    revalidatePath('/inventario/historial');
    revalidatePath('/inventario');
    redirect('/inventario/ventas');
  }

  return (
    <div>
      <PageHeader
        title={`Venta ${venta.folio}`}
        subtitle={formatDateTime(venta.fechaVenta)}
        breadcrumbs={[
          { label: 'Ventas', href: '/inventario/ventas' },
          { label: venta.folio },
        ]}
      />

      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/inventario/ventas"
          className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a ventas
        </Link>
        {!venta.cancelada && (
          <ImprimirGarantiaBtn ventaId={venta.id} garantiaId={venta.garantia.id} />
        )}
      </div>

      {venta.cancelada && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-400">Venta Cancelada</p>
            <p className="text-sm text-red-300">{venta.motivoCancelacion || 'Sin motivo especificado'}</p>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        {/* Información de la Venta */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                Detalle de la Venta
              </h2>
              <Badge variant={venta.cancelada ? 'danger' : 'success'}>
                {venta.cancelada ? 'Cancelada' : 'Completada'}
              </Badge>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="text-center">Cantidad</th>
                  <th className="text-right">Precio Unit.</th>
                  <th className="text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.items.map((item, index) => (
                  <tr key={index}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                          <Package className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}
                          </p>
                          <p className="text-sm text-[var(--text-muted)]">
                            {item.llantaSnapshot.medida}
                          </p>
                          <p className="text-xs font-mono text-[var(--accent)]">
                            {item.llantaSnapshot.codigoAuxiliar}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="text-center font-bold">{item.cantidad}</td>
                    <td className="text-right">{formatCurrency(item.precioUnitario)}</td>
                    <td className="text-right font-bold">{formatCurrency(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border-color)]">
                  <td colSpan={3} className="text-right font-bold">Total</td>
                  <td className="text-right text-xl font-bold text-green-400">
                    {formatCurrency(venta.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardBody>
        </Card>

        {/* Panel Lateral */}
        <div className="space-y-6">
          {/* Garantía */}
          <Card className={venta.garantia.activa && !garantiaExpirada ? 'garantia-activa' : 'garantia-expirada'}>
            <CardHeader>
              <h2 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Garantía
              </h2>
            </CardHeader>
            <CardBody>
              <Link
                href={`/inventario/garantias/${venta.garantia.id}`}
                className="block text-center mb-4"
              >
                <p className="garantia-id text-2xl">{venta.garantia.id}</p>
              </Link>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Estado</span>
                  {venta.cancelada ? (
                    <Badge variant="danger">Cancelada</Badge>
                  ) : garantiaExpirada ? (
                    <Badge variant="danger">Expirada</Badge>
                  ) : (
                    <Badge variant="success">Activa</Badge>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Inicio</span>
                  <span>{formatDateShort(venta.garantia.fechaInicio)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Vencimiento</span>
                  <span>{formatDateShort(venta.garantia.fechaFin)}</span>
                </div>
                {!garantiaExpirada && venta.garantia.activa && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Días restantes</span>
                    <span className={`font-bold ${diasRestantes <= 7 ? 'text-red-400' : diasRestantes <= 30 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {diasRestantes}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Duración</span>
                  <span>{venta.garantia.diasGarantia} días</span>
                </div>
              </div>


            </CardBody>
          </Card>

          {/* Cliente */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold flex items-center gap-2">
                <User className="w-5 h-5" />
                Cliente
              </h2>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <User className="w-4 h-4 text-[var(--text-muted)]" />
                  <span className="font-medium">{venta.cliente.nombre}</span>
                </div>
                {venta.cliente.telefono && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-[var(--text-muted)]" />
                    <span>{venta.cliente.telefono}</span>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Pago */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Pago
              </h2>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Método</span>
                  <span className="font-medium capitalize">{venta.metodoPago}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Fecha</span>
                  <span>{formatDateShort(venta.fechaVenta)}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Cancelar Venta */}
          {!venta.cancelada && (
            <CancelarVentaForm action={handleCancelar} />
          )}
        </div>
      </div>
    </div>
  );
}
