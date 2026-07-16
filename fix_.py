#!/usr/bin/env python3
"""
fix_metadata.py
===============
Repara el Abstracted_Metadata del Subset_resultado.dim copiándolo
desde el output_final.dim del Gráfico 2b, que tiene los metadatos
InSAR completos que SnaphuExport necesita para generar el .conf.

Uso:
  python fix_metadata.py             # usa las rutas de CONFIGURACIÓN
  python fix_metadata.py --dry-run   # solo muestra qué haría, no escribe nada
"""

import os
import sys
import shutil
import argparse
from datetime import datetime

# Intenta con lxml primero (más robusto), cae a stdlib si no está
try:
    from lxml import etree
    PARSER = "lxml"
except ImportError:
    import xml.etree.ElementTree as etree
    PARSER = "stdlib"

# ============================================================
#  CONFIGURACIÓN
# ============================================================

BASE = "/home/nahin/Documentos/SNAP_DOCUMENTATION/Resultados_V1.2"

# Producto DONANTE: Gráfico 2b — tiene Abstracted_Metadata completo
DONOR_DIM  = f"{BASE}/Grafo2_GPT_Prueba/output_final.dim"

# Producto RECEPTOR: Subset del Gráfico 4 — le faltan metadatos
TARGET_DIM = f"{BASE}/Grafo 4/Subset_DInSAR_ML_Flt.dim"

# Backup automático antes de modificar
BACKUP_SUFFIX = ".bak_metadata"

# ============================================================


def load_xml(path):
    if PARSER == "lxml":
        parser = etree.XMLParser(remove_blank_text=True)
        tree = etree.parse(path, parser)
        return tree, tree.getroot()
    else:
        tree = etree.parse(path)
        return tree, tree.getroot()


def save_xml(tree, path):
    if PARSER == "lxml":
        tree.write(path, pretty_print=True,
                   xml_declaration=True, encoding="UTF-8")
    else:
        etree.indent(tree.getroot(), space="  ")
        tree.write(path, encoding="unicode", xml_declaration=False)


def find_abstracted_metadata(root):
    """Busca el elemento Abstracted_Metadata en cualquier nivel del árbol."""
    # BEAM-DIMAP: <Metadata_Element name="Abstracted_Metadata">
    for el in root.iter("MDElem"):
        if el.get("name") == "Abstracted_Metadata":
            return el
    # Alternativa según versión de SNAP
    for el in root.iter("Metadata_Element"):
        if el.get("name") == "Abstracted_Metadata":
            return el
    return None


def find_metadata_root(root):
    """Localiza el nodo padre de Abstracted_Metadata en el árbol."""
    for el in root.iter():
        for child in list(el):
            name = child.get("name", "")
            tag  = child.tag
            if (tag in ("MDElem", "Metadata_Element") and
                    name == "Abstracted_Metadata"):
                return el
    return None


