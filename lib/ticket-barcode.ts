import JsBarcode from 'jsbarcode';

export type TicketKind = 'ventas' | 'ventas_productos';
export function ticketCode(kind: TicketKind, id: string): string {
  if (!['ventas','ventas_productos'].includes(kind) || !/^[\w-]{1,80}$/.test(id)) throw new Error('Identidad de ticket inválida.');
  return `LLA1:${kind === 'ventas' ? 'V' : 'P'}:${id}`;
}

/** CODE128, including its checksum and quiet zones. Works in server and browser without a canvas. */
export function ticketBarcodeSvg(kind: TicketKind, id: string): string {
  const code = ticketCode(kind,id);
  const target: { encodings?: {data:string}[] } = {};
  // JsBarcode's object renderer returns encoded bars without reading the DOM.
  const encode = JsBarcode as unknown as (target:object,code:string,options:object)=>void;
  encode(target,code,{format:'CODE128',displayValue:false});
  const bits=target.encodings?.map(encoding=>encoding.data).join('');
  if(!bits || !/^[01]+$/.test(bits))throw new Error('No se pudo generar el código del ticket.');
  const quiet=12,width=bits.length+quiet*2;
  let bars='';
  for(let i=0;i<bits.length;){if(bits[i]==='0'){i++;continue;}let end=i+1;while(bits[end]==='1')end++;bars+=`<rect x="${quiet+i}" y="0" width="${end-i}" height="56"/>`;i=end;}
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Código de venta ${code}" viewBox="0 0 ${width} 56" width="100%" height="16mm" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${width}" height="56" fill="#fff"/><g fill="#000">${bars}</g></svg>`;
}

export function ticketBarcodeHtml(kind: TicketKind,id:string):string {
  return `<div style="background:#fff;color:#000;text-align:center;padding:3mm 0;break-inside:avoid;max-width:74mm;margin:auto">${ticketBarcodeSvg(kind,id)}<div style="font:7pt 'Courier New',Courier,monospace;overflow-wrap:anywhere;margin-top:1mm">ID: ${ticketCode(kind,id)}</div></div>`;
}
