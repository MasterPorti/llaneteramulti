import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Badge, PrintButton } from '@/components/ui';
import { obtenerReporteInventario } from '../actions';
import { formatCurrency, formatDateShort } from '@/lib/utils/formatters';
import { CONFIG } from '@/lib/config';
import { getTotalStock } from '@/types';

export default async function ReporteInventarioPage() {
  const result = await obtenerReporteInventario();
  const reporte = result.data;

  if (!result.success || !reporte) {
    return <div>Error al cargar el reporte</div>;
  }

  return (
    <div>
      <PageHeader
        title="Reporte de Inventario"
        subtitle={`Generado el ${new Date().toLocaleDateString('es-MX')}`}
        breadcrumbs={[
          { label: 'Reportes', href: '/reportes' },
          { label: 'Inventario' },
        ]}
        actions={<PrintButton />}
      />

      <div className="print:hidden grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Total Productos</p>
            <p className="text-2xl font-bold">{reporte.totalProductos}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Total Unidades</p>
            <p className="text-2xl font-bold">{reporte.totalUnidades}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Valor Total</p>
            <p className="text-2xl font-bold">{formatCurrency(reporte.valorTotal)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">Sin Stock</p>
            <p className="text-2xl font-bold">
              <Badge variant={reporte.sinStock.length > 0 ? 'danger' : 'success'}>
                {reporte.sinStock.length} productos
              </Badge>
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex justify-between items-center">
          <h2 className="font-semibold">Detalle del Inventario</h2>
          <span className="text-sm text-gray-500">
            {CONFIG.nombreNegocio} - {new Date().toLocaleDateString('es-MX')}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Marca</th>
                <th>Modelo</th>
                <th>Medida</th>
                <th>Stock</th>
                <th>Precio Compra</th>
                <th>Precio Venta</th>
                <th>Valor Stock</th>
                <th>Proveedor</th>
                <th>Recibido</th>
              </tr>
            </thead>
            <tbody>
              {reporte.items.map((item) => {
                const stock = getTotalStock(item);
                const sinStockItem = stock === 0;
                return (
                  <tr key={item.id} className={sinStockItem ? 'bg-red-50' : ''}>
                    <td className="font-medium">{item.marca}</td>
                    <td>{item.modelo}</td>
                    <td className="font-mono">{item.medida}</td>
                    <td>
                      <Badge variant={sinStockItem ? 'danger' : stock <= 3 ? 'warning' : 'success'}>
                        {stock}
                      </Badge>
                    </td>
                    <td>{formatCurrency(item.precioCompra)}</td>
                    <td>{formatCurrency(item.precioVenta)}</td>
                    <td className="font-medium">
                      {formatCurrency(item.precioVenta * stock)}
                    </td>
                    <td>{item.proveedor}</td>
                    <td>{formatDateShort(item.fechaRecepcion)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-bold">
                <td colSpan={3}>TOTALES</td>
                <td>{reporte.totalUnidades}</td>
                <td colSpan={2}></td>
                <td>{formatCurrency(reporte.valorTotal)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </CardBody>
      </Card>

      {reporte.sinStock.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <h2 className="font-semibold text-red-600">Productos Sin Stock</h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Medida</th>
                  <th>Proveedor</th>
                </tr>
              </thead>
              <tbody>
                {reporte.sinStock.map((item) => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.marca} {item.modelo}</td>
                    <td className="font-mono">{item.medida}</td>
                    <td>{item.proveedor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
