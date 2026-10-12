import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody } from '@/components/ui';
import { obtenerInventarioSistema, obtenerMovimientosSistema } from '@/lib/data/sistema-inventario';
import { SISTEMA_BODEGAS } from '@/lib/config-sistema';
import { formatDateTime } from '@/lib/utils/formatters';

export const dynamic = 'force-dynamic';

export default async function MovimientosPage({ searchParams }: {
  searchParams: Promise<{ llantaId?: string }>;
}) {
  const { llantaId } = await searchParams;
  const [inventario, movimientos] = await Promise.all([
    obtenerInventarioSistema({ incluirInactivos: true }),
    obtenerMovimientosSistema(),
  ]);
  const llantas = new Map(inventario.map((llanta) => [llanta.id, llanta]));
  const lista = movimientos.filter((movimiento) => !llantaId || movimiento.llantaId === llantaId);
  const nombreBodega = (id: string) => SISTEMA_BODEGAS.find((bodega) => bodega.id === id)?.nombre || id;

  return (
    <div>
      <PageHeader title="Movimientos de inventario" subtitle={`${lista.length} movimientos registrados`} />
      {llantaId && <Link href="/inventario/movimientos" className="btn btn-secondary mb-4">Ver todos los movimientos</Link>}
      <Card>
        <CardBody className="p-0 overflow-x-auto">
          <table className="table w-full">
            <thead><tr><th>Fecha</th><th>Llanta</th><th>Origen</th><th>Destino</th><th>Cantidad</th><th>Registro</th></tr></thead>
            <tbody>
              {lista.map((movimiento) => {
                const llanta = llantas.get(movimiento.llantaId);
                return (
                  <tr key={movimiento.id}>
                    <td>{formatDateTime(movimiento.fecha)}</td>
                    <td>
                      {llanta ? <Link href={`/inventario/inventario/${llanta.id}`} className="hover:underline">
                        {llanta.marca} {llanta.modelo} · {llanta.medida}{!llanta.activo ? ' · Inactiva' : ''}
                      </Link> : movimiento.llantaId}
                    </td>
                    <td>{nombreBodega(movimiento.bodegaOrigen)}</td>
                    <td>{nombreBodega(movimiento.bodegaDestino)}</td>
                    <td>{movimiento.cantidad}</td>
                    <td><details><summary className="cursor-pointer">Ver registro</summary><pre className="max-w-lg overflow-auto text-xs p-2">{JSON.stringify(movimiento, null, 2)}</pre></details></td>
                  </tr>
                );
              })}
              {lista.length === 0 && <tr><td colSpan={6} className="text-center">Sin movimientos</td></tr>}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
