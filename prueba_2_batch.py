#!/usr/bin/env python3
import subprocess
import os
import sys
import time
from datetime import datetime

# ================== CONFIGURACIÓN ==================
GPT_PATH = "/home/nahin/esa-snap/bin/gpt"
BASE     = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2"
GRAFICOS = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Graficos_XML"

MASTER   = f"{BASE}/Grafo1/S1A_IW_SLC__1SDV_20260509T105323_20260509T105350_064439_081D91_CFA2_Orb.dim"
SLAVE    = f"{BASE}/Grafo1/S1A_IW_SLC__1SDV_20260521T105323_20260521T105350_064614_0823A5_5C1B_Orb.dim"
INTER    = f"{BASE}/Grafo2_GPT_Prueba/intermediate_coreg.dim"
OUTPUT   = f"{BASE}/Grafo2_GPT_Prueba/output_final.dim"

#Dividimos en dos partes el grafo 2, asi procesa en menos tiempo y lo hace correctamente

GRAPH_2A = f"{GRAFICOS}/GRAFICO_2a.xml"
GRAPH_2B = f"{GRAFICOS}/GRAFICO_2b.xml"

JVM_ARGS = [
    "-J-Xmx11G",
    "-J-Xms1G",
    "-J-XX:+UseG1GC",
    "-J-XX:G1HeapRegionSize=32m",
    "-J-Dsnap.jai.tileSize=256",
    "-J-Dsnap.jai.tileCacheSize=2147483648",  # 2GB tile cache
]
THREADS = "4"
# ====================================================


def run_step(label, graph, params: dict, verbose=True):
    """Ejecuta un paso GPT y muestra output en tiempo real."""
    os.makedirs(os.path.dirname(list(params.values())[-1]), exist_ok=True)

    cmd = [GPT_PATH, graph] + \
          [f"-P{k}={v}" for k, v in params.items()] + \
          ["-q", THREADS] + JVM_ARGS

    print(f"\n{'='*60}")
    print(f"🔧 {label}")
    print(f"{'='*60}")
    print("Comando:\n  " + " \\\n  ".join(cmd))
    print(f"\n⏳ Iniciando a las {datetime.now().strftime('%H:%M:%S')}...\n")

    start = time.time()

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                print(f"  GPT> {line}")
        proc.wait(timeout=7200)
        returncode = proc.returncode

    except subprocess.TimeoutExpired:
        proc.kill()
        print(f"⏰ TIMEOUT después de {(time.time()-start)/60:.1f} minutos")
        return False
    except Exception as e:
        print(f"❌ Error inesperado: {e}")
        return False

    elapsed = time.time() - start

    if returncode == 0:
        print(f"\n✅ {label} completado en {elapsed/60:.1f} min")
        return True
    else:
        print(f"\n❌ {label} falló después de {elapsed/60:.1f} min (código {returncode})")
        return False


def check_files():
    print(f"\n{'='*60}")
    print("📁 Verificando archivos...")
    for label, path in [("Master", MASTER), ("Slave", SLAVE),
                        ("Graph 2a", GRAPH_2A), ("Graph 2b", GRAPH_2B)]:
        exists = os.path.exists(path)
        icon = "✅" if exists else "❌"
        print(f"  {icon} {label}: {os.path.basename(path)}")
        if not exists:
            print(f"     Ruta: {path}")
            return False
    return True


def main():
    print(f"\n{'='*60}")
    print("🛰️  GRAFICO_2 — Procesamiento en 2 pasos")
    print(f"{'='*60}")
    print(f"Timestamp: {datetime.now()}")

    if not check_files():
        print("\n❌ Verifica las rutas y vuelve a intentar.")
        sys.exit(1)

    total_start = time.time()

    # PASO 1: Back-Geocoding + ESD → archivo intermedio
    ok1 = run_step(
        label="PASO 1: Back-Geocoding + Enhanced-Spectral-Diversity",
        graph=GRAPH_2A,
        params={
            "inputFile":  MASTER,
            "inputFile2": SLAVE,
            "outputFile": INTER,
        }
    )

    if not ok1:
        print("\n❌ Abortando — el paso 1 falló.")
        sys.exit(1)

    # PASO 2: Interferogram + TOPSAR-Deburst → resultado final
    ok2 = run_step(
        label="PASO 2: Interferogram + TOPSAR-Deburst",
        graph=GRAPH_2B,
        params={
            "inputFile":  INTER,
            "outputFile": OUTPUT,
        }
    )

    total = (time.time() - total_start) / 60
    print(f"\n{'='*60}")
    if ok2:
        size_mb = os.path.getsize(OUTPUT) / (1024**2) if os.path.exists(OUTPUT) else 0
        print(f"✅ PROCESAMIENTO COMPLETO en {total:.1f} minutos")
        print(f"   Salida: {OUTPUT} ({size_mb:.1f} MB)")
    else:
        print(f"❌ Procesamiento falló en el paso 2 ({total:.1f} min)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()


#Si funciono 