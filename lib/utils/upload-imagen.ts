import { MAX_PRODUCT_IMAGE_BYTES, normalizarImagenProducto } from '@/lib/product-images';
import type { ImagenProductoNormalizada } from '@/lib/product-images';

export interface CambioImagenProducto {
  imagen?: ImagenProductoNormalizada;
  eliminarImagen: boolean;
}

/** No sube archivos al seleccionar: la acción guarda la imagen junto al producto. */
export async function prepararImagenProducto(media?: FormData): Promise<CambioImagenProducto> {
  if (media === undefined) return { eliminarImagen: false };
  if (!(media instanceof FormData)) throw new Error('Los datos de imagen no son válidos.');
  if (media.getAll('imagen').length > 1) throw new Error('Selecciona una sola imagen.');
  const eliminar = media.get('eliminarImagen');
  if (eliminar !== null && eliminar !== 'true' && eliminar !== 'false') {
    throw new Error('La opción de eliminar imagen no es válida.');
  }
  const file = media.get('imagen');
  const eliminarImagen = eliminar === 'true';
  if (file === null) return { eliminarImagen };
  if (!(file instanceof File) || eliminarImagen) throw new Error('Selecciona una imagen válida.');
  if (!file.size || file.size > MAX_PRODUCT_IMAGE_BYTES) throw new Error('La imagen debe contener datos y no superar 5 MB.');
  const imagen = await normalizarImagenProducto(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
  return { imagen, eliminarImagen: false };
}
