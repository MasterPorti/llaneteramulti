import { Suspense } from 'react';
import NuevaVentaContent from '../NuevaVentaContent';

export default function NuevaVentaPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
        <span className="ml-3 text-gray-500">Cargando...</span>
      </div>
    }>
      <NuevaVentaContent />
    </Suspense>
  );
}
