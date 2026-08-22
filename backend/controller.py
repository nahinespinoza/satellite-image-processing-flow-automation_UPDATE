import os
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import subprocess
import shlex
import mimetypes
from datetime import datetime
from PIL import Image
import io
import tempfile
import uuid
import glob
from pathlib import Path
import re  
import json
import numpy as np

app = Flask(__name__)
CORS(app)

# Nombre de carpeta descriptivo por cada gráfico. Cada ejecución crea/usa
# esta subcarpeta dentro del output_dir para que los resultados de un
# gráfico no se mezclen con los de otro ni queden con nombres poco claros.
GRAPH_LABELS = {
    "GRAFICO_1.xml": "Grafo 1 - Orbit",
    "GRAFICO_2a.xml": "Grafo 2a - Back-Geocoding",
    "GRAFICO_2b.xml": "Grafo 2b - Interferogram",
    "GRAFICO_3.xml": "Grafo 3 - Terrain Correction",
    "GRAFICO_4.xml": "Grafo 4 - Final Output",
}

# ==================== PROCESADORES ADICIONALES (Scripts Python) ====================
PROCESSORS = {
    "SNAPHU_EXPORT": {
        "name": "Snaphu Export (Gráfico 5)",
        "script": "/home/nahin/Documentos/Proyectos_Personales/SNAP_V1.2/satellite-image-processing-flow-automation_UPDATE/Scripts_Automatizacion_Snaphu/Prueba_Subcarpetas_FUNCIONAL.py",
        "type": "python"
    },
    "SNAPHU_UNWRAPPING": {
        "name": "Snaphu Unwrapping (Gráfico 6)",
        "script": "/home/nahin/Documentos/Proyectos_Personales/SNAP_V1.2/satellite-image-processing-flow-automation_UPDATE/Scripts_Automatizacion_Snaphu/Prueba_Subcarpetas_FUNCIONAL.py",  # mismo script, pero se puede separar después
        "type": "python"
    },
    "PHASE_TO_DISPLACEMENT": {
        "name": "Phase to Displacement",
        "script": "/home/nahin/Documentos/Proyectos_Personales/SNAP_V1.2/satellite-image-processing-flow-automation_UPDATE/Scripts_Automatizacion_Snaphu/phase_to_displacement.py",
        "type": "python"
    },
    "TERRAIN_CORRECTION": {
        "name": "Terrain Correction + Máscara",
        "script": "/home/nahin/Documentos/Proyectos_Personales/SNAP_V1.2/satellite-image-processing-flow-automation_UPDATE/Scripts_Automatizacion_Snaphu/TerrainCorrection.py",
        "type": "python"
    },
}

# ==================== PARÁMETROS CONFIGURABLES POR EL USUARIO ====================
DEFAULT_PARAMS = {
    "subset_region": "0,0,24165,4188",
    "snaphu_tile_rows": 4,
    "snaphu_tile_cols": 4,
    "snaphu_processors": 4,
    "snaphu_row_overlap": 300,
    "snaphu_col_overlap": 300,
    "snaphu_cost_threshold": 500,
    "coherence_threshold": 0.3,
    "displacement_max_m": 2.0,
    "band_maths_expression": "",
}


def carpeta_para_grafo(graph_path):
    """Devuelve el nombre de carpeta descriptivo para un archivo de gráfico dado."""
    basename = os.path.basename(graph_path)
    return GRAPH_LABELS.get(basename, os.path.splitext(basename)[0])


# Patrón(es) de banda a exportar como preview para cada gráfico XML,
# reutilizando el mismo criterio que ya usa el flujo completo (_exportar_viz)
# para que el preview de un gráfico individual luzca igual que su
# contraparte dentro del flujo completo.
BAND_PATTERNS_BY_GRAPH = {
    "GRAFICO_1.xml": "Intensity",
    "GRAFICO_2a.xml": "Intensity",
    "GRAFICO_2b.xml": ["Phase_ifg", "Phase"],
    "GRAFICO_3.xml": "Phase",
    "GRAFICO_4.xml": "Phase",
}

# Igual, pero para los procesadores Python (pasos 5, 6 y 7) ejecutados de
# forma individual desde /procesar_paso.
BAND_PATTERNS_BY_STEP = {
    "SNAPHU_FULL": ["Unw.*Phase", "Phase"],
    "SNAPHU_EXPORT": ["Unw.*Phase", "Phase"],
    "SNAPHU_UNWRAPPING": ["Unw.*Phase", "Phase"],
    "PHASE_TO_DISPLACEMENT": "displacement",
    "TERRAIN_CORRECTION": "displacement_masked",
}


def _generar_preview_individual(dim_path, band_pattern, label):
    """
    Genera un preview (GeoTIFF + quicklook PNG) para un .dim resultante de
    un paso ejecutado de forma INDIVIDUAL (no como parte del flujo completo).
    El preview se guarda junto al propio .dim, en una subcarpeta "previews"
    dentro de la misma carpeta de salida, para no mezclarse con los .data
    internos de SNAP.

    Nunca lanza excepción: si algo falla, devuelve un dict con status "error"
    y un mensaje, para no interrumpir la respuesta principal de /procesar o
    /procesar_paso.
    """
    try:
        dim_dir = os.path.dirname(dim_path)
        preview_dir = os.path.join(dim_dir, "previews")
        dim_name = os.path.splitext(os.path.basename(dim_path))[0]
        preview_tiff = os.path.join(preview_dir, f"{dim_name}_preview.tif")

        resultado = exportar_banda_a_geotiff(
            dim_path, band_pattern, preview_tiff,
            gpt_bin="/home/nahin/esa-snap/bin/gpt",
            label=label,
        )
        resultado["step"] = label
        return resultado
    except Exception as e:
        return {"status": "error", "message": f"[{label}] no se pudo generar preview: {e}",
                "output_tiff": None, "band_name": None, "step": label}

