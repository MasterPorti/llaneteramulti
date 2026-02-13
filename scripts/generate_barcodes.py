#!/usr/bin/env python3
"""
Script para generar códigos de barras de servicios.

Requisitos:
    pip install python-barcode pillow

Uso:
    python scripts/generate_barcodes.py

Los códigos de barras se guardan en public/images/barcodes/
"""

import json
import os
from pathlib import Path

try:
    import barcode
    from barcode.writer import ImageWriter
except ImportError:
    print("Error: Necesitas instalar python-barcode y pillow")
    print("Ejecuta: pip install python-barcode pillow")
    exit(1)


def main():
    # Rutas
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    servicios_path = project_root / "data" / "servicios.json"
    output_dir = project_root / "public" / "images" / "barcodes"

    # Crear directorio de salida si no existe
    output_dir.mkdir(parents=True, exist_ok=True)

    # Leer servicios
    with open(servicios_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    servicios = data.get("servicios", [])

    if not servicios:
        print("No se encontraron servicios en el archivo JSON")
        return

    print(f"Generando {len(servicios)} códigos de barras...")
    print(f"Directorio de salida: {output_dir}")
    print("-" * 50)

    # Generar código de barras para cada servicio
    Code128 = barcode.get_barcode_class("code128")

    for servicio in servicios:
        if not servicio.get("activo", True):
            continue

        codigo = servicio.get("codigoBarras")
        nombre = servicio.get("nombre", "Sin nombre")

        if not codigo:
            print(f"  [SKIP] {nombre} - Sin código de barras")
            continue

        # Generar código de barras con el nombre del servicio como texto
        barcode_instance = Code128(codigo, writer=ImageWriter())

        # Opciones del escritor
        options = {
            "module_width": 0.4,      # Ancho de las barras
            "module_height": 15.0,    # Altura de las barras
            "font_size": 10,          # Tamaño de fuente
            "text_distance": 5.0,     # Distancia del texto
            "quiet_zone": 6.5,        # Zona silenciosa
        }

        # Guardar como PNG (sin extensión, barcode la agrega automáticamente)
        output_path = output_dir / codigo
        barcode_instance.save(str(output_path), options)

        print(f"  [OK] {codigo} - {nombre}")

    print("-" * 50)
    print(f"Códigos de barras generados en: {output_dir}")
    print("\nPuedes imprimir estos códigos y pegarlos en tu área de trabajo.")


if __name__ == "__main__":
    main()
