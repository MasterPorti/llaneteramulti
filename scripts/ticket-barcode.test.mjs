import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ticketCode,ticketBarcodeSvg,ticketBarcodeHtml} from '../lib/ticket-barcode.ts';
test('white tickets use the same immutable identity contract as black tickets',()=>{
  const id='1792012345678-abcd123';
  assert.equal(ticketCode('ventas',id),'LLA1:V:'+id);
  assert.equal(ticketCode('ventas_productos',id),'LLA1:P:'+id);
  assert.equal(ticketBarcodeSvg('ventas',id),ticketBarcodeSvg('ventas',id));
  assert.notEqual(ticketBarcodeSvg('ventas',id),ticketBarcodeSvg('ventas_productos',id));
});
test('barcode contains quiet zones, readable ID and no external asset dependencies',()=>{
  const html=ticketBarcodeHtml('ventas','1792012345678-abcd123');
  assert.match(html,/shape-rendering="crispEdges"/);assert.match(html,/ID: LLA1:V:1792012345678-abcd123/);
  assert.doesNotMatch(html,/<script|<img|(?:src|href)=/);
  const svg=ticketBarcodeSvg('ventas','1792012345678-abcd123');const width=Number(svg.match(/viewBox="0 0 (\d+) 56"/)[1]);assert.ok(width<440);
  const bars=[...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)" height="56"\/>/g)];assert.equal(Number(bars[0][1]),12);const last=bars.at(-1);assert.equal(width-Number(last[1])-Number(last[2]),12);
});
test('untrusted IDs cannot inject printable markup',()=>{
  for(const id of ['','../../id','<script>','id:extra','a'.repeat(81)])assert.throws(()=>ticketBarcodeHtml('ventas',id));
});
test('white sale print and inventory sale entry point expose the ticket barcode',()=>{
  assert.match(fs.readFileSync(new URL('../app/ventas/[id]/TicketPrint.tsx',import.meta.url),'utf8'),/<TicketBarcode id=\{venta.id\}/);
  assert.match(fs.readFileSync(new URL('../app/inventario/ventas/[id]/page.tsx',import.meta.url),'utf8'),/Imprimir ticket de venta/);
});
