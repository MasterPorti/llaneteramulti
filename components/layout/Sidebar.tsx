"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CONFIG } from "@/lib/config";
import {
  Home,
  Package,
  Plus,
  ShoppingCart,
  Wrench,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  ShoppingBag,
  History,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface MenuItem {
  label: string;
  href: string;
  icon: LucideIcon;
  indent?: boolean;
  exact?: boolean;
}

const menuItems: MenuItem[] = [
  {
    label: "Inicio",
    href: "/",
    icon: Home,
  },
  {
    label: "Venta",
    href: "/ventas/servicio",
    icon: ShoppingCart,
  },
  {
    label: "Historia de ventas",
    href: "/ventas",
    icon: History,
    exact: true,
  },
  {
    label: "Productos",
    href: "/productos",
    icon: ShoppingBag,
  },
  {
    label: "Nuevo Producto",
    href: "/productos/nuevo",
    icon: Plus,
    indent: true,
  },
  {
    label: "Servicios",
    href: "/servicios",
    icon: Wrench,
  },
  {
    label: "Nuevo Servicio",
    href: "/servicios/nuevo",
    icon: Plus,
    indent: true,
  },
  {
    label: "Llantas",
    href: "/llantas",
    icon: Package,
  },
  {
    label: "Nueva Llanta",
    href: "/llantas/nuevo",
    icon: Plus,
    indent: true,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load collapsed state from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") {
      setCollapsed(true);
    }
    setMounted(true);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // Save collapsed state to localStorage
  const toggleCollapsed = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem("sidebar-collapsed", String(newState));
  };

  const renderNavItems = (items: MenuItem[], isAdmin = false) => {
    return items.map((item) => {
      const Icon = item.icon;
      const hrefPath = item.href.split("?")[0];
      const isActive =
        hrefPath === "/" || item.exact
          ? pathname === hrefPath
          : pathname === hrefPath || pathname.startsWith(hrefPath + "/");

      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          className={`
            flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-all duration-150
            ${item.indent ? "ml-6" : ""}
            ${
              isActive
                ? isAdmin
                  ? "bg-amber-50 text-amber-900 font-medium"
                  : "bg-gray-100 text-gray-900 font-medium"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }
          `}
        >
          <Icon
            className={`w-4.5 h-4.5 shrink-0 ${
              isActive
                ? isAdmin
                  ? "text-amber-600"
                  : "text-gray-900"
                : "text-gray-400"
            }`}
          />
          <span>{item.label}</span>
        </Link>
      );
    });
  };

  const sidebarContent = (
    <>
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
              <h1 className="text-lg font-bold text-gray-800">
                {CONFIG.nombreNegocio}
              </h1>
              <p className="text-xs text-gray-500">Sistema de Inventario</p>
            </div>
          </div>
          {/* Desktop collapse button */}
          <button
            onClick={toggleCollapsed}
            className="hidden md:block p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            title="Ocultar menu"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
          {/* Mobile close button */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <nav className="sidebar-nav">
        <div className="flex flex-col gap-1 px-3">
          {renderNavItems(menuItems)}
        </div>
      </nav>
      <div className="p-4 border-t border-gray-200 text-xs text-gray-500">
        v1.0.0
      </div>
    </>
  );

  // Prevent hydration mismatch by rendering skeleton until mounted
  if (!mounted) {
    return (
      <>
        {/* Mobile menu button skeleton - hidden on desktop via CSS */}
        <div className="mobile-menu-btn">
          <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
        </div>
        {/* Desktop sidebar skeleton - hidden on mobile via CSS */}
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
      </>
    );
  }

  return (
    <>
      {/* Mobile menu button - hidden on desktop via CSS */}
      <button
        onClick={() => setMobileOpen(true)}
        className="mobile-menu-btn no-print"
        aria-label="Abrir menú"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay - hidden on desktop via CSS */}
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile sidebar - hidden on desktop via CSS */}
      <aside className={`sidebar-mobile no-print ${mobileOpen ? "open" : ""}`}>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar - hidden on mobile via CSS */}
      {collapsed ? (
        <button
          onClick={toggleCollapsed}
          className="desktop-collapse-btn no-print"
          title="Mostrar menu"
        >
          <PanelLeftOpen className="w-5 h-5 text-gray-600" />
        </button>
      ) : (
        <aside className="sidebar no-print">{sidebarContent}</aside>
      )}
    </>
  );
}
