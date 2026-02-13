'use client';

import { useState } from 'react';
import { getApiKeyAction } from './action';

export default function GetKeyPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setResult(null);
    try {
      const res = await getApiKeyAction(formData);
      setResult(res);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  // Helper to extract key from various possible response formats
  const apiKey = result?.data?.x_api_key || result?.data?.api_key;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 from-blue-50 to-indigo-50 p-6">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-lg border border-gray-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Factura Digital</h1>
          <p className="text-sm text-gray-500 mt-2 font-medium">Sandbox API Key Retrieval</p>
        </div>
        
        <form action={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">Usuario (RFC / Alias)</label>
            <input
              name="user"
              type="text"
              required
              className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-gray-800 placeholder-gray-400 font-medium"
              placeholder="Ej. BAXX010101000"
            />
          </div>
          
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">Contraseña Sandbox</label>
            <input
              name="pass"
              type="password"
              required
              className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all text-gray-800 placeholder-gray-400 font-medium"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-500/30 transform transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Conectando...
              </span>
            ) : 'Obtener API Key'}
          </button>
        </form>

        {result && (
          <div className={`mt-8 p-6 rounded-xl border ${apiKey ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            {apiKey ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-700 font-bold text-lg">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span>¡Identificación Exitosa!</span>
                </div>
                <div className="bg-white p-4 rounded-lg border border-green-200 shadow-sm relative group cursor-pointer" onClick={() => navigator.clipboard.writeText(apiKey)}>
                  <p className="text-xs text-green-600 font-semibold uppercase mb-1">Tu API Key</p>
                  <p className="font-mono text-gray-800 break-all text-sm">{apiKey}</p>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 text-white text-xs px-2 py-1 rounded">Copiar</div>
                </div>
                <p className="text-xs text-green-800 leading-relaxed">
                  Copia esta llave y agrégala a tu archivo <code className="bg-green-100 px-1 rounded font-bold">.env</code>:
                  <br />
                  <code className="block mt-1 p-2 bg-green-900/10 rounded">FACTURA_DIGITAL_API_KEY={apiKey}</code>
                </p>
              </div>
            ) : (
              <div className="space-y-2 text-red-700">
                <div className="flex items-center gap-2 font-bold">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span>Error en la consulta</span>
                </div>
                <p className="text-sm">No se pudo obtener la llave. Detalles:</p>
                <pre className="text-xs bg-red-100 p-2 rounded overflow-auto max-h-40">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
