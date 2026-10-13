import type { PoolClient } from 'pg';
import { db } from '@/lib/db';

export const sharedDatabaseEnabled = () => process.env.SHARED_DATABASE_MODE === 'true';
export const NEW_TIRES = 'COMERCIALIZADORA DE NEW TIRES';
export const providerKey = (value: unknown): string | null => typeof value === 'string' && value.trim()
  ? value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX') : null;
export const tireScopeSql = `(origen_app='blanca' OR upper(regexp_replace(btrim(proveedor),'[[:space:]]+',' ','g'))='${NEW_TIRES}')`;
export const saleScopeSql = `(v.origen_app='blanca' OR EXISTS(SELECT 1 FROM shared_runtime.sale_item_scope scope
  WHERE scope.sale_kind='ventas' AND scope.sale_id=v.id AND scope.provider_key='${NEW_TIRES}'))`;

export async function nextFolio(client: PoolClient, prefix: string): Promise<string> {
  const row = (await client.query<{ folio: string }>('SELECT shared_runtime.next_folio($1) AS folio', [prefix])).rows[0];
  if (!row || typeof row.folio !== 'string' || !row.folio.startsWith(prefix)) throw new Error('El consecutivo compartido no es válido.');
  return row.folio;
}

export async function originalSaleJson(kind: string, id: string): Promise<string | undefined> {
  const archived = await db.query<{ document_text: string }>(`SELECT document_text FROM shared_archive.sale_originals
    WHERE sale_kind=$1 AND sale_id=$2 ORDER BY CASE source_label WHEN 'negra' THEN 0 ELSE 1 END,source_label LIMIT 1`, [kind, id]);
  if (archived.rows[0]) return archived.rows[0].document_text;
  // New documents have no pre-migration original. Return the complete canonical
  // record, never reconstructing it from presentation defaults.
  const table = kind === 'ventas_productos' ? 'ventas_productos' : 'ventas';
  const result = await db.query<{ original: string }>(`SELECT row_to_json(v)::text AS original FROM public.${table} v WHERE id=$1`, [id]);
  return result.rows[0]?.original;
}
