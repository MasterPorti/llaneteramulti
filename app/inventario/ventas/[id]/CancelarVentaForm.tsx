'use client';

import { useRef } from 'react';
import { XCircle } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui';

interface Props {
  action: (formData: FormData) => Promise<void>;
}

export function CancelarVentaForm({ action }: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    if (!confirm('¿Estás seguro de cancelar esta venta? El stock será restaurado.')) {
      e.preventDefault();
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold flex items-center gap-2 text-red-400">
          <XCircle className="w-5 h-5" />
          Cancelar Venta
        </h2>
      </CardHeader>
      <CardBody>
        <form ref={formRef} action={action} onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="label">Motivo de cancelación</label>
            <textarea
              name="motivo"
              className="input w-full"
              rows={3}
              placeholder="Escribe el motivo..."
              required
            />
          </div>
          <button type="submit" className="btn btn-danger w-full">
            Cancelar Venta
          </button>
        </form>
      </CardBody>
    </Card>
  );
}
