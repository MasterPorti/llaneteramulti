"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Package } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { Card, CardBody, Badge } from "@/components/ui";
import { obtenerInventario } from "./actions";
import { formatCurrency } from "@/lib/utils/formatters";
import { getTotalStock, type Llanta } from "@/types";

export default function InventarioPage() {
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  const loadInventario = useCallback(async () => {
    setLoading(true);
    const result = await obtenerInventario();
    if (result.success && result.data) {
      setInventario(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadInventario();
  }, [loadInventario]);

  const inventarioFiltrado = inventario.filter((l) => {
    if (busqueda.trim()) {
      const term = busqueda.toLowerCase();
      return (
        l.marca.toLowerCase().includes(term) ||
        l.modelo.toLowerCase().includes(term) ||
        l.medida.toLowerCase().includes(term) ||
        l.proveedor.toLowerCase().includes(term) ||
        `${l.marca} ${l.modelo}`.toLowerCase().includes(term)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Inventario"
          subtitle="Catálogo de llantas disponibles"
        />
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
          <span className="ml-3 text-gray-500">Cargando inventario...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Inventario"
        subtitle={`${inventario.length} productos en catálogo`}
        actions={
          <Link href="/llantas/nuevo">
            <button className="btn btn-primary flex items-center gap-2">
              <Plus size={16} /> Nueva Llanta
            </button>
          </Link>
        }
      />

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            className="input"
            style={{ paddingLeft: "2.5rem" }}
            placeholder="Buscar por marca, modelo, medida o proveedor..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {inventarioFiltrado.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-12 text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              {busqueda ? (
                <p>No se encontraron productos para &quot;{busqueda}&quot;</p>
              ) : (
                <p>No hay llantas en inventario. Agrega la primera.</p>
              )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Medida</th>
                  <th>Stock</th>
                  <th>Precio</th>
                </tr>
              </thead>
              <tbody>
                {inventarioFiltrado.map((llanta) => {
                  const totalStock = getTotalStock(llanta);
                  return (
                    <tr key={llanta.id} className="hover:bg-gray-50">
                      <td>
                        <Link
                          href={`/llantas/${llanta.id}`}
                          className="hover:underline"
                        >
                          <p className="font-medium">
                            {llanta.marca} {llanta.modelo}
                          </p>
                          <p className="text-xs text-gray-500">
                            R{llanta.rin} · {llanta.ancho}/{llanta.perfil}
                          </p>
                        </Link>
                      </td>
                      <td className="font-mono">{llanta.medida}</td>
                      <td>
                        <Badge
                          variant={
                            totalStock === 0
                              ? "danger"
                              : totalStock <= 3
                              ? "warning"
                              : "success"
                          }
                        >
                          {totalStock}
                        </Badge>
                      </td>
                      <td>{formatCurrency(llanta.precioVenta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
