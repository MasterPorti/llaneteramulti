import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.FACTURA_DIGITAL_API_KEY;
const BASE_URL = 'https://sandbox-app.facturadigital.com.mx/api/v5';

if (!API_KEY) {
    console.error('Error: FACTURA_DIGITAL_API_KEY environment variable is not set.');
    process.exit(1);
}

async function createInvoice() {
    const invoiceData = {
        // Basic Invoice Data
        Serie: 'F',
        Folio: Math.floor(Math.random() * 10000).toString(), // Random folio for testing
        Fecha: new Date().toISOString(),
        FormaPago: '01', // Efectivo
        CondicionesDePago: 'Contado',
        SubTotal: '100.00',
        Moneda: 'MXN',
        Total: '116.00',
        TipoDeComprobante: 'I',
        MetodoPago: 'PUE',
        LugarExpedicion: '64000', // Example Zip Code

        // Issuer (Emisor) - Often optional if configured in account, but good to check
        /* Emisor: {
             Rfc: 'AAA010101AAA', // Generic testing RFC
             Nombre: 'EMPRESA DE PRUEBA',
             RegimenFiscal: '601'
        }, */

        // Receiver (Receptor)
        Receptor: {
            Rfc: 'XAXX010101000', // Generic Receiver RFC
            Nombre: 'PUBLICO EN GENERAL',
            UsoCFDI: 'S01', // Sin efectos fiscales
            DomicilioFiscalReceptor: '64000',
            RegimenFiscalReceptor: '616'
        },

        // Concepts
        Conceptos: [
            {
                ClaveProdServ: '01010101',
                Cantidad: '1',
                ClaveUnidad: 'H87',
                Descripcion: 'Producto de Prueba',
                ValorUnitario: '100.00',
                Importe: '100.00',
                ObjetoImp: '02', // Sí objeto de impuesto
                Impuestos: {
                    Traslados: [
                        {
                            Base: '100.00',
                            Impuesto: '002', // IVA
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
        console.log('Generating Invoice...');
        // Prepare form data
        const params = new URLSearchParams();
        params.append('json', JSON.stringify(invoiceData));

        const response = await axios.post(`${BASE_URL}/invoice/create`, params, {
            headers: {
                'X-Api-Key': API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        console.log('Response Status:', response.status);
        console.log('Response Data:', JSON.stringify(response.data, null, 2));

    } catch (error: any) {
        console.error('Error creating invoice:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

createInvoice();
