import { Fragment } from 'react';
import Image from 'next/image';
import { TicketBarcode } from '@/components/tickets/TicketBarcode';
import { CONFIG } from '@/lib/config';
import { formatCurrency, formatDateTime } from '@/lib/utils/formatters';
import type { Venta } from '@/types';

interface Props {
  venta: Venta;
  businessName?: string;
  showLogo?: boolean;
  test?: boolean;
}

export function TicketPrint({ venta, businessName = 'Ticket de venta', showLogo = false, test = false }: Props) {
  return (
    <div className="ticket">
      {test && <p className="ticket-status">PRUEBA · SIN VALOR DE VENTA</p>}
      {venta.cancelada && <p className="ticket-status">CANCELADO</p>}
      <div className="ticket-header">
        {showLogo && (
          <Image src={CONFIG.logo} alt="Logo" width={100} height={45}
            className="ticket-logo" loading="eager" />
        )}
        <p className="ticket-business-name">{businessName}</p>
        {CONFIG.direccion && <p>{CONFIG.direccion}</p>}
        {CONFIG.telefono && <p>Tel: {CONFIG.telefono}</p>}
        <div className="ticket-divider" />
        <div className="ticket-hours">
          {CONFIG.horarios.map(({ dia, hora }) => (
            <Fragment key={dia}><span>{dia}</span><span>{hora}</span></Fragment>
          ))}
        </div>
        <div className="ticket-divider" />
        {CONFIG.rfc && <p>RFC: {CONFIG.rfc}</p>}
        <p>{CONFIG.regimenFiscal}</p>
      </div>

      <div className="ticket-row">
        <span>Folio:</span>
        <strong>{venta.folio}</strong>
      </div>
      <div className="ticket-row">
        <span>Fecha:</span>
        <span>{formatDateTime(venta.fechaVenta)}</span>
      </div>
      <div className="ticket-divider" />
      <p>Cliente: {venta.cliente.nombre}</p>
      {venta.cliente.telefono && <p>Tel: {venta.cliente.telefono}</p>}
      <div className="ticket-divider" />

      <div className="ticket-items">
        {venta.items.map((item, index) => (
          <article className="ticket-item" key={index}>
            <p>
              {item.tipo === 'producto'
                ? `${item.llantaSnapshot.marca} ${item.llantaSnapshot.modelo} ${item.llantaSnapshot.medida}`.trim()
                : item.servicioNombre}
            </p>
            <div className="ticket-row">
              <span>{item.cantidad} × {formatCurrency(item.precioUnitario)}</span>
              <span>{formatCurrency(item.subtotal)}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="ticket-divider" />

      {/* Preserve the amounts recorded on the original sale. */}
      <div className="ticket-row">
        <span>Subtotal:</span>
        <span>{formatCurrency(venta.subtotal)}</span>
      </div>
      <div className="ticket-row">
        <span>{venta.ivaPolitica === 'incluido_16' ? 'IVA (16% incluido):' : 'IVA registrado:'}</span>
        <span>{formatCurrency(venta.iva)}</span>
      </div>
      <div className="ticket-row ticket-total">
        <span>TOTAL:</span>
        <span>{formatCurrency(venta.total)}</span>
      </div>
      <div className="ticket-row">
        <span>Método de pago:</span>
        <span>{venta.metodoPago}</span>
      </div>

      {venta.facturada && venta.factura && (
        <>
          <div className="ticket-divider" />
          <div className="ticket-footer">
            <strong>FACTURADO</strong>
            <p>UUID: {venta.factura.uuid}</p>
          </div>
        </>
      )}
      <div className="ticket-divider" />
      <TicketBarcode id={venta.id} kind={venta.storageKind ?? 'ventas'} />
      <div className="ticket-footer">
        <p>¡Gracias por su compra!</p>
        <p>Conserve este ticket para cualquier aclaración</p>
        {test && (
          <>
            <div className="ticket-divider" />
            <p>ABCDEFGHIJKLMNÑOPQRSTUVWXYZ</p>
            <p>abcdefghijklmnñopqrstuvwxyz</p>
            <p>Á É Í Ó Ú · á é í ó ú</p>
            <p>0123456789 · $ % + - /</p>
            <strong>SIN VALOR DE VENTA</strong>
          </>
        )}
      </div>
    </div>
  );
}
