import { db } from '@/lib/db';
import { sharedDatabaseEnabled } from '@/lib/data/shared-database';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sharedDatabaseEnabled()) return new Response(null, { status: 404 });
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return new Response(null, { status: 404 });
  const row = (await db.query<{ contenido: Buffer; mime_type: string }>(`SELECT i.contenido,i.mime_type FROM producto_imagenes i WHERE i.id=$1::uuid
    AND EXISTS(SELECT 1 FROM productos p WHERE p.imagen_id=i.id AND p.activo=true)`, [id])).rows[0];
  if (!row) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.contenido), { headers: { 'Content-Type': row.mime_type,
    'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
