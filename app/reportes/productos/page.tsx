'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Button, Input } from '@/components/ui';
import { obtenerProductosMasVendidos, type ProductoVendido } from '../actions';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';

export default function ReporteProductosPage() {
  const [productos, setProductos] = useState<ProductoVendido[]>([]);
  const [loading, setLoading] = useState(true);

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const [fechaInicio, setFechaInicio] = useState(inicioMes.toISOString().split('T')[0]);
  const [fechaFin, setFechaFin] = useState(hoy.toISOString().split('T')[0]);

  const cargarReporte = async () => {
    setLoading(true);
    const result = await obtenerProductosMasVendidos({ fechaInicio, fechaFin });
    if (result.success && result.data) {
      setProductos(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    cargarReporte();
  }, []);

  const totalUnidades = productos.reduce((acc, p) => acc + p.cantidadVendida, 0);
  const totalIngresos = productos.reduce((acc, p) => acc + p.ingresoTotal, 0);

  return (
    <div>
      <PageHeader
        title="Productos Más Vendidos"
        subtitle="Ranking de productos por cantidad vendida"
        breadcrumbs={[
          { label: 'Reportes', href: '/reportes' },
          { label: 'Productos' },
        ]}
        actions={
          <Button onClick={() => window.print()} className="no-print">
            Imprimir
          </Button>
        }
      />

      <Card className="mb-6 no-print">
        <CardBody>
          <div className="flex items-end gap-4">
            <Input
              label="Fecha Inicio"
              name="fechaInicio"
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
            <Input
              label="Fecha Fin"
              name="fechaFin"
              type="date"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
            />
            <Button onClick={cargarReporte} loading={loading}>
              Generar Reporte
            </Button>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardBody>
                <p className="text-sm text-gray-500">Productos Diferentes</p>
                <p className="text-2xl font-bold">{productos.length}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-sm text-gray-500">Total Unidades Vendidas</p>
                <p className="text-2xl font-bold">{totalUnidades}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-sm text-gray-500">Total Ingresos</p>
                <p className="text-2xl font-bold">{formatCurrency(totalIngresos)}</p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <h2 className="font-semibold">
                Ranking de Productos ({formatDateShort(fechaInicio)} - {formatDateShort(fechaFin)})
              </h2>
            </CardHeader>
            <CardBody className="p-0">
              {productos.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No hay ventas en el período seleccionado
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Producto</th>
                      <th>Medida</th>
                      <th>Unidades Vendidas</th>
                      <th>Ingresos</th>
                      <th>% del Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.map((producto, index) => (
                      <tr key={producto.llantaId}>
                        <td className="font-bold text-lg">
                          {index + 1}
                          {index === 0 && ' 🥇'}
                          {index === 1 && ' 🥈'}
                          {index === 2 && ' 🥉'}
                        </td>
                        <td className="font-medium">
                          {producto.marca} {producto.modelo}
                        </td>
                        <td className="font-mono">{producto.medida}</td>
                        <td className="font-bold">{producto.cantidadVendida}</td>
                        <td>{formatCurrency(producto.ingresoTotal)}</td>
                        <td>
                          {totalIngresos > 0
                            ? ((producto.ingresoTotal / totalIngresos) * 100).toFixed(1)
                            : 0}
                          %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 font-bold">
                      <td colSpan={3}>TOTAL</td>
                      <td>{totalUnidades}</td>
                      <td>{formatCurrency(totalIngresos)}</td>
                      <td>100%</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
