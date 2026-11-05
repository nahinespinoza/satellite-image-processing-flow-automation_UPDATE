#!/usr/bin/env python3
# =============================================================================
# Catálogo de parámetros de los operadores de SNAP
# =============================================================================
# Genera frontend/src/snap_operators.json con TODOS los parámetros de cada
# operador que usan los grafos de backend/files/GRAFICO_*.xml, tal como los
# define SNAP (lo mismo que muestra el Graph Builder de escritorio): tipo,
# descripción, valor por defecto, valores permitidos e intervalo válido.
#
# La fuente es la ayuda de cada operador:  gpt <operador> -h
# Se corre una sola vez (o al actualizar SNAP / agregar operadores); la
# interfaz lee el JSON y no depende de que gpt responda en cada carga.
#
# Uso:
#   python3 generar_catalogo_snap.py                 # operadores de los grafos
#   python3 generar_catalogo_snap.py Calibration ... # + operadores extra
#
# GPT_BIN, GRAPHS_DIR y CATALOGO_SALIDA se pueden sobreescribir por entorno.
# =============================================================================
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
GPT_BIN = os.environ.get("GPT_BIN", "/home/nahin/esa-snap/bin/gpt")
GRAPHS_DIR = Path(os.getenv("GRAPHS_DIR") or RAIZ / "backend" / "files")
SALIDA = Path(os.getenv("CATALOGO_SALIDA") or RAIZ / "frontend" / "src" / "snap_operators.json")

# Cada gpt levanta una JVM pesada: pocos a la vez para no agotar la RAM
PARALELO = 4
TIMEOUT_S = 300

_PARAM = re.compile(r"^  -P(\w+)=<([^>]*)>\s*(.*)$")
_DEFAULT = re.compile(r"^Default value is '(.*)'\.$")
_VALORES = re.compile(r"^Value must be one of (.*)\.$")
_INTERVALO = re.compile(r"^Valid interval is (.*)\.$")
_GENERICA = re.compile(r"^Sets parameter '\w+' to <[^>]*>\.$")

# Normaliza los tipos de Java que imprime gpt a unos pocos que la interfaz entiende
_TIPOS = {
    "boolean": "boolean",
    "int": "int", "integer": "int", "long": "int", "short": "int", "byte": "int",
    "double": "double", "float": "double",
    "string": "string", "file": "file",
}


def operadores_de_grafos():
    """Operadores usados en los GRAFICO_*.xml, en orden de primera aparición."""
    ops = []
    for xml in sorted(GRAPHS_DIR.glob("GRAFICO_*.xml")):
        try:
            raiz = ET.parse(xml).getroot()
        except ET.ParseError as e:
            print(f"  ! {xml.name} no es XML válido, se omite ({e})", file=sys.stderr)
            continue
        for nodo in raiz.findall("node"):
            op = (nodo.findtext("operator") or "").strip()
            if op and op not in ops:
                ops.append(op)
    return ops


def seccion(texto, titulo):
    """Líneas entre '<titulo>:' y el siguiente encabezado sin sangría."""
    lineas, dentro = [], False
    for linea in texto.splitlines():
        if linea.startswith(titulo + ":"):
            dentro = True
        elif dentro and linea and not linea.startswith(" "):
            break
        elif dentro:
            lineas.append(linea)
    return lineas


def orden_xml(texto):
    """Orden de los parámetros (y si tienen estructura anidada) según el bloque
    'Graph XML Format', que es el orden en que SNAP los escribe en un grafo."""
    bloque = "\n".join(seccion(texto, "Graph XML Format"))
    m = re.search(r"<parameters>.*</parameters>", bloque, re.S)
    if not m:
        return []
    try:
        params = ET.fromstring(m.group(0))
    except ET.ParseError:
        # plantilla rara: al menos el orden de las etiquetas de primer nivel
        return [(t, False) for t in re.findall(r"^\s{8}<(\w+)>", m.group(0), re.M)]
    return [(hijo.tag, len(hijo) > 0) for hijo in params]


