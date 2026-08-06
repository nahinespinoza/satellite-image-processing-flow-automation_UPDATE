#!/usr/bin/env python3
# =============================================================================
# PIPELINE AUTOMÁTICO: Gráfico 5 → Gráfico 6 → Gráfico 7
#   - Gráfico 5: SNAPHU EXPORT      (via gpt de SNAP)
#   - Gráfico 6: SNAPHU UNWRAPPING  (via snaphu en terminal)
#   - Gráfico 7: SNAPHU IMPORT      (via gpt de SNAP)
#
# VERSIÓN CON VALIDACIONES: cada etapa imprime un diagnóstico explícito
# de qué se generó, qué formato tiene, y si pasó o falló, antes de
# continuar con la siguiente etapa.
#
# USO:
#   python3 snap_snaphu_pipeline.py
# =============================================================================
# VERSION FUNCIONAL COMPLETA, CON VALIDACIONES EN CADA PASO - Jueves 18/06/2026
# =============================================================================
# DESCRIPCIÓN
# =============================================================================
# Este script automatiza tres etapas del flujo InSAR en SNAP que normalmente
# se ejecutan a mano (Gráfico 5, 6 y 7), y valida cada una antes de continuar
# a la siguiente:
#
#   Gráfico 5 — Snaphu Export (gpt)
#     Lee el .dim del Gráfico 4 (Subset) y genera los archivos binarios que
#     snaphu necesita (Phase_*.img, coh_*.img, snaphu.conf) en la carpeta
#     SNAPHU. Usa 4x4 tiles con overlap de 300 px, configuración confirmada
#     empíricamente como estable y ~4x más rápida que un solo tile.
#
#   Gráfico 6 — Snaphu Unwrapping (binario snaphu en terminal)
#     Antes de ejecutar snaphu, valida tamaño y contenido (NaN/Inf, rango de
#     valores) de los archivos Phase y Coherencia, corrige automáticamente
#     el parámetro CORRFILE en snaphu.conf si SNAP lo dejó incompleto (bug
#     conocido: a veces queda como ".snaphu.img" en vez del nombre real), y
#     advierte si detecta tiles múltiples con overlap insuficiente (<200px),
#     configuración que causa crashes de procesos hijo durante el ensamblado.
#
#   Gráfico 7 — Snaphu Import (gpt)
#     Combina el Subset original con la fase desenvuelta (UnwPhase_*.img) y
#     escribe el producto final con sufijo _UNW, validando que el .dim y las
#     bandas .img se generaron correctamente.
#
# Cada etapa imprime su propio diagnóstico (tamaños, formatos, valores
# mín/máx, NaN/Inf) para que cualquier falla sea visible de inmediato en
# lugar de descubrirse varios pasos después. Si una etapa falla, el pipeline
# se detiene y muestra las últimas líneas del log relevante.
#
# Requiere: SNAP (gpt), snaphu instalado (PATH o bundled en .snap/auxdata),
# Python 3 con numpy (opcional, mejora la validación de archivos binarios).
# =============================================================================

import os
import sys
import subprocess
import shutil
import glob
import struct
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(os.getenv("BASE_DIR", "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.3/Scripts_Automatizacion_Snaphu"))
SUBSET_DIM = os.getenv("SUBSET_DIM")

# Al inicio del script, después de los imports:
input_dim = os.getenv("INPUT_DIM") or str(BASE_DIR / "SnaphuImport" / "output_final_Orb_Orb_UNW.dim")
output_folder = os.getenv("OUTPUT_DIR") or str(BASE_DIR / "PhaseToDisplacement")

# =============================================================================
# COLORES PARA TERMINAL
# =============================================================================
class C:
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    GREEN  = "\033[92m"
    YELLOW = "\033[93m"
    RED    = "\033[91m"
    CYAN   = "\033[96m"
    BLUE   = "\033[94m"
    MAGENTA = "\033[95m"

