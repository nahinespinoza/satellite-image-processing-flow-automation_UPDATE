#!/usr/bin/env python3
# =============================================================================
# LIMPIAR DISPLACEMENT CORRUPTO - Band Maths
# Calibrado para: detección/predicción de DESLIZAMIENTOS en zona rural
#                  cerca de una represa
# =============================================================================
#
# CONTEXTO DEL UMBRAL:
#   - Sentinel-1 con revisita de 12 días (par 09May2026 / 21May2026).
#   - Un deslizamiento ACTIVO cerca de una represa puede moverse desde
#     pocos mm hasta decenas de cm en ese lapso — por eso el umbral de
#     "valor imposible" se deja generoso (no se quiere descartar
#     movimiento real de ladera).
#   - Lo que SÍ hay que descartar son los valores físicamente imposibles
#     (artefactos de unwrapping, ~10^38) y los píxeles de baja confianza
#     (coherencia baja → esa medición individual no es fiable, sea cual
#     sea su valor).
#   - Zonas rurales cerca de represas suelen tener vegetación / terreno
#     irregular → la coherencia interferométrica tiende a ser más baja
#     que en zonas urbanas. Por eso el umbral de coherencia se deja más
#     permisivo (0.15) que el típico urbano (0.3-0.4): un umbral muy
#     estricto aquí descartaría casi toda la zona de interés.
#
# AJUSTA ESTOS DOS VALORES SEGÚN TUS RESULTADOS:
#   DISPLACEMENT_MAX_M  -> filtro de valores físicamente imposibles
#   COHERENCE_MIN       -> filtro de confianza de la medición
# =============================================================================

from pathlib import Path
import subprocess
import sys

# ==================== CONFIGURACIÓN ====================
disp_dim = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2/SnapHu_Automatizacion/Resultados_Fase2/output_final_Orb_Orb_UNW_DISP.dim"

# Nombre EXACTO de la banda de coherencia dentro del producto.
# Verificalo con: grep BAND_NAME tu_archivo.dim
COHERENCE_BAND_NAME = "coh_IW3_VV_09May2026_21May2026"

# --- Umbrales (ajustables) ---
DISPLACEMENT_MAX_M = 2.0   # metros. Por encima de esto es artefacto, no
                           # deslizamiento real en 12 días. Si tu zona
                           # tiene deslizamientos muy rápidos conocidos,
                           # puedes subirlo; si quieres ser más estricto
                           # con artefactos, bájalo (pero no por debajo
                           # de ~0.3-0.5 m sin verificar primero contra
                           # casos conocidos, para no recortar señal real).
COHERENCE_MIN = 0.15      # Permisivo, pensado para zona rural/vegetada
                           # cerca de la represa. Si el resultado sigue
                           # ruidoso, sube a 0.2-0.25 e inspecciona cuánta
                           # área de la zona de interés se pierde.

# Carpeta de salida
output_folder = Path(disp_dim).parent
clean_name = Path(disp_dim).stem + "_CLEAN"
clean_path = str(output_folder / clean_name)
# ========================================================

print("🧹 Creando producto limpio con Band Maths (calibrado para deslizamientos)...\n")
print(f"   Umbral displacement : ±{DISPLACEMENT_MAX_M} m")
print(f"   Umbral coherencia   : >= {COHERENCE_MIN}")
print(f"   Banda coherencia    : {COHERENCE_BAND_NAME}\n")

expression = (
    f"if (abs(displacement) &gt; {DISPLACEMENT_MAX_M} or "
    f"{COHERENCE_BAND_NAME} &lt; {COHERENCE_MIN}) "
    f"then NaN else displacement"
)

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

  <node id="BandMaths">
    <operator>BandMaths</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters>
      <targetBands>
        <targetBand>
          <name>displacement_clean</name>
          <type>float32</type>
          <expression>{expression}</expression>
          <description>Desplazamiento limpio: descarta valores imposibles (artefactos de unwrapping) y píxeles de baja coherencia. Calibrado para deteccion de deslizamientos en zona rural cerca de represa.</description>
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
      <file>{clean_path}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>

</graph>
"""

graph_path = output_folder / "BandMaths_Limpiar_Displacement.xml"
graph_path.write_text(xml_content, encoding="utf-8")
print(f"Grafo generado: {graph_path}\n")

# Ejecutar
gpt_bin = "/home/nahin/esa-snap/bin/gpt"
if not Path(gpt_bin).exists():
    print(f"❌ gpt no encontrado en: {gpt_bin}")
    sys.exit(1)

cmd = [gpt_bin, str(graph_path)]
log_path = output_folder / "bandmaths_clean.log"

print("Ejecutando Band Maths para limpiar...")
with open(log_path, "w") as f:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        print(line, end="")
        f.write(line)
    proc.wait()

if proc.returncode != 0:
    print("\n❌ Falló el BandMaths")
    print(f"Revisa: {log_path}")
    sys.exit(1)

print("\n✅ BandMaths completado!")
print(f"Producto limpio creado: {clean_path}.dim")

# ==================== VALIDACIÓN AUTOMÁTICA DEL RESULTADO ====================
print("\n🔍 Validando producto limpio...")
try:
    import numpy as np
    clean_img = Path(clean_path + ".data") / "displacement_clean.img"
    if clean_img.exists():
        data = np.fromfile(str(clean_img), dtype=np.float32)
        valid = data[np.isfinite(data)]
        total = data.size
        n_valid = valid.size
        n_nan = total - n_valid

        print(f"   Tamaño total       : {total:,} píxeles")
        print(f"   Válidos            : {n_valid:,} ({100*n_valid/total:.1f}%)")
        print(f"   Descartados (NaN)  : {n_nan:,} ({100*n_nan/total:.1f}%)")
        if n_valid > 0:
            print(f"   Min                : {valid.min():.4f} m")
            print(f"   Max                : {valid.max():.4f} m")
            print(f"   Media              : {valid.mean():.4f} m")
            print(f"   Desv. estándar     : {valid.std():.4f} m")

            # Aviso si se descartó demasiada área (relevante porque la zona
            # rural ya tiende a tener coherencia más baja)
            pct_discarded = 100 * n_nan / total
            if pct_discarded > 40:
                print(f"\n   ⚠️  Se descartó el {pct_discarded:.1f}% del área. Para zona "
                      f"rural esto puede ser razonable, pero si te deja muy poca "
                      f"cobertura sobre la ladera de interés, considera bajar "
                      f"COHERENCE_MIN un poco (ej. 0.10-0.12) y volver a correr.")
    else:
        print(f"   ⚠️  No se encontró el .img esperado en: {clean_img}")
except ImportError:
    print("   (numpy no disponible — instala con: pip install numpy --break-system-packages "
          "para validación automática)")

print("\nRecomendación: Abre 'displacement_clean' en SNAP, superponlo sobre la "
      "ladera/represa y revisa si los valores con mayor magnitud coinciden "
      "espacialmente con zonas de pendiente conocida o reportes previos de "
      "movimiento de terreno, antes de interpretarlos como deslizamiento real.")