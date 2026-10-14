import Link from "next/link";
import { PageHeader } from "@/components/layout";
import { Button, Card, CardBody } from "@/components/ui";
import { obtenerVentas } from "./actions";
import { formatCurrency, getMexicoDateString } from "@/lib/utils/formatters";
import { VentasTable } from "./VentasTable";

export const dynamic = 'force-dynamic';

export default async function VentasPage({ searchParams }: {
  searchParams: Promise<{ operacion?: string | string[] }>;
}) {
  const operation = (await searchParams).operacion;
  const confirmationNotice = operation === 'anterior' ? (
    <p role="status" className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
      Se recuperó la confirmación de una venta anterior al reinicio. Su registro original se conserva.
    </p>
  ) : null;
  const result = await obtenerVentas({ incluirCanceladas: true });
  if (!result.success || !result.data) {
    return (
      <div>
        <PageHeader title="Ventas" subtitle="Historial de ventas realizadas" />
        {confirmationNotice}
        <Card>
          <CardBody>
            <p role="alert" className="text-red-700">
              {result.error || 'No se pudo cargar el historial de ventas. Intenta de nuevo.'}
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }
  const ventas = result.data;

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

      {confirmationNotice}

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
