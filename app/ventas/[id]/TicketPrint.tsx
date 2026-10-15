import { Fragment } from 'react';
import { TicketBarcode } from '@/components/tickets/TicketBarcode';
import Image from 'next/image';
import { CONFIG } from '@/lib/config';
import { formatCurrency, formatDateTime } from '@/lib/utils/formatters';
import { descripcionTipoPartida } from '@/lib/utils/venta-item';
import type { Venta } from '@/types';

interface Props {
  venta: Venta;
}

export function TicketPrint({ venta }: Props) {
  return (
    <div className="ticket">
      <div className="ticket-header">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '3mm' }}>
          <Image src={CONFIG.logo} alt="Logo" width={100} height={45}
            style={{ objectFit: 'contain', maxWidth: '100%', height: 'auto' }} />
        </div>
        <p style={{ fontSize: '12pt', fontWeight: 900, letterSpacing: '0.03em' }}>{CONFIG.nombreNegocio}</p>
        {CONFIG.direccion && <p style={{ fontSize: '7.5pt', marginTop: '1mm' }}>{CONFIG.direccion}</p>}
        {CONFIG.telefono && <p style={{ fontSize: '8pt' }}>Tel: {CONFIG.telefono}</p>}
        <div className="ticket-divider" />
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '4mm', rowGap: '0.5mm', fontSize: '7.5pt', textAlign: 'left' }}>
          {CONFIG.horarios.map(({ dia, hora }) => (
            <Fragment key={dia}><span style={{ fontWeight: 700 }}>{dia}</span><span>{hora}</span></Fragment>
          ))}
        </div>
        <div className="ticket-divider" />
        {CONFIG.rfc && <p style={{ fontSize: '7.5pt' }}><strong>RFC:</strong> {CONFIG.rfc}</p>}
        <p style={{ fontSize: '7pt', color: '#444' }}>{CONFIG.regimenFiscal}</p>
      </div>

      <div className="ticket-row">
        <span>Folio:</span>
        <span className="font-bold">{venta.folio}</span>
      </div>
      <div className="ticket-row">
        <span>Fecha:</span>
        <span>{formatDateTime(venta.fechaVenta)}</span>
      </div>

      <div className="ticket-divider" />

      <div className="mb-2">
        <p><strong>Cliente:</strong> {venta.cliente.nombre}</p>
        {venta.cliente.telefono && <p>Tel: {venta.cliente.telefono}</p>}
      </div>

      <div className="ticket-divider" />

      <table className="w-full text-left mb-2">
        <thead>
          <tr>
            <th className="font-normal">Concepto</th>
            <th className="font-normal text-right">Cant</th>
            <th className="font-normal text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {venta.items.map((item, index) => (
            <tr key={index}>
              <td>
                {item.tipo === 'producto' ? (
                  <>
                    <div className="text-xs">
                      {item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}
                    </div>
                    <div className="text-xs text-gray-600">
                      {item.llantaSnapshot.medida} @ {formatCurrency(item.precioUnitario)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs">{item.servicioNombre}</div>
                    <div className="text-xs text-gray-600">
                      {descripcionTipoPartida(item)} @ {formatCurrency(item.precioUnitario)}
                    </div>
                  </>
                )}
              </td>
              <td className="text-right align-top">{item.cantidad}</td>
              <td className="text-right align-top">{formatCurrency(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ticket-divider" />

      {/* El ticket usa los importes registrados, igual que el reporte y el CSV. */}
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

      <div className="ticket-row mt-2">
        <span>Metodo de pago:</span>
        <span className="capitalize">{venta.metodoPago}</span>
      </div>

      {venta.facturada && venta.factura && (
        <>
          <div className="ticket-divider" />
          <div className="text-center">
            <p className="font-bold">FACTURADO</p>
            <p className="text-xs">UUID: {venta.factura.uuid}</p>
          </div>
        </>
      )}

      <div className="ticket-divider" />

      <TicketBarcode id={venta.id}/>
      <div className="text-center mt-2">
        <p>Gracias por su compra!</p>
        <p className="text-xs text-gray-600 mt-1">
          Conserve este ticket para cualquier aclaracion
        </p>
      </div>
    </div>
  );
}