@app.route('/config', methods=['GET'])
def get_config():
    """
    Devuelve la configuración del backend (rutas, etc.)
    Útil para que el frontend sepa dónde guardar archivos
    """
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        default_output = os.path.join(backend_dir, "files", "output")
        default_images = os.path.join(backend_dir, "files", "images")
        
        return jsonify({
            "status": "ok",
            "backend_dir": backend_dir,
            "default_output_dir": default_output,
            "default_images_dir": default_images
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def _listar_archivos_recursivo(base_dir):
    """
    Lista archivos dentro de base_dir, entrando a subcarpetas (como las
    "Grafo N - Nombre" que crea cada gráfico), pero SIN entrar a las
    carpetas *.data que SNAP genera junto a cada .dim (contienen cientos
    de archivos internos de banda que no queremos mostrar).
    Devuelve rutas relativas a base_dir, ej: "Grafo 1 - Orbit/archivo.dim"
    """
    archivos = []
    if not os.path.exists(base_dir):
        return archivos

    for root, dirs, files in os.walk(base_dir):
        # No descender a carpetas *.data (contenido interno de un producto BEAM-DIMAP)
        dirs[:] = [d for d in dirs if not d.lower().endswith('.data')]
        for f in files:
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, base_dir)
            archivos.append(rel_path.replace(os.sep, "/"))
    return archivos


@app.route('/archivos-disponibles', methods=['GET'])
def archivos_disponibles():
    """
    Lista los archivos disponibles, agrupados por par de fechas (carpetas
    AAAAMMDD_AAAAMMDD generadas por /procesar_flujo_batch_auto), para que
    el frontend pueda mostrar un selector por fecha en lugar de una lista
    plana de cientos de archivos.
    """
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        images_dir = os.path.join(backend_dir, "files", "images")
        output_dir = os.path.join(backend_dir, "files", "output")

        def agrupar_por_par(base_dir):
            grupos = {}
            sueltos = []
            if not os.path.exists(base_dir):
                return {"pares": [], "sueltos": []}

            for nombre in sorted(os.listdir(base_dir)):
                ruta = os.path.join(base_dir, nombre)
                # ¿Es una carpeta de par "AAAAMMDD_AAAAMMDD"?
                if os.path.isdir(ruta) and re.match(r'^\d{8}_\d{8}$', nombre):
                    fecha1_str, fecha2_str = nombre.split('_')
                    grupos[nombre] = {
                        "folder": nombre,
                        "fecha1": f"{fecha1_str[:4]}-{fecha1_str[4:6]}-{fecha1_str[6:]}",
                        "fecha2": f"{fecha2_str[:4]}-{fecha2_str[4:6]}-{fecha2_str[6:]}",
                        "archivos": _listar_archivos_recursivo(ruta)
                    }
                elif os.path.isfile(ruta):
                    sueltos.append(nombre)
                elif os.path.isdir(ruta):
                    # Carpeta que no sigue el patrón de fecha (ej. flujo individual viejo)
                    sueltos.extend([f"{nombre}/{f}" for f in _listar_archivos_recursivo(ruta)])

            return {
                "pares": sorted(grupos.values(), key=lambda g: g["fecha1"]),
                "sueltos": sueltos
            }

        files_by_category = {
            "input": agrupar_por_par(images_dir),
            "output": agrupar_por_par(output_dir)
        }

        total = sum(len(p["archivos"]) for p in files_by_category["input"]["pares"]) + \
                len(files_by_category["input"]["sueltos"]) + \
                sum(len(p["archivos"]) for p in files_by_category["output"]["pares"]) + \
                len(files_by_category["output"]["sueltos"])

        return jsonify({
            "status": "ok",
            "files_by_category": files_by_category,
            "total_count": total
        })
    except Exception as e:
        print(f"[ERROR] Excepción en archivos_disponibles: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/procesar', methods=['POST'])
def procesar():
    """
    Procesa un gráfico individual.
    Puede aceptar un solo archivo o múltiples archivos (para GRAFICO_2)
    """
    try:
        graph = request.json['graph']
        input_data = request.json['input']
        output_file = request.json['output']
        user_params = request.json.get('params', {})

        # Convertir a lista si es un solo archivo
        if isinstance(input_data, str):
            input_files = [input_data]
        else:
            input_files = input_data

        # Si el gráfico no es una ruta absoluta, construir la ruta completa en backend/files/
        if not os.path.isabs(graph):
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            graph = os.path.join(backend_dir, "files", graph)
        
        # Resolver rutas absolutas para todos los archivos de entrada
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        absolute_input_files = []
        
        for input_file in input_files:
            abs_path = None
            
            # Si ya es una ruta absoluta
            if os.path.isabs(input_file):
                abs_path = os.path.abspath(input_file)
            else:
                # Buscar en estas ubicaciones (en orden de preferencia)
                search_paths = [
                    os.path.join(backend_dir, "files", "images", input_file),
                    os.path.join(backend_dir, "files", "output", input_file),
                    os.path.join(backend_dir, "files", input_file),
                    input_file
                ]
                
                for path in search_paths:
                    if os.path.exists(path):
                        abs_path = os.path.abspath(path)
                        break
            
            if abs_path is None or not os.path.exists(abs_path):
                # Fallback: los outputs de cada gráfico quedan en subcarpetas
                # (ej. "Grafo 1 - Orbit/archivo.dim"), y las search_paths de
                # arriba solo miran un nivel directo dentro de files/output,
                # sin bajar a esas subcarpetas. Antes de rendirse, se busca
                # el archivo por nombre en cualquier subcarpeta de output.
                # Si hay varias coincidencias (mismo nombre en distintos
                # gráficos), se toma la modificada más recientemente, que es
                # la más probable de ser la que se acaba de generar.
                if not os.path.isabs(input_file):
                    basename = os.path.basename(input_file)
                    candidatos = glob.glob(
                        os.path.join(backend_dir, "files", "output", "**", basename),
                        recursive=True,
                    )
                    if candidatos:
                        abs_path = max(candidatos, key=os.path.getmtime)
                        print(
                            f"[DEBUG] '{input_file}' no estaba en la ubicación "
                            f"esperada; encontrado por búsqueda recursiva en: {abs_path}"
                        )

            if abs_path is None or not os.path.exists(abs_path):
                return jsonify({
                    "status": "error",
                    "message": f"Archivo no encontrado: {input_file}"
                }), 404
            
            absolute_input_files.append(abs_path)
        
        # Convertir a rutas absolutas
        graph = os.path.abspath(graph)
        output_file = os.path.abspath(output_file)

        # Insertar la subcarpeta descriptiva del gráfico
        output_base_dir = os.path.dirname(output_file)
        output_filename = os.path.basename(output_file)
        folder_name = carpeta_para_grafo(graph)
        output_file = os.path.join(output_base_dir, folder_name, output_filename)

        # Crear carpeta de salida si no existe
        output_dir = os.path.dirname(output_file)
        os.makedirs(output_dir, exist_ok=True)
        if not output_file.lower().endswith('.dim'):
            output_file += '.dim'
        GPT_PATH = "/home/nahin/esa-snap/bin/gpt"

        # Construir lista de argumentos
        cmd_list = [GPT_PATH, graph]
        cmd_list.append(f"-PinputFile={absolute_input_files[0]}")
        cmd_list.append(f"-PoutputFile={output_file}")
        if len(absolute_input_files) >= 2:
            cmd_list.append(f"-PinputFile2={absolute_input_files[1]}")
        
        # Inyectar parámetros del usuario (ej: subsetRegion, etc.)
        for k, v in user_params.items():
            if v not in [None, ""]:
                cmd_list.append(f"-P{k}={v}")

        result = subprocess.run(cmd_list, capture_output=True, text=True)

        if result.returncode == 0:
            # Generar preview de la banda relevante para este gráfico, igual
            # que se hace dentro del flujo completo, para que el panel de
            # procesamiento pueda mostrarlo debajo sin tener que ir al
            # Visualizador.
            graph_basename = os.path.basename(graph)
            band_pattern = BAND_PATTERNS_BY_GRAPH.get(graph_basename, ["Intensity", "Phase", ".*"])
            preview = _generar_preview_individual(
                output_file, band_pattern, GRAPH_LABELS.get(graph_basename, graph_basename)
            )
            return jsonify({"status": "ok", "output": output_file, "preview": preview})
        else:
            return jsonify({"status": "error", "message": result.stderr})
    except FileNotFoundError as e:
        return jsonify({"status": "error", "message": f"No se encontró el comando 'gpt'. Verifica que esté instalado y en el PATH. Error: {str(e)}"}), 500
    except Exception as e:
        print(f"[ERROR] Excepción en procesar: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

def _ejecutar_flujo_completo_core(absolute_input_files, output_dir, backend_dir, user_params=None):
    """
    Núcleo del flujo completo (Pasos 1-7): Orbit x2 -> Back-Geocoding ->
    Interferogram -> Terrain Correction -> Subset -> Snaphu -> Phase to
    Displacement -> Terrain Correction final.

    Reutilizable tanto por /procesar_flujo (una sola pareja de imágenes)
    como por /procesar_flujo_batch_auto (muchas parejas, armadas automáticamente por fecha).

    No usa jsonify ni request: recibe todo por parámetros y devuelve
    (dict_resultado, http_status) para que el llamador decida qué hacer
    con la respuesta (responder directo o acumular en un batch).
    """
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)  
    viz_dir = os.path.join(output_dir, "visualizaciones")
    visualizaciones_generadas = []
    progreso_path = os.path.join(output_dir, "progreso.json")

    def _actualizar_progreso(status="en_progreso", current_step=None, message=None):
        """
        Escribe el estado actual del flujo a disco (progreso.json) para que
        el frontend pueda leerlo por polling (endpoint /flujo-progreso) y
        mostrar cada preview apenas está lista, sin esperar a que termine
        todo el flujo (que puede tardar minutos u horas).
        """
        try:
            data = {
                "status": status,
                "current_step": current_step,
                "message": message,
                "visualizaciones": visualizaciones_generadas,
                "updated_at": datetime.now().isoformat(),
            }
            tmp_path = progreso_path + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp_path, progreso_path)
        except Exception as e:
            # Nunca debe interrumpir el flujo principal por un problema
            # escribiendo el archivo de progreso.
            print(f"[WARN] No se pudo escribir progreso.json: {e}")

    def _exportar_viz(step_label, dim_path, band_pattern, filename):
        _actualizar_progreso(status="en_progreso", current_step=step_label)
        r = exportar_banda_a_geotiff(
            dim_path, band_pattern,
            os.path.join(viz_dir, filename),
            gpt_bin=GPT_PATH,
            label=step_label,
        )
        visualizaciones_generadas.append({"step": step_label, **r})
        _actualizar_progreso(status="en_progreso", current_step=step_label)
        return r

    # Progreso inicial: limpia cualquier progreso de una corrida anterior en
    # esta misma carpeta de salida, para que el polling no muestre datos
    # obsoletos apenas arranca esta nueva corrida.
    _actualizar_progreso(status="en_progreso", current_step="Iniciando")

    # --- Mezclar parámetros del usuario con los por defecto ---
    user_params = user_params or {}
    params = {**DEFAULT_PARAMS, **user_params}
    print(f"[DEBUG] Parámetros efectivos: {params}")

    # ==================== PASOS 1-4: GRÁFICOS XML (GPT) ====================
    graph_files = {
        "1": os.path.join(backend_dir, "files", "GRAFICO_1.xml"),
        "2a": os.path.join(backend_dir, "files", "GRAFICO_2a.xml"),
        "2b": os.path.join(backend_dir, "files", "GRAFICO_2b.xml"),
        "3": os.path.join(backend_dir, "files", "GRAFICO_3.xml"),
        "4": os.path.join(backend_dir, "files", "GRAFICO_4.xml"),
    }
    GPT_PATH = "/home/nahin/esa-snap/bin/gpt"

    def ejecutar_grafo(label, input1, output_file, input2=None, extra_params=None):
        """
        Ejecuta un gráfico XML de SNAP con gpt, validando entrada y salida.
        Devuelve la ruta absoluta del .dim generado, o lanza RuntimeError.
        """
        graph = graph_files[label]

        if not os.path.exists(input1):
            raise RuntimeError(
                f"El archivo de entrada para el paso {label} no existe: {input1}. "
                f"El paso anterior no generó la salida esperada."
            )
        if input2 and not os.path.exists(input2):
            raise RuntimeError(
                f"El segundo archivo de entrada para el paso {label} no existe: {input2}."
            )

        file_size_mb = os.path.getsize(input1) / (1024 * 1024)
        print(f"[DEBUG] Paso {label}: entrada válida -> {input1} ({file_size_mb:.2f} MB)")
        if input2:
            print(f"[DEBUG] Paso {label}: entrada 2 válida -> {input2}")

        if not output_file.lower().endswith('.dim'):
            output_file += '.dim'
        os.makedirs(os.path.dirname(output_file), exist_ok=True)

        cmd_list = [GPT_PATH, graph, f"-PinputFile={input1}", f"-PoutputFile={output_file}"]
        if input2:
            cmd_list.append(f"-PinputFile2={input2}")
        if extra_params:
            for k, v in extra_params.items():
                cmd_list.append(f"-P{k}={v}")

        print(f"\n--- Ejecutando paso {label} (XML) ---")
        print(cmd_list)

        result = subprocess.run(cmd_list, capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stderr)
            raise RuntimeError(result.stderr)

        if not os.path.exists(output_file):
            data_folder = output_file.replace('.dim', '.data')
            error_msg = f"El paso {label} reportó éxito pero el archivo de salida no se encontró: {output_file}"
            if os.path.exists(data_folder):
                error_msg += (
                    f". Se detectó la carpeta .data asociada ({data_folder}). "
                    f"SNAP pudo fallar al escribir el encabezado .dim."
                )
            raise RuntimeError(error_msg)

        file_size_mb = os.path.getsize(output_file) / (1024 * 1024)
        print(f"[DEBUG] Paso {label}: salida generada -> {output_file} ({file_size_mb:.2f} MB)")
        print(f"✅ Paso {label} (XML) completado.")
        return output_file

    if len(absolute_input_files) < 2:
        msg = (
            "El flujo requiere dos imágenes (master y slave) para el Gráfico 2a "
            "(Back-Geocoding). Sólo se recibió una."
        )
        _actualizar_progreso(status="error", current_step="1-4", message=msg)
        return {
            "status": "error",
            "step": "1-4",
            "message": msg
        }, 400

    name1 = os.path.splitext(os.path.basename(absolute_input_files[0]))[0]
    folder_1 = os.path.join(output_dir, carpeta_para_grafo(graph_files["1"]))

    try:
        # --- Paso 1: Orbit, aplicado a AMBAS imágenes por separado ---
        out1_master = ejecutar_grafo(
            "1", absolute_input_files[0],
            os.path.join(folder_1, f"{name1}_step_1.dim")
        )
        _exportar_viz("Paso 1 (master)", out1_master, "Intensity", "paso1_master_Intensity.tif")

        name2 = os.path.splitext(os.path.basename(absolute_input_files[1]))[0]
        out1_slave = ejecutar_grafo(
            "1", absolute_input_files[1],
            os.path.join(folder_1, f"{name2}_step_1.dim")
        )
        _exportar_viz("Paso 1 (slave)", out1_slave, "Intensity", "paso1_slave_Intensity.tif")

        # --- Paso 2a: Back-Geocoding, recibe las DOS salidas del paso 1 ---
        out2a = ejecutar_grafo(
            "2a", out1_master,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["2a"]), f"{name1}_step_2a.dim"),
            input2=out1_slave
        )
        _exportar_viz("Paso 2a", out2a, "Intensity", "paso2a_Intensity.tif")

        # --- Paso 2b: Interferogram, recibe la salida de 2a ---
        out2b = ejecutar_grafo(
            "2b", out2a,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["2b"]), f"{name1}_step_2b.dim")
        )
        _exportar_viz("Paso 2b", out2b, ["Phase_ifg", "Phase"], "paso2b_Phase.tif")

        # --- Paso 3: Terrain Correction, recibe la salida de 2b ---
        out3 = ejecutar_grafo(
            "3", out2b,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["3"]), f"{name1}_step_3.dim")
        )
        _exportar_viz("Paso 3", out3, "Phase", "paso3_Phase.tif")

        # --- Paso 4: Subset, recibe la salida de 3 ---
        out4 = ejecutar_grafo(
            "4", out3,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["4"]), f"{name1}_step_4.dim"),
            extra_params={"subsetRegion": params["subset_region"]}
        )
        _exportar_viz("Paso 4", out4, "Phase", "paso4_Phase.tif")
    except RuntimeError as e:
        _actualizar_progreso(status="error", current_step="1-4", message=str(e))
        return {"status": "error", "step": "1-4", "message": str(e), "visualizaciones": visualizaciones_generadas}, 500

    current_input = out4

    # ==================== PASOS 5-7: PROCESADORES PYTHON ====================
    python_steps = [
        ("SNAPHU_FULL", "5"),
        ("PHASE_TO_DISPLACEMENT", "6"),
        ("TERRAIN_CORRECTION", "7"),
    ]

    for step_name, label in python_steps:
        print(f"\n--- Ejecutando paso {label} (Python: {step_name}) ---")

        # Preparar entorno igual que en procesar_paso()
        base_path = Path(output_dir)
        env = os.environ.copy()
        env["BASE_DIR"] = str(base_path)
        env["GPT_BIN"] = "/home/nahin/esa-snap/bin/gpt"
        env["SNAPHU_BIN"] = "/home/nahin/.snap/auxdata/snaphu-v2.0.4_linux/bin/snaphu"
        env["NON_INTERACTIVE"] = "1"

        # Parámetros configurables del usuario
        env["SNAPHU_TILE_ROWS"] = str(params["snaphu_tile_rows"])
        env["SNAPHU_TILE_COLS"] = str(params["snaphu_tile_cols"])
        env["SNAPHU_PROCESSORS"] = str(params["snaphu_processors"])
        env["SNAPHU_ROW_OVERLAP"] = str(params["snaphu_row_overlap"])
        env["SNAPHU_COL_OVERLAP"] = str(params["snaphu_col_overlap"])
        env["SNAPHU_COST_THRESHOLD"] = str(params["snaphu_cost_threshold"])
        env["COHERENCE_THRESHOLD"] = str(params["coherence_threshold"])
        env["DISPLACEMENT_MAX_M"] = str(params["displacement_max_m"])
        env["BAND_MATHS_EXPRESSION"] = str(params.get("band_maths_expression", ""))

        # Determinar script y variables según el paso
        script_path = None

        if step_name == "SNAPHU_FULL":
            script_path = os.path.join(backend_dir, "..", "Scripts_Automatizacion_Snaphu", "Prueba_Subcarpetas_FUNCIONAL.py")
            script_path = os.path.abspath(script_path)

            # Buscar archivo de entrada (subset del paso 4)
            subset_dim = current_input  # Salida del paso 4
            if not os.path.isabs(subset_dim):
                possible_paths = [
                    os.path.join(base_path, subset_dim),
                    os.path.join(backend_dir, "files", subset_dim),
                    os.path.join(backend_dir, "files", "output", subset_dim),
                ]
                for p in possible_paths:
                    if os.path.exists(p):
                        subset_dim = os.path.abspath(p)
                        break

            env["SUBSET_DIM"] = subset_dim
            export_dir = base_path / "SnaphuExport"
            unwrap_dir = base_path / "SnaphuUnwrapping"
            import_dir = base_path / "SnaphuImport"
            for folder in [export_dir, unwrap_dir, import_dir]:
                folder.mkdir(parents=True, exist_ok=True)
            env["EXPORT_DIR"] = str(export_dir)
            env["UNWRAP_DIR"] = str(unwrap_dir)
            env["IMPORT_DIR"] = str(import_dir)
            env["BASE_FOLDER"] = str(base_path)

        elif step_name == "PHASE_TO_DISPLACEMENT":
            script_path = os.path.join(backend_dir, "..", "Scripts_Automatizacion_Snaphu", "phase_to_displacement.py")
            script_path = os.path.abspath(script_path)

            # Buscar automáticamente en SnaphuImport
            snaphu_import_dir = base_path / "SnaphuImport"
            dim_files = list(snaphu_import_dir.glob("*.dim"))
            if dim_files:
                env["INPUT_DIM"] = str(dim_files[0])
            else:
                env["INPUT_DIM"] = str(base_path / "SnaphuImport" / "output_final_Orb_Orb_UNW.dim")

        elif step_name == "TERRAIN_CORRECTION":
            script_path = os.path.join(backend_dir, "..", "Scripts_Automatizacion_Snaphu", "TerrainCorrection.py")
            script_path = os.path.abspath(script_path)

            # SUBSET_DIM: buscar en Grafo 4
            grafo4_dir = base_path / "Grafo 4 - Final Output"
            grafo4_files = list(grafo4_dir.glob("*.dim"))
            if grafo4_files:
                env["SUBSET_DIM"] = str(grafo4_files[0])
            else:
                env["SUBSET_DIM"] = str(base_path / "Grafo 4 - Final Output" / "output_final_Orb_Orb.dim")

            # DISPLACEMENT_DIM: buscar en PhaseToDisplacement
            disp_dir = base_path / "PhaseToDisplacement"
            disp_files = list(disp_dir.glob("*.dim"))
            if disp_files:
                env["DISPLACEMENT_DIM"] = str(disp_files[0])
            else:
                env["DISPLACEMENT_DIM"] = str(base_path / "PhaseToDisplacement" / "output_final_Orb_Orb_DISP.dim")

        if not Path(script_path).exists():
            _actualizar_progreso(status="error", current_step=label, message=f"Script no encontrado: {script_path}")
            return {
                "status": "error",
                "step": label,
                "message": f"Script no encontrado: {script_path}"
            }, 404

        # --- Validación: archivo de entrada para el paso Python ---
        if step_name == "SNAPHU_FULL":
            input_check = env.get("SUBSET_DIM")
        elif step_name == "PHASE_TO_DISPLACEMENT":
            input_check = env.get("INPUT_DIM")
        elif step_name == "TERRAIN_CORRECTION":
            input_check = env.get("DISPLACEMENT_DIM")
        else:
            input_check = None

        if input_check and not os.path.exists(input_check):
            error_msg = (
                f"El archivo de entrada para el paso {label} ({step_name}) no existe: {input_check}. "
                f"Verifica que el paso anterior se haya ejecutado correctamente."
            )
            print(f"[ERROR] {error_msg}")
            _actualizar_progreso(status="error", current_step=label, message=error_msg)
            return {"status": "error", "step": label, "message": error_msg, "visualizaciones": visualizaciones_generadas}, 500
        elif input_check:
            file_size_mb = os.path.getsize(input_check) / (1024 * 1024)
            print(f"[DEBUG] Paso {label}: entrada válida -> {input_check} ({file_size_mb:.2f} MB)")

        # Ejecución con streaming en paralelo (igual que procesar_paso)
        import threading
        import sys

        _actualizar_progreso(status="en_progreso", current_step=label)

        collected_stdout = []
        collected_stderr = []

        process = subprocess.Popen(
            ["python3", "-u", script_path],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=os.path.dirname(script_path)
        )

        def read_stdout():
            for line in process.stdout:
                line_stripped = line.rstrip()
                print(f"[{step_name}-OUT] {line_stripped}", flush=True)
                collected_stdout.append(line_stripped)

        def read_stderr():
            for line in process.stderr:
                line_stripped = line.rstrip()
                print(f"[{step_name}-ERR] {line_stripped}", file=sys.stderr, flush=True)
                collected_stderr.append(line_stripped)

        t_out = threading.Thread(target=read_stdout)
        t_err = threading.Thread(target=read_stderr)
        t_out.start()
        t_err.start()
        process.wait()
        t_out.join()
        t_err.join()

        stdout_text = "\n".join(collected_stdout)
        stderr_text = "\n".join(collected_stderr)

        if process.returncode != 0:
            print(f"[ERROR] Paso {label} ({step_name}) falló.")
            _actualizar_progreso(status="error", current_step=label, message=f"Error en {step_name}")
            return {
                "status": "error",
                "step": label,
                "message": f"Error en {step_name}",
                "stderr": stderr_text[-3000:] if len(stderr_text) > 3000 else stderr_text,
                "visualizaciones": visualizaciones_generadas
            }, 500

        if step_name == "SNAPHU_FULL":
            # Verificar que se generó al menos un .dim en SnaphuImport
            import_dir = base_path / "SnaphuImport"
            dim_files = list(import_dir.glob("*.dim"))
            if not dim_files:
                error_msg = f"El paso {label} (SNAPHU_FULL) no generó archivos .dim en {import_dir}"
                print(f"[ERROR] {error_msg}")
                _actualizar_progreso(status="error", current_step=label, message=error_msg)
                return {"status": "error", "step": label, "message": error_msg, "visualizaciones": visualizaciones_generadas}, 500
            current_input = str(dim_files[0])
            print(f"[DEBUG] Paso {label}: salida detectada -> {current_input}")
            _exportar_viz("Paso 5", current_input, ["Unw.*Phase", "Phase"], "paso5_UnwPhase.tif")  # <-- NUEVO

        elif step_name == "PHASE_TO_DISPLACEMENT":
            disp_dir = base_path / "PhaseToDisplacement"
            dim_files = list(disp_dir.glob("*.dim"))
            if not dim_files:
                error_msg = f"El paso {label} (PHASE_TO_DISPLACEMENT) no generó archivos .dim en {disp_dir}"
                print(f"[ERROR] {error_msg}")
                _actualizar_progreso(status="error", current_step=label, message=error_msg)
                return {"status": "error", "step": label, "message": error_msg, "visualizaciones": visualizaciones_generadas}, 500
            current_input = str(dim_files[0])
            print(f"[DEBUG] Paso {label}: salida detectada -> {current_input}")
            _exportar_viz("Paso 6", current_input, "displacement", "paso6_Displacement.tif")  # <-- NUEVO

        elif step_name == "TERRAIN_CORRECTION":
            # TerrainCorrection no genera un .dim nuevo, usa el de displacement
            # Verificar que el script terminó bien
            print(f"[DEBUG] Paso {label}: TerrainCorrection completado (sin nuevo .dim)")
            # <-- NUEVO: bloque completo de aquí abajo
            tc_dir = base_path / "TerrainCorrection"
            tc_files = list(tc_dir.glob("Stack_TC_Masked.dim")) or list(tc_dir.glob("*.dim"))
            if tc_files:
                _exportar_viz("Paso 7", str(tc_files[0]), "displacement_masked", "paso7_Masked.tif")
            else:
                print(f"[WARN] Paso 7: no se encontró .dim final en {tc_dir}, se omite export de visualización")

    _actualizar_progreso(status="completado", current_step="Finalizado")
    return {
        "status": "ok",
        "message": "Flujo completo ejecutado correctamente (pasos 1-7)",
        "final_output": current_input,
        "visualizaciones": visualizaciones_generadas
    }, 200

