import { Package, ShoppingCart, Shield, Warehouse, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { obtenerInventarioSistema } from '@/lib/data/sistema-inventario';
import { obtenerVentasSistema, obtenerGarantiasActivas } from '@/lib/data/sistema-ventas';
import { SISTEMA_BODEGAS } from '@/lib/config-sistema';
import { getTotalStock } from '@/types';
import { formatCurrency } from '@/lib/utils/formatters';

export const dynamic = 'force-dynamic';

export default async function SistemaDashboard() {
  const inventario = await obtenerInventarioSistema();
  const ventas = await obtenerVentasSistema();
  const garantiasActivas = await obtenerGarantiasActivas();

  // Calcular estadísticas
  const totalProductos = inventario.length;
  const totalUnidades = inventario.reduce((acc, l) => acc + getTotalStock(l), 0);
  const valorInventario = inventario.reduce(
    (acc, l) => acc + getTotalStock(l) * l.precioVenta,
    0
  );

  const ventasHoy = ventas.filter(
    (v) => v.fechaVenta.split('T')[0] === new Date().toISOString().split('T')[0]
  );
  const ingresoHoy = ventasHoy.reduce((acc, v) => acc + v.total, 0);

  // Stock por bodega
  const stockPorBodega = SISTEMA_BODEGAS.map((bodega) => ({
    ...bodega,
    unidades: inventario.reduce((acc, l) => acc + (l.stockPorBodega[bodega.id] || 0), 0),
    productos: inventario.filter((l) => (l.stockPorBodega[bodega.id] || 0) > 0).length,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Sistema Inventario
        </h1>
        <p className="text-[var(--text-secondary)]">
          Panel de control de inventario de llantas
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Package className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">Productos</p>
                <p className="text-xl font-bold">{totalProductos}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <Warehouse className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">Unidades</p>
                <p className="text-xl font-bold">{totalUnidades}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <ShoppingCart className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">Ventas Hoy</p>
                <p className="text-xl font-bold">{ventasHoy.length}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <Shield className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-muted)]">Garantías</p>
                <p className="text-xl font-bold">{garantiasActivas.length}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Stock por Bodega */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Warehouse className="w-5 h-5" />
                Stock por Bodega
              </h2>
              <Link
                href="/sistema/bodegas"
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
              >
                Ver todas <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-[var(--border-color)]">
              {stockPorBodega.map((bodega) => (
                <div
                  key={bodega.id}
                  className="p-4 flex items-center justify-between hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <div>
                    <p className="font-medium">{bodega.nombre}</p>
                    <p className="text-sm text-[var(--text-muted)]">
                      {bodega.productos} productos
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg">{bodega.unidades}</p>
                    <p className="text-xs text-[var(--text-muted)]">unidades</p>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Ventas Recientes */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                Ventas Recientes
              </h2>
              <Link
                href="/sistema/historial"
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
              >
                Ver historial <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {ventas.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-muted)]">
                <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>No hay ventas registradas</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-color)]">
                {ventas.slice(0, 5).map((venta) => (
                  <Link
                    key={venta.id}
                    href={`/sistema/ventas/${venta.id}`}
                    className="p-4 flex items-center justify-between hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div>
                      <p className="font-medium">{venta.folio}</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {venta.cliente.nombre}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{formatCurrency(venta.total)}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {venta.garantia.id}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Garantías Activas */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Garantías Activas
              </h2>
              <Link
                href="/sistema/garantias"
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
              >
                Buscar garantía <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {garantiasActivas.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-muted)]">
                <Shield className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>No hay garantías activas</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-color)]">
                {garantiasActivas.slice(0, 5).map(({ venta, garantia, diasRestantes }) => (
                  <Link
                    key={garantia.id}
                    href={`/sistema/garantias/${garantia.id}`}
                    className="p-4 flex items-center justify-between hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div>
                      <p className="font-mono font-bold text-[var(--accent)]">
                        {garantia.id}
                      </p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {venta.cliente.nombre} - {venta.folio}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          diasRestantes <= 7
                            ? 'bg-red-500/20 text-red-400'
                            : diasRestantes <= 30
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-green-500/20 text-green-400'
                        }`}
                      >
                        {diasRestantes} días restantes
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link
          href="/sistema/inventario/nuevo"
          className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-center"
        >
          <Package className="w-8 h-8 mx-auto mb-2 text-blue-400" />
          <p className="font-medium">Agregar Llanta</p>
        </Link>

        <Link
          href="/sistema/ventas/nueva"
          className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-center"
        >
          <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-green-400" />
          <p className="font-medium">Nueva Venta</p>
        </Link>

        <Link
          href="/sistema/bodegas/mover"
          className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-center"
        >
          <Warehouse className="w-8 h-8 mx-auto mb-2 text-amber-400" />
          <p className="font-medium">Mover Stock</p>
        </Link>

        <Link
          href="/sistema/garantias"
          className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-center"
        >
          <Shield className="w-8 h-8 mx-auto mb-2 text-purple-400" />
          <p className="font-medium">Buscar Garantía</p>
        </Link>
      </div>
    </div>
  );
}
