import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sistema Punto de Venta',
    short_name: 'Sistema PdV',
    description: 'Sistema Punto de Venta - Llanta Usada',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111827',
    orientation: 'portrait',
    icons: [
      {
        src: '/images/logo.jpeg',
        sizes: '192x192',
        type: 'image/jpeg',
      },
      {
        src: '/images/logo.jpeg',
        sizes: '512x512',
        type: 'image/jpeg',
        purpose: 'maskable',
      },
    ],
  };
}
