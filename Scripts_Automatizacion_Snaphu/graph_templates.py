#!/usr/bin/env python3
# =============================================================================
# Plantillas XML de los pasos 5-7
# =============================================================================
# Los grafos de SNAP que usan los scripts de los pasos 5-7 viven como .xml en
# backend/files/ (igual que GRAFICO_1..4), así se editan desde la interfaz
# como cualquier otro grafo. Cada script carga su plantilla y sustituye los
# marcadores ${nombre} con las rutas/valores que solo se conocen al ejecutar.
#
# GRAPHS_DIR permite apuntar a otra carpeta de plantillas sin tocar el código.
# =============================================================================
import os
import re
from pathlib import Path
from xml.sax.saxutils import escape

GRAPHS_DIR = Path(os.getenv("GRAPHS_DIR") or Path(__file__).resolve().parent.parent / "backend" / "files")

_MARCADOR = re.compile(r"\$\{(\w+)\}")


def render_graph(nombre, **valores):
    """Lee GRAPHS_DIR/<nombre> y reemplaza cada ${clave} por valores[clave]
    (escapado para XML). Falla si la plantilla no existe o si queda un marcador
    sin valor, para no lanzar gpt con un grafo incompleto."""
    plantilla = GRAPHS_DIR / nombre
    if not plantilla.exists():
        raise FileNotFoundError(f"No existe la plantilla de grafo: {plantilla}")
    texto = plantilla.read_text(encoding="utf-8")

    faltantes = sorted({m for m in _MARCADOR.findall(texto) if m not in valores})
    if faltantes:
        raise KeyError(f"La plantilla {nombre} usa marcadores sin valor: {', '.join(faltantes)}")

    return _MARCADOR.sub(lambda m: escape(str(valores[m.group(1)])), texto)
