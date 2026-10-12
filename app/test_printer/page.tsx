'use client';

import { Fragment, useState } from 'react';
import Image from 'next/image';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, Input } from '@/components/ui';
import { CONFIG } from '@/lib/config';

export default function TestPrinterPage() {
  const [nombreNegocio, setNombreNegocio] = useState<string>(CONFIG.nombreNegocio);
  const [mostrarLogo, setMostrarLogo] = useState(true);

  return (
    <div className="printer-test-page">
      <div className="no-print">
        <PageHeader title="Prueba de impresión" subtitle="Configura y revisa un ticket de prueba para papel térmico de 80 mm." />
        <Card className="mb-6">
          <CardBody>
            <div className="max-w-lg">
              <Input name="nombreNegocio" label="Nombre del negocio" value={nombreNegocio}
                onChange={(event) => setNombreNegocio(event.target.value)} />
              <label className="flex items-center gap-2 text-sm mb-4">
                <input type="checkbox" checked={mostrarLogo} onChange={(event) => setMostrarLogo(event.target.checked)} />
                Mostrar logo
              </label>
              <Button type="button" onClick={() => window.print()}>
                <Printer className="w-4 h-4" />
                Imprimir Ticket de Prueba
              </Button>
              <p className="text-sm text-gray-500 mt-3">Esta prueba no registra una venta ni modifica los datos del negocio.</p>
            </div>
          </CardBody>
        </Card>
        <p className="text-sm text-gray-500 mb-3">Vista previa · 80 mm</p>
      </div>

      <div className="ticket-preview-container printer-test-preview">
        <div className="ticket" id="printer-test-ticket">
          <div className="text-center mb-3">
            <p className="font-bold">PRUEBA DE IMPRESIÓN</p>
            <p className="font-bold">SIN VALOR DE VENTA</p>
          </div>
          <div className="ticket-header">
            {mostrarLogo && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '3mm' }}>
                <Image src={CONFIG.logo} alt="Logo del negocio" width={100} height={45} loading="eager"
                  style={{ objectFit: 'contain', maxWidth: '100%', height: 'auto' }} />
              </div>
            )}
            <p style={{ fontSize: '12pt', fontWeight: 900, letterSpacing: '0.03em', overflowWrap: 'anywhere' }}>{nombreNegocio}</p>
            <p style={{ fontSize: '7.5pt', marginTop: '1mm' }}>{CONFIG.direccion}</p>
            <p style={{ fontSize: '8pt' }}>Tel: {CONFIG.telefono}</p>
            <div className="ticket-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '4mm', rowGap: '0.5mm', fontSize: '7.5pt', textAlign: 'left' }}>
              {CONFIG.horarios.map(({ dia, hora }) => (
                <Fragment key={dia}><span style={{ fontWeight: 700 }}>{dia}</span><span>{hora}</span></Fragment>
              ))}
            </div>
            <div className="ticket-divider" />
            <p style={{ fontSize: '7.5pt' }}><strong>RFC:</strong> {CONFIG.rfc}</p>
            <p style={{ fontSize: '7pt' }}>{CONFIG.regimenFiscal}</p>
          </div>

          <p className="text-center font-bold">Muestra de caracteres</p>
          <p style={{ overflowWrap: 'anywhere', marginTop: '2mm' }}>ABCDEFGHIJKLMNÑOPQRSTUVWXYZ</p>
          <p style={{ overflowWrap: 'anywhere' }}>abcdefghijklmnñopqrstuvwxyz</p>
          <p>Á É Í Ó Ú · á é í ó ú</p>
          <p>0123456789 · $ % + - /</p>
          <div className="ticket-divider" />
          <div className="ticket-row"><span>Izquierda</span><span>Derecha</span></div>
          <p className="text-center" style={{ marginTop: '2mm' }}>Texto centrado</p>
          <div className="ticket-divider" />
          <div className="text-center">
            <p className="font-bold">FIN DE LA PRUEBA</p>
            <p className="font-bold">SIN VALOR DE VENTA</p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .printer-test-preview { width: 80mm; max-width: 100%; padding: 0; }
        @media print {
          main { padding: 0 !important; overflow: visible !important; }
          .printer-test-page, .printer-test-preview, #printer-test-ticket {
            width: 80mm !important; max-width: 80mm !important; margin: 0 !important;
          }
          #printer-test-ticket { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
