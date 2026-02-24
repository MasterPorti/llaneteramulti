import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge, PrintButton } from '@/components/ui';
import { obtenerVenta } from '../actions';
import { formatCurrency, formatDateTime } from '@/lib/utils/formatters';
import { CONFIG } from '@/lib/config';
import { TicketPrint } from './TicketPrint';
import { CancelarVentaButton } from './CancelarVentaButton';
import { FacturarVentaButton } from './FacturarVentaButton';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VentaDetallePage({ params }: Props) {
  const { id } = await params;
  const result = await obtenerVenta(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const venta = result.data;

  return (
    <div>
      <PageHeader
        title={`Venta ${venta.folio}`}
        subtitle={`${formatDateTime(venta.fechaVenta)} - ${venta.cliente.nombre}`}
        breadcrumbs={[
          { label: 'Ventas', href: '/ventas' },
          { label: venta.folio },
        ]}
        actions={
          <div className="flex gap-2 no-print">
            {!venta.cancelada && !venta.facturada && (
              <FacturarVentaButton id={id} />
            )}
            {!venta.cancelada && (
              <CancelarVentaButton id={id} />
            )}
            <PrintButton />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 no-print">
          {venta.cancelada && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700">
              <strong>Venta Cancelada</strong>
              <p className="text-sm mt-1">Motivo: {venta.motivoCancelacion}</p>
            </div>
          )}

          <Card>
            <CardHeader>
              <h2 className="font-semibold">Items de la Venta</h2>
            </CardHeader>
            <CardBody className="p-0">
              {/* Mobile view - card layout */}
              <div className="md:hidden">
                {venta.items.map((item, index) => (
                  <div key={index} className="p-4 border-b border-gray-100 last:border-b-0">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        {item.tipo === 'producto' ? (
                          <>
                            <p className="font-medium">{item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}</p>
                            <p className="text-sm text-gray-500 font-mono">{item.llantaSnapshot.medida}</p>
                          </>
                        ) : (
                          <>
                            <p className="font-medium">{item.servicioNombre}</p>
                            <p className="text-sm text-gray-500">Servicio</p>
                          </>
                        )}
                      </div>
                      <p className="font-medium text-right">{formatCurrency(item.subtotal)}</p>
                    </div>
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>{item.cantidad} x {formatCurrency(item.precioUnitario)}</span>
                    </div>
                  </div>
                ))}
                <div className="p-4 bg-gray-50 flex justify-between items-center">
                  <span className="font-bold text-lg">Total:</span>
                  <span className="font-bold text-lg">{formatCurrency(venta.total)}</span>
                </div>
              </div>

              {/* Desktop view - table layout */}
              <div className="hidden md:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Detalle</th>
                      <th>Cantidad</th>
                      <th>Precio Unit.</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venta.items.map((item, index) => (
                      <tr key={index}>
                        {item.tipo === 'producto' ? (
                          <>
                            <td className="font-medium">
                              {item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}
                            </td>
                            <td className="font-mono text-sm">{item.llantaSnapshot.medida}</td>
                          </>
                        ) : (
                          <>
                            <td className="font-medium">{item.servicioNombre}</td>
                            <td className="text-sm text-gray-500">Servicio</td>
                          </>
                        )}
                        <td>{item.cantidad}</td>
                        <td>{formatCurrency(item.precioUnitario)}</td>
                        <td className="font-medium">{formatCurrency(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="text-right font-bold text-lg">Total:</td>
                      <td className="font-bold text-lg">{formatCurrency(venta.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Cliente</h2>
              </CardHeader>
              <CardBody>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-gray-500">Nombre</dt>
                    <dd className="font-medium">{venta.cliente.nombre}</dd>
                  </div>
                  {venta.cliente.telefono && (
                    <div>
                      <dt className="text-sm text-gray-500">Telefono</dt>
                      <dd className="font-medium">{venta.cliente.telefono}</dd>
                    </div>
                  )}
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="font-semibold">Pago</h2>
              </CardHeader>
              <CardBody>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-gray-500">Metodo</dt>
                    <dd className="font-medium capitalize">{venta.metodoPago}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Factura</dt>
                    <dd>
                      <Badge variant={venta.facturada ? 'success' : 'neutral'}>
                        {venta.facturada ? `Facturada (${venta.factura?.uuid})` : 'Sin factura'}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          </div>

        </div>

        <div className="print-only lg:no-print">
          <TicketPrint venta={venta} />
        </div>

        <div className="no-print">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Vista Previa del Ticket</h2>
            </CardHeader>
            <CardBody className="p-2 md:p-4">
              <div className="ticket-preview-container">
                <TicketPrint venta={venta} />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
