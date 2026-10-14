import type { BodegaId } from "@/types";

export const BODEGAS: Array<{ id: BodegaId; nombre: string }> = [
  { id: "bodega-1", nombre: "Local" },
  { id: "bodega-2", nombre: "Escaleras" },
  { id: "bodega-3", nombre: "Benitos Usadas" },
  { id: "bodega-4", nombre: "Hacienda" },
  { id: "bodega-5", nombre: "Coacalco Usadas" },
  { id: "bodega-6", nombre: "Hacienda 2" },
  { id: "bodega-7", nombre: "Claudia Usadas Hacienda" },
  { id: "bodega-8", nombre: "Jose Manuel Teyahualco" },
];

export const CONFIG = {
  nombreNegocio: "Llanta Usada",
  logo: "/images/logo.jpeg",
  direccion:
    "Venustiano Carranza S/N, Santiago Teyahualco, 54980 Santiago Teyahualco, Méx.",
  telefono: "55 9190 5857",
  rfc: "GUHA820120MD4",
  regimenFiscal: "612 - Personas Físicas c/Actividades Empresariales",
  horarios: [
    { dia: "Lun – Vie", hora: "9:00 a.m. – 6:00 p.m." },
    { dia: "Sábado", hora: "9:00 a.m. – 5:00 p.m." },
    { dia: "Domingo", hora: "9:00 a.m. – 4:00 p.m." },
  ],

  garantiaDiasPredeterminado: 60,
  condicionesGarantiaPredeterminado:
    "Garantía por defectos de fabricación. No cubre daños por mal uso.",

  formatoFolio: "V-",
} as const;

export const SERVICIOS_INICIALES = [
  {
    nombre: "Parche de llanta",
    descripcion: "Reparación de ponchazo con parche",
    precioDefault: 80,
  },
  {
    nombre: "Extra / Material",
    descripcion: "Costo adicional por material o trabajo extra",
    precioDefault: 50,
  },
  { nombre: "Balanceo", descripcion: "Balanceo de llanta", precioDefault: 60 },
  {
    nombre: "Alineación",
    descripcion: "Alineación del vehículo",
    precioDefault: 350,
  },
  {
    nombre: "Rotación de llantas",
    descripcion: "Rotación de 4 llantas",
    precioDefault: 150,
  },
  {
    nombre: "Montaje de llanta",
    descripcion: "Montaje y desmontaje",
    precioDefault: 50,
  },
  {
    nombre: "Válvula nueva",
    descripcion: "Cambio de válvula",
    precioDefault: 30,
  },
  {
    nombre: "Inflado con nitrógeno",
    descripcion: "Inflado con nitrógeno por llanta",
    precioDefault: 40,
  },
  {
    nombre: "Reparación de rin",
    descripcion: "Reparación/enderezado de rin",
    precioDefault: 200,
  },
];
