#!/usr/bin/env python3
"""
snaphu_pipeline.py
==================
Pipeline modular para el desenrollamiento de fase InSAR con SNAPHU.

Pasos:
  1. SNAPHU Export   — genera los archivos .snaphu.img y .conf desde SNAP/GPT
  2. SNAPHU Unwrap   — ejecuta el binario snaphu sobre los archivos exportados
  3. SNAPHU Import   — reimporta la fase desenrollada a SNAP/GPT

Uso:
  python snaphu_pipeline.py            # ejecuta los 3 pasos
  python snaphu_pipeline.py --step 1   # solo Export
  python snaphu_pipeline.py --step 2   # solo Unwrap
  python snaphu_pipeline.py --step 3   # solo Import
"""

import os
import sys
import glob
import shutil
import argparse
import subprocess
import time
from datetime import datetime

# ============================================================
#  CONFIGURACIÓN — ajusta estas rutas antes de ejecutar
# ============================================================

GPT_PATH    = "/home/nahin/esa-snap/bin/gpt"
SNAPHU_PATH = "/usr/local/bin/snaphu"          # ← cambia a tu ruta real

BASE        = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2"
GRAFICOS    = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2"
# Input: resultado del Gráfico 4 (Subset)
SUBSET_INPUT = f"{BASE}/Grafo 4/Subset_DInSAR_ML_Flt.dim"   # ← ajusta el nombre exacto

# Carpeta de trabajo SNAPHU (se crea automáticamente si no existe)
SNAPHU_DIR   = f"{BASE}/SNAPHU"

# Resultado final del Import
IMPORT_OUTPUT = f"{BASE}/SNAPHU_Import/output_unwrapped.dim"

# XMLs de los grafos (los generamos más abajo si no existen)
GRAPH_EXPORT = f"{GRAFICOS}/SNAPHU_export.xml"
GRAPH_IMPORT = f"{GRAFICOS}/SNAPHU_import.xml"

# JVM y threads (igual que en prueba_2_batch.py)
JVM_ARGS = [
    "-J-Xmx11G",
    "-J-Xms1G",
    "-J-XX:+UseG1GC",
    "-J-XX:G1HeapRegionSize=32m",
    "-J-Dsnap.jai.tileSize=256",
    "-J-Dsnap.jai.tileCacheSize=2147483648",
]
THREADS = "4"

# Parámetros SNAPHU Export
SNAPHU_EXPORT_PARAMS = {
    "numberOfTileRows":    "1",
    "numberOfTileCols":    "1",
    "numberOfProcessors":  "4",
    "rowOverlap":          "0",
    "colOverlap":          "0",
    "tileCostThreshold":   "500",
    "statCostMode":        "DEFO",      # DEFO = deformación; SMOOTH para topografía
    "initMethod":          "MCF",
}

# ============================================================


# ── Grafos XML embebidos ─────────────────────────────────────

SNAPHU_EXPORT_XML = """\
<graph id="Graph">
  <version>1.0</version>
  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>${inputFile}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>
  <node id="SnaphuExport">
    <operator>SnaphuExport</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <targetFolder>${targetFolder}</targetFolder>
      <statCostMode>${statCostMode}</statCostMode>
      <initMethod>${initMethod}</initMethod>
      <numberOfTileRows>${numberOfTileRows}</numberOfTileRows>
      <numberOfTileCols>${numberOfTileCols}</numberOfTileCols>
      <numberOfProcessors>${numberOfProcessors}</numberOfProcessors>
      <rowOverlap>${rowOverlap}</rowOverlap>
      <colOverlap>${colOverlap}</colOverlap>
      <tileCostThreshold>${tileCostThreshold}</tileCostThreshold>
    </parameters>
  </node>
</graph>
"""