def parsear_parametros(texto):
    params, actual = {}, None
    for linea in seccion(texto, "Parameter Options"):
        m = _PARAM.match(linea)
        if m:
            nombre, tipo_java, resto = m.groups()
            es_lista = tipo_java.endswith(",...")
            base = tipo_java.split(",")[0]
            actual = params[nombre] = {
                "name": nombre,
                "type": _TIPOS.get(base.lower(), base),
                "javaType": tipo_java,
                "list": es_lista,
                "description": [],
                "default": None,
                "values": None,
                "interval": None,
                "mandatory": False,
            }
            linea = resto
        if actual is None:
            continue
        linea = linea.strip()
        if not linea:
            continue
        if m := _DEFAULT.match(linea):
            actual["default"] = m.group(1)
        elif m := _VALORES.match(linea):
            actual["values"] = re.findall(r"'([^']*)'", m.group(1))
        elif m := _INTERVALO.match(linea):
            actual["interval"] = m.group(1)
        elif linea == "This is a mandatory parameter.":
            actual["mandatory"] = True
        elif not _GENERICA.match(linea):
            actual["description"].append(linea)

    for p in params.values():
        p["description"] = " ".join(p["description"]) or None
    return params


def consultar(operador):
    """Ejecuta gpt <operador> -h y devuelve (operador, entrada_del_catalogo | error)."""
    try:
        r = subprocess.run([GPT_BIN, operador, "-h"], capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return operador, None, f"gpt tardó más de {TIMEOUT_S}s"
    # gpt imprime la ayuda en stdout y el ruido de arranque (SEVERE/INFO) en stderr
    texto = r.stdout + "\n" + r.stderr
    if "Parameter Options:" not in texto and "Usage:" not in texto:
        ultima = next((l for l in reversed(texto.splitlines()) if l.strip()), "sin salida")
        return operador, None, ultima.strip()

    params = parsear_parametros(texto)
    ordenados = {}
    for nombre, anidado in orden_xml(texto):
        if nombre in params:
            params[nombre]["structured"] = anidado
            ordenados[nombre] = params.pop(nombre)
        elif anidado:
            # p. ej. BandMaths/targetBands: sin opción -P, solo existe como bloque XML
            ordenados[nombre] = {
                "name": nombre, "type": "structured", "javaType": None, "list": False,
                "description": None, "default": None, "values": None, "interval": None,
                "mandatory": False, "structured": True,
            }
    for nombre, p in params.items():  # los que no salgan en la plantilla XML, al final
        p["structured"] = False
        ordenados[nombre] = p

    descripcion = " ".join(l.strip() for l in seccion(texto, "Description") if l.strip()) or None
    return operador, {"description": descripcion, "parameters": ordenados}, None


def version_snap():
    """VERSION.txt de la instalación (gpt está en <snap>/bin/gpt)."""
    archivo = Path(GPT_BIN).resolve().parent.parent / "VERSION.txt"
    try:
        return archivo.read_text(encoding="utf-8").strip().splitlines()[0]
    except (OSError, IndexError):
        return None


def main():
    if not Path(GPT_BIN).exists():
        sys.exit(f"No se encontró gpt en {GPT_BIN} (definir GPT_BIN)")

    operadores = operadores_de_grafos()
    for extra in sys.argv[1:]:
        if extra not in operadores:
            operadores.append(extra)
    if not operadores:
        sys.exit(f"No se encontraron operadores en {GRAPHS_DIR}/GRAFICO_*.xml")

    print(f"Consultando {len(operadores)} operadores con {GPT_BIN} ...")
    catalogo, errores = {}, {}
    with ThreadPoolExecutor(PARALELO) as pool:
        for op, entrada, error in pool.map(consultar, operadores):
            if error:
                errores[op] = error
                print(f"  ✗ {op}: {error}")
                continue
            catalogo[op] = entrada
            n = len(entrada["parameters"])
            cerrados = sum(1 for p in entrada["parameters"].values() if p["values"])
            print(f"  ✓ {op}: {n} parámetros ({cerrados} con lista de valores)")

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps({
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "snapVersion": version_snap(),
        "source": "gpt <operador> -h",
        "operators": catalogo,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Catálogo escrito en {SALIDA}")

    if errores:
        sys.exit(f"{len(errores)} operador(es) con error: {', '.join(errores)}")


if __name__ == "__main__":
    main()
