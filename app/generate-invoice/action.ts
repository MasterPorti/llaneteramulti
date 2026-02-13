'use server';

import axios from 'axios';

export async function createInvoiceAction() {
  const API_KEY = process.env.FACTURA_DIGITAL_API_KEY;
  const BASE_URL = 'https://sandbox-app.facturadigital.com.mx/api/v5';

  if (!API_KEY) {
    return { error: 'No se encontró la API KEY en las variables de entorno.' };
  }

  const invoiceData = {
    // Basic Invoice Data
    Serie: 'F',
    Folio: Math.floor(Math.random() * 10000).toString(),
    Fecha: new Date().toISOString(),
    FormaPago: '01', // Efectivo
    CondicionesDePago: 'Contado',
    SubTotal: '100.00',
    Moneda: 'MXN',
    Total: '116.00',
    TipoDeComprobante: 'I',
    MetodoPago: 'PUE',
    LugarExpedicion: '42501', // ZIP Code of EKU9003173C9

    // Issuer (Emisor) - REQUIRED for Sandbox testing with specific CSD
    Emisor: {
      Rfc: 'EKU9003173C9',
      Nombre: 'ESCUELA KEMPER URGATE',
      RegimenFiscal: '601'
    },

    // Receiver (Receptor)
    Receptor: {
      Rfc: 'XAXX010101000',
      Nombre: 'PUBLICO EN GENERAL',
      UsoCFDI: 'S01',
      DomicilioFiscalReceptor: '64000',
      RegimenFiscalReceptor: '616'
    },

    // Concepts
    Conceptos: [
      {
        ClaveProdServ: '01010101',
        Cantidad: '1',
        ClaveUnidad: 'H87',
        Descripcion: 'Producto de Prueba Web',
        ValorUnitario: '100.00',
        Importe: '100.00',
        ObjetoImp: '02',
        Impuestos: {
          Traslados: [
            {
              Base: '100.00',
              Impuesto: '002',
              TipoFactor: 'Tasa',
              TasaOCuota: '0.160000',
              Importe: '16.00'
            }
          ]
        }
      }
    ],
    Exportacion: '01'
  };

  try {
    // Prepare form data
    const params = new URLSearchParams();
    params.append('json', JSON.stringify(invoiceData));

    const response = await axios.post(`${BASE_URL}/invoice/create`, params, {
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return { success: true, data: response.data };

  } catch (error: any) {
    console.error('Error creating invoice:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Error desconocido al generar la factura',
      details: error.response?.data
    };
  }
}
