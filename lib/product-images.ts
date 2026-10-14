import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;
const IMAGE_TYPES = new Map([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

export interface ImagenProductoNormalizada {
  contenido: Buffer;
  mimeType: 'image/webp';
  nombreOriginal: string;
  tamanioBytes: number;
  ancho: number;
  alto: number;
  sha256: string;
}

/** Decodifica el contenido real, orienta la foto y elimina metadatos EXIF/GPS. */
export async function normalizarImagenProducto(
  bytes: Uint8Array,
  nombreOriginal: string,
  mimeDeclarado?: string,
): Promise<ImagenProductoNormalizada> {
  if (!bytes.byteLength || bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error('La imagen debe contener datos y no superar 5 MB.');
  }
  if (mimeDeclarado && ![...IMAGE_TYPES.values()].includes(mimeDeclarado)) {
    throw new Error('Solo se permiten imágenes JPG, PNG o WebP.');
  }

  try {
    const image = sharp(Buffer.from(bytes), { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    const mimeReal = IMAGE_TYPES.get(metadata.format ?? '');
    if (!mimeReal || (mimeDeclarado && mimeDeclarado !== mimeReal) || (metadata.pages ?? 1) > 1) {
      throw new Error('INVALID_IMAGE');
    }
    const { data, info } = await image.rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > MAX_PRODUCT_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');

    const filename = nombreOriginal.split(/[\\/]/).pop() ?? '';
    return {
      contenido: data,
      mimeType: 'image/webp',
      nombreOriginal: filename.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 255) || 'producto',
      tamanioBytes: data.length,
      ancho: info.width,
      alto: info.height,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  } catch {
    throw new Error('La imagen está dañada, es animada o excede los límites de formato o resolución (24 megapíxeles).');
  }
}
