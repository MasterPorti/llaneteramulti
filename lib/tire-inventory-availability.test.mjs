import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const cache = new Map();
function loadTs(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = new Module(filename);
  cache.set(filename, compiled);
  const nativeRequire = createRequire(filename);
  compiled.require = (name) => name.startsWith('.')
    ? loadTs(path.resolve(path.dirname(filename), `${name}.ts`))
    : nativeRequire(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return compiled.exports;
}
const { tireHasInventoryStock } = loadTs(fileURLToPath(new URL('./tire-inventory-availability.ts', import.meta.url)));
const tire = (stockPorBodega, overrides = {}) => ({ id: 'tire-1', activo: true, stockPorBodega, ...overrides });

test('excludes exhausted tires regardless of their active or historical status', () => {
  for (const activo of [true, false]) {
    assert.equal(tireHasInventoryStock(tire({ 'bodega-1': 0, 'bodega-2': 0 }, { activo })), false);
    assert.equal(tireHasInventoryStock(tire({}, { activo })), false);
  }
});

test('shows stock in any warehouse, but requires stock in the chosen warehouse', () => {
  const llanta = tire({ 'bodega-1': 0, 'bodega-2': 3, 'bodega-3': 1 });
  assert.equal(tireHasInventoryStock(llanta), true);
  assert.equal(tireHasInventoryStock(llanta, ''), true);
  assert.equal(tireHasInventoryStock(llanta, 'bodega-1'), false);
  assert.equal(tireHasInventoryStock(llanta, 'bodega-2'), true);
  assert.equal(tireHasInventoryStock(llanta, 'bodega-3'), true);
  assert.equal(tireHasInventoryStock(llanta, 'bodega-8'), false);
});

test('reappears after restocking and disappears when stock is exhausted again', () => {
  const snapshots = [0, 2, 0].map((quantity) => tire({ 'bodega-1': quantity }));
  assert.deepEqual(snapshots.map((llanta) => tireHasInventoryStock(llanta)), [false, true, false]);
  assert.deepEqual(snapshots.map((llanta) => tireHasInventoryStock(llanta, 'bodega-1')), [false, true, false]);
});

test('filters display rows without changing tire identities, status or stored stock', () => {
  const llantas = [tire({ 'bodega-1': 0 }), tire({ 'bodega-1': 1 }, { id: 'tire-2' })];
  const before = structuredClone(llantas);
  llantas.forEach((llanta) => { Object.freeze(llanta.stockPorBodega); Object.freeze(llanta); });
  Object.freeze(llantas);
  assert.deepEqual(llantas.filter((llanta) => tireHasInventoryStock(llanta)), [llantas[1]]);
  assert.deepEqual(llantas, before);
});
