import { ticketBarcodeHtml, type TicketKind } from '@/lib/ticket-barcode';
export function TicketBarcode({kind='ventas',id}:{kind?:TicketKind;id:string}) {
  return <div dangerouslySetInnerHTML={{__html:ticketBarcodeHtml(kind,id)}}/>;
}
