import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript'), sharp = require('sharp');
function loadModule(filename, database = {}, cache = new Map()) {
  filename = path.resolve(root, filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename); cache.set(filename, mod);
  const native = createRequire(filename);
  mod.require = name => {
    if (name === '@/lib/db') return database;
    if (name.startsWith('@/') || name.startsWith('.')) {
      let target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      if (!path.extname(target)) target += '.ts';
      return loadModule(target, database, cache);
    }
    return native(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const imageApi = loadModule('lib/product-images.ts');
const uploadApi = loadModule('lib/utils/upload-imagen.ts');
const validation = loadModule('lib/data/product-validation.ts');
const input = overrides => ({ nombre: ' Producto ', descripcion: ' Detalle ', precio: 116, precioCompra: 50, cantidad: 0, ...overrides });
const fixture = () => sharp({ create: { width: 80, height: 40, channels: 4, background: '#3478aacc' } }).png().toBuffer();

test('uploaded photo is decoded, bounded and stripped of private metadata', async () => {
  const bytes = await sharp(await fixture()).resize(2000, 1000).jpeg().withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Artist: 'Private photographer' } }).toBuffer();
  const image = await imageApi.normalizarImagenProducto(bytes, 'C:\\private\\foto.jpg', 'image/jpeg');
  const metadata = await sharp(image.contenido).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(Math.max(metadata.width, metadata.height), 1600);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
  assert.equal(image.nombreOriginal, 'foto.jpg'); assert.equal(image.tamanioBytes, image.contenido.length);
  assert.equal(image.sha256, createHash('sha256').update(image.contenido).digest('hex'));
});
test('invalid, excessive and forged image uploads fail before persistence', async () => {
  const png = await fixture();
  for (const [bytes, mime] of [[Buffer.alloc(0), 'image/png'], [Buffer.alloc(imageApi.MAX_PRODUCT_IMAGE_BYTES + 1), 'image/png'],
    [Buffer.from('not an image'), 'image/png'], [png, 'image/jpeg'], [png, 'image/gif']]) {
    await assert.rejects(imageApi.normalizarImagenProducto(bytes, 'foto', mime));
  }
  const ambiguous = new FormData(); ambiguous.set('imagen', new File([png], 'foto.png', { type: 'image/png' }));
  ambiguous.set('eliminarImagen', 'true'); await assert.rejects(uploadApi.prepararImagenProducto(ambiguous));
});
test('FormData distinguishes preserving, replacing and removing an image', async () => {
  assert.deepEqual(await uploadApi.prepararImagenProducto(), { eliminarImagen: false });
  const removal = new FormData(); removal.set('eliminarImagen', 'true');
  assert.deepEqual(await uploadApi.prepararImagenProducto(removal), { eliminarImagen: true });
  const addition = new FormData(); addition.set('imagen', new File([await fixture()], 'foto.png', { type: 'image/png' }));
  const change = await uploadApi.prepararImagenProducto(addition);
  assert.equal(change.eliminarImagen, false); assert.equal(change.imagen.mimeType, 'image/webp');
});
test('product contract preserves zero stock/price and unknown cost while enforcing real storage limits', () => {
  validation.validateProductInput(input({ precio: 0, precioCompra: null }));
  validation.validateProductInput({ precioCompra: null }, true);
  for (const invalid of [{ cantidad: -1 }, { cantidad: 1.5 }, { cantidad: 2147483648 }, { precio: 100000000 },
    { precioCompra: -1 }, { nombre: ' ' }, { descripcion: 'a'.repeat(2001) }, { imagen: 'https://invalid.test/photo' }, { imagen_id: 'forged' }]) {
    assert.throws(() => validation.validateProductInput(input(invalid)));
  }
});

