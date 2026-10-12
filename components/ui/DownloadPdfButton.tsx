'use client';

import { useRef, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { PdfReport } from '@/lib/reports/data';

interface DownloadPdfButtonProps {
  getReport: () => PdfReport;
  disabled?: boolean;
  className?: string;
}

export function DownloadPdfButton({ getReport, disabled, className = '' }: DownloadPdfButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  const handleDownload = async () => {
    if (disabled || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      // Capture the displayed selection before loading the PDF engine.
      const report = getReport();
      const { downloadReportPdf } = await import('@/lib/reports/pdf');
      await downloadReportPdf(report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        className={`btn btn-secondary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
        disabled={disabled || loading}
        aria-busy={loading}
        onClick={handleDownload}
      >
        {loading ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {loading ? 'Generando PDF...' : 'Descargar PDF'}
      </button>
      {error && <p role="alert" className="max-w-sm text-sm text-red-700">{error}</p>}
    </div>
  );
}
