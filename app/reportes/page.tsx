import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader } from '@/components/ui';

const reportes = [
  {
    titulo: 'Inventario Actual',
    descripcion: 'Lista completa de productos en inventario con valores y stock',
    href: '/reportes/inventario',
    icono: '📦',
  },
  {
    titulo: 'Ventas por Período',
    descripcion: 'Resumen de ventas con filtros por fecha',
    href: '/reportes/ventas',
    icono: '💰',
  },
  {
    titulo: 'Productos Más Vendidos',
    descripcion: 'Ranking de productos con mayor demanda',
    href: '/reportes/productos',
    icono: '🏆',
  },
  {
    titulo: 'Garantías Activas',
    descripcion: 'Control de garantías vigentes y por vencer',
    href: '/reportes/garantias',
    icono: '🛡️',
  },
];

export default function ReportesPage() {
  return (
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Genera reportes para análisis y control"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reportes.map((reporte) => (
          <Link key={reporte.href} href={reporte.href}>
            <Card className="hover:border-gray-400 transition-colors cursor-pointer h-full">
              <CardBody>
                <div className="flex items-start gap-4">
                  <span className="text-3xl">{reporte.icono}</span>
                  <div>
                    <h3 className="font-semibold text-lg">{reporte.titulo}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {reporte.descripcion}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
