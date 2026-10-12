'use client';

import { Trash2 } from 'lucide-react';

export function DesactivarLlantaButton() {
  return (
    <button
      type="submit"
      className="btn btn-danger flex items-center gap-2"
      onClick={(event) => {
        if (!confirm('¿Desactivar esta llanta? Se conservará su historial.')) event.preventDefault();
      }}
    >
      <Trash2 className="w-4 h-4" />
      Desactivar
    </button>
  );
}