SNAPHU_IMPORT_XML = """\
<graph id="Graph">
  <version>1.0</version>
  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>${inputFile}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>
  <node id="Read(2)">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>${unwrappedFile}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>
  <node id="SnaphuImport">
    <operator>SnaphuImport</operator>
    <sources>
      <sourceProduct refid="Read"/>
      <sourceProduct.1 refid="Read(2)"/>
    </sources>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <doNotKeepWrapped>false</doNotKeepWrapped>
    </parameters>
  </node>
  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct refid="SnaphuImport"/>
    </sources>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>${outputFile}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>
</graph>
"""


# ── Helpers ──────────────────────────────────────────────────

def banner(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def run_gpt(label, graph_path, params: dict) -> bool:
    """Ejecuta un grafo GPT con parámetros y muestra output en tiempo real."""
    # Asegura que el directorio de salida exista
    for key in ("outputFile", "targetFolder"):
        if key in params:
            os.makedirs(os.path.dirname(params[key]) if key == "outputFile"
                        else params[key], exist_ok=True)

    cmd = ([GPT_PATH, graph_path] +
           [f"-P{k}={v}" for k, v in params.items()] +
           ["-q", THREADS] + JVM_ARGS)

    banner(label)
    print("Comando:\n  " + " \\\n  ".join(cmd))
    print(f"\n⏳ Iniciando a las {datetime.now().strftime('%H:%M:%S')}...\n")
    start = time.time()

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                print(f"  GPT> {line}")
        proc.wait(timeout=7200)
        rc = proc.returncode
    except subprocess.TimeoutExpired:
        proc.kill()
        print(f"⏰ TIMEOUT después de {(time.time()-start)/60:.1f} min")
        return False
    except Exception as e:
        print(f"❌ Error inesperado: {e}")
        return False

    elapsed = (time.time() - start) / 60
    if rc == 0:
        print(f"\n✅ {label} completado en {elapsed:.1f} min")
        return True
    else:
        print(f"\n❌ {label} falló (código {rc}) tras {elapsed:.1f} min")
        return False


def write_graph(path, content):
    """Escribe el XML del grafo si no existe."""
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        print(f"  📄 Grafo creado: {path}")
    else:
        print(f"  📄 Grafo ya existe: {path}")


def find_snaphu_conf(folder) -> str | None:
    """Busca el archivo .conf generado por SnaphuExport."""
    matches = glob.glob(os.path.join(folder, "*.snaphu.conf"))
    if not matches:
        matches = glob.glob(os.path.join(folder, "snaphu.conf"))
    if not matches:
        matches = glob.glob(os.path.join(folder, "*.conf"))
    return matches[0] if matches else None


def find_phase_img(folder) -> str | None:
    """Busca el archivo Phase_*.snaphu.img exportado."""
    matches = glob.glob(os.path.join(folder, "Phase_*.snaphu.img"))
    if not matches:
        matches = glob.glob(os.path.join(folder, "*.snaphu.img"))
    return matches[0] if matches else None


def find_unwrapped_img(folder) -> str | None:
    """Busca el archivo .img resultado del unwrapping (excluye los .snaphu.img)."""
    all_img = glob.glob(os.path.join(folder, "*.img"))
    # Excluir los originales de snaphu export
    unwrapped = [f for f in all_img if "snaphu" not in os.path.basename(f).lower()]
    return unwrapped[0] if unwrapped else None


# ── Paso 1: SNAPHU Export ────────────────────────────────────

def step_export():
    banner("PASO 1: SNAPHU Export")

    write_graph(GRAPH_EXPORT, SNAPHU_EXPORT_XML)

    if not os.path.exists(SUBSET_INPUT):
        print(f"❌ No se encuentra el input del Subset:\n   {SUBSET_INPUT}")
        return False

    os.makedirs(SNAPHU_DIR, exist_ok=True)

    params = {
        "inputFile":    SUBSET_INPUT,
        "targetFolder": SNAPHU_DIR,
        **SNAPHU_EXPORT_PARAMS,
    }

    ok = run_gpt("SNAPHU Export", GRAPH_EXPORT, params)

    if ok:
        conf = find_snaphu_conf(SNAPHU_DIR)
        img  = find_phase_img(SNAPHU_DIR)
        print(f"\n  📂 Carpeta SNAPHU: {SNAPHU_DIR}")
        print(f"  📋 Archivo .conf:  {os.path.basename(conf) if conf else '⚠️  no encontrado'}")
        print(f"  🗺️  Phase .img:     {os.path.basename(img)  if img  else '⚠️  no encontrado'}")

    return ok


# ── Paso 2: SNAPHU Unwrapping ────────────────────────────────

def step_unwrap():
    banner("PASO 2: SNAPHU Unwrapping")

    # Verificar binario
    if not os.path.exists(SNAPHU_PATH):
        print(f"❌ Binario snaphu no encontrado en:\n   {SNAPHU_PATH}")
        print("   Edita SNAPHU_PATH en la sección CONFIGURACIÓN.")
        return False

    # Localizar archivos del Export
    conf_file  = find_snaphu_conf(SNAPHU_DIR)
    phase_file = find_phase_img(SNAPHU_DIR)

    if not conf_file:
        print(f"❌ No se encontró archivo .conf en {SNAPHU_DIR}")
        print("   ¿Ejecutaste el Paso 1 (Export)?")
        return False
    if not phase_file:
        print(f"❌ No se encontró Phase_*.snaphu.img en {SNAPHU_DIR}")
        return False

    # Nombre del archivo de salida (mismo nombre sin .snaphu, agrega _UNW)
    base_name    = os.path.basename(phase_file).replace(".snaphu.img", "")
    unwrap_name  = f"{base_name}_UNW.img"
    unwrap_file  = os.path.join(SNAPHU_DIR, unwrap_name)

    print(f"  📋 Config:   {os.path.basename(conf_file)}")
    print(f"  🗺️  Input:    {os.path.basename(phase_file)}")
    print(f"  🎯 Output:   {unwrap_name}")
    print(f"\n⏳ Iniciando snaphu a las {datetime.now().strftime('%H:%M:%S')}...\n")

    # Leer dimensiones desde el .conf para pasarlas a snaphu
    width, nlines = None, None
    with open(conf_file) as f:
        for line in f:
            line = line.strip()
            if line.startswith("LINELENGTH"):
                width  = line.split()[-1]
            elif line.startswith("FILE_LENGTH") or line.startswith("NLINES"):
                nlines = line.split()[-1]

    if not width or not nlines:
        print("⚠️  No se pudieron leer LINELENGTH/FILE_LENGTH del .conf.")
        print("   Verifica el archivo manualmente.")
        return False

    print(f"  Dimensiones detectadas: {width} cols × {nlines} filas")

    cmd = [
        SNAPHU_PATH,
        "-f", conf_file,
        phase_file,
        width,
        "-o", unwrap_file,
    ]

    print("Comando:\n  " + " \\\n  ".join(cmd) + "\n")
    start = time.time()

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                print(f"  SNAPHU> {line}")
        proc.wait(timeout=14400)   # 4 horas máximo
        rc = proc.returncode
    except subprocess.TimeoutExpired:
        proc.kill()
        print(f"⏰ TIMEOUT snaphu")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

    elapsed = (time.time() - start) / 60

    if rc == 0:
        print(f"\n✅ Unwrapping completado en {elapsed:.1f} min")
        print(f"   Salida: {unwrap_file}")

        # Verificar que el .img resultante está DENTRO de SNAPHU_DIR
        # (snaphu a veces lo deja fuera si el path es relativo)
        if not os.path.exists(unwrap_file):
            # Buscar en el directorio actual
            alt = os.path.join(os.getcwd(), unwrap_name)
            if os.path.exists(alt):
                shutil.copy2(alt, unwrap_file)
                print(f"   📋 Copiado a carpeta SNAPHU: {unwrap_file}")
        return True
    else:
        print(f"\n❌ snaphu falló (código {rc}) tras {elapsed:.1f} min")
        return False


# ── Paso 3: SNAPHU Import ────────────────────────────────────

def step_import():
    banner("PASO 3: SNAPHU Import")

    write_graph(GRAPH_IMPORT, SNAPHU_IMPORT_XML)

    if not os.path.exists(SUBSET_INPUT):
        print(f"❌ No se encuentra el Subset input:\n   {SUBSET_INPUT}")
        return False

    # Buscar el .img desenrollado dentro de SNAPHU_DIR
    unwrapped_img = find_unwrapped_img(SNAPHU_DIR)
    if not unwrapped_img:
        print(f"❌ No se encontró el archivo .img desenrollado en {SNAPHU_DIR}")
        print("   ¿Ejecutaste el Paso 2 (Unwrap)?")
        return False

    print(f"  🎯 Fase desenrollada: {os.path.basename(unwrapped_img)}")

    params = {
        "inputFile":     SUBSET_INPUT,
        "unwrappedFile": unwrapped_img,
        "outputFile":    IMPORT_OUTPUT,
    }

    ok = run_gpt("SNAPHU Import", GRAPH_IMPORT, params)

    if ok:
        size_mb = os.path.getsize(IMPORT_OUTPUT) / (1024**2) if os.path.exists(IMPORT_OUTPUT) else 0
        print(f"\n  📦 Salida: {IMPORT_OUTPUT} ({size_mb:.1f} MB)")

    return ok


# ── Main ─────────────────────────────────────────────────────

def check_config():
    """Valida que las rutas críticas estén configuradas."""
    banner("Verificando configuración")
    ok = True
    checks = [
        ("GPT",          GPT_PATH),
        ("Subset input", SUBSET_INPUT),
        ("Grafo Export", GRAPH_EXPORT),
        ("Grafo Import", GRAPH_IMPORT),
    ]
    for label, path in checks:
        exists = os.path.exists(path)
        icon   = "✅" if exists else "⚠️ "
        print(f"  {icon} {label}: {path}")
        if not exists and label in ("GPT", "Subset input"):
            ok = False

    snaphu_ok = os.path.exists(SNAPHU_PATH)
    print(f"  {'✅' if snaphu_ok else '❌'} SNAPHU bin: {SNAPHU_PATH}")
    if not snaphu_ok:
        print("     → Edita SNAPHU_PATH en la sección CONFIGURACIÓN")
        ok = False
    return ok


def main():
    parser = argparse.ArgumentParser(
        description="Pipeline SNAPHU: Export → Unwrap → Import")
    parser.add_argument("--step", type=int, choices=[1, 2, 3],
                        help="Ejecutar solo un paso (1=Export, 2=Unwrap, 3=Import)")
    args = parser.parse_args()

    banner("🛰️  SNAPHU Pipeline — Export / Unwrap / Import")
    print(f"Timestamp: {datetime.now()}")

    if not check_config():
        print("\n❌ Corrige la configuración y vuelve a ejecutar.")
        sys.exit(1)

    total_start = time.time()
    steps = {1: step_export, 2: step_unwrap, 3: step_import}

    if args.step:
        # Un solo paso
        ok = steps[args.step]()
    else:
        # Pipeline completo
        ok = step_export()
        if not ok:
            print("\n❌ Abortando — Paso 1 (Export) falló.")
            sys.exit(1)

        ok = step_unwrap()
        if not ok:
            print("\n❌ Abortando — Paso 2 (Unwrap) falló.")
            sys.exit(1)

        ok = step_import()

    total = (time.time() - total_start) / 60
    banner(f"{'✅ PIPELINE COMPLETO' if ok else '❌ PIPELINE FALLIDO'} en {total:.1f} minutos")


if __name__ == "__main__":
    main()