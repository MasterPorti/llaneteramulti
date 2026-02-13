'use client';

import { useState } from 'react';
import { createInvoiceAction } from './action';

export default function GenerateInvoicePage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);
    try {
      const res = await createInvoiceAction();
      setResult(res);
    } catch (e: any) {
      setResult({ success: false, error: e.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 from-blue-50 to-indigo-50 p-6">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-lg border border-gray-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Generador de Facturas</h1>
          <p className="text-sm text-gray-500 mt-2 font-medium">Factura Digital Sandbox</p>
        </div>

        <div className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800">
            <p>Se generará una factura de prueba con los siguientes datos:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
              <li><strong>Receptor:</strong> PUBLICO EN GENERAL</li>
              <li><strong>Monto:</strong> $116.00 MXN</li>
              <li><strong>Concepto:</strong> Producto de Prueba Web</li>
            </ul>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-indigo-500/30 transform transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generando CFDI...
              </span>
            ) : 'Generar Factura Ahora'}
          </button>
        </div>

        {result && (
          <div className={`mt-8 p-6 rounded-xl border ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            {result.success ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-700 font-bold text-lg">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span>¡Factura Creada!</span>
                </div>
                
                <div className="space-y-2 text-sm text-gray-700">
                  <div className="flex justify-between border-b pb-2">
                    <span className="font-semibold">UUID:</span>
                    <span className="font-mono text-xs text-gray-600">{result.data?.uuid}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="font-semibold">Serie/Folio:</span>
                    <span>{result.data?.serie} - {result.data?.folio}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                    {result.data?.cfdi_xml && (
                         <a href={result.data.cfdi_xml} target="_blank" rel="noopener noreferrer" className="text-center bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-2 px-4 rounded shadow-sm text-sm">
                             Ver XML
                         </a>
                    )}
                    {result.data?.cfdi_pdf && (
                         <a href={result.data.cfdi_pdf} target="_blank" rel="noopener noreferrer" className="text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded shadow-sm text-sm">
                             Descargar PDF
                         </a>
                    )}
                </div>

                <div className="bg-green-100 p-3 rounded text-xs overflow-auto max-h-40">
                    <pre>{JSON.stringify(result.data, null, 2)}</pre>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-red-700">
                <div className="flex items-center gap-2 font-bold">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span>Error al Generar</span>
                </div>
                <p className="font-medium text-sm">{result.error}</p>
                {result.details && (
                    <pre className="text-xs bg-red-100 p-2 rounded overflow-auto max-h-40 mt-2">
                    {JSON.stringify(result.details, null, 2)}
                    </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
