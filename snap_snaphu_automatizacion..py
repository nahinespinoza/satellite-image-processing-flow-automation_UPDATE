#!/usr/bin/env python3
# =============================================================================
# PIPELINE AUTOMÁTICO: Gráfico 5 → Gráfico 6 → Gráfico 7
#   - Gráfico 5: SNAPHU EXPORT  (via gpt de SNAP)
#   - Gráfico 6: SNAPHU UNWRAPPING  (via snaphu en terminal)
#   - Gráfico 7: SNAPHU IMPORT  (via gpt de SNAP)
#
# USO:
#   python3 snap_snaphu_pipeline.py
#
# El script te pedirá las rutas necesarias interactivamente.
# =============================================================================

import os
import sys
import subprocess
import shutil
import glob
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime

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

def header(msg):
    print(f"\n{C.BOLD}{C.BLUE}{'='*65}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}  {msg}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}{'='*65}{C.RESET}\n")

def info(msg):    print(f"{C.CYAN}[INFO]{C.RESET}  {msg}")
def ok(msg):      print(f"{C.GREEN}[OK]{C.RESET}    {msg}")
def warn(msg):    print(f"{C.YELLOW}[WARN]{C.RESET}  {msg}")
def error(msg):   print(f"{C.RED}[ERROR]{C.RESET} {msg}")
def step(n, msg): print(f"\n{C.BOLD}{C.YELLOW}▶ PASO {n}: {msg}{C.RESET}")

# =============================================================================
# HELPERS DE ENTRADA
# =============================================================================
def ask(prompt, default=None):
    """Pide una ruta al usuario con validación básica."""
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
        error(f"{label} no encontrado: {path}")
        sys.exit(1)
    ok(f"{label} verificado.")

def check_cmd(cmd):
    if shutil.which(cmd) is None:
        error(f"Comando '{cmd}' no encontrado en PATH. Instálalo y vuelve a intentar.")
        sys.exit(1)
    ok(f"'{cmd}' disponible en PATH.")

# =============================================================================
# PASO 0 – RECOLECTAR RUTAS
# =============================================================================
def collect_inputs():
    header("CONFIGURACIÓN DEL PIPELINE")

    print(f"{C.BOLD}Este script automatiza:{C.RESET}")
    print("  • Gráfico 5 → Snaphu Export   (SNAP / gpt)")
    print("  • Gráfico 6 → Snaphu Unwrapping (snaphu en terminal)")
    print("  • Gráfico 7 → Snaphu Import   (SNAP / gpt)\n")

    # ── Ruta del resultado del Gráfico 4 (Subset .dim) ──────────────────────
    step("A", "Resultado del GRÁFICO 4 (Subset .dim)")
    print("  Este es el archivo .dim que produjo el Gráfico 4 (Subset_DInSAR...).")
    subset_dim = ask("Ruta completa del archivo .dim del Gráfico 4")
    check_file(subset_dim, "Subset .dim")

    # ── Carpeta SNAPHU ───────────────────────────────────────────────────────
    step("B", "Carpeta de trabajo SNAPHU")
    print("  Carpeta donde el Gráfico 5 guardará los .img y snaphu.conf.")
    print("  Si no existe, el script la crea automáticamente.")
    snaphu_folder = ask("Ruta de la carpeta SNAPHU")

    # ── Carpeta de salida del Gráfico 7 ─────────────────────────────────────
    step("C", "Carpeta de salida del GRÁFICO 7 (Snaphu Import)")
    print("  Aquí se guardará el producto final con sufijo _UNW.")
    g7_out_folder = ask("Ruta de la carpeta de salida del Gráfico 7")

    # ── Ejecutable gpt de SNAP ───────────────────────────────────────────────
    step("D", "Ejecutable GPT de SNAP")
    gpt_default = shutil.which("gpt") or "/usr/local/snap/bin/gpt"
    gpt_bin = ask("Ruta del ejecutable 'gpt' de SNAP", default=gpt_default)
    if not Path(gpt_bin).exists():
        error(f"gpt no encontrado en: {gpt_bin}")
        sys.exit(1)
    ok(f"gpt encontrado: {gpt_bin}")

    # ── Verificar snaphu ─────────────────────────────────────────────────────
    step("E", "Verificando 'snaphu' en PATH")
    check_cmd("snaphu")

    return {
        "subset_dim":    subset_dim,
        "snaphu_folder": snaphu_folder,
        "g7_out_folder": g7_out_folder,
        "gpt_bin":       gpt_bin,
    }

