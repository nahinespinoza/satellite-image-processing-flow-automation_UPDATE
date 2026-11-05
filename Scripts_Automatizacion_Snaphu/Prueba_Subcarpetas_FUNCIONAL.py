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
#     SNAPHU. El tiling (filas/columnas/overlap/procesadores/costThreshold)
#     es configurable desde la UI (SNAPHU_TILE_ROWS, SNAPHU_TILE_COLS, SNAPHU_ROW_OVERLAP,
#     SNAPHU_COL_OVERLAP, SNAPHU_PROCESSORS, SNAPHU_COST_THRESHOLD; también sin prefijo); por defecto usa 4x4 tiles
#     con overlap de 300 px, configuración confirmada empíricamente como
#     estable y ~4x más rápida que un solo tile PARA LA ESCENA COMPLETA.
#     Si el subset es chico, el Gráfico 6 reduce esta config automáticamente
#     antes de correr snaphu (ver más abajo).
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

from graph_templates import render_graph

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
# DETECCIÓN DEL ANCHO REAL (LINELENGTH) DEL PRODUCTO EXPORTADO
# =============================================================================
# LINELENGTH casi nunca viene como parámetro activo en snaphu.conf (SNAP no
# lo escribe así), así que no basta con buscarlo ahí. El ancho real del
# subset se puede recuperar de dos fuentes más confiables antes de caer al
# valor fijo 6041 (que solo es correcto si el subset mide lo mismo que la
# imagen con la que se probó originalmente):
#
#   1) El header ENVI (.hdr) que SNAP genera junto a cada .img exportado
#      (ej: Phase_ifg_VV_....snaphu.hdr), que trae "samples = <ancho>".
#      Es la fuente más directa: describe el producto que realmente se
#      exportó, sea cual sea el tamaño del POLYGON usado en el Subset.
#   2) El comentario con el comando snaphu sugerido que SNAP deja al final
#      de snaphu.conf, ej: "# snaphu -f snaphu.conf Phase_x.snaphu.img 6238"
#      -- el último número de esa línea es el ancho.
def _leer_width_desde_hdr(img_path):
    """
    Busca el header ENVI (.hdr) asociado a un .img y le lee "samples"
    (el ancho en píxeles). Prueba las dos convenciones de nombre que usa
    SNAP/BEAM (reemplazando la extensión, o agregando .hdr al final).
    Devuelve (ancho, ruta_hdr) o (None, None) si no lo encuentra.
    """
    img_path = Path(img_path)
    candidatos = [
        img_path.with_suffix(".hdr"),
        Path(str(img_path) + ".hdr"),
    ]
    for hdr_path in candidatos:
        if not hdr_path.exists():
            continue
        try:
            with open(hdr_path, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if "=" in line and line.split("=", 1)[0].strip().lower() == "samples":
                        valor = line.split("=", 1)[1].strip()
                        return int(valor), str(hdr_path)
        except (OSError, ValueError):
            continue
    return None, None

def _leer_width_desde_comentario_conf(conf_text, phase_filename):
    """
    Busca, dentro del texto de snaphu.conf, la línea comentada con el
    comando snaphu sugerido por SNAP (contiene el nombre del archivo de
    fase) y extrae el último número de esa línea, que es el ancho.
    Devuelve el ancho (int) o None si no encuentra una línea así.
    """
    for line in conf_text.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped.startswith("snaphu") and phase_filename in stripped:
            tokens = stripped.split()
            if tokens and tokens[-1].isdigit():
                return int(tokens[-1])
    return None


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

    xml_content = render_graph(
        "GRAFICO_5a_SnaphuExport.xml",
        inputFile=subset_dim,
        targetFolder=snaphu_folder,
    )

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
# =============================================================================
# TILING SEGURO: cálculo inicial + reintento adaptativo basado en snaphu
# =============================================================================
# Reemplaza el heurístico anterior de "margen fijo 2x" por dos mecanismos
# complementarios:
#
#   1) calcular_tiling_seguro(): a partir del tamaño REAL del subset,
#      reduce progresivamente NTILEROW/NTILECOL (4→3→2→1) hasta que cada
#      tile quede holgadamente más grande que el overlap deseado. Esto
#      evita gastar intentos fallidos en el caso típico (subset chico de
#      prueba vs. escena completa).
#   2) ejecutar_snaphu_con_reintento(): la red de seguridad real. No
#      predice nada — corre snaphu, y SOLO si el propio snaphu devuelve
#      el error conocido de tiling incompatible, reduce un escalón más
#      (vía reducir_tiling_un_escalon) y reintenta. Esto cubre cualquier
#      tamaño "mediano" que la heurística del paso 1 no haya anticipado
#      bien, sin depender de adivinar un factor de margen exacto.
def calcular_tiling_seguro(width, height, ntilerow_deseado, ntilecol_deseado,
                            rowovrlp_deseado, colovrlp_deseado,
                            min_ratio_tile_overlap=4):
    """
    Punto de partida: intenta respetar lo que pidió el usuario/UI
    (ntilerow_deseado x ntilecol_deseado, con el overlap deseado). Si el
    subset es demasiado chico para eso, reduce el número de tiles (nunca
    el overlap primero) hasta que cada tile mida al menos
    min_ratio_tile_overlap veces el overlap. Si ni con 1x1 alcanza,
    como último recurso también reduce el overlap.
    Devuelve (ntilerow, ntilecol, rowovrlp, colovrlp).
    """
    n_max = max(ntilerow_deseado, ntilecol_deseado, 1)
    for n in range(n_max, 0, -1):
        nr = min(n, ntilerow_deseado) or 1
        nc = min(n, ntilecol_deseado) or 1
        tile_h = height // nr
        tile_w = width // nc
        if tile_h >= rowovrlp_deseado * min_ratio_tile_overlap and \
           tile_w >= colovrlp_deseado * min_ratio_tile_overlap:
            return nr, nc, rowovrlp_deseado, colovrlp_deseado

    # Ni con 1x1 alcanza el overlap deseado: el subset es muy chico incluso
    # para eso. Se reduce también el overlap, proporcional al lado más chico.
    overlap_ajustado = max(0, min(width, height) // (min_ratio_tile_overlap * 2))
    return 1, 1, overlap_ajustado, overlap_ajustado


def _leer_tiling_actual(conf_path):
    with open(conf_path) as f:
        conf_text = f.read()
    def _val(clave, default):
        return next((l.split()[1] for l in conf_text.splitlines()
                     if l.startswith(clave)), default)
    return (int(_val("NTILEROW", "1")), int(_val("NTILECOL", "1")),
            int(_val("ROWOVRLP", "0")), int(_val("COLOVRLP", "0")))


def _escribir_tiling(conf_path, ntilerow, ntilecol, rowovrlp, colovrlp):
    new_lines = []
    with open(conf_path) as f:
        for line in f:
            if line.startswith("NTILEROW"):
                new_lines.append(f"NTILEROW \t\t{ntilerow}\n")
            elif line.startswith("NTILECOL"):
                new_lines.append(f"NTILECOL \t\t{ntilecol}\n")
            elif line.startswith("ROWOVRLP"):
                new_lines.append(f"ROWOVRLP \t\t{rowovrlp}\n")
            elif line.startswith("COLOVRLP"):
                new_lines.append(f"COLOVRLP \t\t{colovrlp}\n")
            else:
                new_lines.append(line)
    with open(conf_path, "w") as f:
        f.writelines(new_lines)


def reducir_tiling_un_escalon(conf_path):
    """
    Reduce un escalón la config de tiling actual del conf: primero baja
    el número de tiles (manteniendo el overlap), y solo cuando ya está en
    1x1 empieza a bajar el overlap. Devuelve True si pudo reducir algo,
    False si ya estaba en el mínimo absoluto (1x1, overlap=0) y no hay
    nada más que reducir.
    """
    ntilerow, ntilecol, rowovrlp, colovrlp = _leer_tiling_actual(conf_path)

    if ntilerow > 1 or ntilecol > 1:
        nuevo_nr = max(1, ntilerow - 1)
        nuevo_nc = max(1, ntilecol - 1)
        warn(f"Reduciendo tiling: {ntilerow}x{ntilecol} → {nuevo_nr}x{nuevo_nc} "
             f"(overlap se mantiene en {rowovrlp}/{colovrlp}).")
        _escribir_tiling(conf_path, nuevo_nr, nuevo_nc, rowovrlp, colovrlp)
        return True

    if rowovrlp > 0 or colovrlp > 0:
        nuevo_row_ov = rowovrlp // 2
        nuevo_col_ov = colovrlp // 2
        warn(f"Ya en 1x1; reduciendo overlap: {rowovrlp}/{colovrlp} → "
             f"{nuevo_row_ov}/{nuevo_col_ov}.")
        _escribir_tiling(conf_path, 1, 1, nuevo_row_ov, nuevo_col_ov)
        return True

    return False  # ya está en el mínimo absoluto (1x1, overlap 0)


# Mensajes de snaphu que indican específicamente un problema de tiling
# (no un error de datos, formato, o config general, que no tiene sentido
# reintentar reduciendo tiles).
_ERRORES_TILING_CONOCIDOS = (
    "tiles too small",
    "overlap too large",
    "not enough tiles",
    "invalid tile",
)


def ejecutar_snaphu_con_reintento(snaphu_bin, conf_path, phase_filename, line_width,
                                   work_dir, log_path, max_intentos=4):
    """
    Corre snaphu. Si falla con un error de tiling conocido, reduce un
    escalón la config (ver reducir_tiling_un_escalon) y reintenta, hasta
    max_intentos veces o hasta que ya no se pueda reducir más.
    Devuelve (exito: bool, output_completo: str, intentos_usados: int).
    """
    cmd = [snaphu_bin, "-f", str(conf_path), phase_filename, str(line_width)]
    output_total = []

    for intento in range(1, max_intentos + 1):
        info(f"Intento {intento}/{max_intentos} — comando: {' '.join(cmd)}")
        proc = subprocess.Popen(cmd, cwd=str(work_dir), stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True)
        lines_este_intento = []
        for line in proc.stdout:
            sys.stdout.write(line)
            lines_este_intento.append(line)
        proc.wait()
        output_este_intento = "".join(lines_este_intento)
        output_total.append(f"\n--- intento {intento} ---\n{output_este_intento}")

        if proc.returncode == 0:
            with open(log_path, "w") as log_f:
                log_f.write("".join(output_total))
            return True, "".join(output_total), intento

        es_error_tiling = any(msg in output_este_intento.lower()
                               for msg in _ERRORES_TILING_CONOCIDOS)

        if not es_error_tiling:
            error(f"snaphu falló con un error que NO es de tiling (código {proc.returncode}). "
                  f"No tiene sentido reintentar reduciendo tiles — revisa el log.")
            with open(log_path, "w") as log_f:
                log_f.write("".join(output_total))
            return False, "".join(output_total), intento

        warn(f"Intento {intento}: snaphu reportó un error de tiling conocido "
             f"('tiles too small'/'overlap too large' o similar).")
        if not reducir_tiling_un_escalon(conf_path):
            error("Ya se llegó a la config mínima (1x1, overlap 0) y snaphu sigue fallando. "
                  "El problema ya no es de tiling — probablemente el subset es demasiado "
                  "chico para el algoritmo de unwrapping en sí (ver nota más abajo).")
            with open(log_path, "w") as log_f:
                log_f.write("".join(output_total))
            return False, "".join(output_total), intento

    with open(log_path, "w") as log_f:
        log_f.write("".join(output_total))
    return False, "".join(output_total), max_intentos


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
    with open(conf_path) as f:
        content = f.read()

    def _ancho_consistente_con_archivo(width):
        """
        True si 'width' es compatible con el tamaño real de phase_file
        (datos FLOAT_DATA de 4 bytes por píxel): el total de floats debe
        ser múltiplo exacto del ancho. Si no se puede leer el tamaño, se
        acepta el candidato igual (no hay forma de descartarlo).
        """
        if not width:
            return False
        try:
            size = phase_file.stat().st_size
        except OSError:
            return True
        return (size // 4) % width == 0

    # Se recolectan TODOS los candidatos posibles y se valida cada uno
    # contra el tamaño real del archivo, en vez de confiar ciegamente en
    # el primero que aparezca (un .hdr viejo de otra corrida, por ejemplo,
    # podría traer un ancho que ya no corresponde a este subset).
    candidatos = []

    # 1) LINELENGTH activo en el conf (rara vez SNAP lo escribe así).
    for line in content.splitlines():
        parts = line.split()
        if parts and parts[0] == "LINELENGTH":
            try:
                candidatos.append((int(parts[1]), "LINELENGTH en snaphu.conf"))
            except (IndexError, ValueError):
                pass

    # 2) Header ENVI (.hdr) que SNAP genera junto al .img de fase -- fuente
    #    confiable porque describe el producto realmente exportado, sea
    #    cual sea el tamaño del subset/POLYGON usado.
    hdr_width, hdr_path = _leer_width_desde_hdr(phase_file)
    if hdr_width is not None:
        candidatos.append((hdr_width, f".hdr ({hdr_path})"))

    # 3) Comentario con el comando snaphu sugerido, al final de snaphu.conf
    #    (ej: "# snaphu -f snaphu.conf Phase_x.snaphu.img 6238").
    comentario_width = _leer_width_desde_comentario_conf(content, phase_file.name)
    if comentario_width is not None:
        candidatos.append((comentario_width, "comentario del comando sugerido en snaphu.conf"))

    line_width = None
    width_source = None
    for width, fuente in candidatos:
        if _ancho_consistente_con_archivo(width):
            line_width, width_source = width, fuente
            ok(f"Ancho de línea: {width} (fuente: {fuente}) -- consistente con el tamaño de {phase_file.name}.")
            break
        else:
            warn(f"Candidato de ancho {width} (fuente: {fuente}) NO es múltiplo exacto del tamaño "
                 f"de {phase_file.name} -- se descarta, se prueba la siguiente fuente.")

    if line_width is None and candidatos:
        # Ninguno pasó la validación de tamaño: se usa el primero encontrado
        # igual (validate_img_file más abajo lo vuelve a chequear y muestra
        # el detalle completo si sigue sin cuadrar).
        line_width, width_source = candidatos[0]
        warn(f"Ningún candidato pasó la validación de tamaño; se usa el primero encontrado "
             f"igual ({line_width}, fuente: {width_source}) -- revisa el diagnóstico de abajo.")

    if line_width is None:
        warn("No se encontró el ancho en LINELENGTH, en el .hdr, ni en el comentario de snaphu.conf.")
        if os.environ.get("NON_INTERACTIVE") == "1":
            line_width = 6041
            width_source = "default hardcodeado (6041)"
            warn(f"Modo API: cayendo al valor por defecto {line_width}. "
                 f"Esto casi seguro está MAL si el subset no mide lo mismo que la imagen "
                 f"con la que se probó originalmente -- revisa por qué no se encontró el "
                 f"header (.hdr) del producto exportado.")
        else:
            lw_str = ask("Introduce el ancho de línea (LINE_WIDTH) manualmente", default="6041")
            line_width = int(lw_str)
            width_source = "ingresado manualmente"

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

    # ── Cálculo de tiling seguro (punto de partida) ──────────────────────
    # La config 4x4 + overlap 300 (o la que haya pedido el usuario en la
    # UI) fue pensada para la ESCENA COMPLETA. Con un subset chico (ej. un
    # POLYGON de prueba) cada tile queda más chico que el propio overlap.
    # En vez de solo detectar el problema y caer directo a 1x1, se calcula
    # el tiling más grande que SÍ entra en el tamaño real del subset —
    # esto evita gastar reintentos en el caso típico (subset de prueba
    # chico vs. escena real grande).
    height = int(phase_diag["rows_as_float32"]) if phase_diag else None
    if height:
        nr_seguro, nc_seguro, rov_seguro, cov_seguro = calcular_tiling_seguro(
            width=line_width, height=height,
            ntilerow_deseado=int(ntilerow), ntilecol_deseado=int(ntilecol),
            rowovrlp_deseado=int(rowovrlp), colovrlp_deseado=int(colovrlp),
        )
        if (nr_seguro, nc_seguro, rov_seguro, cov_seguro) != (int(ntilerow), int(ntilecol), int(rowovrlp), int(colovrlp)):
            warn(f"Config de tiling pedida ({ntilerow}x{ntilecol}, overlap {rowovrlp}/{colovrlp}) "
                 f"no entra en el tamaño real del subset ({line_width}x{height}px). "
                 f"Ajustada a {nr_seguro}x{nc_seguro}, overlap {rov_seguro}/{cov_seguro} "
                 f"para esta corrida (no afecta la config guardada para la escena completa).")
            _escribir_tiling(conf_path, nr_seguro, nc_seguro, rov_seguro, cov_seguro)
            multi_tile = (nr_seguro > 1 or nc_seguro > 1)
        else:
            ok(f"Config de tiling pedida ({ntilerow}x{ntilecol}, overlap {rowovrlp}/{colovrlp}) "
               f"es compatible con el tamaño real del subset. Se deja sin cambios.")

    # ── Ejecutar snaphu, con reintento automático si falla por tiling ───
    # Esta es la red de seguridad real: si el cálculo de arriba no fue
    # suficiente (tamaños "medianos" en zona gris), se deja que snaphu
    # mismo confirme el fallo con su mensaje de error, y se reduce un
    # escalón más antes de reintentar — sin depender de adivinar un
    # margen exacto.
    subheader("Ejecutando snaphu (con reintento automático si falla por tiling)")
    snaphu_bin = cfg["snaphu_bin"]
    info(f"Binario   : {snaphu_bin}")
    info(f"Directorio: {work_dir}")
    print()

    log_path = work_dir / "snaphu_unwrapping.log"
    exito, output, intentos_usados = ejecutar_snaphu_con_reintento(
        snaphu_bin=snaphu_bin, conf_path=conf_path, phase_filename=phase_file.name,
        line_width=line_width, work_dir=work_dir, log_path=log_path,
    )

    if not exito:
        error(f"snaphu falló tras {intentos_usados} intento(s).")
        error(f"Log completo en: {log_path}")
        subheader("Últimas líneas del log para diagnóstico rápido")
        for l in output.splitlines()[-20:]:
            print(f"    {l.rstrip()}")
        info("Si el subset es de solo unos pocos píxeles de lado, este fallo puede "
             "deberse a que la imagen es demasiado chica para el algoritmo de "
             "unwrapping (MCF) en sí, no a la config de tiling — en ese caso hace "
             "falta un polígono más grande, no más ajuste de parámetros.")
        return False

    if intentos_usados > 1:
        ok(f"snaphu terminó exitosamente tras reducir el tiling automáticamente "
           f"({intentos_usados} intentos).")

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

    xml_content = render_graph(
        "GRAFICO_5c_SnaphuImport.xml",
        inputFile=subset_dim,
        unwrappedFile=unw_file,
        outputFile=out_path,
    )

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