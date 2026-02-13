"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@/components/ui";
import { facturarVenta } from "../actions";

interface Props {
  id: string;
}

export function FacturarVentaButton({ id }: Props) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFacturar = async () => {
    setLoading(true);
    const result = await facturarVenta(id);

    if (result.success) {
      setShowModal(false);
      router.refresh();
    } else {
      alert(result.error || "Error al facturar");
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Generar Factura (CFDI)"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleFacturar} loading={loading}>
              Generar Factura
            </Button>
          </>
        }
      >
        <p>¿Deseas generar la factura (CFDI) para esta venta?</p>
        <p className="text-sm text-gray-500 mt-2">
          Se utilizará la integración con Factura Digital configurada.
        </p>
      </Modal>
    </>
  );
}
