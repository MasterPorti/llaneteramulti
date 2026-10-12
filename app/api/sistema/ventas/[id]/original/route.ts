import { obtenerVentaSistema } from '@/lib/data/sistema-ventas';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const venta = await obtenerVentaSistema(id);
  if (!venta?.datosOriginalesJson) return new Response('Registro no encontrado', { status: 404 });
  return new Response(venta.datosOriginalesJson, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="venta-${encodeURIComponent(id)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
