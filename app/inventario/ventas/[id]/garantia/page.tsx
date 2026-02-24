import { notFound } from 'next/navigation';
import { obtenerVentaSistema } from '@/lib/data/sistema-ventas';
import { formatDate, formatCurrency } from '@/lib/utils/formatters';
import { AutoPrint } from './AutoPrint';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GarantiaPrintPage({ params }: PageProps) {
  const { id } = await params;
  const venta = await obtenerVentaSistema(id);

  if (!venta) notFound();

  const { garantia, cliente, items, total, folio } = venta;

  // Split conditions into sections for structured rendering
  const condLines = garantia.condiciones.split('\n');

  return (
    <div>
      <AutoPrint />

      {/* Warranty Document */}
      <div
        id="garantia-print"
        style={{
          background: '#ffffff',
          color: '#1a1a1a',
          maxWidth: '794px',
          margin: '0 auto',
          fontFamily: '"Segoe UI", Arial, Helvetica, sans-serif',
          fontSize: '13px',
          lineHeight: '1.5',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          borderRadius: '6px',
          overflow: 'hidden',
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: '6px', background: 'linear-gradient(90deg, #111 0%, #444 100%)' }} />

        <div style={{ padding: '36px 44px 40px' }}>

          {/* Header: business info + logo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
            <div>
              <h1 style={{ margin: '0 0 4px 0', fontSize: '26px', fontWeight: '800', color: '#111', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Llanta Usada
              </h1>
              <p style={{ margin: '0', fontSize: '12px', color: '#666' }}>
                Venustiano Carranza S/N, Santiago Teyahualco
              </p>
              <p style={{ margin: '0', fontSize: '12px', color: '#666' }}>
                54980 Santiago Teyahualco, Méx.
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo.jpeg"
              alt="Logo"
              style={{ width: '72px', height: '72px', objectFit: 'contain', borderRadius: '8px' }}
            />
          </div>

          {/* Title band */}
          <div style={{
            background: '#111',
            color: '#fff',
            textAlign: 'center',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '28px',
          }}>
            <p style={{ margin: '0', fontSize: '11px', letterSpacing: '4px', color: '#aaa', textTransform: 'uppercase' }}>
              Documento oficial
            </p>
            <h2 style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: '700', letterSpacing: '3px', textTransform: 'uppercase' }}>
              Póliza de Garantía
            </h2>
          </div>

          {/* Info row: dates + ID */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '16px',
            marginBottom: '24px',
            padding: '16px 20px',
            background: '#f7f7f7',
            borderRadius: '6px',
            border: '1px solid #e8e8e8',
          }}>
            <div>
              <p style={{ margin: '0 0 3px', fontSize: '10px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Fecha de emisión
              </p>
              <p style={{ margin: '0', fontSize: '13px', fontWeight: '600', color: '#111' }}>
                {formatDate(garantia.fechaInicio)}
              </p>
            </div>
            <div>
              <p style={{ margin: '0 0 3px', fontSize: '10px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Fecha de vencimiento
              </p>
              <p style={{ margin: '0', fontSize: '13px', fontWeight: '600', color: '#111' }}>
                {formatDate(garantia.fechaFin)}
              </p>
            </div>
            <div>
              <p style={{ margin: '0 0 3px', fontSize: '10px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Duración
              </p>
              <p style={{ margin: '0', fontSize: '13px', fontWeight: '600', color: '#111' }}>
                {garantia.diasGarantia} días
              </p>
            </div>
          </div>

          {/* Client + Folio row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', marginBottom: '24px', alignItems: 'start' }}>
            <div style={{ padding: '14px 18px', border: '1px solid #e8e8e8', borderRadius: '6px', background: '#fafafa' }}>
              <p style={{ margin: '0 0 6px', fontSize: '10px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Datos del cliente
              </p>
              <p style={{ margin: '0 0 3px', fontSize: '14px', fontWeight: '600', color: '#111' }}>
                {cliente.nombre || 'Cliente general'}
              </p>
              {cliente.telefono && (
                <p style={{ margin: '0', fontSize: '12px', color: '#555' }}>
                  Tel: {cliente.telefono}
                </p>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: '0 0 4px', fontSize: '10px', color: '#999', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Folio {folio}
              </p>
              <p style={{
                margin: '0',
                fontSize: '22px',
                fontWeight: '800',
                fontFamily: 'monospace',
                letterSpacing: '2px',
                color: '#111',
                background: '#f0f0f0',
                padding: '8px 14px',
                borderRadius: '6px',
                border: '1px solid #ddd',
              }}>
                {garantia.id}
              </p>
            </div>
          </div>

          {/* Products Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#111', color: '#fff' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', fontSize: '11px', letterSpacing: '0.5px', borderRadius: '0' }}>
                  Cód. Auxiliar
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', fontSize: '11px' }}>
                  Marca / Modelo
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', fontSize: '11px' }}>
                  Medida
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '600', fontSize: '11px' }}>
                  Cant.
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', fontSize: '11px' }}>
                  P. Unit.
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', fontSize: '11px' }}>
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: '1px solid #eee',
                    background: i % 2 === 0 ? '#ffffff' : '#fafafa',
                  }}
                >
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: '700', fontSize: '13px', color: '#333' }}>
                    {item.llantaSnapshot.codigoAuxiliar}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#222' }}>
                    {item.llantaSnapshot.marca} {item.llantaSnapshot.modelo}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#555' }}>
                    {item.llantaSnapshot.medida}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700' }}>
                    {item.cantidad}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#444' }}>
                    {formatCurrency(item.precioUnitario)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: '#111' }}>
                    {formatCurrency(item.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#111', color: '#fff' }}>
                <td colSpan={5} style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px', letterSpacing: '1px' }}>
                  TOTAL
                </td>
                <td style={{ padding: '12px', textAlign: 'right', fontWeight: '800', fontSize: '15px' }}>
                  {formatCurrency(total)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Terms and Conditions */}
          <div style={{ borderTop: '2px solid #eee', paddingTop: '20px' }}>
            <div style={{ fontSize: '11.5px', color: '#444', lineHeight: '1.7' }}>
              {condLines.map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={i} style={{ height: '8px' }} />;
                // Section headers (all caps lines)
                if (trimmed === trimmed.toUpperCase() && trimmed.length > 4) {
                  return (
                    <p key={i} style={{ margin: '0 0 6px', fontWeight: '700', color: '#111', fontSize: '11px', letterSpacing: '0.5px' }}>
                      {trimmed}
                    </p>
                  );
                }
                return (
                  <p key={i} style={{ margin: '0 0 3px', paddingLeft: /^\d+\./.test(trimmed) ? '4px' : '0' }}>
                    {trimmed}
                  </p>
                );
              })}
            </div>
          </div>

        </div>

        {/* Bottom accent bar */}
        <div style={{ height: '4px', background: 'linear-gradient(90deg, #111 0%, #444 100%)' }} />
      </div>
    </div>
  );
}
