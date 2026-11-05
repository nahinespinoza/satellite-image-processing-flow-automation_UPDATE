#!/usr/bin/env python3
# =============================================================================
# ETAPA 2 DEL MANUAL: Range Doppler Terrain Correction (x2) + Create Stack
#                      + Band Maths (máscara de coherencia)
# =============================================================================
#
# Según el manual, esta etapa va DESPUÉS de Phase to Displacement:
#
#   1. Range Doppler Terrain Correction sobre el Subset (Gráfico 4)
#      -> bandas: intensity, phase, topo, coherencia
#   2. Range Doppler Terrain Correction sobre el resultado de
#      PhaseToDisplacement (_UNW_DISP.dim) -> banda: displacement
#   3. Create Stack de los dos productos corregidos
#      (Resampling Type: NONE, Initial Offset: Product Geolocation,
#       Output Extents: Master)
#   4. Band Maths sobre el stack: if coherencia <= 0.3 then 0 else
#      displacement_VV
#
# Por qué la coherencia se aplica AQUÍ y no antes: el manual la usa como
# máscara final sobre el desplazamiento ya corregido geométricamente y
# co-registrado en el stack — no sobre el producto crudo de
# PhaseToDisplacement (que de hecho no conserva esa banda, como ya
# confirmamos). Aplicarla antes de Terrain Correction sería comparar
# píxeles que aún no están alineados geométricamente entre sí.
#
# RUTAS A AJUSTAR: están marcadas con "=== CONFIGURACIÓN ===" abajo.
# El resto del script detecta bandas automáticamente, igual que el script
# anterior de limpieza, para que sea reusable con otros pares de fechas.
# =============================================================================

import sys
import re
import os
import subprocess
from pathlib import Path

from graph_templates import render_graph

# Carpeta base principal
BASE_DIR = Path(os.getenv("BASE_DIR", "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.3/Scripts_Automatizacion_Snaphu"))
SUBSET_DIM = os.getenv("SUBSET_DIM")
# Al inicio del script, después de los imports:
input_dim = os.getenv("INPUT_DIM") or str(BASE_DIR / "SnaphuImport" / "output_final_Orb_Orb_UNW.dim")
output_folder = os.getenv("OUTPUT_DIR") or str(BASE_DIR / "PhaseToDisplacement")

# =============================================================================
# COLORES
# =============================================================================
class C:
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    GREEN  = "\033[92m"
    YELLOW = "\033[93m"
    RED    = "\033[91m"
    CYAN   = "\033[96m"
    BLUE   = "\033[94m"

def header(msg):
    print(f"\n{C.BOLD}{C.BLUE}{'='*70}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}  {msg}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}{'='*70}{C.RESET}\n")

def ok(msg):      print(f"{C.GREEN}[OK]{C.RESET}     {msg}")
def info(msg):    print(f"{C.CYAN}[INFO]{C.RESET}   {msg}")
def warn(msg):    print(f"{C.YELLOW}[WARN]{C.RESET}   {msg}")
def error(msg):   print(f"{C.RED}[ERROR]{C.RESET}  {msg}")


# =============================================================================
# === CONFIGURACIÓN === (Rutas relativas basadas en la carpeta raíz)
# =============================================================================

# Carpeta base del proyecto
BASE_DIR = Path(os.getenv("BASE_DIR", "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.3"))

# Ruta del Subset (salida del Gráfico 4) → VIENE DESDE EL BACKEND
SUBSET_DIM = os.getenv("SUBSET_DIM") or str(
    BASE_DIR / "Grafo 4 - Final Output" / "output_final_Orb_Orb.dim"
)

# Ruta del Displacement (salida del paso anterior)
DISPLACEMENT_DIM = os.getenv("DISPLACEMENT_DIM") or str(
    BASE_DIR / "PhaseToDisplacement" / "output_final_Orb_Orb_DISP.dim"
)

# Carpeta de salida de este paso
OUTPUT_FOLDER = Path(os.getenv("OUTPUT_DIR") or (BASE_DIR / "TerrainCorrection"))
OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)

# GPT
GPT_BIN = os.getenv("GPT_BIN", "/home/nahin/esa-snap/bin/gpt")


