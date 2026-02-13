'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Button, Input } from '@/components/ui';
import { obtenerReporteVentas, type ReporteVentas } from '../actions';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';

export default function ReporteVentasPage() {
  const [reporte, setReporte] = useState<ReporteVentas | null>(null);
  const [loading, setLoading] = useState(true);

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const [fechaInicio, setFechaInicio] = useState(inicioMes.toISOString().split('T')[0]);
  const [fechaFin, setFechaFin] = useState(hoy.toISOString().split('T')[0]);

  const cargarReporte = async () => {
    setLoading(true);
    const result = await obtenerReporteVentas({ fechaInicio, fechaFin });
    if (result.success && result.data) {
      setReporte(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    cargarReporte();
  }, []);

  return (
    <div>
      <PageHeader
        title="Reporte de Ventas"
        subtitle="Ventas por período"
        breadcrumbs={[
          { label: 'Reportes', href: '/reportes' },
          { label: 'Ventas' },
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
      ) : reporte ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardBody>
                <p className="text-sm text-gray-500">Total Ventas</p>
                <p className="text-2xl font-bold">{reporte.totalVentas}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-sm text-gray-500">Total Ingresos</p>
                <p className="text-2xl font-bold">{formatCurrency(reporte.totalIngresos)}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-sm text-gray-500">Promedio por Venta</p>
                <p className="text-2xl font-bold">{formatCurrency(reporte.promedioVenta)}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-sm text-gray-500">Período</p>
                <p className="text-lg font-medium">
                  {formatDateShort(fechaInicio)} - {formatDateShort(fechaFin)}
                </p>
              </CardBody>
            </Card>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <h2 className="font-semibold">Ventas por Día</h2>
            </CardHeader>
            <CardBody className="p-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cantidad de Ventas</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.ventasPorDia.map((dia) => (
                    <tr key={dia.fecha}>
                      <td>{formatDateShort(dia.fecha)}</td>
                      <td>{dia.cantidad}</td>
                      <td className="font-medium">{formatCurrency(dia.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold">
                    <td>TOTAL</td>
                    <td>{reporte.totalVentas}</td>
                    <td>{formatCurrency(reporte.totalIngresos)}</td>
                  </tr>
                </tfoot>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold">Detalle de Ventas</h2>
            </CardHeader>
            <CardBody className="p-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Productos</th>
                    <th>Método Pago</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.ventas.map((venta) => (
                    <tr key={venta.id}>
                      <td className="font-mono">{venta.folio}</td>
                      <td>{formatDateShort(venta.fechaVenta)}</td>
                      <td>{venta.cliente.nombre}</td>
                      <td>{venta.items.length}</td>
                      <td className="capitalize">{venta.metodoPago}</td>
                      <td className="font-medium">{formatCurrency(venta.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </>
      ) : (
        <div className="text-center py-8 text-gray-500">
          No hay datos disponibles
        </div>
      )}
    </div>
  );
}
