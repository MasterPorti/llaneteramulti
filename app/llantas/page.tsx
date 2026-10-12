"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Search, Package } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { Card, CardBody, Badge } from "@/components/ui";
import { DownloadPdfButton } from "@/components/ui/DownloadPdfButton";
import { obtenerInventario } from "./actions";
import { formatCurrency } from "@/lib/utils/formatters";
import { getTotalStock, type Llanta, type BodegaId } from "@/types";
import { BODEGAS } from "@/lib/config";
import { buildTiresReport } from "@/lib/reports/data";

export default function InventarioPage() {
  const [inventario, setInventario] = useState<Llanta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("activos");
  const [error, setError] = useState("");
  const [bodegaFiltro, setBodegaFiltro] = useState<BodegaId | "">("");

  useEffect(() => {
    let mounted = true;
    obtenerInventario({ incluirInactivos: true }).then((result) => {
      if (!mounted) return;
      if (result.success && result.data) setInventario(result.data);
      else setError(result.error || 'No se pudo cargar el inventario');
      setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setError('No se pudo cargar el inventario');
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);
  const inventarioFiltrado = inventario.filter((l) => {
    if (bodegaFiltro && !(l.stockPorBodega[bodegaFiltro] > 0)) return false;
    if (estadoFiltro === "activos" && !l.activo) return false;
    if (estadoFiltro === "inactivos" && l.activo) return false;
    if (busqueda.trim()) {
      const term = busqueda.toLowerCase();
      return (
        l.marca.toLowerCase().includes(term) ||
        l.modelo.toLowerCase().includes(term) ||
        l.medida.toLowerCase().includes(term) ||
        (l.proveedor || "").toLowerCase().includes(term) ||
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
          <div className="flex flex-wrap gap-2">
            <DownloadPdfButton
              getReport={() => buildTiresReport(inventarioFiltrado, {
                busqueda,
                estado: estadoFiltro === 'activos' ? 'Activos' : estadoFiltro === 'inactivos' ? 'Inactivos' : 'Todos',
                bodega: BODEGAS.find((bodega) => bodega.id === bodegaFiltro)?.nombre || 'Todas las bodegas',
              })}
              disabled={loading || !!error || !inventarioFiltrado.length}
            />
            <Link href="/llantas/nuevo">
              <button className="btn btn-primary flex items-center gap-2">
                <Plus size={16} /> Nueva Llanta
              </button>
            </Link>
          </div>
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

      {error && <p role="alert" className="mb-4 text-red-600">{error}</p>}
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="estado-inventario" className="text-sm text-gray-500">Estado:</label>
        <select id="estado-inventario" className="select" value={estadoFiltro} onChange={(event) => setEstadoFiltro(event.target.value)}>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos (historial)</option>
          <option value="todos">Todos los registros</option>
        </select>
        <select aria-label="Bodega" className="select" value={bodegaFiltro} onChange={(event) => setBodegaFiltro(event.target.value as BodegaId | "")}>
          <option value="">Todas las bodegas</option>
          {BODEGAS.map((bodega) => <option key={bodega.id} value={bodega.id}>{bodega.nombre}</option>)}
        </select>
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
                            {!llanta.activo && <span className="ml-2 text-xs text-amber-700">Inactiva</span>}
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
