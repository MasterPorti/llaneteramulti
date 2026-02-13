import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge, PrintButton } from '@/components/ui';
import { obtenerReporteGarantias } from '../actions';
import { formatCurrency, formatDate, formatDateShort } from '@/lib/utils/formatters';

export default async function ReporteGarantiasPage() {
  const result = await obtenerReporteGarantias();
  const garantias = result.data || [];

  const activas = garantias.filter((g) => g.estado === 'activa');
  const porVencer = garantias.filter((g) => g.estado === 'por_vencer');
  const vencidas = garantias.filter((g) => g.estado === 'vencida');

  return (
    <div>
      <PageHeader
        title="Garantías Activas"
        subtitle="Control de garantías vigentes y por vencer"
        breadcrumbs={[
          { label: 'Reportes', href: '/reportes' },
          { label: 'Garantías' },
        ]}
        actions={<PrintButton />}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Garantías Activas</p>
            <p className="text-2xl font-bold text-green-600">{activas.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Por Vencer (7 días)</p>
            <p className="text-2xl font-bold text-yellow-600">{porVencer.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Vencidas</p>
            <p className="text-2xl font-bold text-red-600">{vencidas.length}</p>
          </CardBody>
        </Card>
      </div>

      {porVencer.length > 0 && (
        <Card className="mb-6 border-yellow-400">
          <CardHeader className="bg-yellow-50">
            <h2 className="font-semibold text-yellow-700">
              ⚠️ Garantías por Vencer (próximos 7 días)
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Cliente</th>
                  <th>Productos</th>
                  <th>Vence</th>
                  <th>Días Restantes</th>
                </tr>
              </thead>
              <tbody>
                {porVencer.map((g) => (
                  <tr key={g.venta.id}>
                    <td>
                      <Link href={`/ventas/${g.venta.id}`} className="font-mono text-blue-600 hover:underline">
                        {g.venta.folio}
                      </Link>
                    </td>
                    <td>{g.venta.cliente.nombre}</td>
                    <td>
                      {g.venta.items
                        .filter((i) => i.tipo === 'producto')
                        .map((i) => (
                          <div key={i.llantaId} className="text-sm">
                            {i.llantaSnapshot.marca} {i.llantaSnapshot.modelo} ({i.cantidad})
                          </div>
                        ))}
                    </td>
                    <td>{formatDate(g.venta.garantia.fechaFin)}</td>
                    <td>
                      <Badge variant="warning">{g.diasRestantes} días</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Todas las Garantías</h2>
        </CardHeader>
        <CardBody className="p-0">
          {garantias.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No hay garantías activas
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Cliente</th>
                  <th>Fecha Venta</th>
                  <th>Productos</th>
                  <th>Total</th>
                  <th>Inicio</th>
                  <th>Vencimiento</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {garantias.map((g) => (
                  <tr
                    key={g.venta.id}
                    className={
                      g.estado === 'por_vencer'
                        ? 'bg-yellow-50'
                        : g.estado === 'vencida'
                        ? 'bg-red-50'
                        : ''
                    }
                  >
                    <td>
                      <Link href={`/ventas/${g.venta.id}`} className="font-mono text-blue-600 hover:underline">
                        {g.venta.folio}
                      </Link>
                    </td>
                    <td>{g.venta.cliente.nombre}</td>
                    <td>{formatDateShort(g.venta.fechaVenta)}</td>
                    <td>{g.venta.items.length}</td>
                    <td>{formatCurrency(g.venta.total)}</td>
                    <td>{formatDateShort(g.venta.garantia.fechaInicio)}</td>
                    <td>{formatDateShort(g.venta.garantia.fechaFin)}</td>
                    <td>
                      <Badge
                        variant={
                          g.estado === 'activa'
                            ? 'success'
                            : g.estado === 'por_vencer'
                            ? 'warning'
                            : 'danger'
                        }
                      >
                        {g.estado === 'activa' && `${g.diasRestantes} días`}
                        {g.estado === 'por_vencer' && `${g.diasRestantes} días`}
                        {g.estado === 'vencida' && 'Vencida'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
