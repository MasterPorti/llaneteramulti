import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin - Llanta Usada',
  description: 'Panel de administración',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