# Los parámetros de Terrain Correction (DEM, resampling, proyección...) están
# en las plantillas GRAFICO_7a/7b de backend/files y se editan desde la interfaz.

# =============================================================================
# =============================================================================


def get_band_names(dim_path):
    text = Path(dim_path).read_text(encoding="utf-8", errors="ignore")
    return re.findall(r"<BAND_NAME>([^<]+)</BAND_NAME>", text)


def find_band(band_names, pattern):
    for name in band_names:
        if re.search(pattern, name, re.IGNORECASE):
            return name
    return None


def run_gpt(graph_path, log_path, label):
    cmd = [GPT_BIN, str(graph_path)]
    info(f"Ejecutando {label}: {' '.join(cmd)}")
    print()
    with open(log_path, "w") as log_f:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            sys.stdout.write(line)
            log_f.write(line)
        proc.wait()
    if proc.returncode != 0:
        error(f"{label} falló (código {proc.returncode}). Revisa: {log_path}")
        with open(log_path) as f:
            lines = f.readlines()
        for l in lines[-15:]:
            print(f"    {l.rstrip()}")
        return False
    ok(f"{label} completado.")
    return True


# =============================================================================
# PASO 1 — Range Doppler Terrain Correction sobre el SUBSET
#          (intensity, phase, topo, coherencia)
# =============================================================================
def run_terrain_correction_subset(cfg):
    header("PASO 1 — Terrain Correction sobre el Subset")

    subset_dim = cfg["subset_dim"]
    if not Path(subset_dim).exists():
        error(f"No se encontró el Subset: {subset_dim}")
        return None

    bands = get_band_names(subset_dim)
    info(f"Bandas detectadas en el Subset: {bands}")

    # El manual pide: intensity, phase, topo, coherencia.
    # Se detectan de forma flexible por si el nombre exacto varía.
    selected = []
    for pattern, label in [
        (r"intensity", "intensity"),
        (r"^phase|_phase", "phase"),
        (r"topo", "topo"),
        (r"coh", "coherencia"),
    ]:
        band = find_band(bands, pattern)
        if band:
            selected.append(band)
            ok(f"  Banda '{label}' encontrada: {band}")
        else:
            warn(f"  Banda '{label}' NO encontrada (patrón: {pattern}) — se omite.")

    if not selected:
        error("No se encontró ninguna banda esperada en el Subset. Abortando.")
        return None

    out_folder = Path(cfg["output_folder"])
    out_folder.mkdir(parents=True, exist_ok=True)
    out_name = Path(subset_dim).stem + "_TC"
    out_path = str(out_folder / out_name)

    source_bands_xml = ",".join(selected)

    xml_content = render_graph(
        "GRAFICO_7a_TC_Subset.xml",
        inputFile=subset_dim,
        sourceBands=source_bands_xml,
        outputFile=out_path,
    )

    graph_path = out_folder / "TC_Subset_auto.xml"
    graph_path.write_text(xml_content, encoding="utf-8")
    info(f"Grafo generado: {graph_path}")

    log_path = out_folder / "tc_subset.log"
    if not run_gpt(graph_path, log_path, "Terrain Correction (Subset)"):
        return None

    final_dim = Path(out_path + ".dim")
    if not final_dim.exists():
        error(f"No se generó el .dim esperado: {final_dim}")
        return None

    ok(f"Producto corregido: {final_dim}")
    return str(final_dim)


