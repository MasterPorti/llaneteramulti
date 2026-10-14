import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ImagenProductoNormalizada } from '../product-images';

/** Store immutable image bytes in the product transaction, reusing their hash. */
export async function guardarImagenProducto(
  client: Pick<PoolClient, 'query'>,
  image: ImagenProductoNormalizada,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO producto_imagenes
      (id,contenido,mime_type,nombre_original,tamanio_bytes,ancho,alto,sha256,origen_url)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL)
     ON CONFLICT(sha256) DO NOTHING RETURNING id`,
    [randomUUID(), image.contenido, image.mimeType, image.nombreOriginal,
      image.tamanioBytes, image.ancho, image.alto, image.sha256],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  // A separate statement sees the concurrent winner after ON CONFLICT waits.
  // No UPDATE privilege on historical image bytes or hashes is necessary.
  const existing = await client.query<{ id: string }>('SELECT id FROM producto_imagenes WHERE sha256=$1', [image.sha256]);
  if (!existing.rows[0]) throw new Error('No se pudo confirmar la imagen del producto.');
  return existing.rows[0].id;
}
