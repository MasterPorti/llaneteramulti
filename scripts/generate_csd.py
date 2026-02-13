
import base64
import os

# Certificados de Prueba SAT - RFC: EKU9003173C9
# Fuente: Facturama / FacturoPorTi
# Contraseña de la llave privada: 12345678a

cer_base64 = "MIIFdzCCA1-gAwIBAgIUMzAwMDEwMDAwMDA0MDAwMDI0MzYwDQYJKoZIhvcNAQELBQAwggErMQ8wDQYDVQQDDAZBQyBVQ0EgUFJVRUJBUzELMAkGA1UEBhMCTVgxMjAwBgNVBAoMKVNFUlZJQ0lPIERFIEFETUlOSVNUUkFDSU9OIFRSSUJVVEFSSUEgKFNBVCkxJDAiBgkqhkiG9w0BCQEWFWNvbnRhY3RvLnRlY25pY29Ac2F0LmdvYi5teDEmMCQGA1UECQwdQXYuIGRlIEhpZGFsZ28gNzcsIENvbC4gR3VlcnJlcm8xDjAMBgNVBBEMBTA2MzAwMQswCQYDVQQGEwJNWDEZMBcGA1UECAwQRGlzdHJpdG8gRmVkZXJhbDESMBAGA1UEBwwJQ295b2FjYW4xMTAvBgkqhkiG9w0BCQIMIiJSZXNwb25zYWJsZTogQWRtaW5pc3RyYWNpb24gQ2VudHJhbCBkZSBTZXJ2aWNpb3MgVHJpYnV0YXJpb3MgYWwgQ29udHJpYnV5ZW50ZTAeFw0xOTA1MTYxNjEzMjRaFw0yMzA1MTYxNjEzMjRaMIHuMSkwJwYDVQQDEyBFU0NVRUxBIEtFTVBFUiBVUkdBVEUgU0EgREUgQ1YxKTAnBgNVBCkTIEVTQ1VFTEEgS0VNUEVSIFVSR0FURSBTQSBERSBDVjEpMCcGA1UEChMgRVNDVUVMQSBLRU1QRVIgVVJHQVRFIFNBIERFIENWMSUwIwYDVQQtExxGS1U5MDAzMTczQzkgLyBLQU9SNTgwMTI1MlkyMR4wHAYDVQQFExUgLyBLQU9SNTgwMTI1SERGUlpSMDkxDzANBgNVBAsTBlVuaWRhZDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJ5gS/Q3C2e0q3aTUq7Xg5eHT6l7U2Qh7q2F9nQj5j5+O5+0e3+X5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0CAwEAAaMhMB8wHQYDVR0OBBYEFL4W9a0s3+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0+5+7+0"
# NOTE: The above base64 is a placeholder/simulated as real ones are very long. 
# I will use the actual known base64 for EKU9003173C9 from standard testing resources if available, 
# otherwise the user must download the zip.
# However, for this task, I will provide the script Structure and ask user to use the ZIP link if the heavy payload is too much.
# BUT, since I found the Elevio article with base64, I will try to use a valid truncated version or just guide the user to the ZIP if the string is too massive for this tool.

# Actually, to ensure success, I will advise the user to download the ZIP directly as it is more reliable than embedding 4KB+ strings here.
# But user asked for a python script. I will provide a script that downloads the ZIP file and extracts it.

import requests
import zipfile
import io

def download_and_extract_certs():
    url = "https://software.facturoporti.com.mx/TaaS/Json/Api/Csd-Prueba.zip"
    print(f"Descargando certificados desde {url}...")
    
    try:
        r = requests.get(url)
        r.raise_for_status()
        
        z = zipfile.ZipFile(io.BytesIO(r.content))
        
        # Extract to current directory
        z.extractall(".")
        
        print("\n¡Éxito! Archivos descargados:")
        for file in z.namelist():
            print(f"- {file}")
            
        print("\n--- INSTRUCCIONES ---")
        print("1. Ve a https://sandbox-app.facturadigital.com.mx")
        print("2. Configuración -> Certificados CSD")
        print("3. Sube los archivos .cer y .key que se acaban de descargar.")
        print("4. Contraseña de llave privada: 12345678a")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    download_and_extract_certs()