def header(msg):
    print(f"\n{C.BOLD}{C.BLUE}{'='*70}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}  {msg}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}{'='*70}{C.RESET}\n")

def subheader(msg):
    print(f"\n{C.BOLD}{C.MAGENTA}--- {msg} ---{C.RESET}")

def info(msg):    print(f"{C.CYAN}[INFO]{C.RESET}     {msg}")
def ok(msg):      print(f"{C.GREEN}[OK]{C.RESET}       {msg}")
def warn(msg):    print(f"{C.YELLOW}[WARN]{C.RESET}     {msg}")
def error(msg):   print(f"{C.RED}[ERROR]{C.RESET}    {msg}")
def check(msg):   print(f"{C.BOLD}[CHECK]{C.RESET}    {msg}")
def step(n, msg): print(f"\n{C.BOLD}{C.YELLOW}▶ PASO {n}: {msg}{C.RESET}")

# =============================================================================
# HELPERS DE ENTRADA
# =============================================================================
def ask(prompt, default=None):
    if default:
        full_prompt = f"{C.CYAN}{prompt}{C.RESET}\n  [{default}]: "
    else:
        full_prompt = f"{C.CYAN}{prompt}{C.RESET}\n  Ruta: "
    while True:
        val = input(full_prompt).strip()
        if not val and default:
            return default
        if val:
            return val
        print("  La ruta no puede estar vacía. Intenta de nuevo.")

def ask_yes_no(prompt, default="s"):
    val = input(f"{C.CYAN}{prompt}{C.RESET} [s/n] ({default}): ").strip().lower()
    return (val or default).startswith("s")

def check_file(path, label):
    if not Path(path).exists():
        error(f"{label} NO encontrado: {path}")
        return False
    ok(f"{label} verificado: {path}")
    return True

def check_cmd(cmd):
    found = shutil.which(cmd)
    if found is None:
        error(f"Comando '{cmd}' NO encontrado en PATH.")
        return None
    ok(f"'{cmd}' disponible en: {found}")
    return found

# =============================================================================
# VALIDADOR GENÉRICO DE ARCHIVO BINARIO .img
# =============================================================================
def validate_img_file(path, expected_width=None, label="archivo"):
    """
    Inspecciona un archivo .img binario y reporta:
    - si existe
    - tamaño en bytes
    - filas estimadas si se conoce el ancho esperado (float32)
    - si tiene NaN/Inf (requiere numpy; se omite si no está disponible)
    Retorna dict con el diagnóstico, o None si el archivo no existe.
    """
    p = Path(path)
    if not p.exists():
        error(f"  [{label}] archivo no existe: {path}")
        return None

    size = p.stat().st_size
    diag = {"path": str(p), "size_bytes": size}

    info(f"  [{label}] tamaño: {size:,} bytes")

    if expected_width:
        n_floats = size // 4
        rows_f32 = n_floats / expected_width
        diag["rows_as_float32"] = rows_f32
        if rows_f32 == int(rows_f32):
            ok(f"  [{label}] consistente con FLOAT_DATA, ancho={expected_width} → filas={int(rows_f32)}")
        else:
            warn(f"  [{label}] NO es múltiplo exacto de ancho={expected_width} como FLOAT_DATA → filas={rows_f32:.3f}")

        # Chequeo alterno: ALT_LINE_DATA (doble dato por pixel)
        rows_alt = n_floats / (expected_width * 2)
        diag["rows_as_alt_line_data"] = rows_alt
        if rows_alt == int(rows_alt):
            info(f"  [{label}] también sería consistente con ALT_LINE_DATA → filas={int(rows_alt)}")

    try:
        import numpy as np
        data = np.fromfile(str(p), dtype=np.float32)
        diag["min"] = float(np.nanmin(data)) if data.size else None
        diag["max"] = float(np.nanmax(data)) if data.size else None
        diag["mean"] = float(np.nanmean(data)) if data.size else None
        diag["nan_count"] = int(np.isnan(data).sum())
        diag["inf_count"] = int(np.isinf(data).sum())

        info(f"  [{label}] min={diag['min']:.4f}  max={diag['max']:.4f}  mean={diag['mean']:.4f}")
        if diag["nan_count"] > 0:
            warn(f"  [{label}] contiene {diag['nan_count']} valores NaN")
        if diag["inf_count"] > 0:
            warn(f"  [{label}] contiene {diag['inf_count']} valores Inf")
        if diag["nan_count"] == 0 and diag["inf_count"] == 0:
            ok(f"  [{label}] sin NaN/Inf")
    except ImportError:
        warn(f"  [{label}] numpy no disponible — se omite chequeo de valores (NaN/Inf/min/max)")
        info(f"           instalar con: pip install numpy --break-system-packages")

    return diag

