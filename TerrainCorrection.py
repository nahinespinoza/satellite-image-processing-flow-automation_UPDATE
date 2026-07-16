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
import subprocess
from pathlib import Path

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

# 1. Definimos la carpeta base 
BASE_DIR = Path("/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.3")

# 2. Ruta del Subset original (Gráfico 4)
# Mantenemos esta ruta absoluta porque proviene del script anterior y no se genera dinámicamente aquí.
SUBSET_DIM = "/home/nahin/Documentos/Proyectos_Personales/SNAP V1.1/satellite-image-processing-flow-automation/backend/files/output/output/Grafo4/output_final_Orb_Orb.dim"

# 3. Ruta del archivo de Displacement (generado en el script anterior)
# Ahora lo busca dinámicamente dentro de la carpeta PhaseToDisplacement
DISPLACEMENT_DIM = str(BASE_DIR / "PhaseToDisplacement" / "output_final_Orb_Orb_DISP.dim")

# 4. Carpeta de salida para este script
# Se creará automáticamente dentro de V1.3
OUTPUT_FOLDER = str(BASE_DIR / "TerrainCorrection")

# Ruta del ejecutable gpt
GPT_BIN = "/home/nahin/esa-snap/bin/gpt"

# Umbral de coherencia del manual
COHERENCE_THRESHOLD = 0.3

