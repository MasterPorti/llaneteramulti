import { CONFIG } from '@/lib/config';
import { formatCurrency, formatDateTime } from '@/lib/utils/formatters';
import type { Venta } from '@/types';

interface Props {
  venta: Venta;
}

export function TicketPrint({ venta }: Props) {
  return (
    <div className="ticket">
      <div className="ticket-header">
        <p className="text-lg font-bold">{CONFIG.nombreNegocio}</p>
        {CONFIG.direccion && <p>{CONFIG.direccion}</p>}
        {CONFIG.telefono && <p>Tel: {CONFIG.telefono}</p>}
        {CONFIG.rfc && <p>RFC: {CONFIG.rfc}</p>}
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
            <th className="font-normal text-right">Total</th>
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
                      Servicio @ {formatCurrency(item.precioUnitario)}
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

      <div className="text-center mt-2">
        <p>Gracias por su compra!</p>
        <p className="text-xs text-gray-600 mt-1">
          Conserve este ticket para cualquier aclaracion
        </p>
      </div>
    </div>
  );
}