# =============================================================================
# VALIDADOR DE snaphu.conf
# =============================================================================
def validate_snaphu_conf(conf_path):
    """
    Lee snaphu.conf y reporta el valor actual de cada parámetro crítico
    que ha causado problemas en este pipeline:
    CORRFILE, CORRFILEFORMAT, NTILEROW, NTILECOL, ROWOVRLP, COLOVRLP, NPROC
    Retorna dict {param: valor_str} o None si no existe el archivo.
    """
    p = Path(conf_path)
    if not p.exists():
        error(f"snaphu.conf no encontrado: {conf_path}")
        return None

    critical_params = [
        "CORRFILE", "CORRFILEFORMAT", "INFILEFORMAT", "OUTFILEFORMAT",
        "NTILEROW", "NTILECOL", "ROWOVRLP", "COLOVRLP", "NPROC",
        "TILECOSTTHRESH", "LINELENGTH", "STATCOSTMODE", "INITMETHOD",
    ]
    found = {}
    with open(p) as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            parts = stripped.split(None, 1)
            if not parts:
                continue
            key = parts[0]
            val = parts[1].strip() if len(parts) > 1 else ""
            if key in critical_params:
                found[key] = val

    subheader(f"Diagnóstico de snaphu.conf: {p}")
    for param in critical_params:
        if param in found:
            print(f"    {param:<16} = {found[param]}")
        else:
            print(f"    {param:<16} = {C.YELLOW}(no definido){C.RESET}")

    return found

# =============================================================================
# PASO 0 – RECOLECTAR RUTAS
# =============================================================================
# =============================================================================
# PASO 0 – RECOLECTAR RUTAS (MODIFICADO)
# =============================================================================
# =============================================================================
# PASO 0 – RECOLECTAR RUTAS (SOLO MODO NO-INTERACTIVO)
# =============================================================================
def collect_inputs():
    print(f"[DEBUG] NON_INTERACTIVE env var = '{os.environ.get('NON_INTERACTIVE', 'NO ESTÁ DEFINIDA')}'")
    print(f"[DEBUG] ALL env vars with SNAP: {[k for k in os.environ.keys() if 'SNAP' in k or 'NON' in k]}")

    header("CONFIGURACIÓN DEL PIPELINE")
    
    info("Modo API: cargando configuración desde variables de entorno")
    
    subset_dim = os.environ.get("SUBSET_DIM")
    base_folder = os.environ.get("BASE_FOLDER")
    export_dir = os.environ.get("EXPORT_DIR")
    unwrap_dir = os.environ.get("UNWRAP_DIR")
    import_dir = os.environ.get("IMPORT_DIR")
    gpt_bin = os.environ.get("GPT_BIN", "/home/nahin/esa-snap/bin/gpt")
    snaphu_bin = os.environ.get("SNAPHU_BIN", "/home/nahin/.snap/auxdata/snaphu-v2.0.4_linux/bin/snaphu")

    # Validar que todas las variables requeridas estén presentes
    required = {
        "SUBSET_DIM": subset_dim,
        "BASE_FOLDER": base_folder,
        "EXPORT_DIR": export_dir,
        "UNWRAP_DIR": unwrap_dir,
        "IMPORT_DIR": import_dir,
    }
    
    missing = [k for k, v in required.items() if not v]
    if missing:
        error(f"Faltan variables de entorno requeridas: {', '.join(missing)}")
        sys.exit(1)

    # Validar archivos
    for path, label in [(subset_dim, "SUBSET_DIM"), (gpt_bin, "GPT_BIN"), (snaphu_bin, "SNAPHU_BIN")]:
        if not Path(path).exists():
            error(f"{label} no encontrado: {path}")
            sys.exit(1)

    ok(f"Configuración cargada correctamente")
    
    return {
        "subset_dim": subset_dim,
        "base_folder": base_folder,
        "export_dir": export_dir,
        "unwrap_dir": unwrap_dir,
        "import_dir": import_dir,
        "gpt_bin": gpt_bin,
        "snaphu_bin": snaphu_bin,
    }
