'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CONFIG } from '@/lib/config';
import {
  Home,
  Package,
  Plus,
  ShoppingCart,
  PlusCircle,
  BarChart3,
  Wrench,
  Warehouse,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface MenuItem {
  label: string;
  href: string;
  icon: LucideIcon;
  indent?: boolean;
}

const menuItems: MenuItem[] = [
  {
    label: 'Inicio',
    href: '/',
    icon: Home,
  },
  {
    label: 'Inventario',
    href: '/inventario',
    icon: Package,
  },
  {
    label: '+ Nueva Llanta',
    href: '/inventario/nuevo',
    icon: Plus,
    indent: true,
  },
  {
    label: 'Ventas',
    href: '/ventas',
    icon: ShoppingCart,
  },
  {
    label: 'Servicio',
    href: '/ventas/servicio',
    icon: Wrench,
    indent: true,
  },
  {
    label: 'Venta Llantas',
    href: '/ventas/llantas',
    icon: PlusCircle,
    indent: true,
  },
  {
    label: 'Servicios',
    href: '/servicios',
    icon: Wrench,
  },
  {
    label: 'Reportes',
    href: '/reportes',
    icon: BarChart3,
  },
];

const adminItems: MenuItem[] = [
  {
    label: 'Admin',
    href: '/admin',
    icon: LayoutDashboard,
  },
  {
    label: 'Bodegas',
    href: '/admin/bodegas',
    icon: Warehouse,
    indent: true,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load collapsed state from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') {
      setCollapsed(true);
    }
    setMounted(true);
  }, []);

  // Save collapsed state to localStorage
  const toggleCollapsed = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', String(newState));
  };

  // Prevent hydration mismatch by rendering full sidebar until mounted
  if (!mounted) {
    return (
      <aside className="sidebar no-print">
        <div className="sidebar-header">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-200 rounded-lg animate-pulse" />
            <div>
              <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
              <div className="h-3 w-32 bg-gray-200 rounded animate-pulse mt-1" />
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (collapsed) {
    return (
      <button
        onClick={toggleCollapsed}
        className="fixed top-4 left-4 z-50 p-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 no-print"
        title="Mostrar menu"
      >
        <PanelLeftOpen className="w-5 h-5 text-gray-600" />
      </button>
    );
  }

  return (
    <aside className="sidebar no-print">
      <div className="sidebar-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src={CONFIG.logo}
              alt={CONFIG.nombreNegocio}
              width={48}
              height={48}
              className="rounded-lg"
            />
            <div>
              <h1 className="text-lg font-bold text-gray-800">{CONFIG.nombreNegocio}</h1>
              <p className="text-xs text-gray-500">Sistema de Inventario</p>
            </div>
          </div>
          <button
            onClick={toggleCollapsed}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            title="Ocultar menu"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>
      </div>
      <nav className="sidebar-nav">
        <div className="flex flex-col gap-1 px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const hrefPath = item.href.split('?')[0];
            const isActive =
              hrefPath === '/'
                ? pathname === '/'
                : pathname === hrefPath || pathname.startsWith(hrefPath + '/');

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-all duration-150
                  ${item.indent ? 'ml-6' : ''}
                  ${
                    isActive
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }
                `}
              >
                <Icon className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'text-gray-900' : 'text-gray-400'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Admin section */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex flex-col gap-1 px-3">
            {adminItems.map((item) => {
              const Icon = item.icon;
              const hrefPath = item.href.split('?')[0];
              const isActive =
                pathname === hrefPath || pathname.startsWith(hrefPath + '/');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-all duration-150
                    ${item.indent ? 'ml-6' : ''}
                    ${
                      isActive
                        ? 'bg-amber-50 text-amber-900 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'text-amber-600' : 'text-gray-400'}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
      <div className="p-4 border-t border-gray-200 text-xs text-gray-500">
        v1.0.0
      </div>
    </aside>
  );
}
