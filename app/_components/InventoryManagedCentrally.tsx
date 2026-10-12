import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Card, CardBody } from '@/components/ui';

export default function InventoryManagedCentrally() {
  return (
    <div>
      <PageHeader title="Inventario de llantas" />
      <Card>
        <CardBody>
          <p className="mb-4">Las llantas se administran en Sistema Inventario.</p>
          <Link href="/llantas" className="btn btn-secondary inline-flex">
            Consultar llantas NEW TIRES
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