# =============================================================================
# PASO 1 – GRÁFICO 5: SNAPHU EXPORT (con validación posterior)
# =============================================================================
def run_grafico5(cfg):
    header("GRÁFICO 5 – SNAPHU EXPORT")

    snaphu_folder = cfg["export_dir"]
    Path(snaphu_folder).mkdir(parents=True, exist_ok=True)
    ok(f"Carpeta SnaphuExport lista: {snaphu_folder}")

    subset_dim = cfg["subset_dim"]

    xml_content = f"""<graph id="Graph">
  <version>1.0</version>

  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>{subset_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="SnaphuExport">
    <operator>SnaphuExport</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <targetFolder>{snaphu_folder}</targetFolder>
      <statCostMode>DEFO</statCostMode>
      <initMethod>MCF</initMethod>
      <numberOfTileRows>4</numberOfTileRows>
      <numberOfTileCols>4</numberOfTileCols>
      <numberOfProcessors>4</numberOfProcessors>
      <rowOverlap>300</rowOverlap>
      <colOverlap>300</colOverlap>
      <tileCostThreshold>500</tileCostThreshold>
    </parameters>
  </node>

</graph>
"""

    graph_path = Path(snaphu_folder) / "GRAFICO_5_SnaphuExport_auto.xml"
    graph_path.write_text(xml_content, encoding="utf-8")
    info(f"Grafo XML generado: {graph_path}")

    cmd = [cfg["gpt_bin"], str(graph_path)]
    info(f"Ejecutando: {' '.join(cmd)}")
    print()

    log_path = Path(snaphu_folder) / "grafico5.log"
    with open(log_path, "w") as log_f:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            sys.stdout.write(line)
            log_f.write(line)
        proc.wait()

    if proc.returncode != 0:
        error(f"Gráfico 5 (gpt) terminó con código {proc.returncode}. Revisa: {log_path}")
        return False

    ok("gpt terminó sin error de retorno. Ahora validando archivos generados...")

    # ── VALIDACIÓN POST-EXPORT ────────────────────────────────────────────
    subheader("VALIDACIÓN: archivos generados por el Gráfico 5")

    phase_files = (
        glob.glob(f"{snaphu_folder}/**/Phase_*.snaphu.img", recursive=True) +
        glob.glob(f"{snaphu_folder}/Phase_*.snaphu.img")
    )
    coh_files = (
        glob.glob(f"{snaphu_folder}/**/coh_*.snaphu.img", recursive=True) +
        glob.glob(f"{snaphu_folder}/coh_*.snaphu.img")
    )
    conf_files = (
        glob.glob(f"{snaphu_folder}/**/snaphu.conf", recursive=True) +
        glob.glob(f"{snaphu_folder}/snaphu.conf")
    )

    all_ok = True

    if not phase_files:
        error("  No se generó ningún archivo Phase_*.snaphu.img")
        all_ok = False
    else:
        ok(f"  Phase encontrado: {phase_files[0]}")

    if not coh_files:
        error("  No se generó ningún archivo coh_*.snaphu.img")
        all_ok = False
    else:
        ok(f"  Coherencia encontrada: {coh_files[0]}")

    if not conf_files:
        error("  No se generó snaphu.conf")
        all_ok = False
    else:
        ok(f"  snaphu.conf encontrado: {conf_files[0]}")

    if not all_ok:
        error("Gráfico 5 incompleto. Revisa el log antes de continuar.")
        return False

    # Tamaños relativos: Phase y coherencia deben coincidir en bytes
    phase_size = Path(phase_files[0]).stat().st_size
    coh_size = Path(coh_files[0]).stat().st_size
    if phase_size != coh_size:
        warn(f"  Phase ({phase_size:,} bytes) y coherencia ({coh_size:,} bytes) "
             f"tienen tamaños DIFERENTES — esto puede indicar un problema de formato.")
    else:
        ok(f"  Phase y coherencia tienen el mismo tamaño ({phase_size:,} bytes) — consistente.")

    cfg["phase_file"] = Path(phase_files[0])
    cfg["coh_file"] = Path(coh_files[0])
    cfg["conf_file"] = Path(conf_files[0])
    cfg["work_dir"] = Path(phase_files[0]).parent

    ok("Gráfico 5 (Snaphu Export) completado y validado.")
    return True

