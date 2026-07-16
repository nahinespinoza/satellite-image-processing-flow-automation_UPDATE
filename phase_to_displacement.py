#!/usr/bin/env python3
import subprocess
from pathlib import Path

# =============================================================================
# CONFIGURACIÓN DE RUTAS (Relativas a la carpeta base V1.3)
# =============================================================================
# Definimos tu directorio raíz como un objeto Path
BASE_DIR = Path("/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.3")

# Construimos las rutas de entrada y salida de forma relativa
# Esto busca automáticamente dentro de la carpeta 'SnaphuImport' que ya existe
input_dim = BASE_DIR / "SnaphuImport" / "output_final_Orb_Orb_UNW.dim"

# Definimos la nueva carpeta para este paso (se creará automáticamente)
output_folder = BASE_DIR / "PhaseToDisplacement"
output_folder.mkdir(parents=True, exist_ok=True)

# Archivo .dim de salida final
output_dim = output_folder / "output_final_Orb_Orb_DISP.dim"

# Ruta del ejecutable GPT de SNAP
gpt_bin = "/home/nahin/esa-snap/bin/gpt"

print(f"═" * 70)
print(f" PROCESANDO: PHASE TO DISPLACEMENT")
print(f"═" * 70)
print(f"• Carpeta Base: {BASE_DIR}")
print(f"• Leyendo de : {input_dim.relative_to(BASE_DIR)}")
print(f"• Guardando en: {output_dim.relative_to(BASE_DIR)}")
print(f"═" * 70)

# =============================================================================
# VALIDACIÓN DE INSUMOS
# =============================================================================
if not input_dim.exists():
    print(f"[ERROR] No se encontró el archivo de entrada en: {input_dim}")
    print("Asegúrate de que el script anterior (Gráfico 7) se haya ejecutado en la carpeta V1.3.")
    exit(1)

# =============================================================================
# GENERACIÓN DEL GRAFO XML
# =============================================================================
# Usamos str(path) para que SNAP entienda las rutas en formato de texto puro
xml_content = f"""<graph id="Graph">
  <version>1.0</version>
  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>{str(input_dim)}</file>
    </parameters>
  </node>
  
  <node id="PhaseToDisplacement">
    <operator>PhaseToDisplacement</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement"/>
  </node>
  
  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct refid="PhaseToDisplacement"/>
    </sources>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>{str(output_dim)}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>
</graph>
"""

# Guardamos el archivo XML temporal dentro de la nueva carpeta de salida
graph_path = output_folder / "GRAFICO_PhaseToDisplacement_auto.xml"
graph_path.write_text(xml_content, encoding="utf-8")

# =============================================================================
# EJECUCIÓN EN SNAP (GPT)
# =============================================================================
print("[INFO] Ejecutando el operador PhaseToDisplacement en SNAP...")
cmd = [gpt_bin, str(graph_path)]

proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

if proc.returncode == 0:
    print("\n[OK] ¡Fase convertida a Desplazamiento con éxito!")
    print(f"[OK] Producto generado: {output_dim}")
else:
    print("\n[ERROR] El proceso falló en SNAP:")
    print(proc.stdout)
    exit(1)