"use client";

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, Input } from '@/components/ui';
import type { Venta } from '@/types';
import { TicketPrint } from '../ventas/[id]/TicketPrint';

// A printable fixture only: no sale action or database connection is used here.
const sampleDate = '2026-01-01T18:00:00.000Z';
const sampleSale: Venta = {
  id: 'ticket-prueba-blanca',
  storageKind: 'ventas',
  folio: 'PRUEBA-SIN-VENTA',
  cliente: { nombre: 'Cliente de prueba' },
  items: [{
    tipo: 'servicio', servicioId: 'prueba', servicioNombre: 'Servicio de prueba',
    cantidad: 2, precioUnitario: 58, subtotal: 116,
  }],
  subtotal: 100, iva: 16, total: 116, ivaPolitica: 'incluido_16',
  metodoPago: 'efectivo', fechaVenta: sampleDate,
  ticketGenerado: false, facturada: false, cancelada: false,
  garantia: { activa: false, fechaInicio: '', fechaFin: '', diasGarantia: 0, condiciones: '' },
  createdAt: sampleDate, updatedAt: sampleDate,
};

export default function TestPrinterPage() {
  const [nombreNegocio, setNombreNegocio] = useState('Ticket de venta');
  const [mostrarLogo, setMostrarLogo] = useState(false);
  return (
    <div className="printer-test-page">
      <div className="no-print">
        <PageHeader title="Prueba de impresión" subtitle="Ticket térmico de 80 mm." />
        <Card className="mb-6">
          <CardBody>
            <div className="max-w-lg">
              <Input name="nombreNegocio" label="Encabezado del ticket" value={nombreNegocio}
                onChange={(event) => setNombreNegocio(event.target.value)} />
              <label className="flex items-center gap-2 text-sm mb-4">
                <input type="checkbox" checked={mostrarLogo} onChange={(event) => setMostrarLogo(event.target.checked)} />
                Mostrar logo en gris
              </label>
              <Button type="button" onClick={() => window.print()}>
                <Printer className="w-4 h-4" />
                Imprimir ticket de prueba
              </Button>
              <p className="text-sm text-gray-500 mt-3">Esta prueba no registra una venta.</p>
            </div>
          </CardBody>
        </Card>
        <p className="text-sm text-gray-500 mb-3">Vista previa · 80 mm</p>
      </div>
      <div className="ticket-preview-container printer-test-preview">
        <TicketPrint venta={sampleSale} businessName={nombreNegocio} showLogo={mostrarLogo} test />
      </div>
      <style jsx global>{`
        .printer-test-preview { width: 80mm; max-width: 100%; padding: 0; }
        @media print {
          .printer-test-page { width: 80mm !important; max-width: 80mm !important; margin: 0 !important; }
        }
      `}</style>
    </div>
  );
}
