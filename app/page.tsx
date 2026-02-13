import Link from "next/link";
import { PageHeader } from "@/components/layout";
import { Card, CardBody, CardHeader, Button } from "@/components/ui";
import {
  ShoppingCart,
  Package,
  Wrench,
  Plus,
  ClipboardList,
} from "lucide-react";

export default function HomePage() {
  return (
    <div>
      <PageHeader
        title="Llanta Usada"
        subtitle={`${new Date().toLocaleDateString("es-MX", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        <Link href="/ventas/servicio">
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer h-full border-2 border-blue-200 bg-blue-50">
            <CardBody className="py-8">
              <div className="text-center">
                <Wrench className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-blue-900">
                  Nuevo Servicio
                </h2>
                <p className="text-sm text-blue-700 mt-2">
                  Parches, balanceo, alineación...
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/ventas/llantas">
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer h-full border-2 border-green-200 bg-green-50">
            <CardBody className="py-8">
              <div className="text-center">
                <ShoppingCart className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-green-900">
                  Venta de Llantas
                </h2>
                <p className="text-sm text-green-700 mt-2">
                  Vender productos del inventario
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>

        <Link href="/inventario">
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer h-full">
            <CardBody className="py-8">
              <div className="text-center">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold">Ver Inventario</h2>
                <p className="text-sm text-gray-500 mt-2">
                  Consultar productos disponibles
                </p>
              </div>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}
