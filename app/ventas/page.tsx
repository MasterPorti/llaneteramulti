import Link from "next/link";
import { PageHeader } from "@/components/layout";
import { Button, Card, CardBody } from "@/components/ui";
import { obtenerVentas } from "./actions";
import { formatCurrency, getMexicoDateString } from "@/lib/utils/formatters";
import { VentasTable } from "./VentasTable";

export const dynamic = 'force-dynamic';

export default async function VentasPage() {
  const result = await obtenerVentas({ incluirCanceladas: true });
  const ventas = result.data || [];

  const hoy = getMexicoDateString();
  const vigentes = ventas.filter((venta) => !venta.cancelada);
  const ventasHoy = vigentes.filter((v) => getMexicoDateString(new Date(v.fechaVenta)) === hoy);
  const totalHoy = ventasHoy.reduce((acc, v) => acc + v.total, 0);
  const totalMes = vigentes
    .filter((v) => getMexicoDateString(new Date(v.fechaVenta)).startsWith(hoy.slice(0, 7)))
    .reduce((acc, v) => acc + v.total, 0);

  return (
    <div>
      <PageHeader
        title="Ventas"
        subtitle="Historial de ventas realizadas"
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href="https://sistema.conectia.mx/cfdi4/users/login"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              Generar Factura
            </a>
            <Link href="/ventas/nueva">
              <Button>Nueva Venta</Button>
            </Link>
          </div>
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