# =============================================================================
# PASO 2 — Range Doppler Terrain Correction sobre DISPLACEMENT
# =============================================================================
def run_terrain_correction_displacement(cfg):
    header("PASO 2 — Terrain Correction sobre Displacement")

    disp_dim = cfg["displacement_dim"]
    if not Path(disp_dim).exists():
        error(f"No se encontró el producto de Displacement: {disp_dim}")
        return None

    bands = get_band_names(disp_dim)
    info(f"Bandas detectadas en Displacement: {bands}")

    displacement_band = find_band(bands, r"displacement")
    if displacement_band is None:
        error("No se encontró ninguna banda de desplazamiento. Abortando.")
        return None
    ok(f"  Banda de desplazamiento: {displacement_band}")

    out_folder = Path(cfg["output_folder"])
    out_name = Path(disp_dim).stem + "_TC"
    out_path = str(out_folder / out_name)

    xml_content = render_graph(
        "GRAFICO_7b_TC_Displacement.xml",
        inputFile=disp_dim,
        sourceBands=displacement_band,
        outputFile=out_path,
    )

    graph_path = Path(cfg["output_folder"]) / "TC_Displacement_auto.xml"
    graph_path.write_text(xml_content, encoding="utf-8")
    info(f"Grafo generado: {graph_path}")

    log_path = Path(cfg["output_folder"]) / "tc_displacement.log"
    if not run_gpt(graph_path, log_path, "Terrain Correction (Displacement)"):
        return None

    final_dim = Path(out_path + ".dim")
    if not final_dim.exists():
        error(f"No se generó el .dim esperado: {final_dim}")
        return None

    ok(f"Producto corregido: {final_dim}")
    return str(final_dim)


# =============================================================================
# PASO 3 — Create Stack (de los dos productos corregidos)
#          Resampling Type: NONE | Initial Offset: Product Geolocation
#          Output Extents: Master
# =============================================================================
def run_create_stack(cfg, tc_subset_dim, tc_displacement_dim):
    header("PASO 3 — Collocate (reemplaza a Create Stack)")

    # CreateStack falló de forma consistente con "mstBand is null" en
    # eu.esa.sar.insar.gpf.coregistration.CreateStackOp.getSlaveBands(),
    # probado con 7 variantes distintas de invocación (grafo XML, CLI
    # directo, con/sin masterBands, con/sin calificador ::producto, con
    # el Subset original y con el _TC). Confirmado como limitación del
    # operador para este caso de uso: combina dos productos ya
    # geocodificados independientemente (cada uno con su propio
    # Terrain-Correction), un escenario distinto al diseño original de
    # CreateStack (coregistración InSAR de pares SLC complejos i/q).
    #
    # Solución: usar Collocate, diseñado para alinear píxel a píxel dos
    # productos ya georreferenciados según coordenadas geográficas —
    # exactamente el escenario tras Terrain-Correction. Confirmado
    # funcional vía gpt CLI directo.
    out_folder = Path(cfg["output_folder"])
    out_path = str(out_folder / "Stack_TC")

    xml_content = render_graph(
        "GRAFICO_7c_Collocate.xml",
        inputFile=tc_subset_dim,
        inputFile2=tc_displacement_dim,
        outputFile=out_path,
    )

    graph_path = out_folder / "Collocate_auto.xml"
    graph_path.write_text(xml_content, encoding="utf-8")
    info(f"Grafo generado: {graph_path}")

    log_path = out_folder / "collocate.log"
    if not run_gpt(graph_path, log_path, "Collocate"):
        return None

    final_dim = Path(out_path + ".dim")
    if not final_dim.exists():
        error(f"No se generó el .dim esperado: {final_dim}")
        return None

    bands = get_band_names(str(final_dim))
    info(f"Bandas en el Stack resultante: {bands}")

    if find_band(bands, r"displacement") is None:
        warn("No se encontró ninguna banda de desplazamiento en el Stack resultante. "
             "Verifica el nombre exacto — Collocate puede haberla renombrado con "
             "sufijo '_S1' (secundario) o similar.")

    ok(f"Stack generado: {final_dim}")
    return str(final_dim)