# =============================================================================
# PASO 1 – GENERAR XML GRÁFICO 5 Y EJECUTAR (Snaphu Export)
# =============================================================================
def run_grafico5(cfg):
    header("GRÁFICO 5 – SNAPHU EXPORT")

    snaphu_folder = cfg["snaphu_folder"]
    Path(snaphu_folder).mkdir(parents=True, exist_ok=True)
    ok(f"Carpeta SNAPHU lista: {snaphu_folder}")

    subset_dim = cfg["subset_dim"]

    # Nombre base del producto de salida (sin extensión)
    product_name = Path(subset_dim).stem   # e.g. Subset_DInSAR_ML_Flt

    # ── Generar XML del grafo ────────────────────────────────────────────────
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
      <rowOverlap>200</rowOverlap>
      <colOverlap>200</colOverlap>
      <tileCostThreshold>500</tileCostThreshold>
    </parameters>
  </node>

</graph>
"""

    graph_path = Path(snaphu_folder) / "GRAFICO_5_SnaphuExport_auto.xml"
    graph_path.write_text(xml_content, encoding="utf-8")
    info(f"Grafo XML generado: {graph_path}")

    # ── Ejecutar gpt ─────────────────────────────────────────────────────────
    cmd = [cfg["gpt_bin"], str(graph_path)]
    info(f"Ejecutando: {' '.join(cmd)}")
    print()

    log_path = Path(snaphu_folder) / "grafico5.log"
    with open(log_path, "w") as log_f:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        for line in proc.stdout:
            sys.stdout.write(line)
            log_f.write(line)
        proc.wait()

    if proc.returncode != 0:
        error(f"Gráfico 5 falló (código {proc.returncode}). Revisa: {log_path}")
        sys.exit(1)

    ok("Gráfico 5 (Snaphu Export) completado.")
    return graph_path

# =============================================================================
# PASO 2 – DESCUBRIR ARCHIVOS Y EJECUTAR SNAPHU (Gráfico 6)
# =============================================================================
def run_grafico6(cfg):
    header("GRÁFICO 6 – SNAPHU UNWRAPPING")

    snaphu_folder = cfg["snaphu_folder"]

    # Buscar subcarpeta de salida (SNAP crea una subcarpeta con el nombre del producto)
    # Los archivos .img suelen estar directamente en snaphu_folder o en una subcarpeta
    phase_files = (
        glob.glob(f"{snaphu_folder}/**/Phase_*.snaphu.img", recursive=True) +
        glob.glob(f"{snaphu_folder}/Phase_*.snaphu.img")
    )
    coh_files = (
        glob.glob(f"{snaphu_folder}/**/coh_*.snaphu.img", recursive=True) +
        glob.glob(f"{snaphu_folder}/coh_*.snaphu.img")
    )

    if not phase_files:
        error("No se encontró ningún archivo Phase_*.snaphu.img en la carpeta SNAPHU.")
        error(f"  Buscado en: {snaphu_folder}")
        sys.exit(1)

    if len(phase_files) > 1:
        warn("Se encontraron múltiples archivos de fase. Se usará el más reciente:")
        phase_files.sort(key=os.path.getmtime, reverse=True)
        for f in phase_files:
            print(f"    {f}")

    phase_file = Path(phase_files[0])
    work_dir   = phase_file.parent
    ok(f"Archivo de fase: {phase_file.name}")
    ok(f"Directorio de trabajo: {work_dir}")

    if not coh_files:
        error("No se encontró ningún archivo coh_*.snaphu.img.")
        sys.exit(1)
    coh_file = Path(coh_files[0])
    ok(f"Archivo de coherencia: {coh_file.name}")

    # ── Leer ancho de línea desde snaphu.conf ───────────────────────────────
    conf_path = work_dir / "snaphu.conf"
    if not conf_path.exists():
        conf_path = Path(snaphu_folder) / "snaphu.conf"
    if not conf_path.exists():
        error(f"No se encontró snaphu.conf en {work_dir} ni en {snaphu_folder}")
        sys.exit(1)

    line_width = None
    with open(conf_path) as f:
        for line in f:
            if line.strip().startswith("LINELENGTH") or line.strip().startswith("# Width"):
                # snaphu.conf puede traer el ancho en diferentes keys
                pass
    # El ancho también se puede inferir del nombre del .img o del conf
    # SNAP suele poner LINELENGTH en el conf
    with open(conf_path) as f:
        content = f.read()
    for line in content.splitlines():
        parts = line.split()
        if parts and parts[0] in ("LINELENGTH", "WIDTH"):
            try:
                line_width = int(parts[1])
                ok(f"Ancho de línea leído del conf: {line_width}")
                break
            except (IndexError, ValueError):
                pass

    if line_width is None:
        warn("No se encontró LINELENGTH en snaphu.conf.")
        lw_str = ask("Introduce el ancho de línea (LINE_WIDTH) manualmente", default="6041")
        line_width = int(lw_str)

    # ── Corregir CORRFILE en snaphu.conf ─────────────────────────────────────
    info("Actualizando CORRFILE en snaphu.conf...")
    new_conf_lines = []
    replaced = False
    with open(conf_path) as f:
        for line in f:
            if line.startswith("CORRFILE"):
                new_conf_lines.append(f"CORRFILE \t\t{coh_file.name}\n")
                replaced = True
            else:
                new_conf_lines.append(line)
    if not replaced:
        new_conf_lines.append(f"CORRFILE \t\t{coh_file.name}\n")

    with open(conf_path, "w") as f:
        f.writelines(new_conf_lines)
    ok("snaphu.conf actualizado.")
    info("Corrigiendo tile overlap en snaphu.conf...")
    new_conf_lines2 = []
    with open(conf_path) as f:
        for line in f:
            if line.startswith("ROWOVRLP"):
                new_conf_lines2.append("ROWOVRLP           200\n")
            elif line.startswith("COLOVRLP"):
                new_conf_lines2.append("COLOVRLP           200\n")
            elif line.startswith("NTILEROW"):
                new_conf_lines2.append("NTILEROW           4\n")
            elif line.startswith("NTILECOL"):
                new_conf_lines2.append("NTILECOL           4\n")
            else:
                new_conf_lines2.append(line)
    with open(conf_path, "w") as f:
        f.writelines(new_conf_lines2)
    ok("Tile overlap corregido a 200.")
    
    # ── Ejecutar snaphu ───────────────────────────────────────────────────────
    cmd = ["snaphu", "-f", str(conf_path), phase_file.name, str(line_width)]
    info(f"Ejecutando desde: {work_dir}")
    info(f"Comando: {' '.join(cmd)}")
    print()

    log_path = work_dir / "snaphu_unwrapping.log"
    with open(log_path, "w") as log_f:
        proc = subprocess.Popen(
            cmd,
            cwd=str(work_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        for line in proc.stdout:
            sys.stdout.write(line)
            log_f.write(line)
        proc.wait()

    if proc.returncode != 0:
        error(f"Snaphu falló (código {proc.returncode}). Revisa: {log_path}")
        sys.exit(1)

    # ── Buscar archivo UnwPhase generado y copiarlo a work_dir ───────────────
    unw_files = (
        glob.glob(str(work_dir / "UnwPhase_*.snaphu.img")) +
        glob.glob(str(work_dir.parent / "UnwPhase_*.snaphu.img"))
    )

    if not unw_files:
        error("No se generó el archivo UnwPhase_*.snaphu.img. Revisa el log.")
        sys.exit(1)

    unw_file = Path(unw_files[0])
    ok(f"Archivo unwrapped generado: {unw_file}")

    # Si el archivo está fuera de work_dir → copiarlo adentro (como indica el manual)
    dest = work_dir / unw_file.name
    if unw_file.resolve() != dest.resolve():
        info(f"Copiando {unw_file.name} dentro de {work_dir} …")
        shutil.copy2(str(unw_file), str(dest))
        ok(f"Copia realizada: {dest}")
    else:
        ok("El archivo ya está en el directorio correcto.")

    cfg["unw_file"] = str(dest)
    ok("Gráfico 6 (Snaphu Unwrapping) completado.")
    return dest

# =============================================================================
# PASO 3 – GENERAR XML GRÁFICO 7 Y EJECUTAR (Snaphu Import)
# =============================================================================
def run_grafico7(cfg):
    header("GRÁFICO 7 – SNAPHU IMPORT")

    subset_dim    = cfg["subset_dim"]
    unw_file      = cfg["unw_file"]
    g7_out_folder = cfg["g7_out_folder"]
    snaphu_folder = cfg["snaphu_folder"]

    Path(g7_out_folder).mkdir(parents=True, exist_ok=True)

    # Nombre de salida: mismo nombre del subset + _UNW
    out_name   = Path(subset_dim).stem + "_UNW"
    out_path   = str(Path(g7_out_folder) / out_name)

    xml_content = f"""<graph id="Graph">
  <version>1.0</version>

  <!-- Pestaña Read-Phase: subset del Gráfico 4 -->
  <node id="Read">
    <operator>Read</operator>
    <sources/>
    <parameters class="com.bc.ceres.binding.dom.XppDomElement">
      <file>{subset_dim}</file>
      <copyMetadata>true</copyMetadata>
    </parameters>
  </node>

  <!-- Pestaña Read-Unwrapped-Phase: resultado del unwrapping -->
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

    # ── Ejecutar gpt ─────────────────────────────────────────────────────────
    cmd = [cfg["gpt_bin"], str(graph_path)]
    info(f"Ejecutando: {' '.join(cmd)}")
    print()

    log_path = Path(g7_out_folder) / "grafico7.log"
    with open(log_path, "w") as log_f:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        for line in proc.stdout:
            sys.stdout.write(line)
            log_f.write(line)
        proc.wait()

    if proc.returncode != 0:
        error(f"Gráfico 7 falló (código {proc.returncode}). Revisa: {log_path}")
        sys.exit(1)

    ok(f"Gráfico 7 (Snaphu Import) completado.")
    ok(f"Producto final: {out_path}.dim")
    return out_path

