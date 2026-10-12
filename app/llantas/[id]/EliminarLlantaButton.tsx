'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal } from '@/components/ui';
import { eliminarLlanta } from '../actions';

interface Props {
  id: string;
}

export function EliminarLlantaButton({ id }: Props) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleEliminar = async () => {
    setLoading(true);
    const result = await eliminarLlanta(id);

    if (result.success) {
      router.push('/llantas');
    } else {
      alert(result.error || 'Error al eliminar');
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="danger" onClick={() => setShowModal(true)}>
        Desactivar
      </Button>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Confirmar desactivación"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleEliminar} loading={loading}>
              Sí, desactivar
            </Button>
          </>
        }
      >
        <p>¿Deseas retirar esta llanta del inventario activo?</p>
        <p className="text-sm text-gray-500 mt-2">
          El registro y su historial se conservarán para consulta.
        </p>
      </Modal>
    </>
  );
}