# =============================================================================
# PASO 4 — Band Maths con máscara de coherencia
#          if coherencia <= 0.3 then 0 else displacement_VV
# =============================================================================
def run_band_maths_mask(cfg, stack_dim):
    header("PASO 4 — Band Maths (máscara de coherencia)")

    bands = get_band_names(stack_dim)
    info(f"Bandas disponibles en el Stack: {bands}")

    coherence_band = find_band(bands, r"coh")
    displacement_band = find_band(bands, r"displacement")

    if coherence_band is None:
        error("No se encontró banda de coherencia en el Stack. No se puede "
              "aplicar la máscara como indica el manual.")
        info(f"Bandas disponibles: {bands}")
        return None

    if displacement_band is None:
        error("No se encontró banda de desplazamiento en el Stack.")
        info(f"Bandas disponibles: {bands}")
        return None

    ok(f"  Banda de coherencia      : {coherence_band}")
    ok(f"  Banda de desplazamiento  : {displacement_band}")

    out_folder = Path(cfg["output_folder"])
    out_name = "Stack_TC_Masked"
    out_path = str(out_folder / out_name)

    # La expresión y sus umbrales (coherencia, desplazamiento máximo) viven en
    # GRAFICO_7d y se editan desde la interfaz; solo se sustituyen los nombres
    # de banda, que se detectan al ejecutar.
    xml_content = render_graph(
        "GRAFICO_7d_BandMaths_Mask.xml",
        inputFile=stack_dim,
        coherenceBand=coherence_band,
        displacementBand=displacement_band,
        outputFile=out_path,
    )

    graph_path = out_folder / "BandMaths_Mask_auto.xml"
    graph_path.write_text(xml_content, encoding="utf-8")
    info(f"Grafo generado: {graph_path}")

    log_path = out_folder / "band_maths_mask.log"
    if not run_gpt(graph_path, log_path, "Band Maths (máscara)"):
        return None

    final_dim = Path(out_path + ".dim")
    if not final_dim.exists():
        error(f"No se generó el .dim esperado: {final_dim}")
        return None

    ok(f"Producto final enmascarado: {final_dim}")

    # Validación rápida con numpy si está disponible
    try:
        import numpy as np
        img_path = Path(out_path + ".data") / "displacement_masked.img"
        if img_path.exists():
            data = np.fromfile(str(img_path), dtype='>f4')
            valid = data[np.isfinite(data)]
            n_zero = (valid == 0).sum()
            n_nonzero = (valid != 0).sum()
            info(f"  Píxeles en 0 (enmascarados): "
                 f"{n_zero:,} ({100*n_zero/valid.size:.1f}%)")
            info(f"  Píxeles con desplazamiento real: {n_nonzero:,} "
                 f"({100*n_nonzero/valid.size:.1f}%)")
            if n_nonzero > 0:
                nz = valid[valid != 0]
                info(f"  Rango de desplazamiento (no enmascarado): "
                     f"{nz.min():.4f} a {nz.max():.4f} m")
    except ImportError:
        pass

    return str(final_dim)


# =============================================================================
# MAIN
# =============================================================================
def main():
    header("ETAPA 2 — TERRAIN CORRECTION + CREATE STACK + MÁSCARA DE COHERENCIA")

    cfg = {
        "subset_dim": SUBSET_DIM,
        "displacement_dim": DISPLACEMENT_DIM,
        "output_folder": OUTPUT_FOLDER,
    }

    print(f"  Subset (Gráfico 4)      : {cfg['subset_dim']}")
    print(f"  Displacement (_UNW_DISP): {cfg['displacement_dim']}")
    print(f"  Carpeta de salida       : {cfg['output_folder']}")
    print(f"  Máscara (GRAFICO_7d)    : expresión editable desde el editor de grafos\n")

    Path(cfg["output_folder"]).mkdir(parents=True, exist_ok=True)

    tc_subset = run_terrain_correction_subset(cfg)
    if not tc_subset:
        error("Pipeline detenido en el Paso 1.")
        sys.exit(1)

    tc_displacement = run_terrain_correction_displacement(cfg)
    if not tc_displacement:
        error("Pipeline detenido en el Paso 2.")
        sys.exit(1)

    stack_dim = run_create_stack(cfg, tc_subset, tc_displacement)
    if not stack_dim:
        error("Pipeline detenido en el Paso 3.")
        sys.exit(1)

    final_dim = run_band_maths_mask(cfg, stack_dim)
    if not final_dim:
        error("Pipeline detenido en el Paso 4.")
        sys.exit(1)

    header("ETAPA 2 COMPLETADA")
    ok(f"Producto final: {final_dim}")
    ok("Banda 'displacement_masked': desplazamiento con coherencia >0.3, "
       "el resto en 0 — lista para análisis de deslizamientos.")


if __name__ == "__main__":
    main()




