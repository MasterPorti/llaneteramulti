import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, Badge } from '@/components/ui';
import { obtenerVentas } from './actions';
import { formatCurrency } from '@/lib/utils/formatters';
import { VentasTable } from './VentasTable';

export default async function VentasPage() {
  const result = await obtenerVentas();
  const ventas = result.data || [];

  const hoy = new Date().toISOString().split('T')[0];
  const ventasHoy = ventas.filter((v) => v.fechaVenta.split('T')[0] === hoy);
  const totalHoy = ventasHoy.reduce((acc, v) => acc + v.total, 0);
  const totalMes = ventas
    .filter((v) => v.fechaVenta.startsWith(hoy.slice(0, 7)))
    .reduce((acc, v) => acc + v.total, 0);

  return (
    <div>
      <PageHeader
        title="Ventas"
        subtitle="Historial de ventas realizadas"
        actions={
          <Link href="/ventas/nueva">
            <Button>+ Nueva Venta</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Ventas Hoy</p>
            <p className="text-2xl font-bold">{ventasHoy.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Total Hoy</p>
            <p className="text-2xl font-bold">{formatCurrency(totalHoy)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Total del Mes</p>
            <p className="text-2xl font-bold">{formatCurrency(totalMes)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Total Ventas</p>
            <p className="text-2xl font-bold">{ventas.length}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="p-0">
          <VentasTable ventas={ventas} />
        </CardBody>
      </Card>
    </div>
  );
}
