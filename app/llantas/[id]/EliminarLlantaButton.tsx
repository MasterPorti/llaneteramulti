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
        Eliminar
      </Button>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Confirmar Eliminación"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleEliminar} loading={loading}>
              Sí, Eliminar
            </Button>
          </>
        }
      >
        <p>¿Estás seguro de que deseas eliminar esta llanta del inventario?</p>
        <p className="text-sm text-gray-500 mt-2">
          Esta acción no se puede deshacer.
        </p>
      </Modal>
    </>
  );
}
