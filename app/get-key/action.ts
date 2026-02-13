'use server';

import axios from 'axios';

export async function getApiKeyAction(formData: FormData) {
  const user = formData.get('user') as string;
  const pass = formData.get('pass') as string;

  if (!user || !pass) {
    return { error: 'Usuario y contraseña son requeridos' };
  }

  try {
    const response = await axios.get('https://sandbox-app.facturadigital.com.mx/api/v5/account/authorize', {
      headers: {
        'api-usuario': user,
        'api-password': pass
      }
    });

    return { data: response.data };
  } catch (error: any) {
    console.error('Error fetching API key:', error.response?.data || error.message);
    return {
      error: error.response?.data?.message || error.message || 'Error desconocido al conectar con la API'
    };
  }
}
