#!/usr/bin/env python3
"""
Script de prueba y diagnóstico para GRAFICO_2 con GPT CLI
Prueba diferentes configuraciones de tiles y memoria para encontrar la óptima
"""
import subprocess
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# ================== CONFIGURACIÓN ==================
GPT_PATH = "/home/nahin/esa-snap/bin/gpt"
MAX_MEMORY = "10G"
NUM_THREADS = "7"

INPUT_MASTER = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2/Grafo1/S1A_IW_SLC__1SDV_20260509T105323_20260509T105350_064439_081D91_CFA2_Orb.dim"
INPUT_SLAVE  = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2/Grafo1/S1A_IW_SLC__1SDV_20260521T105323_20260521T105350_064614_0823A5_5C1B_Orb.dim"
OUTPUT_BASE  = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2/Grafo2_GPT_Prueba"
GRAPH_PATH   = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Graficos_XML/GRAFICO_2.xml"

# Ruta al archivo de propiedades de SNAP (para configurar tile cache)
SNAP_CONF_DIR = os.path.expanduser("~/.snap/etc")
# ====================================================


def check_snap_config():
    """Revisa y muestra la configuración actual de SNAP"""
    print("\n" + "="*60)
    print("📋 DIAGNÓSTICO DE CONFIGURACIÓN SNAP")
    print("="*60)

    conf_file = os.path.join(SNAP_CONF_DIR, "snap.properties")
    if os.path.exists(conf_file):
        print(f"✅ Archivo de configuración encontrado: {conf_file}")
        with open(conf_file) as f:
            content = f.read()
        # Buscar parámetros relevantes
        for line in content.splitlines():
            if any(k in line.lower() for k in ["tile", "cache", "memory", "thread"]):
                print(f"   {line}")
    else:
        print(f"⚠️  No se encontró {conf_file}")
        print("   SNAP usará configuración por defecto (tile cache puede ser muy pequeño)")

    # Verificar caché de DEM
    dem_cache = os.path.expanduser("~/.snap/auxdata/dem")
    if os.path.exists(dem_cache):
        size = sum(f.stat().st_size for f in Path(dem_cache).rglob('*') if f.is_file())
        print(f"\n✅ Caché DEM encontrada: {dem_cache}")
        print(f"   Tamaño: {size / (1024**2):.1f} MB")
    else:
        print(f"\n⚠️  Sin caché DEM local — Back-Geocoding descargará SRTM 1Sec HGT en runtime")
        print("   Esto puede causar delays importantes en la primera ejecución")


def patch_snap_properties(tile_cache_gb=6):
    """
    Modifica snap.properties para optimizar tile cache.
    El tile cache grande es CRÍTICO para Back-Geocoding + ESD.
    """
    os.makedirs(SNAP_CONF_DIR, exist_ok=True)
    conf_file = os.path.join(SNAP_CONF_DIR, "snap.properties")

    tile_cache_bytes = tile_cache_gb * 1024 * 1024 * 1024

    # Leer existente o crear nuevo
    lines = []
    keys_set = set()
    if os.path.exists(conf_file):
        with open(conf_file) as f:
            lines = f.readlines()
        # Filtrar líneas de tile cache para reemplazarlas
        lines = [l for l in lines if "snap.jai.tileCacheSize" not in l]

    lines.append(f"\nsnap.jai.tileCacheSize={tile_cache_bytes}\n")

    with open(conf_file, "w") as f:
        f.writelines(lines)

    print(f"✅ snap.properties actualizado: tile cache = {tile_cache_gb} GB")
    return conf_file


