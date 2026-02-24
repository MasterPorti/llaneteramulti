import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Shield,
  User,
  Phone,
  Calendar,
  Package,
  ShoppingCart,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { buscarGarantiaPorId } from '@/lib/data/sistema-ventas';
import { formatCurrency, formatDateShort, formatDateTime } from '@/lib/utils/formatters';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GarantiaDetallePage({ params }: PageProps) {
  const { id } = await params;
  const result = await buscarGarantiaPorId(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const { venta, garantia } = result.data;

  const garantiaExpirada = new Date(garantia.fechaFin) < new Date();
  const diasRestantes = Math.ceil(
    (new Date(garantia.fechaFin).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  const getEstadoInfo = () => {
    if (venta.cancelada) {
      return {
        icon: XCircle,
        text: 'Venta Cancelada',
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        borderColor: 'border-red-500/30',
      };
    }
    if (!garantia.activa) {
      return {
        icon: XCircle,
        text: 'Garantía Inactiva',
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        borderColor: 'border-red-500/30',
      };
    }
    if (garantiaExpirada) {
      return {
        icon: Clock,
        text: 'Garantía Expirada',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/20',
        borderColor: 'border-yellow-500/30',
      };
    }
    return {
      icon: CheckCircle,
      text: 'Garantía Vigente',
      color: 'text-green-400',
      bgColor: 'bg-green-500/20',
      borderColor: 'border-green-500/30',
    };
  };

  const estadoInfo = getEstadoInfo();
  const EstadoIcon = estadoInfo.icon;

  return (
    <div>
      <PageHeader
        title={`Garantía ${garantia.id}`}
        subtitle="Detalles de la garantía"
        breadcrumbs={[
          { label: 'Garantías', href: '/inventario/garantias' },
          { label: garantia.id },
        ]}
      />

      <div className="mb-6">
        <Link
          href="/inventario/garantias"
          className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a garantías
        </Link>
      </div>

      {/* Estado Principal */}
      <Card className={`mb-6 border-l-4 ${estadoInfo.borderColor}`}>
        <CardBody>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full ${estadoInfo.bgColor}`}>
                <EstadoIcon className={`w-6 h-6 ${estadoInfo.color}`} />
              </div>
              <div>
                <p className={`text-xl font-bold ${estadoInfo.color}`}>
                  {estadoInfo.text}
                </p>
                {garantia.activa && !garantiaExpirada && !venta.cancelada && (
                  <p className="text-[var(--text-muted)]">
                    Quedan <span className="font-bold">{diasRestantes}</span> días de garantía
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="garantia-id text-3xl">{garantia.id}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Información de la Garantía */}
        <Card className="md:col-span-2">
          <CardHeader>
            <h2 className="font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Detalles de Garantía
            </h2>
          </CardHeader>
          <CardBody>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Fecha de Inicio
                </p>
                <p className="font-medium text-lg">{formatDateShort(garantia.fechaInicio)}</p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Fecha de Vencimiento
                </p>
                <p className="font-medium text-lg">{formatDateShort(garantia.fechaFin)}</p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1">Duración</p>
                <p className="font-medium">{garantia.diasGarantia} días</p>
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1">Estado</p>
                <Badge variant={garantia.activa && !garantiaExpirada ? 'success' : 'danger'}>
                  {venta.cancelada ? 'Cancelada' : garantiaExpirada ? 'Expirada' : garantia.activa ? 'Activa' : 'Inactiva'}
                </Badge>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-[var(--border-color)]">
              <p className="text-sm text-[var(--text-muted)] mb-2">Condiciones de la Garantía</p>
              <div className="p-4 rounded-lg bg-[var(--bg-tertiary)]">
                <p className="whitespace-pre-wrap">{garantia.condiciones}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Información del Cliente */}
        <div className="space-y-6">
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

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" />
                  Venta Asociada
                </h2>
              </div>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Folio</span>
                  <Link
                    href={`/inventario/ventas/${venta.id}`}
                    className="font-bold text-[var(--accent)] hover:underline"
                  >
                    {venta.folio}
                  </Link>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Fecha</span>
                  <span>{formatDateShort(venta.fechaVenta)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Total</span>
                  <span className="font-bold text-green-400">{formatCurrency(venta.total)}</span>
                </div>
              </div>

              <Link
                href={`/inventario/ventas/${venta.id}`}
                className="btn btn-secondary w-full mt-4"
              >
                Ver Venta Completa
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Productos Cubiertos */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Productos Cubiertos por esta Garantía
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {/* Mobile View */}
          <div className="md:hidden divide-y divide-[var(--border-color)]">
            {venta.items.map((item, index) => (
              <div key={index} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <Package className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">
                      {item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">
                      {item.llantaSnapshot.medida}
                    </p>
                    <p className="text-xs font-mono text-[var(--accent)]">
                      {item.llantaSnapshot.codigoAuxiliar}
                    </p>
                    <div className="flex justify-between mt-2">
                      <span className="text-sm text-[var(--text-muted)]">
                        {item.cantidad} unidades
                      </span>
                      <span className="font-bold">{formatCurrency(item.subtotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Código Auxiliar</th>
                  <th className="text-center">Cantidad</th>
                  <th className="text-right">Precio Unit.</th>
                  <th className="text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.items.map((item, index) => (
                  <tr key={index}>
                    <td>
                      <div>
                        <p className="font-medium">
                          {item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}
                        </p>
                        <p className="text-sm text-[var(--text-muted)]">
                          {item.llantaSnapshot.medida}
                        </p>
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-[var(--accent)]">
                        {item.llantaSnapshot.codigoAuxiliar}
                      </span>
                    </td>
                    <td className="text-center font-bold">{item.cantidad}</td>
                    <td className="text-right">{formatCurrency(item.precioUnitario)}</td>
                    <td className="text-right font-bold">{formatCurrency(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
