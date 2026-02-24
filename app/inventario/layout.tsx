import type { Metadata, Viewport } from 'next';
import './globals-sistema.css';
import { SistemaSidebar } from '@/components/layout/SistemaSidebar';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'Sistema Inventario - Llanta Usada',
  description: 'Sistema de gestión de inventario de llantas',
};

export default function SistemaLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="sistema-app flex min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <SistemaSidebar />
      <main className="flex-1 overflow-y-auto p-4 pt-16 md:p-6 md:pt-6">
        {children}
      </main>
    </div>
  );
}
