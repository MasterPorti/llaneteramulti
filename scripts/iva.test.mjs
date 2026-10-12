import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/utils/iva.ts');
const compiled = new Module(filename);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { calcularImportePartida, calcularImportesVenta, desglosarIvaIncluido } = compiled.exports;

test('included IVA preserves the user confirmed amount charged', () => {
  assert.deepEqual(desglosarIvaIncluido(2380), { subtotal:2051.72, iva:328.28, total:2380 });
  assert.deepEqual(calcularImportesVenta([{ precioUnitario:1190, cantidad:2 }]), { subtotal:2051.72, iva:328.28, total:2380 });
});

test('decimal currency avoids floating point residue and calculates IVA once per sale', () => {
  assert.deepEqual(calcularImportesVenta([{ precioUnitario:0.1,cantidad:1 },{ precioUnitario:0.2,cantidad:1 }]),
    { subtotal:0.26,iva:0.04,total:0.3 });
  assert.deepEqual(calcularImportesVenta([{ precioUnitario:0.04,cantidad:1 },{ precioUnitario:0.04,cantidad:1 }]),
    { subtotal:0.07,iva:0.01,total:0.08 });
  assert.deepEqual(calcularImportesVenta([{ precioUnitario:12.34,cantidad:3 },{ precioUnitario:56.78,cantidad:2 }]),
    { subtotal:129.81,iva:20.77,total:150.58 });
});

test('unit prices round half up to cents before multiplying quantities', () => {
  assert.equal(calcularImportePartida(1.005,1),1.01);
  assert.equal(calcularImportePartida(1.005,3),3.03);
  assert.equal(calcularImportePartida(19.995,3),60);
  assert.deepEqual(calcularImportesVenta([{ precioUnitario:19.995,cantidad:3 },{ precioUnitario:0.1,cantidad:1 }]),
    { subtotal:51.81,iva:8.29,total:60.1 });
  assert.equal(calcularImportePartida(0.004,1),0);
  assert.equal(calcularImportePartida(0.005,1),0.01);
});

test('zero value sales and empty previews keep all monetary fields at zero', () => {
  assert.deepEqual(desglosarIvaIncluido(0), { subtotal:0,iva:0,total:0 });
  assert.deepEqual(calcularImportesVenta([]), { subtotal:0,iva:0,total:0 });
  assert.deepEqual(calcularImportesVenta([{ precioUnitario:0,cantidad:3 }]), { subtotal:0,iva:0,total:0 });
  assert.equal(calcularImportePartida(1e-7,1),0);
});

test('maximum supported amount has exact cents and overflow is rejected', () => {
  assert.deepEqual(desglosarIvaIncluido(99999999.99), { subtotal:86206896.54,iva:13793103.45,total:99999999.99 });
  assert.equal(calcularImportePartida(99999999.99,1),99999999.99);
  assert.throws(() => desglosarIvaIncluido(100000000), /importe/);
  assert.throws(() => desglosarIvaIncluido(99999999.995), /importe/);
  assert.throws(() => calcularImportePartida(99999999.99,2), /importe/);
  assert.throws(() => calcularImportesVenta([{ precioUnitario:99999999.99,cantidad:1 },{ precioUnitario:0.01,cantidad:1 }]), /total/);
});

test('invalid amounts and quantities cannot silently become a tax calculation', () => {
  for (const amount of [NaN,Infinity,-Infinity,-0.01,null,undefined,'100']) {
    assert.throws(() => desglosarIvaIncluido(amount), /importe/);
    assert.throws(() => calcularImportePartida(amount,1), /importe/);
    assert.throws(() => calcularImportesVenta([{ precioUnitario:amount,cantidad:1 }]), /importe/);
  }
  for (const quantity of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,null,'2']) {
    assert.throws(() => calcularImportePartida(1,quantity), /cantidad/);
    assert.throws(() => calcularImportesVenta([{ precioUnitario:1,cantidad:quantity }]), /cantidad/);
  }
});