def banner(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(
        description="Repara Abstracted_Metadata del Subset copiándolo del Gráfico 2b")
    parser.add_argument("--dry-run", action="store_true",
                        help="Solo muestra qué haría, sin escribir nada")
    parser.add_argument("--donor",  default=DONOR_DIM,
                        help="Ruta del .dim donante (default: output_final.dim)")
    parser.add_argument("--target", default=TARGET_DIM,
                        help="Ruta del .dim a reparar (default: Subset_DInSAR_ML_Flt.dim)")
    args = parser.parse_args()

    banner("fix_metadata.py — Reparación de Abstracted_Metadata")
    print(f"Parser XML : {PARSER}")
    print(f"Timestamp  : {datetime.now()}")
    print(f"Modo       : {'DRY-RUN (sin escritura)' if args.dry_run else 'ESCRITURA REAL'}")

    # ── Verificar archivos ───────────────────────────────────
    banner("Verificando archivos")
    for label, path in [("Donante (Gráfico 2b)", args.donor),
                        ("Receptor (Subset)",    args.target)]:
        exists = os.path.exists(path)
        print(f"  {'✅' if exists else '❌'} {label}: {path}")
        if not exists:
            print(f"\n❌ Archivo no encontrado. Ajusta las rutas en CONFIGURACIÓN.")
            sys.exit(1)

    # ── Cargar XMLs ──────────────────────────────────────────
    banner("Cargando XMLs")
    print(f"  📖 Leyendo donante...")
    donor_tree, donor_root = load_xml(args.donor)
    print(f"  📖 Leyendo receptor...")
    target_tree, target_root = load_xml(args.target)

    # ── Extraer Abstracted_Metadata del donante ──────────────
    banner("Analizando metadatos")
    donor_am = find_abstracted_metadata(donor_root)
    if donor_am is None:
        print("❌ No se encontró Abstracted_Metadata en el donante.")
        print("   Verifica que output_final.dim es correcto.")
        sys.exit(1)

    # Contar atributos para dar feedback
    attrs = list(donor_am)
    print(f"  ✅ Abstracted_Metadata encontrado en donante")
    print(f"     → {len(attrs)} subelementos/atributos")

    # Mostrar algunos campos clave
    key_fields = ["radar_frequency", "range_spacing", "azimuth_spacing",
                  "PASS", "antenna_pointing", "mission"]
    for field in key_fields:
        for child in donor_am:
            if child.get("name") == field:
                val = child.get("val", child.text or "")
                print(f"     · {field}: {val}")

    # ── Analizar receptor ────────────────────────────────────
    target_am     = find_abstracted_metadata(target_root)
    target_am_parent = find_metadata_root(target_root)

    if target_am is not None:
        print(f"\n  ⚠️  El receptor YA tiene Abstracted_Metadata")
        sub = list(target_am)
        print(f"     → {len(sub)} subelementos (probablemente incompleto)")
        print(f"     → Se REEMPLAZARÁ con el del donante")
    else:
        print(f"\n  ℹ️  El receptor NO tiene Abstracted_Metadata → se INSERTARÁ")

    if target_am_parent is None and target_am is None:
        # Buscar nodo Metadata_Group o Dataset_Sources como fallback
        for tag in ("Metadata_Group", "Dataset_Sources", "Dataset_Attributes"):
            target_am_parent = target_root.find(f".//{tag}")
            if target_am_parent is not None:
                print(f"     → Insertando bajo <{tag}>")
                break
        if target_am_parent is None:
            target_am_parent = target_root
            print(f"     → Insertando en raíz del documento")

    # ── Hacer backup ─────────────────────────────────────────
    if not args.dry_run:
        backup_path = args.target + BACKUP_SUFFIX
        if not os.path.exists(backup_path):
            shutil.copy2(args.target, backup_path)
            print(f"\n  💾 Backup creado: {os.path.basename(backup_path)}")
        else:
            print(f"\n  💾 Backup ya existe: {os.path.basename(backup_path)}")

    # ── Importar el elemento con deep copy ──────────────────
    if PARSER == "lxml":
        import copy
        new_am = copy.deepcopy(donor_am)
    else:
        import xml.etree.ElementTree as ET
        import copy
        new_am = copy.deepcopy(donor_am)

    # ── Reemplazar o insertar ────────────────────────────────
    if not args.dry_run:
        banner("Aplicando reparación")
        if target_am is not None:
            # Reemplazar el existente
            idx = list(target_am_parent).index(target_am)
            target_am_parent.remove(target_am)
            target_am_parent.insert(idx, new_am)
            print("  ✅ Abstracted_Metadata REEMPLAZADO")
        else:
            # Insertar al inicio del padre
            target_am_parent.insert(0, new_am)
            print("  ✅ Abstracted_Metadata INSERTADO")

        save_xml(target_tree, args.target)
        print(f"  💾 Archivo guardado: {args.target}")

        # Verificación post-escritura
        _, verify_root = load_xml(args.target)
        verify_am = find_abstracted_metadata(verify_root)
        if verify_am is not None:
            print(f"  ✅ Verificación OK — {len(list(verify_am))} subelementos presentes")
        else:
            print("  ⚠️  Verificación: no se encontró Abstracted_Metadata tras guardar")
            print("     Restaura el backup y reporta el problema.")

    else:
        banner("DRY-RUN — resumen de lo que se haría")
        action = "REEMPLAZAR" if target_am else "INSERTAR"
        print(f"  → {action} Abstracted_Metadata en {os.path.basename(args.target)}")
        print(f"  → Backup en: {os.path.basename(args.target)}{BACKUP_SUFFIX}")
        print(f"  → Fuente: {os.path.basename(args.donor)}")
        print(f"  → {len(attrs)} subelementos a copiar")
        print(f"\n  Para ejecutar de verdad: quita el --dry-run")

    banner("✅ Listo")
    print(f"  Siguiente paso: ejecutar snaphu_pipeline.py --step 1")
    print(f"  (el Export sobre el Subset reparado)\n")


if __name__ == "__main__":
    main()




# /home/nahin/esa-snap/bin/gpt \
#   "/home/nahin/Documentos/SNAP_DOCUMENTATION/Graficos_XML/GRAFICO_4.xml/GRAFICO_4.xml" \
#   -q 4 -J-Xmx11G