import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Llanta Usada',
    short_name: 'Llanta Usada',
    description: 'Sistema de administración de inventario para Llanta Usada',
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