@app.route('/procesar_flujo', methods=['POST'])
def procesar_flujo():
    """
    Ejecuta el flujo COMPLETO: 4 gráficos XML + 3 procesadores Python,
    para UNA sola pareja de imágenes (master + slave).
    Espera un JSON con los campos:
    {
      "inputs": ["archivo1.zip", "archivo2.dim"],
      "output_dir": "C:/ruta/salida/",
      "params": { ... }   <-- OPCIONAL
    }
    """
    try:
        data = request.json
        input_files = data.get('inputs', [])
        output_dir = data['output_dir']
        user_params = data.get('params', {})

        if not input_files:
            return jsonify({
                "status": "error",
                "message": "Se requiere al menos un archivo de entrada"
            }), 400

        if isinstance(input_files, str):
            input_files = [input_files]

        backend_dir = os.path.dirname(os.path.abspath(__file__))
        absolute_input_files = []
        
        print(f"[DEBUG] Input files recibidos: {input_files}")
        
        for input_file in input_files:
            abs_path = None
            
            if os.path.isabs(input_file):
                abs_path = os.path.abspath(input_file)
            else:
                search_paths = [
                    os.path.join(backend_dir, "files", "images", input_file),
                    os.path.join(backend_dir, "files", "output", input_file),
                    os.path.join(backend_dir, "files", input_file),
                    input_file
                ]
                
                for path in search_paths:
                    if os.path.exists(path):
                        abs_path = os.path.abspath(path)
                        print(f"[DEBUG] Archivo encontrado en: {abs_path}")
                        break
            
            print(f"[DEBUG] Buscando archivo: {input_file}")
            
            if abs_path is None or not os.path.exists(abs_path):
                print(f"[ERROR] Archivo no encontrado: {input_file}")
                images_dir = os.path.join(backend_dir, "files", "images")
                output_dir_list = os.path.join(backend_dir, "files", "output")
                
                available = []
                if os.path.exists(images_dir):
                    available.extend([f"images/{f}" for f in os.listdir(images_dir) if os.path.isfile(os.path.join(images_dir, f))])
                if os.path.exists(output_dir_list):
                    available.extend([f"output/{f}" for f in os.listdir(output_dir_list) if os.path.isfile(os.path.join(output_dir_list, f))])
                
                print(f"[DEBUG] Archivos disponibles: {available}")
                return jsonify({
                    "status": "error",
                    "message": f"Archivo no encontrado: {input_file}. Intenta usar 'output/nombre.dim' si está en la carpeta de output",
                    "available_files": available
                }), 404
            
            absolute_input_files.append(abs_path)
        
        result, code = _ejecutar_flujo_completo_core(absolute_input_files, output_dir, backend_dir, user_params)
        return jsonify(result), code

    except FileNotFoundError as e:
        return jsonify({
            "status": "error",
            "message": f"No se encontró el comando 'gpt'. Verifica que esté instalado y en el PATH. Error: {str(e)}"
        }), 500
    except Exception as e:
        print(f"[ERROR] Excepción en procesar_flujo: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/flujo-progreso', methods=['GET'])
def flujo_progreso():
    """
    Devuelve el estado actual de un flujo completo en ejecución, leyendo el
    progreso.json que _ejecutar_flujo_completo_core va escribiendo después
    de cada paso. Pensado para que el frontend haga polling mientras
    /procesar_flujo sigue corriendo, y así mostrar cada preview apenas está
    lista en vez de esperar a que termine todo el flujo.

    Uso: GET /flujo-progreso?output_dir=/ruta/absoluta/usada/en/procesar_flujo
    """
    try:
        output_dir = request.args.get('output_dir')
        if not output_dir:
            return jsonify({"status": "error", "message": "output_dir es requerido"}), 400

        output_dir = os.path.abspath(output_dir)
        progreso_path = os.path.join(output_dir, "progreso.json")

        if not os.path.exists(progreso_path):
            # Aún no ha arrancado (o la carpeta no corresponde a ningún
            # flujo corrido todavía) — no es un error, solo "sin datos aún".
            return jsonify({
                "status": "pendiente",
                "current_step": None,
                "visualizaciones": []
            })

        with open(progreso_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        print(f"[ERROR] Excepción en flujo_progreso: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500
# ==================== EMPAREJAMIENTO AUTOMÁTICO POR FECHA (12 días) ====================

# Extrae la fecha de adquisición de un nombre de producto Sentinel-1, ej:
# S1A_IW_SLC__1SDV_20260509T105323_20260509T105350_064439_081D91_CFA2
# -> captura el primer bloque YYYYMMDDTHHMMSS y devuelve solo la fecha (date).
_SENTINEL_DATE_RE = re.compile(r'(\d{8})T\d{6}')


def _extraer_fecha_sentinel(filename):
    """
    Devuelve un objeto date extraído del nombre del archivo, o None si el
    nombre no tiene el patrón esperado (YYYYMMDDTHHMMSS).
    """
    basename = os.path.basename(filename)
    match = _SENTINEL_DATE_RE.search(basename)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%Y%m%d").date()
    except ValueError:
        return None


def _formar_pares_por_fecha(imagenes, dias_esperados=12):
    """
    Recibe una lista de rutas de imágenes (ya ordenadas cronológicamente) y
    arma pares consecutivos SOLO cuando la diferencia de fechas entre ellas
    es exactamente `dias_esperados` días.

    Lógica (ventana deslizante de paso 1, tal como la describiste):
      - compara img[0] con img[1]; si difieren en 12 días -> es un par válido
      - compara img[1] con img[2]; si no difieren en 12 días -> no hay par ahí
      - compara img[2] con img[3]; si difieren en 12 días -> es un par válido
      - ... y así sucesivamente hasta el final de la lista.

    Devuelve:
        pares: lista de tuplas (img_a, img_b) válidas
        descartadas: lista de dicts informando qué comparaciones no cuadraron
                     (útil para mostrarle al usuario por qué faltó un par)
    """
    pares = []
    descartadas = []

    for i in range(len(imagenes) - 1):
        img_a, img_b = imagenes[i], imagenes[i + 1]
        fecha_a = _extraer_fecha_sentinel(img_a)
        fecha_b = _extraer_fecha_sentinel(img_b)

        if fecha_a is None or fecha_b is None:
            descartadas.append({
                "img_a": os.path.basename(img_a),
                "img_b": os.path.basename(img_b),
                "motivo": "No se pudo extraer la fecha del nombre del archivo"
            })
            continue

        diferencia_dias = abs((fecha_b - fecha_a).days)

        if diferencia_dias == dias_esperados:
            pares.append((img_a, img_b))
        else:
            descartadas.append({
                "img_a": os.path.basename(img_a),
                "img_b": os.path.basename(img_b),
                "motivo": f"Diferencia de {diferencia_dias} días (se esperaban {dias_esperados})"
            })

    return pares, descartadas


@app.route('/procesar_flujo_batch_auto', methods=['POST'])
def procesar_flujo_batch_auto():
    """
    Ejecuta el flujo COMPLETO (pasos 1-7) para MUCHAS parejas de imágenes,
    a partir de una carpeta principal PLANA (sin subcarpetas) con n imágenes:

    Carpeta_main/
      Img1, Img2, Img3, ..., ImgN

    Los pares se arman automáticamente comparando la fecha de adquisición
    codificada en el nombre del archivo Sentinel-1 (formato YYYYMMDDTHHMMSS):
    solo se procesan como par las imágenes consecutivas (ordenadas por fecha)
    cuya diferencia sea de exactamente 12 días.

    Por cada par válido se crea una subcarpeta dentro de main_folder con el
    nombre "<fecha1>_<fecha2>" y ahí se genera toda la salida del flujo
    (igual que hace /procesar_flujo_batch para cada Carpeta_n).

    Espera un JSON:
    {
      "main_folder": "/ruta/a/Carpeta_main",
      "dias_esperados": 12,   <-- OPCIONAL, por defecto 12
      "params": { ... }       <-- OPCIONAL
    }
    """
    try:
        data = request.json
        main_folder = data.get('main_folder')
        dias_esperados = int(data.get('dias_esperados', 12))
        user_params = data.get('params', {})

        if not main_folder:
            return jsonify({"status": "error", "message": "main_folder es requerido"}), 400

        backend_dir = os.path.dirname(os.path.abspath(__file__))

        # Misma resolución de ruta que ya usa /procesar_flujo_batch, para
        # soportar tanto ruta absoluta como nombre de carpeta suelto.
        if os.path.isabs(main_folder) and os.path.isdir(main_folder):
            resolved_folder = os.path.abspath(main_folder)
        else:
            search_paths = [
                os.path.join(backend_dir, "files", "images", main_folder),
                os.path.join(backend_dir, "files", "output", main_folder),
                os.path.join(backend_dir, "files", main_folder),
                main_folder,
            ]
            resolved_folder = None
            for path in search_paths:
                if os.path.isdir(path):
                    resolved_folder = os.path.abspath(path)
                    print(f"[BATCH-AUTO] Carpeta principal encontrada en: {resolved_folder}")
                    break

        if resolved_folder is None:
            return jsonify({
                "status": "error",
                "message": (
                    f"No se encontró la carpeta principal: '{main_folder}'. "
                    f"Si la seleccionaste con 'Browse', colócala dentro de "
                    f"backend/files/images/ o backend/files/output/, o escribe "
                    f"la ruta absoluta completa manualmente."
                )
            }), 404

        main_folder = resolved_folder
        ALLOWED_EXTS = ('.zip', '.dim')

        # Todas las imágenes (nivel raíz de main_folder, sin bajar a subcarpetas)
        imagenes = [
            os.path.join(main_folder, f)
            for f in os.listdir(main_folder)
            if os.path.isfile(os.path.join(main_folder, f))
            and f.lower().endswith(ALLOWED_EXTS)
        ]

        if len(imagenes) < 2:
            return jsonify({
                "status": "error",
                "message": f"Se requieren al menos 2 imágenes en '{main_folder}', se encontraron {len(imagenes)}."
            }), 404

        # Ordenar cronológicamente según la fecha extraída del nombre. Las
        # imágenes sin fecha reconocible se mandan al final (no rompen el orden).
        imagenes.sort(key=lambda f: _extraer_fecha_sentinel(f) or datetime.max.date())

        print(f"[BATCH-AUTO] {len(imagenes)} imágenes encontradas en {main_folder}, armando pares por fecha...")

        pares, descartadas = _formar_pares_por_fecha(imagenes, dias_esperados=dias_esperados)

        for d in descartadas:
            print(f"[BATCH-AUTO][SKIP] {d['img_a']} <-> {d['img_b']}: {d['motivo']}")

        if not pares:
            return jsonify({
                "status": "error",
                "message": f"No se formó ningún par con diferencia de {dias_esperados} días.",
                "descartadas": descartadas
            }), 404

        print(f"[BATCH-AUTO] {len(pares)} pares válidos de {len(imagenes)} imágenes.")

        resultados = []
        exitosos = 0
        fallidos = 0

        for imagen1, imagen2 in pares:
            fecha1 = _extraer_fecha_sentinel(imagen1)
            fecha2 = _extraer_fecha_sentinel(imagen2)
            folder_name = f"{fecha1.strftime('%Y%m%d')}_{fecha2.strftime('%Y%m%d')}"
            pair_output_dir = os.path.join(main_folder, folder_name)
            os.makedirs(pair_output_dir, exist_ok=True)

            print(f"\n{'=' * 60}\n[BATCH-AUTO] Procesando par: {folder_name}\n{'=' * 60}")
            print(f"[BATCH-AUTO] Imagen 1 (master): {imagen1}")
            print(f"[BATCH-AUTO] Imagen 2 (slave):  {imagen2}")

            try:
                result, code = _ejecutar_flujo_completo_core(
                    [imagen1, imagen2], pair_output_dir, backend_dir, user_params
                )
            except Exception as e:
                print(f"[BATCH-AUTO][ERROR] Excepción procesando '{folder_name}': {e}")
                import traceback
                traceback.print_exc()
                result, code = {"status": "error", "message": str(e)}, 500

            result["folder"] = folder_name
            resultados.append(result)

            if result.get("status") == "ok":
                exitosos += 1
                print(f"[BATCH-AUTO] ✅ '{folder_name}' completada. Salida: {result.get('final_output')}")
            else:
                fallidos += 1
                print(f"[BATCH-AUTO] ❌ '{folder_name}' falló: {result.get('message')}")

        if fallidos == 0:
            status_general = "ok"
        elif exitosos > 0:
            status_general = "partial"
        else:
            status_general = "error"

        print(f"\n[BATCH-AUTO] Terminado. {exitosos} exitosas, {fallidos} fallidas de {len(pares)} pares.")

        return jsonify({
            "status": status_general,
            "main_folder": main_folder,
            "total_imagenes": len(imagenes),
            "total_pares": len(pares),
            "exitosos": exitosos,
            "fallidos": fallidos,
            "resultados": resultados,
            "pares_descartados": descartadas
        })

    except Exception as e:
        print(f"[ERROR] Excepción en procesar_flujo_batch_auto: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/guardar-graph', methods=['POST'])
def guardar_graph():
    """
    Guarda un archivo XML modificado dentro de backend/files/
    Espera un JSON:
    {
       "file_name": "GRAFICO_1.xml",
       "content": "<graph>...</graph>"
    }
    """
    try:
        data = request.json
        file_name = data.get("file_name")
        content = data.get("content")

        if not file_name or not content:
            return jsonify({"status": "error", "message": "file_name y content son requeridos"}), 400

        backend_dir = os.path.dirname(os.path.abspath(__file__))
        graph_path = os.path.join(backend_dir, "files", file_name)

        # Validar extensión
        if not file_name.lower().endswith(".xml"):
            return jsonify({"status": "error", "message": "Solo se permiten archivos .xml"}), 400
        
        # Guardar archivo
        with open(graph_path, "w", encoding="utf-8") as f:
            f.write(content)

        return jsonify({
            "status": "ok",
            "message": "Archivo guardado correctamente",
            "path": graph_path
        })
    
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/files/<folder>/<path:filename>', methods=['GET'])
def serve_file(folder, filename):
    """
    Sirve archivos estáticos desde las carpetas files/images o files/output
    """
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Validar folder
        if folder not in ['images', 'output', 'input']:
            return jsonify({"status": "error", "message": "Carpeta no válida"}), 400
        
        # Mapear "input" a "images" para la ruta del archivo real
        physical_folder = "images" if folder == "input" else folder
        
        file_path = os.path.join(backend_dir, "files", physical_folder, filename)
        
        # Verificar que el archivo existe y está dentro del directorio permitido
        if not os.path.exists(file_path) or not os.path.isfile(file_path):
            return jsonify({"status": "error", "message": "Archivo no encontrado"}), 404
        
        # Verificar que la ruta está dentro del directorio permitido (seguridad)
        allowed_dir = os.path.join(backend_dir, "files", physical_folder)
        if not os.path.commonpath([file_path, allowed_dir]) == allowed_dir:
            return jsonify({"status": "error", "message": "Acceso denegado"}), 403
        
        # Si es TIFF, intentar convertir antes de servir para evitar enviar TIFF crudo al navegador
        if filename.lower().endswith(('.tif', '.tiff')):
            try:
                buf = _convert_file_to_png(file_path)
                buf.seek(0)
                print(f"[DEBUG] TIFF convertido exitosamente: {filename}")
                return send_file(buf, mimetype='image/png', as_attachment=False,
                                 download_name=f"{os.path.splitext(filename)[0]}.png")
            except ConversionError as ce:
                print(f"[ERROR] ConversionError para {filename}: {ce.message}")
                # Devolver JSON informativo (HTTP 422) en lugar de TIFF crudo
                return jsonify(ce.to_dict()), 422
            except Exception as e:
                print(f"[ERROR] Error inesperado convirtiendo {filename}: {str(e)}")
                import traceback
                traceback.print_exc()
                return jsonify({"status": "error", "message": f"Error convirtiendo TIFF: {str(e)}"}), 500

        # Determinar tipo MIME
        mimetype = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'

        return send_file(file_path, mimetype=mimetype)
    except Exception as e:
        print(f"[ERROR] Error general en serve_file para {filename}: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/preview-image', methods=['GET'])
def preview_image():
    """
    Sirve como PNG un archivo de preview (tif/png/jpg) a partir de su ruta
    absoluta en el servidor. Se usa para mostrar los previews generados por
    /procesar, /procesar_paso y /procesar_flujo directamente debajo del área
    de procesamiento, sin depender de que el archivo esté dentro de
    backend/files/ (los output_dir son elegidos libremente por el usuario).

    Uso: GET /preview-image?path=/ruta/absoluta/al/archivo.tif
    """
    try:
        path = request.args.get('path')
        if not path:
            return jsonify({"status": "error", "message": "path es requerido"}), 400

        path = os.path.abspath(path)
        if not os.path.exists(path) or not os.path.isfile(path):
            return jsonify({"status": "error", "message": "Archivo de preview no encontrado"}), 404

        if path.lower().endswith(('.tif', '.tiff')):
            # Preferir el quicklook PNG pre-generado con pconvert si existe
            precomputed_png = os.path.splitext(path)[0] + ".png"
            if os.path.exists(precomputed_png):
                return send_file(precomputed_png, mimetype='image/png', as_attachment=False)
            try:
                buf = _convert_file_to_png(path)
                buf.seek(0)
                return send_file(buf, mimetype='image/png', as_attachment=False)
            except ConversionError as ce:
                return jsonify(ce.to_dict()), 422

        mimetype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        return send_file(path, mimetype=mimetype)
    except Exception as e:
        print(f"[ERROR] Excepción en preview_image: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/files/temp/converted/<filename>', methods=['GET'])
def serve_temp_converted(filename):
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(backend_dir, 'files', 'temp', 'converted', filename)
        if not os.path.exists(file_path):
            return jsonify({"status": "error", "message": "Archivo no encontrado"}), 404
        return send_file(file_path, mimetype='image/png')
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/download/<folder>/<path:filename>', methods=['GET'])
def download_original(folder, filename):
    """Descarga el archivo original (sin conversión). Útil para obtener el TIFF completo."""
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        if folder not in ['images', 'output', 'temp', 'files', 'input']:
            return jsonify({"status": "error", "message": "Carpeta no válida"}), 400

        # Mapear "input" a "images" para la ruta del archivo real
        physical_folder = "images" if folder == "input" else folder

        # Construir path seguro
        file_path = os.path.join(backend_dir, 'files', physical_folder, filename)
        if not os.path.exists(file_path) or not os.path.isfile(file_path):
            return jsonify({"status": "error", "message": "Archivo no encontrado"}), 404

        # Forzar descarga como attachment
        mimetype = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
        return send_file(file_path, mimetype=mimetype, as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    


@app.route('/info-archivo/<filename>', methods=['GET'])
def info_archivo(filename):
    """
    Obtiene información básica de un archivo en la carpeta output
    """
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.join(backend_dir, "files", "output")
        file_path = os.path.join(output_dir, filename)
        
        if not os.path.exists(file_path):
            return jsonify({"status": "error", "message": "Archivo no encontrado"}), 404
        
        # Obtener información básica del archivo
        stat = os.stat(file_path)
        
        file_info = {
            "filename": filename,
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "extension": os.path.splitext(filename)[1].lower(),
            "type": "image" if filename.lower().endswith(('.tif', '.tiff', '.jpg', '.jpeg', '.png')) else "data"
        }
        
        # Para archivos .dim, intentar leer algunos metadatos básicos
        if filename.lower().endswith('.dim'):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read(1000)  # Leer solo los primeros 1000 caracteres
                    if 'DIMAP' in content:
                        file_info["format"] = "DIMAP Product"
                        # Extraer información básica si está disponible
                        if 'SCENE_WIDTH' in content:
                            import re
                            width_match = re.search(r'<NCOLS>(\d+)</NCOLS>', content)
                            height_match = re.search(r'<NROWS>(\d+)</NROWS>', content)
                            if width_match and height_match:
                                file_info["dimensions"] = f"{width_match.group(1)} x {height_match.group(1)}"
            except:
                pass
        
        return jsonify({
            "status": "ok",
            "file_info": file_info
        })
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/geo-info/<filename>', methods=['GET'])
def geo_info(filename):
    """
    Obtiene información geoespacial de un archivo (coordenadas, proyección, etc.)
    """
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.join(backend_dir, "files", "output")
        file_path = os.path.join(output_dir, filename)
        
        if not os.path.exists(file_path):
            return jsonify({"status": "error", "message": "Archivo no encontrado"}), 404
        
        geo_info = {
            "filename": filename,
            "has_georeference": False,
            "bounds": None,
            "crs": None,
            "transform": None
        }
        
        # Para archivos .dim, leer metadatos DIMAP
        if filename.lower().endswith('.dim'):
            try:
                import xml.etree.ElementTree as ET
                tree = ET.parse(file_path)
                root = tree.getroot()
                
                # Buscar información de georreferenciación en DIMAP
                ul_x = ul_y = lr_x = lr_y = None
                for elem in root.iter():
                    if 'ULXMAP' in elem.tag or 'UL_X' in elem.tag:
                        ul_x = float(elem.text) if elem.text else None
                    elif 'ULYMAP' in elem.tag or 'UL_Y' in elem.tag:
                        ul_y = float(elem.text) if elem.text else None
                    elif 'LRXMAP' in elem.tag or 'LR_X' in elem.tag:
                        lr_x = float(elem.text) if elem.text else None
                    elif 'LRYMAP' in elem.tag or 'LR_Y' in elem.tag:
                        lr_y = float(elem.text) if elem.text else None
                    elif 'HORIZONTAL_CS_CODE' in elem.tag:
                        geo_info["crs"] = elem.text
                
                # Si encontramos coordenadas, calcular bounds
                if all(v is not None for v in [ul_x, ul_y, lr_x, lr_y]):
                    geo_info["has_georeference"] = True
                    geo_info["bounds"] = {
                        "west": min(ul_x, lr_x),
                        "east": max(ul_x, lr_x),
                        "north": max(ul_y, lr_y),
                        "south": min(ul_y, lr_y)
                    }
                    
            except Exception as e:
                print(f"Error parsing DIMAP: {e}")
        
        # Para archivos .tif, intentar leer con rasterio
        elif filename.lower().endswith(('.tif', '.tiff')):
            try:
                import rasterio
                
                with rasterio.open(file_path) as ds:
                    if ds.crs and ds.bounds:
                        geo_info["has_georeference"] = True
                        geo_info["bounds"] = {
                            "west": ds.bounds.left,
                            "east": ds.bounds.right,
                            "north": ds.bounds.top,
                            "south": ds.bounds.bottom
                        }
                        geo_info["crs"] = str(ds.crs)
                        
            except ImportError:
                print("rasterio no está disponible para leer georreferenciación de TIFF")
            except Exception as e:
                print(f"Error leyendo TIFF con rasterio: {e}")
        
        # Si no hay georreferenciación, usar coordenadas por defecto para visualización
        if not geo_info["has_georeference"]:
            geo_info["bounds"] = {
                "west": -1.0,
                "east": 1.0,
                "north": 1.0,
                "south": -1.0
            }
        
        return jsonify({
            "status": "ok",
            "geo_info": geo_info,
            **geo_info  # Desempaquetar para acceso directo
        })
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/geo-info-path', methods=['GET'])
def geo_info_path():
    """
    Obtiene bounds en EPSG:4326 para un GeoTIFF de preview.
    Estrategia (en orden):
      1) CRS + transform afín del raster
      2) GCPs embebidos en el GeoTIFF (típico en productos SNAP)
      3) Metadatos del .dim hermano (ULXMAP/ULYMAP/...) si existe
    """
    path = request.args.get('path')
    if not path:
        return jsonify({"status": "error", "message": "path es requerido"}), 400

    path = os.path.abspath(path)
    if not os.path.exists(path) or not os.path.isfile(path):
        return jsonify({"status": "error", "message": "Archivo no encontrado"}), 404

    if not path.lower().endswith(('.tif', '.tiff')):
        return jsonify({
            "status": "error",
            "message": "Solo se soportan GeoTIFF (.tif/.tiff) por ahora",
        }), 400

    try:
        import rasterio
        from rasterio.warp import transform_bounds
        from rasterio.transform import from_gcps
    except ImportError:
        return jsonify({
            "status": "error",
            "message": "rasterio no está instalado en el backend",
        }), 500

    def _ok(west, south, east, north, source, crs_original=None, width=None, height=None):
        return jsonify({
            "status": "ok",
            "filename": os.path.basename(path),
            "has_georeference": True,
            "bounds": {
                "west": float(west),
                "east": float(east),
                "north": float(north),
                "south": float(south),
            },
            "source": source,
            "crs_original": crs_original,
            "width": width,
            "height": height,
        })

    def _bounds_from_dim(dim_path):
        """Lee ULXMAP/ULYMAP/LRXMAP/LRYMAP (o variantes) del .dim BEAM-DIMAP."""
        try:
            text = Path(dim_path).read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return None

        def _find(names):
            for name in names:
                m = re.search(
                    rf"<(?:[^:>]+:)?{name}>\s*([-+eE0-9.]+)\s*</(?:[^:>]+:)?{name}>",
                    text,
                    re.IGNORECASE,
                )
                if m:
                    try:
                        return float(m.group(1))
                    except ValueError:
                        pass
            return None

        ulx = _find(["ULXMAP", "UL_X", "WEST_BOUNDING_COORDINATE"])
        uly = _find(["ULYMAP", "UL_Y", "NORTH_BOUNDING_COORDINATE"])
        lrx = _find(["LRXMAP", "LR_X", "EAST_BOUNDING_COORDINATE"])
        lry = _find(["LRYMAP", "LR_Y", "SOUTH_BOUNDING_COORDINATE"])

        if None in (ulx, uly, lrx, lry):
            # Fallback: first/last lat/lon tie-point si existen
            lats = [float(x) for x in re.findall(
                r"<(?:[^:>]+:)?LATITUDE>\s*([-+eE0-9.]+)\s*</", text)]
            lons = [float(x) for x in re.findall(
                r"<(?:[^:>]+:)?LONGITUDE>\s*([-+eE0-9.]+)\s*</", text)]
            if len(lats) >= 2 and len(lons) >= 2:
                return min(lons), min(lats), max(lons), max(lats)
            return None

        west, east = min(ulx, lrx), max(ulx, lrx)
        south, north = min(uly, lry), max(uly, lry)
        # Si parecen grados WGS84
        if -180 <= west <= 180 and -90 <= south <= 90:
            return west, south, east, north
        return None

    try:
        with rasterio.open(path) as ds:
            width, height = ds.width, ds.height

            # 1) CRS afín real
            if ds.crs and ds.transform and not ds.transform.is_identity:
                try:
                    west, south, east, north = transform_bounds(
                        ds.crs, "EPSG:4326",
                        ds.bounds.left, ds.bounds.bottom,
                        ds.bounds.right, ds.bounds.top,
                    )
                    if all(abs(v) < 1e10 for v in (west, south, east, north)):
                        return _ok(west, south, east, north, "affine_crs",
                                   str(ds.crs), width, height)
                except Exception as e:
                    print(f"[WARN] geo_info_path affine falló: {e}")

            # 2) GCPs (muy frecuente en exports de SNAP)
            try:
                gcps, gcp_crs = ds.gcps
                if gcps and len(gcps) >= 3:
                    xs = [g.x for g in gcps]
                    ys = [g.y for g in gcps]
                    if gcp_crs:
                        west, south, east, north = transform_bounds(
                            gcp_crs, "EPSG:4326",
                            min(xs), min(ys), max(xs), max(ys),
                        )
                    else:
                        # Asumir ya lat/lon
                        west, south, east, north = min(xs), min(ys), max(xs), max(ys)
                    if all(abs(v) < 1e10 for v in (west, south, east, north)):
                        return _ok(west, south, east, north, "gcps",
                                   str(gcp_crs) if gcp_crs else None,
                                   width, height)
            except Exception as e:
                print(f"[WARN] geo_info_path GCPs falló: {e}")

        # 3) .dim hermano: mismo basename en la carpeta padre o en previews/
        candidates = []
        base = os.path.splitext(os.path.basename(path))[0]
        # quitar sufijos típicos de preview
        for suffix in ("_preview", "_Intensity", "_Phase", "_UnwPhase",
                       "_Displacement", "_Masked"):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
                break
        parent = os.path.dirname(path)
        grandparents = [parent, os.path.dirname(parent),
                        os.path.join(os.path.dirname(parent), "..")]
        for folder in grandparents:
            folder = os.path.abspath(folder)
            for name in (f"{base}.dim",
                         os.path.basename(path).replace(".tif", ".dim")):
                cand = os.path.join(folder, name)
                if os.path.exists(cand):
                    candidates.append(cand)
            # cualquier .dim en la carpeta del producto
            for dim in glob.glob(os.path.join(folder, "*.dim")):
                candidates.append(dim)

        seen = set()
        for dim_path in candidates:
            if dim_path in seen:
                continue
            seen.add(dim_path)
            b = _bounds_from_dim(dim_path)
            if b:
                west, south, east, north = b
                return _ok(west, south, east, north, f"dim:{os.path.basename(dim_path)}",
                           "EPSG:4326", None, None)

        return jsonify({
            "status": "ok",
            "filename": os.path.basename(path),
            "has_georeference": False,
            "message": (
                "Sin CRS/GCPs en el GeoTIFF ni bounds en .dim asociado. "
                "Típico en geometría radar (pasos previos a Terrain Correction)."
            ),
        })

    except rasterio.errors.RasterioIOError as e:
        return jsonify({
            "status": "error",
            "message": f"No se pudo abrir el raster: {e}",
        }), 422
    except Exception as e:
        print(f"[ERROR] geo_info_path: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/pixel-value', methods=['GET'])
def pixel_value():
    """
    Devuelve el valor REAL del píxel en lat/lng.
    Soporta:
      1) CRS + transform afín
      2) GCPs (productos SNAP georreferenciados solo con puntos de control)
    """
    path = request.args.get('path')
    lat = request.args.get('lat')
    lng = request.args.get('lng')

    if not path or lat is None or lng is None:
        return jsonify({"status": "error", "message": "path, lat y lng son requeridos"}), 400

    try:
        lat = float(lat)
        lng = float(lng)
    except ValueError:
        return jsonify({"status": "error", "message": "lat/lng inválidos"}), 400

    path = os.path.abspath(path)
    if not os.path.exists(path) or not os.path.isfile(path):
        return jsonify({"status": "error", "message": "Archivo no encontrado"}), 404

    if not path.lower().endswith(('.tif', '.tiff')):
        return jsonify({"status": "error", "message": "Solo se soportan GeoTIFF (.tif/.tiff) por ahora"}), 400

    try:
        import rasterio
        from rasterio.warp import transform as warp_transform
        from rasterio.transform import from_gcps, rowcol
    except ImportError:
        return jsonify({"status": "error", "message": "rasterio no está instalado en el backend"}), 500

    def _read_pixel(ds, row, col, method="affine"):
        if row < 0 or col < 0 or row >= ds.height or col >= ds.width:
            return jsonify({
                "status": "ok",
                "in_bounds": False,
                "message": "Coordenada fuera del área del producto.",
                "method": method,
            })
        banda = ds.read(1, window=((row, row + 1), (col, col + 1)), masked=True)
        valor = banda[0, 0]
        es_nodata = bool(np.ma.is_masked(valor))
        return jsonify({
            "status": "ok",
            "in_bounds": True,
            "row": int(row),
            "col": int(col),
            "value": None if es_nodata else float(valor),
            "is_nodata": es_nodata,
            "band_count": ds.count,
            "method": method,
        })

    try:
        with rasterio.open(path) as ds:
            # 1) Transform afín real
            if ds.crs and ds.transform and not ds.transform.is_identity:
                try:
                    xs, ys = warp_transform("EPSG:4326", ds.crs, [lng], [lat])
                    row, col = ds.index(xs[0], ys[0])
                    return _read_pixel(ds, row, col, method="affine")
                except Exception as e:
                    print(f"[WARN] pixel_value affine falló: {e}")

            # 2) GCPs → transform aproximado (típico SNAP post-TC / subset)
            try:
                gcps, gcp_crs = ds.gcps
                if gcps and len(gcps) >= 3:
                    transform = from_gcps(gcps)
                    if gcp_crs:
                        xs, ys = warp_transform("EPSG:4326", gcp_crs, [lng], [lat])
                        x, y = xs[0], ys[0]
                    else:
                        # GCPs ya en lon/lat
                        x, y = lng, lat
                    rows, cols = rowcol(transform, [x], [y])
                    row, col = int(rows[0]), int(cols[0])
                    return _read_pixel(ds, row, col, method="gcps")
            except Exception as e:
                print(f"[WARN] pixel_value GCPs falló: {e}")

            return jsonify({
                "status": "error",
                "message": (
                    "Este producto no tiene transformación afín ni GCPs utilizables; "
                    "no se puede mapear lat/lng a un píxel de forma fiable."
                ),
            }), 422

    except rasterio.errors.RasterioIOError as e:
        return jsonify({"status": "error", "message": f"No se pudo abrir el raster: {e}"}), 422
    except Exception as e:
        print(f"[ERROR] pixel_value: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": f"Error leyendo valor de píxel: {e}"}), 500

@app.route('/convert-image/<folder>/<path:filename>', methods=['GET'])
def convert_image(folder, filename):
    """
    Convierte archivos de imagen a formato PNG para visualización en navegador
    Especialmente útil para archivos .tif que no son soportados nativamente
    """
    try:
        # Validar folder
        valid_folders = ['output', 'images', 'input']
        if folder not in valid_folders:
            return jsonify({"error": "Folder no válido"}), 400
        
        # Mapear "input" a "images" para la ruta del archivo real
        physical_folder = "images" if folder == "input" else folder
        
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(backend_dir, "files", physical_folder, filename)
        
        if not os.path.exists(file_path):
            return jsonify({"error": "Archivo no encontrado"}), 404

        # Si es un TIFF y ya existe un quicklook PNG pre-generado con
        # pconvert (creado en el momento de exportar el .tif, con el
        # mismo motor de render que SNAP Desktop), lo servimos directo
        # desde disco -- es más rápido y más confiable que reconstruir
        # la banda desde el .tif crudo aquí adivinando parámetros.
        if file_path.lower().endswith(('.tif', '.tiff')):
            precomputed_png = os.path.splitext(file_path)[0] + ".png"
            if os.path.exists(precomputed_png):
                print(f"[DEBUG] Sirviendo quicklook pre-generado: {precomputed_png}")
                return send_file(precomputed_png, mimetype='image/png', as_attachment=False,
                                 download_name=f"{os.path.splitext(filename)[0]}.png")

        try:
            buf = _convert_file_to_png(file_path)
            buf.seek(0)
            return send_file(buf, mimetype='image/png', as_attachment=False,
                             download_name=f"{os.path.splitext(filename)[0]}.png")
        except ConversionError as ce:
            return jsonify(ce.to_dict()), 422
        except Exception as e:
            return jsonify({"error": str(e)}), 500
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500


class ConversionError(Exception):
    def __init__(self, message, file_size_mb=None, is_geospatial=False, suggestion=None):
        super().__init__(message)
        self.message = message
        self.file_size_mb = file_size_mb
        self.is_geospatial = is_geospatial
        self.suggestion = suggestion

    def to_dict(self):
        d = {"error": self.message}
        if self.file_size_mb is not None:
            d["file_size_mb"] = self.file_size_mb
        if self.is_geospatial:
            d["is_geospatial"] = True
        if self.suggestion:
            d["suggestion"] = self.suggestion
        return d


def _convert_file_to_png(file_path, max_size=2048):
    """
    Intenta convertir un archivo (TIFF u otros) a PNG en memoria.
    Devuelve un io.BytesIO con PNG o lanza ConversionError.
    """
    print(f"[DEBUG] Intentando convertir: {file_path}")
    
    # Intento 1: PIL
    try:
        print(f"[DEBUG] Probando PIL para {os.path.basename(file_path)}")
        with Image.open(file_path) as img:
            print(f"[DEBUG] PIL abrió imagen: modo={img.mode}, tamaño={img.size}")
            
            # Convertir modos problemáticos a RGB
            if img.mode in ['RGBA', 'P', 'L', 'LA']:
                print(f"[DEBUG] Convirtiendo de {img.mode} a RGB")
                img = img.convert('RGB')
            elif img.mode in ['F', 'I', 'I;16', 'I;16B']:
                # Modos numéricos (float32/int32, típicos de bandas SAR/satelitales).
                # img.convert('RGB') NO normaliza: trunca/clampa los valores a 0-255,
                # lo que produce imágenes en blanco o negras si los datos no están
                # ya en rango 0-255. Hay que normalizar manualmente antes.
                #
                # OJO: usar min()/max() absolutos es peligroso en SAR porque suele
                # haber píxeles basura/nodata con valores extremos (overflow, bordes
                # sin datos) que dominan el rango y aplastan toda la señal real.
                # Por eso usamos un stretch por percentiles (2%-98%), como hace SNAP.
                print(f"[DEBUG] Modo {img.mode} detectado, normalizando valores antes de convertir a RGB")
                import numpy as np
                arr = np.array(img, dtype='float64')
                arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)

                # Descartar outliers extremos antes de calcular percentiles
                finite_mask = np.isfinite(arr)
                p2, p98 = np.percentile(arr[finite_mask], [2, 98])
                print(f"[DEBUG] Rango completo: min={arr.min()}, max={arr.max()} | Percentiles 2-98%: {p2}, {p98}")

                if p98 - p2 < 1e-8:
                    arr8 = np.zeros_like(arr, dtype='uint8')
                else:
                    clipped = np.clip(arr, p2, p98)
                    arr8 = ((clipped - p2) / (p98 - p2) * 255).astype('uint8')

                img = Image.fromarray(arr8).convert('RGB')
            elif img.mode not in ['RGB', 'RGBA']:
                print(f"[DEBUG] Convirtiendo modo {img.mode} a RGB")
                img = img.convert('RGB')

            # Redimensionar si es muy grande
            if img.width > max_size or img.height > max_size:
                print(f"[DEBUG] Redimensionando de {img.size} a {max_size}x{max_size} max")
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            buf = io.BytesIO()
            img.save(buf, format='PNG', optimize=True)
            buf.seek(0)
            print(f"[DEBUG] PIL conversión exitosa, tamaño buffer: {len(buf.getvalue())} bytes")
            return buf
    except Exception as pil_error:
        print(f"[ERROR] PIL falló para {os.path.basename(file_path)}: {pil_error}")

    # Intento 2: rasterio
    try:
        print(f"[DEBUG] Probando rasterio para {os.path.basename(file_path)}")
        import numpy as np
        import rasterio
        from rasterio.enums import Resampling

        with rasterio.Env():
            with rasterio.open(file_path) as ds:
                print(f"[DEBUG] Rasterio abrió: {ds.count} bandas, {ds.width}x{ds.height}, dtype={ds.dtypes[0]}")
                
                if ds.count >= 3:
                    bands = [1, 2, 3]
                    print(f"[DEBUG] Usando bandas RGB: {bands}")
                elif ds.count == 1:
                    bands = [1, 1, 1]  # Repetir banda única para RGB
                    print(f"[DEBUG] Imagen de 1 banda, repitiendo para RGB")
                else:
                    bands = [1] + ([2] if ds.count >= 2 else [1]) + [1]  # Fallback
                    print(f"[DEBUG] Usando bandas fallback: {bands}")

                scale = 1.0
                if max(ds.width, ds.height) > max_size:
                    scale = max_size / float(max(ds.width, ds.height))
                    print(f"[DEBUG] Aplicando escala: {scale}")

                arrs = []
                for i, b in enumerate(bands):
                    if scale < 1.0:
                        out_height = int(ds.height * scale)
                        out_width = int(ds.width * scale)
                        data = ds.read(b, out_shape=(out_height, out_width), resampling=Resampling.bilinear)
                    else:
                        data = ds.read(b)
                    
                    # Manejar valores nodata
                    if hasattr(ds, 'nodata') and ds.nodata is not None:
                        data = np.where(data == ds.nodata, 0, data)
                    
                    arrs.append(data.astype('float32'))
                    print(f"[DEBUG] Banda {b}: shape={data.shape}, min={data.min()}, max={data.max()}")

                img = np.dstack(arrs)

                def scale_to_255(a):
                    # Manejar valores infinitos o NaN
                    a = np.nan_to_num(a, nan=0.0, posinf=0.0, neginf=0.0)
                    amin = a.min()
                    amax = a.max()
                    if amax - amin < 1e-8:
                        return np.zeros_like(a, dtype=np.uint8)
                    out = (a - amin) / (amax - amin)
                    return (out * 255).astype(np.uint8)

                print(f"[DEBUG] Normalizando imagen: shape={img.shape}")
                img8 = np.dstack([scale_to_255(img[:, :, i]) for i in range(img.shape[2])])
                pil_img = Image.fromarray(img8)
                
                if pil_img.width > max_size or pil_img.height > max_size:
                    pil_img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

                buf = io.BytesIO()
                pil_img.save(buf, format='PNG', optimize=True)
                buf.seek(0)
                print(f"[DEBUG] Rasterio conversión exitosa, tamaño buffer: {len(buf.getvalue())} bytes")
                return buf

    except ImportError:
        print("[WARNING] rasterio no está disponible; instalar con: conda install -c conda-forge rasterio")
    except Exception as raster_err:
        print(f"[ERROR] Rasterio falló para {os.path.basename(file_path)}: {raster_err}")
        import traceback
        traceback.print_exc()

    # Ambos métodos fallaron -> proporcionar información útil
    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
    print(f"[ERROR] Todos los métodos de conversión fallaron para {os.path.basename(file_path)} ({file_size_mb:.1f}MB)")
    
    if file_size_mb > 800:
        raise ConversionError(
            f"Archivo TIFF geoespacial muy complejo ({file_size_mb:.1f}MB). Requiere herramientas especializadas.",
            file_size_mb=file_size_mb,
            is_geospatial=True,
            suggestion="Instala rasterio con: conda install -c conda-forge rasterio numpy"
        )
    elif file_size_mb > 100:
        raise ConversionError(
            f"Archivo TIFF grande ({file_size_mb:.1f}MB). Instala rasterio para mejor soporte.",
            file_size_mb=file_size_mb,
            suggestion="Instala rasterio con: conda install -c conda-forge rasterio numpy"
        )
    else:
        raise ConversionError(
            f"No se pudo procesar el archivo TIFF. Tamaño: {file_size_mb:.1f}MB",
            file_size_mb=file_size_mb,
            suggestion="Verifica que sea un archivo TIFF válido. Si persiste, instala rasterio."
        )

@app.route('/productos-visualizables', methods=['GET'])
def productos_visualizables():
    """
    Lista GeoTIFF de preview ya generados bajo una carpeta de salida,
    para poder cargarlos en el mapa/comparador sin reprocesar.

    Query:
      base_dir  (opcional)  ruta absoluta de salida del usuario
                            Si no se envía, usa backend/files/output

    Cada ítem tiene el mismo shape que las visualizaciones del flujo, más
    los campos "par"/"fecha1"/"fecha2" cuando el .tif vive dentro de una
    carpeta de par "AAAAMMDD_AAAAMMDD" generada por /procesar_flujo_batch_auto:
      { status, step, band_name, output_tiff, quicklook_png, message,
        mtime, par, fecha1, fecha2 }
    """
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        default_out = os.path.join(backend_dir, "files", "output")
        base_dir = request.args.get("base_dir") or default_out
        base_dir = os.path.abspath(base_dir)

        if not os.path.isdir(base_dir):
            return jsonify({
                "status": "error",
                "message": f"Carpeta no encontrada: {base_dir}",
            }), 404

        # Carpetas / nombres típicos de previews del pipeline
        tiff_candidates = []
        for root, dirs, files in os.walk(base_dir):
            # no entrar a *.data de SNAP
            dirs[:] = [d for d in dirs if not d.lower().endswith(".data")]
            rel_root = os.path.relpath(root, base_dir)
            for f in files:
                low = f.lower()
                if not low.endswith((".tif", ".tiff")):
                    continue
                # filtrar tiffs "de trabajo" poco útiles si hace falta;
                # incluimos previews y exports del flujo
                full = os.path.join(root, f)
                tiff_candidates.append(full)

        # Patrón de carpeta de par generada por /procesar_flujo_batch_auto,
        # ej. "20260509_20260521/Grafo 1 - Orbit/paso1_master_preview.tif"
        _PAR_RE = re.compile(r'^(\d{8})_(\d{8})')

        productos = []
        seen = set()
        for tiff_path in tiff_candidates:
            if tiff_path in seen:
                continue
            seen.add(tiff_path)

            base_name = os.path.splitext(os.path.basename(tiff_path))[0]
            parent = os.path.dirname(tiff_path)

            # PNG quicklook hermano (mismo basename)
            png_path = os.path.join(parent, base_name + ".png")
            if not os.path.exists(png_path):
                # a veces pconvert usa el nombre del .dim original
                alt = glob.glob(os.path.join(parent, "*.png"))
                png_path = alt[0] if len(alt) == 1 else None
            if png_path and not os.path.exists(png_path):
                png_path = None

            # Etiqueta legible: carpeta relativa + nombre
            try:
                rel = os.path.relpath(tiff_path, base_dir)
            except ValueError:
                rel = tiff_path
            step_label = rel.replace("\\", "/")

            # Si el .tif vive dentro de una carpeta de par "AAAAMMDD_AAAAMMDD"
            # (generada por /procesar_flujo_batch_auto), extraemos esa info
            # para poder agrupar/ordenar/filtrar por par en el frontend.
            par_match = _PAR_RE.match(step_label)
            if par_match:
                par = f"{par_match.group(1)}_{par_match.group(2)}"
                fecha1 = f"{par_match.group(1)[:4]}-{par_match.group(1)[4:6]}-{par_match.group(1)[6:]}"
                fecha2 = f"{par_match.group(2)[:4]}-{par_match.group(2)[4:6]}-{par_match.group(2)[6:]}"
            else:
                par, fecha1, fecha2 = None, None, None

            # band_name heurístico desde el nombre del archivo
            band_name = base_name
            for prefix in ("paso1_master_", "paso1_slave_", "paso2a_", "paso2b_",
                           "paso3_", "paso4_", "paso5_", "paso6_", "paso7_",
                           "preview_", "_preview"):
                if band_name.lower().startswith(prefix.lower()):
                    band_name = band_name[len(prefix):]
                    break
            if band_name.endswith("_preview"):
                band_name = band_name[: -len("_preview")]

            productos.append({
                "status": "ok",
                "step": step_label,
                "band_name": band_name,
                "output_tiff": tiff_path,
                "quicklook_png": png_path,
                "message": "Cargado desde disco",
                "mtime": os.path.getmtime(tiff_path),
                "par": par,
                "fecha1": fecha1,
                "fecha2": fecha2,
            })

        # Orden: primero por par (fecha1 ascendente; los que no tienen par
        # identificado quedan al final) y dentro de cada par por el nombre
        # del paso, para que la lista quede agrupable y predecible en vez
        # de mezclada por fecha de modificación (mtime) global.
        productos.sort(key=lambda p: (p["fecha1"] or "9999-99-99", p["step"]))

        return jsonify({
            "status": "ok",
            "base_dir": base_dir,
            "count": len(productos),
            "productos": productos,
        })
    except Exception as e:
        print(f"[ERROR] productos_visualizables: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/convert-image/upload', methods=['POST'])
def convert_image_upload():
    """Recibe un TIFF subido por multipart/form-data (campo 'file'), intenta convertir y devuelve URL al PNG temporal."""
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Campo 'file' no encontrado"}), 400

        f = request.files['file']
        if f.filename == '':
            return jsonify({"status": "error", "message": "No se proporcionó archivo"}), 400

        backend_dir = os.path.dirname(os.path.abspath(__file__))
        temp_dir = os.path.join(backend_dir, 'files', 'temp')
        converted_dir = os.path.join(temp_dir, 'converted')
        os.makedirs(converted_dir, exist_ok=True)

        # Guardar archivo temporal
        uid = uuid.uuid4().hex
        orig_name = os.path.basename(f.filename)
        temp_path = os.path.join(temp_dir, f"{uid}_{orig_name}")
        f.save(temp_path)

        # Intentar conversión
        try:
            buf = _convert_file_to_png(temp_path)
            out_name = f"{os.path.splitext(orig_name)[0]}_{uid}.png"
            out_path = os.path.join(converted_dir, out_name)
            with open(out_path, 'wb') as out_f:
                out_f.write(buf.getbuffer())

            image_url = f"/files/temp/converted/{out_name}"
            return jsonify({"status": "ok", "image_url": image_url})
        except ConversionError as ce:
            return jsonify(ce.to_dict()), 422
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/files/upload', methods=['POST'])
def files_upload():
    """Sube archivos genéricos a backend/files/images y devuelve URL."""
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Campo 'file' no encontrado"}), 400

        f = request.files['file']
        if f.filename == '':
            return jsonify({"status": "error", "message": "No se proporcionó archivo"}), 400

        backend_dir = os.path.dirname(os.path.abspath(__file__))
        images_dir = os.path.join(backend_dir, 'files', 'images')
        os.makedirs(images_dir, exist_ok=True)

        safe_name = f"{uuid.uuid4().hex}_{os.path.basename(f.filename)}"
        out_path = os.path.join(images_dir, safe_name)
        f.save(out_path)

        image_url = f"/files/images/{safe_name}"
        return jsonify({"status": "ok", "image_url": image_url})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

    
@app.route('/procesar_paso', methods=['POST'])
def procesar_paso():
    """
    Ejecuta los nuevos pasos Python con rutas dinámicas y secuenciales.
    Versión con streaming de stdout/stderr en paralelo (evita deadlock).
    """
    try:
        data = request.json
        step = data.get('step')
        base_output_dir = data.get('output_dir')
        input_from_user = data.get('input')
        user_params = data.get('params', {})
        params = {**DEFAULT_PARAMS, **user_params}

        if not step or not base_output_dir:
            return jsonify({"status": "error", "message": "step y output_dir son requeridos"}), 400

        base_path = Path(base_output_dir)
        base_path.mkdir(parents=True, exist_ok=True)

        backend_dir = os.path.dirname(os.path.abspath(__file__))

        env = os.environ.copy()
        env["BASE_DIR"] = str(base_path)
        env["GPT_BIN"] = "/home/nahin/esa-snap/bin/gpt"
        env["SNAPHU_BIN"] = "/home/nahin/.snap/auxdata/snaphu-v2.0.4_linux/bin/snaphu"

        # Parámetros configurables del usuario (se inyectan como variables de entorno)
        env["SNAPHU_TILE_ROWS"] = str(params["snaphu_tile_rows"])
        env["SNAPHU_TILE_COLS"] = str(params["snaphu_tile_cols"])
        env["SNAPHU_PROCESSORS"] = str(params["snaphu_processors"])
        env["SNAPHU_ROW_OVERLAP"] = str(params["snaphu_row_overlap"])
        env["SNAPHU_COL_OVERLAP"] = str(params["snaphu_col_overlap"])
        env["SNAPHU_COST_THRESHOLD"] = str(params["snaphu_cost_threshold"])
        env["COHERENCE_THRESHOLD"] = str(params["coherence_threshold"])
        env["DISPLACEMENT_MAX_M"] = str(params["displacement_max_m"])
        env["BAND_MATHS_EXPRESSION"] = str(params.get("band_maths_expression", ""))

        script_path = None

        if step == "SNAPHU_FULL":
            script_path = os.path.join(backend_dir, "..", "Scripts_Automatizacion_Snaphu", "Prueba_Subcarpetas_FUNCIONAL.py")
            script_path = os.path.abspath(script_path)
            
            if input_from_user:
                subset_dim = input_from_user
                if not os.path.isabs(subset_dim):
                    possible_paths = [
                        os.path.join(base_path, subset_dim),
                        os.path.join(backend_dir, "files", subset_dim),
                        os.path.join(backend_dir, "files", "output", subset_dim),
                        os.path.join(base_path, "files", "output", subset_dim),
                    ]
                    found = False
                    for p in possible_paths:
                        if os.path.exists(p):
                            subset_dim = os.path.abspath(p)
                            found = True
                            print(f"[DEBUG] Archivo encontrado en: {subset_dim}")
                            break
                    if not found:
                        # Fallback: igual que en /procesar, cada gráfico guarda su
                        # salida en su propia subcarpeta (ej. "Grafo 4 - Final
                        # Output/archivo.dim"), y las possible_paths de arriba no
                        # bajan a esas subcarpetas. Se busca recursivamente por
                        # nombre de archivo dentro de files/output/ antes de
                        # rendirse al fallback ciego de siempre.
                        basename = os.path.basename(subset_dim)
                        candidatos = glob.glob(
                            os.path.join(backend_dir, "files", "output", "**", basename),
                            recursive=True,
                        )
                        if candidatos:
                            subset_dim = max(candidatos, key=os.path.getmtime)
                            found = True
                            print(f"[DEBUG] '{input_from_user}' encontrado por búsqueda recursiva en: {subset_dim}")
                    if not found:
                        subset_dim = os.path.abspath(possible_paths[0])
                        print(f"[DEBUG] Archivo no encontrado, usando fallback: {subset_dim}")
            else:
                subset_dim = str(base_path / "Grafo 4 - Final Output" / "output_final_Orb_Orb.dim")
            
            env["SUBSET_DIM"] = subset_dim
            print(f"[DEBUG] SUBSET_DIM final (absoluta) = {subset_dim}")
            
            export_dir = base_path / "SnaphuExport"
            unwrap_dir = base_path / "SnaphuUnwrapping"
            import_dir = base_path / "SnaphuImport"
            
            for folder in [export_dir, unwrap_dir, import_dir]:
                folder.mkdir(parents=True, exist_ok=True)
            
            env["EXPORT_DIR"] = str(export_dir)
            env["UNWRAP_DIR"] = str(unwrap_dir)
            env["IMPORT_DIR"] = str(import_dir)
            env["BASE_FOLDER"] = str(base_path)
            env["NON_INTERACTIVE"] = "1"

        elif step == "PHASE_TO_DISPLACEMENT":
            script_path = os.path.join(backend_dir, "..", "Scripts_Automatizacion_Snaphu", "phase_to_displacement.py")
            script_path = os.path.abspath(script_path)
            
            # Buscar el archivo .dim generado por SnaphuImport (nombre dinámico)
            snaphu_import_dir = base_path / "SnaphuImport"
            dim_files = list(snaphu_import_dir.glob("*.dim"))
            if dim_files:
                env["INPUT_DIM"] = str(dim_files[0])
                print(f"[DEBUG] INPUT_DIM detectado automáticamente: {dim_files[0]}")
            else:
                env["INPUT_DIM"] = str(base_path / "SnaphuImport" / "output_final_Orb_Orb_UNW.dim")
                print(f"[WARN] No se encontró .dim en SnaphuImport, usando fallback")

        elif step == "TERRAIN_CORRECTION":
            script_path = os.path.join(backend_dir, "..", "Scripts_Automatizacion_Snaphu", "TerrainCorrection.py")
            script_path = os.path.abspath(script_path)
            
            # SUBSET_DIM: buscar automáticamente en Grafo 4
            grafo4_dir = base_path / "Grafo 4 - Final Output"
            grafo4_files = list(grafo4_dir.glob("*.dim"))
            if grafo4_files:
                env["SUBSET_DIM"] = str(grafo4_files[0])
            else:
                env["SUBSET_DIM"] = str(base_path / "Grafo 4 - Final Output" / "output_final_Orb_Orb.dim")
            
            # DISPLACEMENT_DIM: buscar automáticamente en PhaseToDisplacement
            disp_dir = base_path / "PhaseToDisplacement"
            disp_files = list(disp_dir.glob("*.dim"))
            if disp_files:
                env["DISPLACEMENT_DIM"] = str(disp_files[0])
            else:
                env["DISPLACEMENT_DIM"] = str(base_path / "PhaseToDisplacement" / "output_final_Orb_Orb_DISP.dim")

        else:
            return jsonify({"status": "error", "message": f"Paso desconocido: {step}"}), 400

        if not Path(script_path).exists():
            return jsonify({"status": "error", "message": f"Script no encontrado: {script_path}"}), 404

        print(f"[INFO] Ejecutando paso: {step}")
        print(f"[INFO] Script: {script_path}")
        print(f"[DEBUG] Enviando NON_INTERACTIVE = {env.get('NON_INTERACTIVE')}")
        print(f"[DEBUG] Enviando SUBSET_DIM = {env.get('SUBSET_DIM')}")

        # =================================================================
        # EJECUCIÓN CON STREAMING EN PARALELO (evita deadlock de pipes)
        # =================================================================
        import threading
        import queue
        
        collected_stdout = []
        collected_stderr = []
        
        # Usar -u para unbuffered output del script hijo
        process = subprocess.Popen(
            ["python3", "-u", script_path],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=os.path.dirname(script_path)
        )

        def read_stdout():
            try:
                for line in process.stdout:
                    line_stripped = line.rstrip()
                    print(f"[{step}-OUT] {line_stripped}", flush=True)
                    collected_stdout.append(line_stripped)
            except Exception as e:
                print(f"[ERROR] Exception reading stdout: {e}")

        def read_stderr():
            try:
                for line in process.stderr:
                    line_stripped = line.rstrip()
                    print(f"[{step}-ERR] {line_stripped}", file=sys.stderr, flush=True)
                    collected_stderr.append(line_stripped)
            except Exception as e:
                print(f"[ERROR] Exception reading stderr: {e}")

        # Iniciar threads para leer en paralelo
        t_out = threading.Thread(target=read_stdout)
        t_err = threading.Thread(target=read_stderr)
        t_out.start()
        t_err.start()

        # Esperar a que el proceso termine
        process.wait()
        
        # Esperar a que los threads terminen de leer
        t_out.join()
        t_err.join()

        stdout_text = "\n".join(collected_stdout)
        stderr_text = "\n".join(collected_stderr)

        if process.returncode == 0:
            # Detectar el .dim de salida de este paso (misma lógica que usa
            # el flujo completo para encadenar pasos) y generar su preview.
            preview = None
            try:
                dim_a_previsualizar = None
                if step == "SNAPHU_FULL":
                    dim_files = list((base_path / "SnaphuImport").glob("*.dim"))
                    if dim_files:
                        dim_a_previsualizar = str(dim_files[0])
                elif step == "PHASE_TO_DISPLACEMENT":
                    dim_files = list((base_path / "PhaseToDisplacement").glob("*.dim"))
                    if dim_files:
                        dim_a_previsualizar = str(dim_files[0])
                elif step == "TERRAIN_CORRECTION":
                    tc_dir = base_path / "TerrainCorrection"
                    tc_files = list(tc_dir.glob("Stack_TC_Masked.dim")) or list(tc_dir.glob("*.dim"))
                    if tc_files:
                        dim_a_previsualizar = str(tc_files[0])

                if dim_a_previsualizar:
                    band_pattern = BAND_PATTERNS_BY_STEP.get(step, ".*")
                    preview = _generar_preview_individual(dim_a_previsualizar, band_pattern, step)
            except Exception as preview_err:
                print(f"[WARN] No se pudo generar preview para paso {step}: {preview_err}")

            return jsonify({
                "status": "ok",
                "message": f"Paso {step} completado exitosamente",
                "output": stdout_text[-3000:] if len(stdout_text) > 3000 else stdout_text,
                "preview": preview
            })
        else:
            return jsonify({
                "status": "error",
                "message": f"Error en {step}",
                "stderr": stderr_text[-3000:] if len(stderr_text) > 3000 else stderr_text
            }), 500

    except Exception as e:
        print(f"[ERROR] Excepción en procesar_paso: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

#Modulo para visualizacion y conversion de imagenes a formato .tif

def _parse_dim_bands(dim_text):
    """
    Parsea un .dim (BEAM-DIMAP) y devuelve la lista de bandas con su info
    relevante para decidir cómo exportarlas:
        [{"name": str, "virtual": bool, "expression": str|None}, ...]

    Las bandas virtuales (ej. Intensity_* calculada desde i_*/q_* en datos
    SLC complejos) no tienen píxeles propios en disco -- solo una fórmula
    en el .dim -- así que hay que recalcularlas con BandMaths en vez de
    simplemente seleccionarlas con BandSelect.
    """
    bands = []
    for block in re.findall(r"<Spectral_Band_Info>(.*?)</Spectral_Band_Info>", dim_text, re.DOTALL):
        name_m = re.search(r"<BAND_NAME>([^<]+)</BAND_NAME>", block)
        if not name_m:
            continue
        virtual_m = re.search(r"<VIRTUAL_BAND>\s*true\s*</VIRTUAL_BAND>", block, re.IGNORECASE)
        expr_m = re.search(r"<EXPRESSION>(.*?)</EXPRESSION>", block, re.DOTALL)
        bands.append({
            "name": name_m.group(1),
            "virtual": bool(virtual_m),
            "expression": expr_m.group(1).strip() if expr_m else None,
        })
    return bands


def _xml_escape(s):
    """Escape mínimo para insertar un valor dentro de un tag XML."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _generar_quicklook_pconvert(dim_path, band_name, output_tiff_path, pconvert_bin=None, max_res=2048):
    """
    Genera un PNG "quicklook" usando la herramienta pconvert de SNAP,
    apuntando directamente al .dim de origen y la banda por nombre.

    Esto replica el mismo motor de render/stretch que usa SNAP Desktop al
    visualizar una banda, evitando el problema de exportar el TIFF crudo
    (valores float32 sin normalizar, con posibles outliers extremos en
    píxeles sin datos válidos, que rompen una normalización min-max simple).

    Nunca lanza excepción: si falla, solo loguea un warning y devuelve
    None, para no interrumpir el flujo principal de exportación del .tif.

    Returns:
        str|None: ruta al PNG generado, o None si falló.
    """
    pconvert_bin = pconvert_bin or os.environ.get("PCONVERT_BIN", "/home/nahin/esa-snap/bin/pconvert")
    try:
        output_dir = os.path.dirname(output_tiff_path)
        os.makedirs(output_dir, exist_ok=True)

        cmd = [
            pconvert_bin,
            "-f", "png",
            "-B", band_name,
            "-r", f"{max_res},{max_res}",
            "-o", output_dir,
            dim_path,
        ]
        print(f"[DEBUG] Generando quicklook con pconvert: {cmd}")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)

        if proc.returncode != 0:
            print(f"[WARN] pconvert falló generando quicklook para '{band_name}': {proc.stderr[-800:]}")
            return None

        # pconvert nombra el PNG según el basename del .dim de entrada,
        # no según el nombre del .tif -- hay que localizarlo así.
        dim_basename = os.path.splitext(os.path.basename(dim_path))[0]
        generated_png = os.path.join(output_dir, f"{dim_basename}.png")

        if not os.path.exists(generated_png):
            print(f"[WARN] pconvert reportó éxito pero no se encontró el PNG esperado: {generated_png}")
            return None

        # Renombrar/mover para que coincida con el basename del .tif, así
        # el endpoint /convert-image lo encuentra por convención de nombre
        # sin tener que adivinar la banda.
        target_png = os.path.splitext(output_tiff_path)[0] + ".png"
        if os.path.abspath(generated_png) != os.path.abspath(target_png):
            os.replace(generated_png, target_png)

        print(f"[OK] Quicklook generado -> {target_png}")
        return target_png

    except subprocess.TimeoutExpired:
        print(f"[WARN] pconvert excedió el tiempo límite generando quicklook para '{band_name}'")
        return None
    except Exception as e:
        print(f"[WARN] Error inesperado generando quicklook con pconvert: {e}")
        return None


def exportar_banda_a_geotiff(dim_path, band_pattern, output_tiff_path, gpt_bin=None, label="banda"):
    """
    Exporta UNA banda de un producto .dim (BEAM-DIMAP) a GeoTIFF.

    Si la banda es virtual (ej. Intensity_* calculada desde i_*/q_* en
    datos SLC complejos, que existe solo como fórmula en el .dim y no
    tiene .img propio), usa un nodo BandMaths con esa misma expresión
    para recalcular los píxeles reales. Si es una banda real (con .img
    en disco), usa BandSelect como antes -- más simple y más rápido.

    Nunca lanza excepción: siempre devuelve un dict, para poder llamarla
    después de cada paso del flujo sin arriesgar detenerlo si falla.

    Returns:
        dict: {"status": "ok"|"error", "message": str,
               "output_tiff": str|None, "band_name": str|None}
    """
    result = {"status": "error", "message": None, "output_tiff": None, "band_name": None}
    gpt_bin = gpt_bin or os.environ.get("GPT_BIN", "/home/nahin/esa-snap/bin/gpt")

    try:
        dim_path = str(dim_path)
        if not os.path.exists(dim_path):
            result["message"] = f"[{label}] .dim no encontrado: {dim_path}"
            print(f"[WARN] {result['message']}")
            return result

        try:
            dim_text = Path(dim_path).read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            result["message"] = f"[{label}] no se pudo leer el .dim: {e}"
            print(f"[WARN] {result['message']}")
            return result

        bands_info = _parse_dim_bands(dim_text)
        patterns = band_pattern if isinstance(band_pattern, (list, tuple)) else [band_pattern]

        banda_info = None
        for pat in patterns:
            for b in bands_info:
                if re.search(pat, b["name"], re.IGNORECASE):
                    banda_info = b
                    break
            if banda_info:
                break

        if banda_info is None:
            result["message"] = (
                f"[{label}] ninguna banda coincide con {patterns} en {dim_path}. "
                f"Bandas disponibles: {[b['name'] for b in bands_info]}"
            )
            print(f"[WARN] {result['message']}")
            return result

        banda = banda_info["name"]
        es_virtual = banda_info["virtual"] and banda_info["expression"]

        output_tiff_path = str(output_tiff_path)
        if not output_tiff_path.lower().endswith((".tif", ".tiff")):
            output_tiff_path += ".tif"
        os.makedirs(os.path.dirname(output_tiff_path), exist_ok=True)

        if es_virtual:
            expr_escaped = _xml_escape(banda_info["expression"])
            print(f"[DEBUG] [{label}] banda '{banda}' es VIRTUAL, recalculando con BandMaths: {banda_info['expression']}")
            calc_node = f"""  <node id="BandMaths">
    <operator>BandMaths</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters>
      <targetBands>
        <targetBand>
          <name>{banda}</name>
          <type>float32</type>
          <expression>{expr_escaped}</expression>
          <noDataValue>0.0</noDataValue>
        </targetBand>
      </targetBands>
    </parameters>
  </node>"""
            write_source_refid = "BandMaths"
        else:
            print(f"[DEBUG] [{label}] banda '{banda}' es real, usando BandSelect")
            calc_node = f"""  <node id="BandSelect">
    <operator>BandSelect</operator>
    <sources>
      <sourceProduct refid="Read"/>
    </sources>
    <parameters>
      <sourceBands>{banda}</sourceBands>
    </parameters>
  </node>"""
            write_source_refid = "BandSelect"

        xml_content = f"""<graph id="Graph">
  <version>1.0</version>
  <node id="Read">
    <operator>Read</operator>
    <parameters>
      <file>{dim_path}</file>
    </parameters>
  </node>
{calc_node}
  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct refid="{write_source_refid}"/>
    </sources>
    <parameters>
      <file>{output_tiff_path}</file>
      <formatName>GeoTIFF</formatName>
    </parameters>
  </node>
</graph>
"""
        graph_path = os.path.join(
            os.path.dirname(output_tiff_path),
            f"_export_{os.path.splitext(os.path.basename(output_tiff_path))[0]}.xml",
        )
        with open(graph_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

        print(f"[INFO] [{label}] exportando banda '{banda}' -> {output_tiff_path}")
        proc = subprocess.run([gpt_bin, graph_path], capture_output=True, text=True)

        if proc.returncode != 0:
            result["message"] = f"[{label}] gpt falló exportando '{banda}': {proc.stderr[-1500:]}"
            print(f"[WARN] {result['message']}")
            return result

        if not os.path.exists(output_tiff_path):
            result["message"] = f"[{label}] gpt retornó éxito pero no se generó el TIFF: {output_tiff_path}"
            print(f"[WARN] {result['message']}")
            return result

        try:
            os.remove(graph_path)
        except OSError:
            pass

        result.update(status="ok", message=f"[{label}] banda '{banda}' exportada.",
                       output_tiff=output_tiff_path, band_name=banda)
        print(f"[OK] {result['message']} -> {output_tiff_path}")

        # Generar también el quicklook PNG con pconvert (mismo motor de
        # render que SNAP Desktop) en el mismo momento, ya que aquí
        # tenemos a mano el .dim y el nombre exacto de la banda. Esto es
        # más confiable que reconstruir la banda a partir del nombre del
        # archivo .tif en un endpoint genérico más adelante.
        result["quicklook_png"] = _generar_quicklook_pconvert(dim_path, banda, output_tiff_path)

        return result

    except Exception as e:
        result["message"] = f"[{label}] excepción inesperada: {e}"
        print(f"[ERROR] {result['message']}")
        import traceback
        traceback.print_exc()
        return result

if __name__ == '__main__':
    # threaded=True es IMPRESCINDIBLE: /procesar_flujo puede tardar minutos u
    # horas dentro de una sola request. Sin threading, el servidor de
    # desarrollo de Flask atiende una request a la vez, y el polling de
    # /flujo-progreso quedaría bloqueado hasta que /procesar_flujo termine
    # -- justo lo que queremos evitar para mostrar previews en tiempo real.
    app.run(host='127.0.0.1', port=5000, threaded=True)