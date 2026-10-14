import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = fileURLToPath(new URL('./producto-search.ts', import.meta.url));
const compiled = new Module(filename);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { filtrarProductos } = compiled.exports;

const productos = [
  { id: '1', nombre: 'Válvula metálica corta', descripcion: 'Para rin 15', stock: 0 },
  { id: '2', nombre: 'Válvula metálica larga', descripcion: 'Para rin 17', stock: 3 },
  { id: '3', nombre: 'Parche radial', stock: 5 },
];

test('finds the full product name without accents, case or extra whitespace', () => {
  assert.deepEqual(filtrarProductos(productos, '  VALVULA   METALICA LARGA  '), [productos[1]]);
});

test('combines search words in either order across name and description', () => {
  assert.deepEqual(filtrarProductos(productos, 'rin 15 valvula'), [productos[0]]);
  assert.deepEqual(filtrarProductos(productos, 'larga corta'), []);
});

test('distinguishes similar endings and keeps out-of-stock matches visible', () => {
  assert.deepEqual(filtrarProductos(productos, 'corta'), [productos[0]]);
  assert.deepEqual(filtrarProductos(productos, 'larga'), [productos[1]]);
});

test('blank search returns all products without changing the original catalog', () => {
  const before = structuredClone(productos);
  const resultado = filtrarProductos(productos, ' \t ');
  assert.deepEqual(resultado, productos);
  assert.notEqual(resultado, productos);
  assert.deepEqual(productos, before);
  assert.deepEqual(filtrarProductos([], 'parche'), []);
  assert.deepEqual(filtrarProductos(productos, 'radial'), [productos[2]]);
});
