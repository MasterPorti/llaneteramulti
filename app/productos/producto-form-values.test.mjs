import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = fileURLToPath(new URL('./producto-form-values.ts', import.meta.url));
const compiled = new Module(filename);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { buildProductoInput } = compiled.exports;
const values = { nombre: ' Producto ', descripcion: '', precioVenta: '25.50', precioCompra: '', cantidad: '0' };

test('creating with zero stock preserves zero and leaves unknown cost null', () => {
  assert.deepEqual(buildProductoInput(values, 'create'), {
    nombre: 'Producto', descripcion: '', precio: 25.5, precioVenta: 25.5, precioCompra: null, cantidad: 0,
  });
});

test('explicit zero amounts are authentic values, distinct from blank cost and blank sale price', () => {
  const input = buildProductoInput({ ...values, precioVenta: '0', precioCompra: '0' }, 'create');
  assert.equal(input.precio, 0);
  assert.equal(input.precioVenta, 0);
  assert.equal(input.precioCompra, 0);
  assert.throws(() => buildProductoInput({ ...values, precioVenta: '' }, 'create'), /precio de venta/);
});

test('editing never sends stock even when an old stock value is supplied', () => {
  const input = buildProductoInput({ ...values, cantidad: '327' }, 'edit');
  assert.equal(Object.hasOwn(input, 'cantidad'), false);
  assert.equal(Object.hasOwn(input, 'stock'), false);
  assert.equal(input.precioCompra, null);
  assert.equal(input.descripcion, '');
});

test('stock is validated instead of truncated, defaulted or silently rounded', () => {
  for (const cantidad of ['', ' ', '1.5', '-1', '1e3', '2147483648', 'Infinity', 'NaN']) {
    assert.throws(() => buildProductoInput({ ...values, cantidad }, 'create'), /stock inicial/);
  }
  assert.equal(buildProductoInput({ ...values, cantidad: '2147483647' }, 'create').cantidad, 2147483647);
});

test('money keeps exact submitted cents and refuses invalid precision or overflow', () => {
  const input = buildProductoInput({ ...values, precioVenta: '99999999.99', precioCompra: '12,34' }, 'edit');
  assert.equal(input.precioVenta, 99999999.99);
  assert.equal(input.precioCompra, 12.34);
  for (const precioVenta of ['1.234', '-0.01', '100000000', 'NaN', 'Infinity', '1,000.00', '1e3']) {
    assert.throws(() => buildProductoInput({ ...values, precioVenta }, 'edit'), /precio de venta/);
  }
  assert.throws(() => buildProductoInput({ ...values, precioCompra: '1.239' }, 'edit'), /costo de compra/);
});
