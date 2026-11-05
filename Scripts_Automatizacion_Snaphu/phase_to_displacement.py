#!/usr/bin/env python3
import subprocess
from pathlib import Path
import os

from graph_templates import render_graph

# =============================================================================
# CONFIGURACIÓN
# =============================================================================
BASE_DIR = Path(os.getenv("BASE_DIR", "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.3"))

INPUT_DIM = os.getenv("INPUT_DIM") or str(
    BASE_DIR / "SnaphuImport" / "output_final_Orb_Orb_UNW.dim"
)

OUTPUT_FOLDER = Path(os.getenv("OUTPUT_DIR") or (BASE_DIR / "PhaseToDisplacement"))
OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)

OUTPUT_DIM = OUTPUT_FOLDER / "output_final_Orb_Orb_DISP.dim"

GPT_BIN = os.getenv("GPT_BIN", "/home/nahin/esa-snap/bin/gpt")

# =============================================================================
# Validación
# =============================================================================
if not Path(INPUT_DIM).exists():
    print(f"[ERROR] Archivo de entrada no encontrado: {INPUT_DIM}")
    print("Asegúrate de ejecutar primero el Paso 5 (Snaphu).")
    exit(1)

print(f"[INFO] Input : {INPUT_DIM}")
print(f"[INFO] Output: {OUTPUT_DIM}")

# =============================================================================
# Grafo XML
# =============================================================================
xml_content = render_graph(
    "GRAFICO_6_PhaseToDisplacement.xml",
    inputFile=INPUT_DIM,
    outputFile=OUTPUT_DIM,
)

graph_path = OUTPUT_FOLDER / "PhaseToDisplacement_auto.xml"
graph_path.write_text(xml_content, encoding="utf-8")

# =============================================================================
# Ejecución
# =============================================================================
cmd = [GPT_BIN, str(graph_path)]
print("[INFO] Ejecutando PhaseToDisplacement...")

proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

if proc.returncode == 0:
    print("\n[OK] Phase to Displacement completado exitosamente!")
    print(f"[OK] Archivo generado: {OUTPUT_DIM}")
else:
    print("\n[ERROR] Falló la ejecución:")
    print(proc.stdout)
    exit(1)