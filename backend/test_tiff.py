#!/usr/bin/env python3
"""
Script de prueba para verificar la conversión de archivos TIFF
"""
import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from controller import _convert_file_to_png, ConversionError

def test_tiff_conversion():
    """Prueba la conversión de archivos TIFF disponibles"""
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Buscar archivos TIFF en las carpetas
    search_dirs = [
        os.path.join(backend_dir, "files", "images"),
        os.path.join(backend_dir, "files", "output")
    ]
    
    tiff_files = []
    for search_dir in search_dirs:
        if os.path.exists(search_dir):
            for file in os.listdir(search_dir):
                if file.lower().endswith(('.tif', '.tiff')):
                    tiff_files.append(os.path.join(search_dir, file))
    
    if not tiff_files:
        print("❌ No se encontraron archivos TIFF para probar")
        print(f"Buscado en: {search_dirs}")
        return False
    
    print(f"🔍 Encontrados {len(tiff_files)} archivos TIFF:")
    success_count = 0
    
    for tiff_file in tiff_files:
        filename = os.path.basename(tiff_file)
        file_size = os.path.getsize(tiff_file) / (1024 * 1024)
        print(f"\n📁 Probando: {filename} ({file_size:.1f}MB)")
        
        try:
            buf = _convert_file_to_png(tiff_file)
            png_size = len(buf.getvalue()) / 1024
            print(f"✅ Conversión exitosa → PNG ({png_size:.1f}KB)")
            success_count += 1
            
        except ConversionError as ce:
            print(f"⚠️  ConversionError: {ce.message}")
            if ce.suggestion:
                print(f"💡 Sugerencia: {ce.suggestion}")
                
        except Exception as e:
            print(f"❌ Error inesperado: {e}")
    
    print(f"\n📊 Resultado: {success_count}/{len(tiff_files)} conversiones exitosas")
    return success_count > 0

if __name__ == "__main__":
    test_tiff_conversion()