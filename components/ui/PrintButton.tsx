'use client';

import { Button } from './Button';

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="no-print">
      Imprimir
    </Button>
  );
}