function fakeDatabase() {
  let state = { products: {}, images: {} };
  let rejectProduct = false;
  const events = [];
  const result = rows => ({ rows, rowCount: rows.length });
  async function query(sql, params = []) {
    events.push(sql);
    if (sql.startsWith('INSERT INTO producto_imagenes')) {
      const [id, contenido, mime_type, nombre_original, tamanio_bytes, ancho, alto, sha256] = params;
      if (Object.values(state.images).some(image => image.sha256 === sha256)) return result([]);
      state.images[id] = { id, contenido, mime_type, nombre_original, tamanio_bytes, ancho, alto, sha256 };
      return result([{ id }]);
    }
    if (sql.startsWith('SELECT id FROM producto_imagenes')) return result(Object.values(state.images).filter(image => image.sha256 === params[0]).map(({ id }) => ({ id })));
    if (sql.startsWith('INSERT INTO productos(')) {
      if (rejectProduct) throw new Error('Synthetic product persistence failure');
      const [id, nombre, descripcion, precioCompra, precioVenta, stock, imagen_id] = params;
      state.products[id] = { id, nombre, descripcion, precioCompra, precioVenta, stock, imagen_id, imagen: null, activo: true, createdAt: 'original', updatedAt: 'original' };
      return result([structuredClone(state.products[id])]);
    }
    if (sql.startsWith('SELECT * FROM productos')) return result(state.products[params[0]] ? [structuredClone(state.products[params[0]])] : []);
    if (sql.startsWith('UPDATE productos SET nombre=')) {
      if (rejectProduct) throw new Error('Synthetic product persistence failure');
      const [id, nombre, descripcion, precioCompra, precioVenta, stock, imagen_id, imagen] = params;
      Object.assign(state.products[id], { nombre, descripcion, precioCompra, precioVenta, stock, imagen_id, imagen });
      return result([structuredClone(state.products[id])]);
    }
    throw new Error('Unexpected SQL: ' + sql);
  }
  return { get state() { return state; }, events, rejectProductWrites() { rejectProduct = true; }, database: {
    db: { query }, transaction: async callback => {
      const before = structuredClone(state); events.push('BEGIN');
      try { const value = await callback({ query }); events.push('COMMIT'); return value; }
      catch (error) { state = before; events.push('ROLLBACK'); throw error; }
    },
  } };
}
test('product and image commit together with exact zero stock and nullable cost', async () => {
  const fake = fakeDatabase(), api = loadModule('lib/data/shared-database-catalog.ts', fake.database);
  const photo = await imageApi.normalizarImagenProducto(await fixture(), 'foto.png', 'image/png');
  const product = await api.sharedCreateProduct(input({ precioCompra: null }), { imagen: photo, eliminarImagen: false });
  assert.equal(product.stock, 0); assert.equal(product.precioCompra, undefined); assert.equal(product.nombre, 'Producto');
  assert.equal(fake.state.products[product.id].precioCompra, null); assert.equal(fake.state.images[product.imagenId].sha256, photo.sha256);
  assert.equal(product.imagen, `/api/productos/imagenes/${product.imagenId}`);
  assert.deepEqual(fake.events.filter(event => /^(BEGIN|COMMIT|ROLLBACK)$/.test(event)), ['BEGIN', 'COMMIT']);
});
test('editing fields preserves stock, recorded cost and photo unless explicitly changed', async () => {
  const fake = fakeDatabase(), api = loadModule('lib/data/shared-database-catalog.ts', fake.database);
  const photo = await imageApi.normalizarImagenProducto(await fixture(), 'foto.png', 'image/png');
  const product = await api.sharedCreateProduct(input({ cantidad: 7 }), { imagen: photo, eliminarImagen: false });
  const edited = await api.sharedUpdateProduct(product.id, { nombre: ' Editado ', precioVenta: 232 });
  assert.equal(edited.stock, 7); assert.equal(edited.precioCompra, 50); assert.equal(edited.imagenId, product.imagenId); assert.equal(edited.precio, 232);
  const removed = await api.sharedUpdateProduct(product.id, { precioCompra: null }, { eliminarImagen: true });
  assert.equal(removed.stock, 7); assert.equal(removed.precioCompra, undefined); assert.equal(removed.imagenId, null); assert.equal(removed.imagen, undefined);
  assert.equal(Object.keys(fake.state.images).length, 1, 'Unlinking must preserve original image bytes.');
});
test('same image reuses its immutable identity without updates or deletes', async () => {
  const fake = fakeDatabase(), api = loadModule('lib/data/shared-database-catalog.ts', fake.database);
  const photo = await imageApi.normalizarImagenProducto(await fixture(), 'foto.png', 'image/png');
  const first = await api.sharedCreateProduct(input(), { imagen: photo, eliminarImagen: false });
  const second = await api.sharedCreateProduct(input({ nombre: 'Otro' }), { imagen: photo, eliminarImagen: false });
  assert.equal(first.imagenId, second.imagenId); assert.equal(Object.keys(fake.state.images).length, 1);
  assert.equal(fake.events.some(sql => /UPDATE producto_imagenes|DELETE FROM|DO UPDATE/.test(sql)), false);
});
test('failed product persistence rolls image insert back and leaves existing stock unchanged', async () => {
  const fake = fakeDatabase(), api = loadModule('lib/data/shared-database-catalog.ts', fake.database);
  const existing = await api.sharedCreateProduct(input({ cantidad: 4 }));
  const before = structuredClone(fake.state); fake.rejectProductWrites();
  const photo = await imageApi.normalizarImagenProducto(await fixture(), 'foto.png', 'image/png');
  await assert.rejects(api.sharedCreateProduct(input(), { imagen: photo, eliminarImagen: false }), /Synthetic/);
  assert.deepEqual(fake.state, before);
  await assert.rejects(api.sharedUpdateProduct(existing.id, { precioCompra: null }, { imagen: photo, eliminarImagen: false }), /Synthetic/);
  assert.deepEqual(fake.state, before);
});
