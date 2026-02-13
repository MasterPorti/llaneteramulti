import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Button, Badge } from '@/components/ui';
import { obtenerInventario as getInventario } from '@/app/inventario/actions';
import { obtenerVentas as getVentas } from '@/app/ventas/actions';
import { obtenerReporteGarantias } from '@/app/reportes/actions';
import { formatCurrency } from '@/lib/utils/formatters';
import { getTotalStock } from '@/types';
import {
  ShoppingCart, Package, Shield, Warehouse,
  TrendingUp, BarChart3,
} from 'lucide-react';
import { DescargasSection } from './DescargasSection';

export default async function AdminDashboardPage() {
  const [inventarioResult, ventasResult, garantiasResult] = await Promise.all([
    getInventario(),
    getVentas(),
    obtenerReporteGarantias(),
  ]);

  const inventario = inventarioResult.data || [];
  const ventas = ventasResult.data || [];
  const garantias = garantiasResult.data || [];

  const hoy = new Date().toISOString().split('T')[0];

  const totalProductos = inventario.length;
  const totalUnidades = inventario.reduce((acc, l) => acc + getTotalStock(l), 0);
  const sinStock = inventario.filter((l) => getTotalStock(l) === 0);

  const ventasHoy = ventas.filter((v) => v.fechaVenta.split('T')[0] === hoy && !v.cancelada);
  const totalHoy = ventasHoy.reduce((acc, v) => acc + v.total, 0);

  const inicioMes = hoy.slice(0, 7);
  const ventasMes = ventas.filter((v) => v.fechaVenta.startsWith(inicioMes) && !v.cancelada);
  const totalMes = ventasMes.reduce((acc, v) => acc + v.total, 0);

  const garantiasPorVencer = garantias.filter((g) => g.estado === 'por_vencer');

  const ultimasVentas = ventas.slice(0, 5);

  // Calcular valor total del inventario
  const valorInventario = inventario.reduce((acc, l) => acc + (getTotalStock(l) * l.precioVenta), 0);

  return (
    <div>
      <PageHeader
        title="Dashboard Admin"
        subtitle={`Panel de control - ${new Date().toLocaleDateString('es-MX', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}`}
      />

      {/* Admin warning */}
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
        <Shield className="w-5 h-5 text-amber-600 mt-0.5" />
        <div>
          <p className="font-medium text-amber-800">Área restringida</p>
          <p className="text-sm text-amber-700">
            Esta sección contiene información sensible del negocio.
          </p>
        </div>
      </div>

      {garantiasPorVencer.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-yellow-500" />
            <div>
              <p className="font-medium text-yellow-700">
                {garantiasPorVencer.length} garantia(s) por vencer
              </p>
              <p className="text-sm text-yellow-600">
                Vencen en los proximos 7 dias
              </p>
            </div>
          </div>
          <Link href="/reportes/garantias">
            <Button variant="secondary" size="sm">
              Ver Garantias
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <ShoppingCart className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Ventas Hoy</p>
                <p className="text-2xl font-bold">{ventasHoy.length}</p>
                <p className="text-sm text-green-600 font-medium">{formatCurrency(totalHoy)}</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Ventas del Mes</p>
                <p className="text-2xl font-bold">{ventasMes.length}</p>
                <p className="text-sm text-green-600 font-medium">{formatCurrency(totalMes)}</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <Package className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Inventario</p>
                <p className="text-2xl font-bold">{totalProductos}</p>
                <p className="text-sm text-gray-500">{totalUnidades} unidades</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <Warehouse className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Valor Inventario</p>
                <p className="text-2xl font-bold">{formatCurrency(valorInventario)}</p>
                <Link href="/admin/bodegas" className="text-xs text-blue-500 hover:underline">
                  Ver bodegas
                </Link>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Garantías</p>
                <p className="text-2xl font-bold">{garantiasPorVencer.length}</p>
                <p className="text-sm text-yellow-600">Por vencer</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex justify-between items-center">
            <h2 className="font-semibold">Últimas Ventas</h2>
            <Link href="/ventas">
              <Button variant="ghost" size="sm">
                Ver todas
              </Button>
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            {ultimasVentas.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No hay ventas registradas
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Cliente</th>
                    <th>Total</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {ultimasVentas.map((venta) => (
                    <tr key={venta.id}>
                      <td>
                        <Link href={`/ventas/${venta.id}`} className="font-mono text-blue-600 hover:underline">
                          {venta.folio}
                        </Link>
                      </td>
                      <td>{venta.cliente.nombre}</td>
                      <td className="font-medium">{formatCurrency(venta.total)}</td>
                      <td>
                        <Badge variant={venta.cancelada ? 'danger' : 'success'}>
                          {venta.cancelada ? 'Cancelada' : 'OK'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex justify-between items-center">
            <h2 className="font-semibold">Sin Stock</h2>
            <Link href="/inventario">
              <Button variant="ghost" size="sm">
                Ver inventario
              </Button>
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            {sinStock.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                Todos los productos tienen stock disponible
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Medida</th>
                    <th>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {sinStock.slice(0, 5).map((llanta) => (
                    <tr key={llanta.id}>
                      <td>
                        <Link href={`/inventario/${llanta.id}`} className="text-blue-600 hover:underline">
                          {llanta.marca} {llanta.modelo}
                        </Link>
                      </td>
                      <td className="font-mono">{llanta.medida}</td>
                      <td>
                        <Badge variant="danger">{getTotalStock(llanta)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="font-semibold">Acciones Rápidas</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/bodegas">
              <Button variant="secondary"><Warehouse size={16} /> Gestionar Bodegas</Button>
            </Link>
            <Link href="/reportes/ventas">
              <Button variant="secondary"><BarChart3 size={16} /> Reporte de Ventas</Button>
            </Link>
            <Link href="/reportes/inventario">
              <Button variant="secondary"><BarChart3 size={16} /> Reporte de Inventario</Button>
            </Link>
            <Link href="/reportes/garantias">
              <Button variant="secondary"><Shield size={16} /> Garantías</Button>
            </Link>
          </div>
        </CardBody>
      </Card>

      <div className="mt-6">
        <DescargasSection />
      </div>
    </div>
  );
}
