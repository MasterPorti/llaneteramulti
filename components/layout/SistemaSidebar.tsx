'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Home,
  Package,
  Plus,
  ShoppingCart,
  ArrowRightLeft,
  Shield,
  History,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Warehouse,
} from 'lucide-react';
import { SISTEMA_CONFIG } from '@/lib/config-sistema';

interface MenuItem {
  label: string;
  href: string;
  icon: React.ElementType;
  indent?: boolean;
}

const menuItems: MenuItem[] = [
  { label: 'Inicio', href: '/inventario', icon: Home },
  { label: 'Inventario', href: '/inventario/inventario', icon: Package },
  { label: 'Agregar Llanta', href: '/inventario/inventario/nuevo', icon: Plus, indent: true },
  { label: 'Bodegas', href: '/inventario/bodegas', icon: Warehouse },
  { label: 'Mover Stock', href: '/inventario/bodegas/mover', icon: ArrowRightLeft, indent: true },
  { label: 'Ventas', href: '/inventario/ventas', icon: ShoppingCart },
  { label: 'Nueva Venta', href: '/inventario/ventas/nueva', icon: Plus, indent: true },
  { label: 'Garantías', href: '/inventario/garantias', icon: Shield },
  { label: 'Historial', href: '/inventario/historial', icon: History },
];

export function SistemaSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Load collapsed state from localStorage
  useEffect(() => {
    const savedCollapsed = localStorage.getItem('sistema-sidebar-collapsed');
    if (savedCollapsed) {
      setCollapsed(JSON.parse(savedCollapsed));
    }
  }, []);

  // Save collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('sistema-sidebar-collapsed', JSON.stringify(collapsed));
  }, [collapsed]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === '/inventario') return pathname === '/inventario';
    return pathname.startsWith(href);
  };

  const SidebarContent = () => (
    <>
      {/* Header */}
      <div className="sidebar-header p-4 flex items-center gap-3 border-b border-[var(--border-color)]">
        <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-white flex-shrink-0">
          <Image
            src={SISTEMA_CONFIG.logo}
            alt="Logo"
            fill
            className="object-cover"
          />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-[var(--text-primary)] truncate">
              {SISTEMA_CONFIG.nombreNegocio}
            </h1>
            <p className="text-xs text-[var(--text-muted)]">Gestión de Inventario</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav flex-1 p-2 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                sidebar-link flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-all
                ${item.indent ? 'ml-4' : ''}
                ${active
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-l-3 border-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }
              `}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${item.indent ? 'w-4 h-4' : ''}`} />
              {!collapsed && (
                <span className={`truncate ${item.indent ? 'text-sm' : ''}`}>
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--border-color)]">
        {!collapsed && (
          <p className="text-xs text-[var(--text-muted)] text-center">
            Sistema Inventario v1.0
          </p>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="mobile-menu-btn-sistema md:hidden"
        aria-label="Abrir menú"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-[280px] z-40
          bg-[var(--bg-secondary)] border-r border-[var(--border-color)]
          transform transition-transform duration-300 ease-in-out
          md:hidden flex flex-col
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <SidebarContent />
      </aside>

      {/* Desktop Sidebar */}
      <aside
        className={`
          hidden md:flex flex-col h-screen sticky top-0
          bg-[var(--bg-secondary)] border-r border-[var(--border-color)]
          transition-all duration-300 ease-in-out
          ${collapsed ? 'w-[70px]' : 'w-[260px]'}
        `}
      >
        <SidebarContent />

        {/* Collapse Button */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full
            bg-[var(--bg-tertiary)] border border-[var(--border-color)]
            flex items-center justify-center text-[var(--text-secondary)]
            hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]
            transition-colors z-10"
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </aside>
    </>
  );
}