def run_gpt(output_suffix, extra_jvm_args=None, tile_size=None, verbose=False):
    """
    Ejecuta GPT con una configuración específica y mide el tiempo.
    
    Args:
        output_suffix: sufijo para el archivo de salida (para no pisar resultados anteriores)
        extra_jvm_args: lista de args JVM adicionales (ej: ["-J-Dtile.size=512"])
        tile_size: tamaño de tile JAI en píxeles (None = default SNAP ~512)
        verbose: si True, imprime stdout/stderr en tiempo real
    """
    output_file = os.path.join(OUTPUT_BASE, f"output_{output_suffix}.dim")
    os.makedirs(OUTPUT_BASE, exist_ok=True)

    cmd = [
        GPT_PATH,
        GRAPH_PATH,
        f"-PinputFile={INPUT_MASTER}",
        f"-PinputFile2={INPUT_SLAVE}",
        f"-PoutputFile={output_file}",
        "-q", NUM_THREADS,
        f"-J-Xmx{MAX_MEMORY}",
        "-J-Xms4G",
        # Forzar GC paralelo — mejor para procesos batch
        "-J-XX:+UseParallelGC",
        # Reducir overhead de GC
        "-J-XX:MaxGCPauseMillis=500",
    ]

    if tile_size:
        cmd += [
            f"-J-Dsnap.jai.tileSize={tile_size}",
            f"-J-Dsnap.jai.tileCacheSize={6 * 1024**3}",
        ]

    if extra_jvm_args:
        cmd += extra_jvm_args

    print(f"\n{'='*60}")
    print(f"🔧 PRUEBA: {output_suffix}")
    print(f"{'='*60}")
    print("Comando:")
    print("  " + " ".join(cmd))
    print(f"\nSalida: {output_file}")
    print(f"⏳ Iniciando a las {datetime.now().strftime('%H:%M:%S')}...\n")

    start = time.time()

    try:
        if verbose:
            # Modo verbose: ver output en tiempo real
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            last_lines = []
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    print(f"  GPT> {line}")
                    last_lines.append(line)
                    if len(last_lines) > 20:
                        last_lines.pop(0)
            proc.wait(timeout=7200)
            returncode = proc.returncode
            stderr_out = ""
        else:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=7200  # 2 horas máximo
            )
            returncode = result.returncode
            stderr_out = result.stderr
            last_lines = result.stdout.splitlines()[-20:] if result.stdout else []

    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        print(f"⏰ TIMEOUT después de {elapsed/60:.1f} minutos")
        return None

    except Exception as e:
        print(f"❌ Error inesperado: {e}")
        return None

    elapsed = time.time() - start

    if returncode == 0:
        print(f"\n✅ ÉXITO en {elapsed/60:.1f} minutos ({elapsed:.0f} seg)")
        print(f"   Archivo: {output_file}")
        if os.path.exists(output_file):
            size = os.path.getsize(output_file) / (1024**2)
            print(f"   Tamaño: {size:.1f} MB")
    else:
        print(f"\n❌ FALLÓ después de {elapsed/60:.1f} minutos")
        print(f"   Return code: {returncode}")
        if stderr_out:
            print("\n--- ÚLTIMAS LÍNEAS DE ERROR ---")
            for line in stderr_out.splitlines()[-30:]:
                print(f"  {line}")
        elif last_lines:
            print("\n--- ÚLTIMO OUTPUT ---")
            for line in last_lines[-15:]:
                print(f"  {line}")

    return {"success": returncode == 0, "elapsed": elapsed, "output": output_file}


def main():
    print(f"\n{'='*60}")
    print("🛰️  DIAGNÓSTICO Y PRUEBA GPT - GRAFICO_2")
    print(f"{'='*60}")
    print(f"Timestamp: {datetime.now()}")

    # 1. Diagnóstico previo
    check_snap_config()

    # 2. Verificar archivos de entrada
    print("\n📁 Verificando archivos de entrada...")
    for label, path in [("Master", INPUT_MASTER), ("Slave", INPUT_SLAVE), ("Graph", GRAPH_PATH)]:
        if os.path.exists(path):
            size = os.path.getsize(path) / (1024**2)
            print(f"  ✅ {label}: {os.path.basename(path)} ({size:.1f} MB)")
        else:
            print(f"  ❌ {label}: NO ENCONTRADO → {path}")
            print("     Verifica las rutas antes de continuar.")
            sys.exit(1)

    # 3. Elegir modo de prueba
    print("\n¿Qué prueba deseas ejecutar?")
    print("  1) Prueba rápida con tile size optimizado (recomendada primero)")
    print("  2) Prueba con verbose para ver qué paso se cuelga")
    print("  3) Prueba bajar tile cache a 4GB (si hay poca RAM disponible)")
    print("  4) Correr TODAS las configuraciones en secuencia")

    choice = input("\nElige (1/2/3/4): ").strip()

    results = []

    if choice == "1" or choice == "4":
        # Configuración optimizada: tile 512 + 6GB cache
        patch_snap_properties(tile_cache_gb=6)
        r = run_gpt(
            output_suffix="opt_tile512",
            tile_size=512,
            verbose=False
        )
        if r:
            results.append(("Tile 512 + Cache 6GB", r))

    if choice == "2" or choice == "4":
        # Verbose para diagnóstico
        print("\n⚠️  Modo verbose: verás todos los mensajes de GPT.")
        print("   Busca en qué operador se 'congela' el proceso.")
        r = run_gpt(
            output_suffix="verbose_diag",
            tile_size=512,
            verbose=True
        )
        if r:
            results.append(("Verbose diagnóstico", r))

    if choice == "3" or choice == "4":
        # Tile cache reducido
        patch_snap_properties(tile_cache_gb=4)
        r = run_gpt(
            output_suffix="cache_4gb",
            tile_size=256,
            extra_jvm_args=["-J-Dsnap.jai.tileCacheSize=4294967296"],
            verbose=False
        )
        if r:
            results.append(("Tile 256 + Cache 4GB", r))

    # Resumen
    if results:
        print(f"\n{'='*60}")
        print("📊 RESUMEN DE RESULTADOS")
        print(f"{'='*60}")
        for name, r in results:
            status = "✅" if r["success"] else "❌"
            mins = r["elapsed"] / 60
            print(f"  {status} {name}: {mins:.1f} min")


if __name__ == "__main__":
    main()