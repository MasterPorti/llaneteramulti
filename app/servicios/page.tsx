'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, Input } from '@/components/ui';
import { DownloadPdfButton } from '@/components/ui/DownloadPdfButton';
import { Wrench, Plus, Pencil, Trash2, Check, X, DollarSign, ScanBarcode, Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/formatters';
import { imprimirCodigosServicios } from '@/lib/utils/print-service-barcodes';
import { buildServicesReport } from '@/lib/reports/data';
import JsBarcode from 'jsbarcode';

function descargarCodigoBarras(servicio: { nombre: string; codigoBarras: string; id: string }) {
  const valor = servicio.codigoBarras || servicio.id;
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, valor, {
    format: 'CODE128',
    displayValue: true,
    text: `${servicio.nombre} · ${valor}`,
    fontSize: 12,
    margin: 10,
    width: 2,
    height: 60,
  });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `barcode_${servicio.nombre.replace(/\s+/g, '_')}.png`;
  a.click();
}
import {
  obtenerServicios,
  crearServicio,
  actualizarServicio,
  eliminarServicio,
} from './actions';
import type { Servicio, ServicioInput } from '@/types';

export default function ServiciosPage() {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datosConfirmados, setDatosConfirmados] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ServicioInput>>({});

  // Adding state
  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState<ServicioInput>({
    nombre: '',
    descripcion: '',
    precioDefault: 0,
  });

  const [saving, setSaving] = useState(false);

  async function handlePrint(selection: Servicio[]) {
    try {
      await imprimirCodigosServicios(selection);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Error al imprimir los códigos de barras');
    }
  }

  useEffect(() => {
    let active = true;
    obtenerServicios().then((result) => {
      if (!active) return;
      if (result.success && result.data) {
        setServicios(result.data);
        setDatosConfirmados(true);
        setError(null);
      } else {
        setError(result.error || 'Error al cargar servicios');
      }
      setLoading(false);
    }).catch(() => {
      if (active) {
        setError('Error al cargar servicios');
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  async function cargarServicios() {
    setLoading(true);
    setDatosConfirmados(false);
    try {
      const result = await obtenerServicios();
      if (result.success && result.data) {
        setServicios(result.data);
        setDatosConfirmados(true);
        setError(null);
      } else {
        setError(result.error || 'Error al cargar servicios');
      }
    } catch {
      setError('Error al cargar servicios');
    } finally {
      setLoading(false);
    }
  }

  // --- Add handlers ---
  function handleStartAdd() {
    setIsAdding(true);
    setEditingId(null);
    setAddForm({ nombre: '', descripcion: '', precioDefault: 0 });
  }

  function handleCancelAdd() {
    setIsAdding(false);
    setAddForm({ nombre: '', descripcion: '', precioDefault: 0 });
  }

  async function handleSaveAdd() {
    if (saving || !addForm.nombre.trim()) return;
    setSaving(true);
    setDatosConfirmados(false);
    try {
      const result = await crearServicio({
        nombre: addForm.nombre.trim(),
        descripcion: addForm.descripcion.trim(),
        precioDefault: Number(addForm.precioDefault),
      });
      if (result.success) {
        await cargarServicios();
        setIsAdding(false);
        setAddForm({ nombre: '', descripcion: '', precioDefault: 0 });
      } else {
        setError(result.error || 'Error al crear servicio');
      }
    } catch {
      setError('No se pudo confirmar el guardado. Recarga los servicios.');
    } finally {
      setSaving(false);
    }
  }

  // --- Edit handlers ---
  function handleStartEdit(servicio: Servicio) {
    setEditingId(servicio.id);
    setIsAdding(false);
    setEditForm({
      nombre: servicio.nombre,
      descripcion: servicio.descripcion,
      precioDefault: servicio.precioDefault,
    });
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  async function handleSaveEdit() {
    if (saving || !editingId || !editForm.nombre?.trim()) return;
    setSaving(true);
    setDatosConfirmados(false);
    try {
      const result = await actualizarServicio(editingId, {
        nombre: editForm.nombre?.trim(),
        descripcion: editForm.descripcion?.trim(),
        precioDefault: Number(editForm.precioDefault),
      });
      if (result.success) {
        await cargarServicios();
        setEditingId(null);
        setEditForm({});
      } else {
        setError(result.error || 'Error al actualizar servicio');
      }
    } catch {
      setError('No se pudo confirmar el guardado. Recarga los servicios.');
    } finally {
      setSaving(false);
    }
  }

  // --- Delete handler ---
  async function handleDelete(id: string) {
    if (saving || !confirm('Esta accion eliminara el servicio. Continuar?')) return;
    setSaving(true);
    setDatosConfirmados(false);
    try {
      const result = await eliminarServicio(id);
      if (result.success) {
        await cargarServicios();
      } else {
        setError(result.error || 'Error al eliminar servicio');
      }
    } catch {
      setError('No se pudo confirmar la eliminación. Recarga los servicios.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Servicios"
        subtitle="Administracion de servicios disponibles"
        breadcrumbs={[
          { label: 'Inicio', href: '/' },
          { label: 'Servicios' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <DownloadPdfButton
              getReport={() => buildServicesReport(servicios)}
              disabled={loading || !datosConfirmados || saving || isAdding || !!editingId || !servicios.length}
            />
            <Button variant="secondary" onClick={() => handlePrint(servicios)} disabled={loading || !servicios.length}>
              <Printer className="w-4 h-4" />
              Imprimir todos
            </Button>
            <Link href="/servicios/nuevo" className="btn btn-primary">
              <Plus className="w-4 h-4" />
              Nuevo Servicio
            </Link>
          </div>
        }
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
          {!datosConfirmados && (
            <button type="button" onClick={cargarServicios} disabled={loading || saving} className="ml-3 underline disabled:opacity-50">
              Recargar servicios
            </button>
          )}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4 inline" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">
          <div className="spinner mx-auto mb-3" />
          Cargando servicios...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Add New Service Card */}
          {isAdding && (
            <Card className="border-2 border-dashed border-gray-300">
              <CardBody>
                <div className="flex items-center gap-2 mb-4">
                  <Wrench className="w-5 h-5 text-gray-500" />
                  <span className="font-semibold text-gray-700">Nuevo Servicio</span>
                </div>
                <div className="space-y-3">
                  <Input
                    label="Nombre"
                    name="nombre"
                    value={addForm.nombre}
                    onChange={(e) =>
                      setAddForm({ ...addForm, nombre: e.target.value })
                    }
                    placeholder="Nombre del servicio"
                    required
                    autoFocus
                  />
                  <Input
                    label="Descripcion"
                    name="descripcion"
                    value={addForm.descripcion}
                    onChange={(e) =>
                      setAddForm({ ...addForm, descripcion: e.target.value })
                    }
                    placeholder="Descripcion breve"
                  />
                  <div>
                    <label className="label">
                      Precio Default <span className="text-red-600 ml-1">*</span>
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="number"
                        name="precioDefault"
                        className="input" style={{ paddingLeft: '2rem' }}
                        value={addForm.precioDefault || ''}
                        onChange={(e) =>
                          setAddForm({
                            ...addForm,
                            precioDefault: parseFloat(e.target.value) || 0,
                          })
                        }
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelAdd}
                    disabled={saving}
                  >
                    <X className="w-4 h-4" />
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveAdd}
                    disabled={saving || !addForm.nombre.trim()}
                    loading={saving}
                  >
                    <Check className="w-4 h-4" />
                    Guardar
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Service Cards */}
          {servicios.map((servicio) => (
            <Card
              key={servicio.id}
              className="transition-shadow hover:shadow-md"
            >
              <CardBody>
                {editingId === servicio.id ? (
                  /* Inline Edit Form */
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <Wrench className="w-5 h-5 text-gray-500" />
                      <span className="font-semibold text-gray-700">
                        Editar Servicio
                      </span>
                    </div>
                    <div className="space-y-3">
                      <Input
                        label="Nombre"
                        name="nombre"
                        value={editForm.nombre || ''}
                        onChange={(e) =>
                          setEditForm({ ...editForm, nombre: e.target.value })
                        }
                        placeholder="Nombre del servicio"
                        required
                        autoFocus
                      />
                      <Input
                        label="Descripcion"
                        name="descripcion"
                        value={editForm.descripcion || ''}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            descripcion: e.target.value,
                          })
                        }
                        placeholder="Descripcion breve"
                      />
                      <div>
                        <label className="label">
                          Precio Default{' '}
                          <span className="text-red-600 ml-1">*</span>
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="number"
                            name="precioDefault"
                            className="input" style={{ paddingLeft: '2rem' }}
                            value={editForm.precioDefault ?? ''}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                precioDefault:
                                  parseFloat(e.target.value) || 0,
                              })
                            }
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={saving}
                      >
                        <X className="w-4 h-4" />
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={saving || !editForm.nombre?.trim()}
                        loading={saving}
                      >
                        <Check className="w-4 h-4" />
                        Guardar
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Display Mode */
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Wrench className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <h3 className="font-semibold text-gray-800 truncate">
                          {servicio.nombre}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <button
                          onClick={() => handlePrint([servicio])}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          title="Imprimir código de barras"
                          aria-label={`Imprimir código de barras de ${servicio.nombre}`}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => descargarCodigoBarras(servicio)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Descargar código de barras"
                        >
                          <ScanBarcode className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleStartEdit(servicio)}
                          disabled={saving}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(servicio.id)}
                          disabled={saving}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {servicio.descripcion && (
                      <p className="text-sm text-gray-500 mt-1 ml-7">
                        {servicio.descripcion}
                      </p>
                    )}
                    <div className="mt-3 ml-7">
                      <span className="inline-flex items-center gap-1 text-lg font-semibold text-gray-700">
                        {formatCurrency(servicio.precioDefault)}
                      </span>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}

          {/* Empty State */}
          {servicios.length === 0 && !isAdding && (
            <div className="col-span-full">
              <div className="empty-state">
                <Wrench className="empty-state-icon mx-auto" />
                <p className="text-lg font-medium text-gray-600 mb-1">
                  No hay servicios registrados
                </p>
                <p className="text-sm text-gray-400 mb-4">
                  Agrega tu primer servicio para comenzar
                </p>
                <Button onClick={handleStartAdd}>
                  <Plus className="w-4 h-4" />
                  Nuevo Servicio
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
