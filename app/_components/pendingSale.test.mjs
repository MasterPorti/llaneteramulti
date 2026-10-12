import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('./pendingSale.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(`(function(exports) { ${compiled}\n })`)(exportsObject);
const { storePendingSale, readPendingSale, clearPendingSale } = exportsObject;

function storage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}
const key = 'pending-sale';
const input = () => ({ operacionId: 'operation-00000001', clienteNombre: 'Cliente', items: [{ id: 'tire', cantidad: 2, precioCustom: 100 }] });

test('reload recovers the exact original ID and payload despite later edits to the form', () => {
  const session = storage();
  const form = input();
  const saved = storePendingSale(session, key, form, 'general');
  form.items[0].cantidad = 9;
  form.items[0].precioCustom = 500;
  form.clienteNombre = 'Changed';
  const reloaded = readPendingSale(session, key);
  assert.equal(JSON.stringify(reloaded), JSON.stringify(saved));
  assert.equal(reloaded.payload.items[0].cantidad, 2);
  assert.equal(reloaded.payload.items[0].precioCustom, 100);
  assert.equal(reloaded.payload.clienteNombre, 'Cliente');
});

test('an unresolved sale cannot be overwritten from the other checkout or cleared by a different operation', () => {
  const session = storage();
  storePendingSale(session, key, input(), 'sistema');
  assert.throws(() => storePendingSale(session, key, { ...input(), operacionId: 'operation-00000002' }, 'general'));
  assert.throws(() => clearPendingSale(session, key, 'operation-00000002'));
  assert.equal(readPendingSale(session, key).id, 'operation-00000001');
  assert.equal(readPendingSale(session, key).flow, 'sistema');
  clearPendingSale(session, key, 'operation-00000001');
  assert.equal(readPendingSale(session, key), null);
});

test('storage failures and corrupt recovery data fail closed without deleting the pending record', () => {
  const session = storage();
  assert.throws(() => storePendingSale({ ...session, setItem() { throw new Error('quota'); } }, key, input(), 'general'));
  session.setItem(key, '{broken');
  assert.throws(() => readPendingSale(session, key));
  assert.equal(session.getItem(key), '{broken');
  session.setItem(key, JSON.stringify({ version: 1, flow: 'general', id: 'operation-00000001', payload: { ...input(), operacionId: 'operation-00000002' } }));
  assert.throws(() => readPendingSale(session, key));
  assert.throws(() => clearPendingSale(session, key, 'operation-00000001'));
  assert.notEqual(session.getItem(key), null);
});
