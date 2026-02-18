import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '../globals.css';
import './globals-sistema.css';
import { SistemaSidebar } from '@/components/layout/SistemaSidebar';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

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
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <div className="flex min-h-screen bg-[var(--bg-primary)]">
          <SistemaSidebar />
          <main className="flex-1 overflow-y-auto p-4 pt-16 md:p-6 md:pt-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