# =============================================================================
# MAIN
# =============================================================================
def main():
    print(f"\n{C.BOLD}{C.GREEN}")
    print("╔══════════════════════════════════════════════════════════╗")
    print("║   PIPELINE InSAR: Gráfico 5 → Gráfico 6 → Gráfico 7    ║")
    print("║   Snaphu Export → Unwrapping → Snaphu Import            ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(C.RESET)
    print(f"  Iniciado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # ── Recolectar rutas ──────────────────────────────────────────────────────
    cfg = collect_inputs()

    # ── Confirmar antes de ejecutar ───────────────────────────────────────────
    header("RESUMEN DE CONFIGURACIÓN")
    print(f"  Subset .dim (Gráfico 4) : {cfg['subset_dim']}")
    print(f"  Carpeta SNAPHU          : {cfg['snaphu_folder']}")
    print(f"  Carpeta salida Gráfico 7: {cfg['g7_out_folder']}")
    print(f"  Ejecutable gpt          : {cfg['gpt_bin']}")
    print()

    if not ask_yes_no("¿Todo correcto? ¿Iniciar el pipeline?", default="s"):
        print("Cancelado por el usuario.")
        sys.exit(0)

    # ── Ejecutar los 3 pasos ──────────────────────────────────────────────────
    t0 = datetime.now()

    run_grafico5(cfg)
    run_grafico6(cfg)
    run_grafico7(cfg)

    elapsed = datetime.now() - t0

    header("PIPELINE COMPLETADO")
    ok(f"Tiempo total: {elapsed}")
    ok(f"Producto final con fase desenvolvida guardado en: {cfg['g7_out_folder']}")
    print()

if __name__ == "__main__":
    main()

#Fecha de la prueba : Martes 16/06/2026
#Prueba de automatizacion completa de los graficos 5,6 y 7 
#Presentaba ciertos errores en el gafo 6 SnapHU Wnraping , segun lo que estaba viendo es por el snap.confg
#Se realizara otra prueba para validad gafico por grafico y ver en que parte esta fallando 
# Nombre de la nueva prueba : SnapHU_Pruebas_Individuales.py