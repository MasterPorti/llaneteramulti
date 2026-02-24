import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout";
import { Card, CardBody, CardHeader, Button } from "@/components/ui";
import { obtenerLlanta } from "../actions";
import { formatCurrency, formatDate } from "@/lib/utils/formatters";
import { getTotalStock } from "@/types";
import { EliminarLlantaButton } from "./EliminarLlantaButton";
import { AjustarStockForm } from "./AjustarStockForm";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function LlantaDetallePage({ params }: Props) {
  const { id } = await params;
  const result = await obtenerLlanta(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const llanta = result.data;
  const totalStock = getTotalStock(llanta);

  return (
    <div>
      <PageHeader
        title={`${llanta.marca} ${llanta.modelo}`}
        subtitle={llanta.medida}
        breadcrumbs={[
          { label: "Inventario", href: "/llantas" },
          { label: `${llanta.marca} ${llanta.modelo}` },
        ]}
        actions={
          <div className="flex gap-2">
            {totalStock > 0 && (
              <Link href={`/ventas/llantas?llantaId=${id}`}>
                <Button>Vender</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Información del Producto</h2>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-gray-500">Marca</dt>
                  <dd className="font-medium">{llanta.marca}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Modelo</dt>
                  <dd className="font-medium">{llanta.modelo}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Medida</dt>
                  <dd className="font-mono font-medium">{llanta.medida}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Rin</dt>
                  <dd className="font-medium">R{llanta.rin}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Proveedor</dt>
                  <dd className="font-medium">{llanta.proveedor}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Fecha Recepción</dt>
                  <dd className="font-medium">
                    {formatDate(llanta.fechaRecepcion)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold">Precio</h2>
            </CardHeader>
            <CardBody>
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-600">
                  {formatCurrency(llanta.precioVenta)}
                </p>
                <p className="text-sm text-gray-500 mt-1">Precio de venta</p>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Stock</h2>
            </CardHeader>
            <CardBody>
              <div className="text-center mb-4">
                <p className="text-4xl font-bold">{totalStock}</p>
                <p className="text-sm text-gray-500">unidades disponibles</p>
              </div>
              <AjustarStockForm id={llanta.id} stockActual={totalStock} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold">Especificaciones</h2>
            </CardHeader>
            <CardBody>
              <dl className="space-y-3">
                <div>
                  <dt className="text-sm text-gray-500">Ancho</dt>
                  <dd className="font-medium">{llanta.ancho} mm</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Perfil</dt>
                  <dd className="font-medium">{llanta.perfil}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
