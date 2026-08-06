#!/usr/bin/env python3
# =============================================================================
# ORQUESTRADOR PRINCIPAL DEL PIPELINE InSAR (Flujo Secuencial Modular)
# =============================================================================
# Este script centraliza la ejecución de todo tu flujo de procesamiento, 
# llamando uno por uno a los scripts específicos de forma ordenada.
# Si un paso falla, el pipeline se detiene inmediatamente para evitar
# arrastrar errores y facilitar la depuración (Debugging).
# =============================================================================



import sys
import subprocess
import os
from pathlib import Path

BASE_DIR = Path(os.getenv("BASE_DIR", "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.3/Scripts_Automatizacion_Snaphu"))

# Al inicio del script, después de los imports:
input_dim = os.getenv("INPUT_DIM") or str(BASE_DIR / "SnaphuImport" / "output_final_Orb_Orb_UNW.dim")
output_folder = os.getenv("OUTPUT_DIR") or str(BASE_DIR / "PhaseToDisplacement")

# Colores para una consola limpia y profesional
class C:
    RESET  = " [0m"
    BOLD   = " [1m"
    GREEN  = " [92m"
    YELLOW = " [93m"
    RED    = " [91m"
    CYAN   = " [96m"
    BLUE   = " [94m"

def print_banner(title, color=C.CYAN):
    print(f"\n{C.BOLD}{color}{'='*80}{C.RESET}")
    print(f"{C.BOLD}{color}  {title}{C.RESET}")
    print(f"{C.BOLD}{color}{'='*80}{C.RESET}\n")

def run_script(script_path):
    """Ejecuta un script de Python de forma segura y transmite sus logs en tiempo real"""
    script = Path(script_path)
    if not script.exists():
        print(f"{C.RED}[ERROR]{C.RESET} No se encontró el archivo del script en: {script}")
        return False

    print(f"{C.BOLD}{C.YELLOW}[EJECUTANDO]{C.RESET} {script.name}...")
    print(f"Ruta: {script}\n{'-'*80}")
    
    try:
        # Ejecuta heredando stdout/stderr para que los 'prints' de tus scripts salgan en vivo
        process = subprocess.run([sys.executable, str(script)], check=False)
        print(f"{'-'*80}")
        
        if process.returncode == 0:
            print(f"{C.GREEN}[OK]{C.RESET} '{script.name}' finalizó exitosamente.")
            return True
        else:
            print(f"{C.RED}[ERROR]{C.RESET} '{script.name}' terminó con código de error {process.returncode}.")
            return False
            
    except Exception as e:
        print(f"{C.RED}[ERROR EXCEPCIÓN]{C.RESET} Falló la invocación del script: {e}")
        return False

def main():
    print_banner("INICIANDO PROCESAMIENTO COMPLETO InSAR (ORQUESTRADOR MASTER)", C.BLUE)

    # =============================================================================
    # CONFIGURACIÓN DEL DIRECTORIO DE SCRIPTS
    # =============================================================================
    SCRIPTS_DIR = Path("/home/nahin/Documentos/SNAP_DOCUMENTATION/Scripts_Automatizacion_Snaphu/")

    # Lista ordenada de tareas (Tu pipeline modularizado)
    pipeline_steps = [
        SCRIPTS_DIR / "Prueba_Subcarpetas_FUNCIONAL.py",  # 1. Snaphu (Export, Unwrapping, Import)
        SCRIPTS_DIR / "phase_to_displacement.py",         # 2. Conversión a Desplazamiento
        SCRIPTS_DIR / "TerrainCorrection.py"              # 3. Corrección, Collocate y Máscara Coherencia
    ]

    # Ejecución secuencial del Pipeline
    for index, script in enumerate(pipeline_steps, 1):
        print_banner(f"PASO {index} DE {len(pipeline_steps)}: {script.name.upper()}", C.CYAN)
        
        exito = run_script(script)
        
        if not exito:
            print_banner(f"PIPELINE ABORTADO EN EL PASO {index} ({script.name})", C.RED)
            print(f"{C.BOLD}{C.RED}[CRÍTICO]{C.RESET} Por favor corrige el error arriba antes de volver a ejecutar.")
            sys.exit(1)

    print_banner("¡FANTÁSTICO! PIPELINE COMPLETADO EXITOSAMENTE AL 100%", C.GREEN)
    print(f"{C.BOLD}{C.GREEN}[INFO]{C.RESET} Todos los procesos del manual científico terminaron sin errores.")
    print(f"{C.BOLD}{C.GREEN}[INFO]{C.RESET} Los resultados finales están unificados en tu carpeta Resultados_V1.3\n")

if __name__ == '__main__':
    main()