# =============================================================================
# PASO 2 – GRÁFICO 6: SNAPHU UNWRAPPING (con validación previa y posterior)
# =============================================================================
def run_grafico6(cfg):
    header("GRÁFICO 6 – SNAPHU UNWRAPPING")

    phase_file = cfg["phase_file"]
    coh_file = cfg["coh_file"]
    conf_path = cfg["conf_file"]
    work_dir = phase_file.parent
    cfg["work_dir"] = work_dir

    ok(f"Directorio de trabajo: {work_dir}")
    ok(f"Archivo de fase: {phase_file.name}")
    ok(f"Archivo de coherencia: {coh_file.name}")

    # ── VALIDACIÓN PREVIA: leer ancho desde el conf ──────────────────────
    subheader("Leyendo ancho de línea (LINELENGTH) desde snaphu.conf")
    line_width = None
    with open(conf_path) as f:
        content = f.read()
    for line in content.splitlines():
        parts = line.split()
        if parts and parts[0] == "LINELENGTH":
            try:
                line_width = int(parts[1])
                ok(f"LINELENGTH encontrado en conf: {line_width}")
            except (IndexError, ValueError):
                pass

    if line_width is None:
        warn("No se encontró LINELENGTH en snaphu.conf.")
        if os.environ.get("NON_INTERACTIVE") == "1":
            line_width = 6041
            info(f"Modo API: usando LINE_WIDTH por defecto = {line_width}")
        else:
            lw_str = ask("Introduce el ancho de línea (LINE_WIDTH) manualmente", default="6041")
            line_width = int(lw_str)

    # ── VALIDACIÓN: inspeccionar binarios Phase y Coherencia ─────────────
    subheader("Validando archivo de FASE")
    phase_diag = validate_img_file(phase_file, expected_width=line_width, label="Phase")

    subheader("Validando archivo de COHERENCIA")
    coh_diag = validate_img_file(coh_file, expected_width=line_width, label="Coherencia")

    if phase_diag and coh_diag:
        if phase_diag["size_bytes"] != coh_diag["size_bytes"]:
            warn("Phase y coherencia NO tienen el mismo tamaño en bytes — esto puede causar "
                 "el error 'wrong size' en snaphu.")
        else:
            ok("Phase y coherencia tienen tamaños consistentes entre sí.")

    # ── Corregir CORRFILE (nombre incompleto/vacío es un problema conocido) ──
    # SNAP a veces escribe CORRFILE como ".snaphu.img" (le falta el prefijo
    # "coh_..."), lo que hace que snaphu busque un archivo que no existe.
    # Aquí: si el valor actual no es EXACTAMENTE el nombre real del archivo
    # de coherencia que ya confirmamos que existe en disco, se corrige.
    subheader("Corrigiendo parámetros conocidos en snaphu.conf")
    new_lines = []
    corrfile_fixed = False
    corrfile_original = None
    with open(conf_path) as f:
        for line in f:
            if line.startswith("CORRFILE") and not line.startswith("CORRFILEFORMAT"):
                current_val = line.split(None, 1)[1].strip() if len(line.split(None, 1)) > 1 else ""
                corrfile_original = current_val
                if current_val != coh_file.name:
                    corrfile_fixed = True
                    new_lines.append(f"CORRFILE \t\t{coh_file.name}\n")
                else:
                    new_lines.append(line)
            else:
                new_lines.append(line)
    with open(conf_path, "w") as f:
        f.writelines(new_lines)

    if corrfile_fixed:
        warn(f"CORRFILE estaba mal definido (valor original: '{corrfile_original}') "
             f"— corregido a '{coh_file.name}'.")
    else:
        ok("CORRFILE ya apuntaba correctamente al archivo de coherencia.")

    # ── Mostrar diagnóstico completo del conf antes de ejecutar ──────────
    validate_snaphu_conf(conf_path)

    # ── Advertencia conocida: tile múltiple SIN overlap suficiente crashea ──
    # Confirmado empíricamente: NTILEROW/COL=4 con ROWOVRLP/COLOVRLP=0 crashea
    # en el ensamblado de tiles. Con overlap >=300 corrió completo (16/16 tiles,
    # ~14 min wall-clock vs ~35 min en un solo tile). La causa no es memoria
    # ni el binario: es que un overlap insuficiente deja a cada tile sin
    # contexto suficiente en los bordes para que el solver MCF converja al
    # ensamblar las redes secundarias entre tiles vecinos.
    with open(conf_path) as f:
        conf_text = f.read()
    ntilerow = next((l.split()[1] for l in conf_text.splitlines() if l.startswith("NTILEROW")), "1")
    ntilecol = next((l.split()[1] for l in conf_text.splitlines() if l.startswith("NTILECOL")), "1")
    rowovrlp = next((l.split()[1] for l in conf_text.splitlines() if l.startswith("ROWOVRLP")), "0")
    colovrlp = next((l.split()[1] for l in conf_text.splitlines() if l.startswith("COLOVRLP")), "0")

    multi_tile = (ntilerow != "1" or ntilecol != "1")
    low_overlap = (int(rowovrlp) < 200 or int(colovrlp) < 200) if multi_tile else False

    if multi_tile and low_overlap:
        warn(f"NTILEROW={ntilerow} NTILECOL={ntilecol} con ROWOVRLP={rowovrlp} COLOVRLP={colovrlp} "
             f"→ overlap insuficiente. Esta combinación ha causado crashes "
             f"('Unexpected or abnormal exit of child process') al ensamblar tiles. "
             f"Se recomienda ROWOVRLP/COLOVRLP >= 300 con tiles 4x4, que corrió "
             f"estable en pruebas (16/16 tiles, ~14 min vs ~35 min en un solo tile).")
    elif multi_tile:
        ok(f"NTILEROW={ntilerow} NTILECOL={ntilecol} con overlap={rowovrlp}/{colovrlp} "
           f"→ configuración validada empíricamente como estable.")
    else:
        info(f"NTILEROW={ntilerow} NTILECOL={ntilecol} → un solo tile, sin paralelismo "
             f"(más lento pero siempre estable).")

    # ── Ejecutar snaphu ────────────────────────────────────────────────
    subheader("Ejecutando snaphu")
    snaphu_bin = cfg["snaphu_bin"]
    cmd = [snaphu_bin, "-f", str(conf_path), phase_file.name, str(line_width)]
    info(f"Binario   : {snaphu_bin}")
    info(f"Directorio: {work_dir}")
    info(f"Comando   : {' '.join(cmd)}")
    print()

    log_path = work_dir / "snaphu_unwrapping.log"
    with open(log_path, "w") as log_f:
        proc = subprocess.Popen(cmd, cwd=str(work_dir), stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            sys.stdout.write(line)
            log_f.write(line)
        proc.wait()

    if proc.returncode != 0:
        error(f"snaphu terminó con código {proc.returncode}.")
        error(f"Log completo en: {log_path}")
        subheader("Últimas líneas del log para diagnóstico rápido")
        with open(log_path) as f:
            lines = f.readlines()
        for l in lines[-15:]:
            print(f"    {l.rstrip()}")
        return False

    # ── VALIDACIÓN POSTERIOR: ¿se generó el archivo de salida? ───────────
    subheader("Validando salida de snaphu")
    unw_candidates = (
        glob.glob(str(work_dir / "UnwPhase_*.snaphu.img")) +
        glob.glob(str(work_dir.parent / "UnwPhase_*.snaphu.img"))
    )
    if not unw_candidates:
        error("snaphu retornó código 0 pero NO se encontró ningún archivo UnwPhase_*.snaphu.img.")
        return False

    unw_file = Path(unw_candidates[0])
    validate_img_file(unw_file, expected_width=line_width, label="UnwPhase (resultado)")

    dest = work_dir / unw_file.name
    if unw_file.resolve() != dest.resolve():
        info(f"Copiando {unw_file.name} dentro de {work_dir} (requerido por el manual)…")
        shutil.copy2(str(unw_file), str(dest))
        ok(f"Copia realizada: {dest}")
    else:
        ok("El archivo ya está en el directorio correcto.")

    cfg["unw_file"] = str(dest)
    ok("Gráfico 6 (Snaphu Unwrapping) completado y validado.")
    return True

# =============================================================================
# PASO 3 – GRÁFICO 7: SNAPHU IMPORT (con validación posterior)
# =============================================================================
def run_grafico7(cfg):
    header("GRÁFICO 7 – SNAPHU IMPORT")

    subset_dim    = cfg["subset_dim"]
    unw_file      = cfg["unw_file"]
    g7_out_folder = cfg["import_dir"]
    snaphu_folder = cfg["export_dir"]

    Path(g7_out_folder).mkdir(parents=True, exist_ok=True)

    out_name = Path(subset_dim).stem + "_UNW"
    out_path = str(Path(g7_out_folder) / out_name)

    subheader("Verificando insumos antes de generar el grafo")
    inputs_ok = True
    if not check_file(subset_dim, "Subset .dim (Read-Phase)"):
        inputs_ok = False
    if not check_file(unw_file, "UnwPhase .img (Read-Unwrapped-Phase)"):
        inputs_ok = False
    if not inputs_ok:
        error("Faltan insumos para el Gráfico 7. Abortando.")
        return False

    xml_content = f"""<graph id="Graph">
  <version>1.0</version>

  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>{subset_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="ReadUnwrapped">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>{unw_file}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="SnaphuImport">
    <operator>SnaphuImport</operator>
    <sources>
      <sourceProduct refid="Read"/>
      <sourceProduct2 refid="ReadUnwrapped"/>
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
      <file>{out_path}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>

</graph>
"""

    graph_path = Path(snaphu_folder) / "GRAFICO_7_SnaphuImport_auto.xml"
    graph_path.write_text(xml_content, encoding="utf-8")
    info(f"Grafo XML generado: {graph_path}")

    cmd = [cfg["gpt_bin"], str(graph_path)]
    info(f"Ejecutando: {' '.join(cmd)}")
    print()

    log_path = Path(g7_out_folder) / "grafico7.log"
    with open(log_path, "w") as log_f:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            sys.stdout.write(line)
            log_f.write(line)
        proc.wait()

    if proc.returncode != 0:
        error(f"Gráfico 7 falló (código {proc.returncode}). Revisa: {log_path}")
        subheader("Últimas líneas del log")
        with open(log_path) as f:
            lines = f.readlines()
        for l in lines[-15:]:
            print(f"    {l.rstrip()}")
        return False

    # ── VALIDACIÓN POSTERIOR ──────────────────────────────────────────
    subheader("Validando producto final generado")
    final_dim = Path(out_path + ".dim")
    final_data_dir = Path(out_path + ".data")

    if not final_dim.exists():
        error(f"No se generó el .dim esperado: {final_dim}")
        return False
    ok(f".dim generado: {final_dim}")

    if final_data_dir.exists():
        n_bands = len(list(final_data_dir.glob("*.img")))
        ok(f".data generado con {n_bands} banda(s) .img dentro")
    else:
        warn(f"No se encontró la carpeta .data junto al .dim (puede ser normal según el formato)")

    ok(f"Gráfico 7 (Snaphu Import) completado y validado.")
    ok(f"Producto final: {final_dim}")
    return True

# =============================================================================
# MAIN
# =============================================================================
def main():
    print(f"\n{C.BOLD}{C.GREEN}")
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║   PIPELINE InSAR: Gráfico 5 → Gráfico 6 → Gráfico 7         ║")
    print("║   Snaphu Export → Unwrapping → Snaphu Import  (con validación)║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print(C.RESET)
    print(f"  Iniciado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    cfg = collect_inputs()
    
    header("RESUMEN DE CONFIGURACIÓN")
    print(f"  Subset .dim          : {cfg['subset_dim']}")
    print(f"  Carpeta Base         : {cfg['base_folder']}")
    print(f"  SnaphuExport         : {cfg['export_dir']}")
    print(f"  SnaphuUnwrapping     : {cfg['unwrap_dir']}")
    print(f"  SnaphuImport         : {cfg['import_dir']}")
    print(f"  Ejecutable gpt       : {cfg['gpt_bin']}")
    print(f"  Binario snaphu       : {cfg['snaphu_bin']}")

    

# En modo no-interactivo, saltar la confirmación del usuario
    if os.environ.get("NON_INTERACTIVE") == "1":
        info("Modo API: iniciando pipeline automáticamente")
    else:
        if not ask_yes_no("¿Todo correcto? ¿Iniciar el pipeline?", default="s"):
            print("Cancelado por el usuario.")
            sys.exit(0)

    t0 = datetime.now()
    results = {}

    results["grafico5"] = run_grafico5(cfg)
    if not results["grafico5"]:
        error("Pipeline detenido: Gráfico 5 falló la validación.")
        print_summary(results, t0)
        sys.exit(1)

    results["grafico6"] = run_grafico6(cfg)
    if not results["grafico6"]:
        error("Pipeline detenido: Gráfico 6 (Snaphu Unwrapping) falló la validación.")
        print_summary(results, t0)
        sys.exit(1)

    results["grafico7"] = run_grafico7(cfg)
    if not results["grafico7"]:
        error("Pipeline detenido: Gráfico 7 falló la validación.")
        print_summary(results, t0)
        sys.exit(1)

    print_summary(results, t0)



    
def print_summary(results, t0):
    elapsed = datetime.now() - t0
    header("RESUMEN FINAL DEL PIPELINE")
    for name in ["grafico5", "grafico6", "grafico7"]:
        status = results.get(name)
        if status is True:
            print(f"  {name:<12} : {C.GREEN}✓ OK{C.RESET}")
        elif status is False:
            print(f"  {name:<12} : {C.RED}✗ FALLÓ{C.RESET}")
        else:
            print(f"  {name:<12} : {C.YELLOW}— no ejecutado{C.RESET}")
    print(f"\n  Tiempo total: {elapsed}\n")

if __name__ == "__main__":
    main()