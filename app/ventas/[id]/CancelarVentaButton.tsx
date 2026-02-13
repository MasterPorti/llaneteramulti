'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Input } from '@/components/ui';
import { cancelarVenta } from '../actions';

interface Props {
  id: string;
}

export function CancelarVentaButton({ id }: Props) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCancelar = async () => {
    if (!motivo.trim()) {
      alert('Ingresa el motivo de la cancelación');
      return;
    }

    setLoading(true);
    const result = await cancelarVenta(id, motivo.trim());

    if (result.success) {
      setShowModal(false);
      router.refresh();
    } else {
      alert(result.error || 'Error al cancelar');
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="danger" onClick={() => setShowModal(true)}>
        Cancelar Venta
      </Button>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Cancelar Venta"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              No, Volver
            </Button>
            <Button
              variant="danger"
              onClick={handleCancelar}
              loading={loading}
              disabled={!motivo.trim()}
            >
              Sí, Cancelar Venta
            </Button>
          </>
        }
      >
        <p className="mb-4">
          ¿Estás seguro de que deseas cancelar esta venta? El stock será devuelto al inventario.
        </p>
        <Input
          label="Motivo de la cancelación"
          name="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej: Cliente solicitó devolución"
          required
        />
      </Modal>
    </>
  );
}