# Parámetros de Terrain Correction
DEM_NAME = "SRTM 1Sec HGT"
DEM_RESAMPLING = "BILINEAR_INTERPOLATION"
IMG_RESAMPLING = "BILINEAR_INTERPOLATION"

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

    xml_content = f"""<graph id="Graph">
  <version>1.0</version>

  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters>
      <file>{subset_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="Terrain-Correction">
    <operator>Terrain-Correction</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters>
      <sourceBands>{source_bands_xml}</sourceBands>
      <demName>{DEM_NAME}</demName>
      <externalDEMFile/>
      <externalDEMNoDataValue>0.0</externalDEMNoDataValue>
      <demResamplingMethod>{DEM_RESAMPLING}</demResamplingMethod>
      <imgResamplingMethod>{IMG_RESAMPLING}</imgResamplingMethod>
      <pixelSpacingInMeter>0.0</pixelSpacingInMeter>
      <pixelSpacingInDegree>0.0</pixelSpacingInDegree>
      <mapProjection>WGS84(DD)</mapProjection>
      <saveDEM>false</saveDEM>
      <saveLatLon>false</saveLatLon>
      <saveIncidenceAngleFromEllipsoid>false</saveIncidenceAngleFromEllipsoid>
      <saveLocalIncidenceAngle>false</saveLocalIncidenceAngle>
      <saveProjectedLocalIncidenceAngle>false</saveProjectedLocalIncidenceAngle>
      <saveSelectedSourceBand>true</saveSelectedSourceBand>
      <outputComplex>false</outputComplex>
      <applyRadiometricNormalization>false</applyRadiometricNormalization>
      <nodataValueAtSea>false</nodataValueAtSea>
    </parameters>
  </node>

  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct refid="Terrain-Correction"/>
    </sources>
    <parameters>
      <file>{out_path}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>

</graph>
"""

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

    xml_content = f"""<graph id="Graph">
  <version>1.0</version>

  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters>
      <file>{disp_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="Terrain-Correction">
    <operator>Terrain-Correction</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters>
      <sourceBands>{displacement_band}</sourceBands>
      <demName>{DEM_NAME}</demName>
      <externalDEMFile/>
      <externalDEMNoDataValue>0.0</externalDEMNoDataValue>
      <demResamplingMethod>{DEM_RESAMPLING}</demResamplingMethod>
      <imgResamplingMethod>{IMG_RESAMPLING}</imgResamplingMethod>
      <pixelSpacingInMeter>0.0</pixelSpacingInMeter>
      <pixelSpacingInDegree>0.0</pixelSpacingInDegree>
      <mapProjection>WGS84(DD)</mapProjection>
      <saveDEM>false</saveDEM>
      <saveLatLon>false</saveLatLon>
      <saveIncidenceAngleFromEllipsoid>false</saveIncidenceAngleFromEllipsoid>
      <saveLocalIncidenceAngle>false</saveLocalIncidenceAngle>
      <saveProjectedLocalIncidenceAngle>false</saveProjectedLocalIncidenceAngle>
      <saveSelectedSourceBand>true</saveSelectedSourceBand>
      <outputComplex>false</outputComplex>
      <applyRadiometricNormalization>false</applyRadiometricNormalization>
      <nodataValueAtSea>false</nodataValueAtSea>
    </parameters>
  </node>

  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct refid="Terrain-Correction"/>
    </sources>
    <parameters>
      <file>{out_path}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>

</graph>
"""

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

    xml_content = f"""<graph id="Graph">
  <version>1.0</version>

  <node id="Read-Reference">
    <operator>Read</operator>
    <sources/>
    <parameters>
      <file>{tc_subset_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="Read-Secondary">
    <operator>Read</operator>
    <sources/>
    <parameters>
      <file>{tc_displacement_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="Collocate">
    <operator>Collocate</operator>
    <sources>
      <reference refid="Read-Reference"/>
      <secondary refid="Read-Secondary"/>
    </sources>
    <parameters>
      <resamplingType>NEAREST_NEIGHBOUR</resamplingType>
      <renameReferenceComponents>true</renameReferenceComponents>
      <renameSecondaryComponents>true</renameSecondaryComponents>
    </parameters>
  </node>

  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct refid="Collocate"/>
    </sources>
    <parameters>
      <file>{out_path}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>

</graph>
"""

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

    # Expresión del manual + filtro de valores imposibles. IMPORTANTE:
    # se invirtió la lógica respecto al intento anterior. La forma
    # "abs(x) > UMBRAL then 0" no descartó los valores de ~10^38 en la
    # práctica — la hipótesis es que jexp evalúa esos valores extremos
    # como NaN internamente, y en aritmética IEEE 754 cualquier
    # comparación con NaN (incluyendo "NaN > 2.0") da False, dejando
    # pasar el valor corrupto al "else" en vez de descartarlo.
    # Solución: exigir que el valor esté DENTRO de un rango explícito
    # para aceptarlo (rango cerrado con AND), en vez de comparar el
    # valor corrupto contra un umbral. Si el valor es NaN o extremo,
    # ninguna de las dos comparaciones (>= -2.0 y <= 2.0) será True,
    # y por construcción cae en el "then 0" por defecto.
    DISPLACEMENT_MAX_M = 2.0
    expression = (
        f"if ({coherence_band} &gt; {COHERENCE_THRESHOLD} and "
        f"{displacement_band} &gt;= -{DISPLACEMENT_MAX_M} and "
        f"{displacement_band} &lt;= {DISPLACEMENT_MAX_M}) "
        f"then {displacement_band} else 0"
    )

    xml_content = f"""<graph id="Graph">
  <version>1.0</version>

  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters>
      <file>{stack_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <node id="BandMaths">
    <operator>BandMaths</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters>
      <targetBands>
        <targetBand>
          <name>displacement_masked</name>
          <type>float32</type>
          <expression>{expression}</expression>
          <description>Desplazamiento con mascara de coherencia (umbral {COHERENCE_THRESHOLD}), segun manual.</description>
          <unit>m</unit>
          <noDataValue>NaN</noDataValue>
        </targetBand>
      </targetBands>
    </parameters>
  </node>

  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct refid="BandMaths"/>
    </sources>
    <parameters>
      <file>{out_path}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>

</graph>
"""

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
            info(f"  Píxeles en 0 (coherencia <= {COHERENCE_THRESHOLD}): "
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
    print(f"  Umbral de coherencia    : <= {COHERENCE_THRESHOLD}\n")

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




