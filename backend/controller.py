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
from pathlib import Path

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
    Lista todos los archivos disponibles en las carpetas de imágenes y output
    (incluyendo los que están dentro de las subcarpetas "Grafo N - Nombre")
    """
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        images_dir = os.path.join(backend_dir, "files", "images")
        output_dir = os.path.join(backend_dir, "files", "output")

        files_by_category = {
            "input": _listar_archivos_recursivo(images_dir),
            "output": _listar_archivos_recursivo(output_dir)
        }

        return jsonify({
            "status": "ok",
            "files_by_category": files_by_category,
            "total_count": len(files_by_category["input"]) + len(files_by_category["output"])
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
            return jsonify({"status": "ok", "output": output_file})
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
    como por /procesar_flujo_batch (muchas parejas, una por subcarpeta).

    No usa jsonify ni request: recibe todo por parámetros y devuelve
    (dict_resultado, http_status) para que el llamador decida qué hacer
    con la respuesta (responder directo o acumular en un batch).
    """
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

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
        return {
            "status": "error",
            "step": "1-4",
            "message": (
                "El flujo requiere dos imágenes (master y slave) para el Gráfico 2a "
                "(Back-Geocoding). Sólo se recibió una."
            )
        }, 400

    name1 = os.path.splitext(os.path.basename(absolute_input_files[0]))[0]
    folder_1 = os.path.join(output_dir, carpeta_para_grafo(graph_files["1"]))

    try:
        # --- Paso 1: Orbit, aplicado a AMBAS imágenes por separado ---
        out1_master = ejecutar_grafo(
            "1", absolute_input_files[0],
            os.path.join(folder_1, f"{name1}_step_1.dim")
        )

        name2 = os.path.splitext(os.path.basename(absolute_input_files[1]))[0]
        out1_slave = ejecutar_grafo(
            "1", absolute_input_files[1],
            os.path.join(folder_1, f"{name2}_step_1.dim")
        )

        # --- Paso 2a: Back-Geocoding, recibe las DOS salidas del paso 1 ---
        out2a = ejecutar_grafo(
            "2a", out1_master,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["2a"]), f"{name1}_step_2a.dim"),
            input2=out1_slave
        )

        # --- Paso 2b: Interferogram, recibe la salida de 2a ---
        out2b = ejecutar_grafo(
            "2b", out2a,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["2b"]), f"{name1}_step_2b.dim")
        )

        # --- Paso 3: Terrain Correction, recibe la salida de 2b ---
        out3 = ejecutar_grafo(
            "3", out2b,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["3"]), f"{name1}_step_3.dim")
        )

        # --- Paso 4: Subset, recibe la salida de 3 ---
        out4 = ejecutar_grafo(
            "4", out3,
            os.path.join(output_dir, carpeta_para_grafo(graph_files["4"]), f"{name1}_step_4.dim"),
            extra_params={"subsetRegion": params["subset_region"]}
        )
    except RuntimeError as e:
        return {"status": "error", "step": "1-4", "message": str(e)}, 500

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
            return {"status": "error", "step": label, "message": error_msg}, 500
        elif input_check:
            file_size_mb = os.path.getsize(input_check) / (1024 * 1024)
            print(f"[DEBUG] Paso {label}: entrada válida -> {input_check} ({file_size_mb:.2f} MB)")

        # Ejecución con streaming en paralelo (igual que procesar_paso)
        import threading
        import sys

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
            return {
                "status": "error",
                "step": label,
                "message": f"Error en {step_name}",
                "stderr": stderr_text[-3000:] if len(stderr_text) > 3000 else stderr_text
            }, 500

        # --- Validación: verificar salidas del paso Python ---
        if step_name == "SNAPHU_FULL":
            # Verificar que se generó al menos un .dim en SnaphuImport
            import_dir = base_path / "SnaphuImport"
            dim_files = list(import_dir.glob("*.dim"))
            if not dim_files:
                error_msg = f"El paso {label} (SNAPHU_FULL) no generó archivos .dim en {import_dir}"
                print(f"[ERROR] {error_msg}")
                return {"status": "error", "step": label, "message": error_msg}, 500
            current_input = str(dim_files[0])
            print(f"[DEBUG] Paso {label}: salida detectada -> {current_input}")

        elif step_name == "PHASE_TO_DISPLACEMENT":
            disp_dir = base_path / "PhaseToDisplacement"
            dim_files = list(disp_dir.glob("*.dim"))
            if not dim_files:
                error_msg = f"El paso {label} (PHASE_TO_DISPLACEMENT) no generó archivos .dim en {disp_dir}"
                print(f"[ERROR] {error_msg}")
                return {"status": "error", "step": label, "message": error_msg}, 500
            current_input = str(dim_files[0])
            print(f"[DEBUG] Paso {label}: salida detectada -> {current_input}")

        elif step_name == "TERRAIN_CORRECTION":
            # TerrainCorrection no genera un .dim nuevo, usa el de displacement
            # Verificar que el script terminó bien
            print(f"[DEBUG] Paso {label}: TerrainCorrection completado (sin nuevo .dim)")

        print(f"✅ Paso {label} (Python: {step_name}) completado.")

    return {
        "status": "ok",
        "message": "Flujo completo ejecutado correctamente (pasos 1-7)",
        "final_output": current_input
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

@app.route('/procesar_flujo_batch', methods=['POST'])
def procesar_flujo_batch():
    """
    Ejecuta el flujo COMPLETO (pasos 1-7) para MUCHAS parejas de imágenes
    de una sola vez, a partir de una carpeta principal con esta estructura:

    Carpeta_main/
      Carpeta_0/  -> Img1, Img2
      Carpeta_1/  -> Img1, Img2
      ...
      Carpeta_n/  -> Img1, Img2

    Por cada subcarpeta se toman las 2 imágenes (.zip o .dim) que contiene
    y se corre el flujo completo, generando TODA la salida (Grafo 1..4,
    Snaphu, Phase to Displacement, Terrain Correction) DENTRO de esa misma
    subcarpeta, al mismo nivel que las imágenes originales.

    Si una subcarpeta falla, se registra el error y se continúa con las
    demás (no se detiene el batch completo).

    Espera un JSON:
    {
      "main_folder": "/ruta/a/Carpeta_main",
      "params": { ... }   <-- OPCIONAL
    }
    """
    try:
        data = request.json
        main_folder = data.get('main_folder')
        user_params = data.get('params', {})

        if not main_folder:
            return jsonify({"status": "error", "message": "main_folder es requerido"}), 400

        backend_dir = os.path.dirname(os.path.abspath(__file__))

        # Resolver la carpeta principal. Si viene como ruta absoluta (por ej.
        # tecleada manualmente) se usa tal cual. Si viene como un nombre suelto
        # (por ej. lo que entrega el selector de carpetas del navegador, que por
        # seguridad NO expone la ruta absoluta del disco, solo el nombre de la
        # carpeta) se busca dentro de las ubicaciones conocidas del backend,
        # igual que ya se hace para archivos individuales en /procesar_flujo.
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
                    print(f"[BATCH] Carpeta principal encontrada en: {resolved_folder}")
                    break

        if resolved_folder is None:
            return jsonify({
                "status": "error",
                "message": (
                    f"No se encontró la carpeta principal: '{main_folder}'. "
                    f"Si la seleccionaste con 'Browse', el navegador solo envía el nombre de "
                    f"la carpeta (por seguridad no expone la ruta completa del disco); en ese "
                    f"caso colócala dentro de backend/files/images/ o backend/files/output/, "
                    f"o escribe la ruta absoluta completa manualmente en el campo de texto."
                )
            }), 404

        main_folder = resolved_folder
        ALLOWED_EXTS = ('.zip', '.dim')

        # Subcarpetas de primer nivel (Carpeta_0, Carpeta_1, ..., Carpeta_n)
        subfolders = sorted([
            os.path.join(main_folder, d)
            for d in os.listdir(main_folder)
            if os.path.isdir(os.path.join(main_folder, d))
        ])

        if not subfolders:
            return jsonify({
                "status": "error",
                "message": f"No se encontraron subcarpetas dentro de: {main_folder}"
            }), 404

        print(f"[BATCH] {len(subfolders)} subcarpetas encontradas en {main_folder}")

        resultados = []
        exitosos = 0
        fallidos = 0

        for subfolder in subfolders:
            folder_name = os.path.basename(subfolder)
            print(f"\n{'=' * 60}\n[BATCH] Procesando carpeta: {folder_name}\n{'=' * 60}")

            # Buscar las 2 imágenes principales dentro de la subcarpeta (nivel raíz,
            # sin bajar a las carpetas que el propio flujo irá creando dentro).
            imagenes = sorted([
                os.path.join(subfolder, f)
                for f in os.listdir(subfolder)
                if os.path.isfile(os.path.join(subfolder, f))
                and f.lower().endswith(ALLOWED_EXTS)
            ])

            if len(imagenes) < 2:
                msg = (
                    f"Se requieren 2 imágenes (.zip o .dim) en '{folder_name}' y se "
                    f"encontraron {len(imagenes)}."
                )
                print(f"[BATCH][ERROR] {msg}")
                resultados.append({"folder": folder_name, "status": "error", "message": msg})
                fallidos += 1
                continue

            imagen1, imagen2 = imagenes[0], imagenes[1]
            print(f"[BATCH] Imagen 1 (master): {imagen1}")
            print(f"[BATCH] Imagen 2 (slave):  {imagen2}")

            # La salida de esta carpeta se crea DENTRO de la misma subcarpeta,
            # al nivel de las imágenes principales.
            try:
                result, code = _ejecutar_flujo_completo_core(
                    [imagen1, imagen2], subfolder, backend_dir, user_params
                )
            except Exception as e:
                print(f"[BATCH][ERROR] Excepción procesando '{folder_name}': {e}")
                import traceback
                traceback.print_exc()
                result, code = {"status": "error", "message": str(e)}, 500

            result["folder"] = folder_name
            resultados.append(result)

            if result.get("status") == "ok":
                exitosos += 1
                print(f"[BATCH] ✅ '{folder_name}' completada. Salida: {result.get('final_output')}")
            else:
                fallidos += 1
                print(f"[BATCH] ❌ '{folder_name}' falló: {result.get('message')}")

        if fallidos == 0:
            status_general = "ok"
        elif exitosos > 0:
            status_general = "partial"
        else:
            status_general = "error"

        print(f"\n[BATCH] Terminado. {exitosos} exitosas, {fallidos} fallidas de {len(subfolders)} totales.")

        return jsonify({
            "status": status_general,
            "main_folder": main_folder,
            "total_carpetas": len(subfolders),
            "exitosos": exitosos,
            "fallidos": fallidos,
            "resultados": resultados
        })

    except Exception as e:
        print(f"[ERROR] Excepción en procesar_flujo_batch: {str(e)}")
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


@app.route('/files/<folder>/<filename>', methods=['GET'])
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


@app.route('/download/<folder>/<filename>', methods=['GET'])
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


@app.route('/convert-image/<folder>/<filename>', methods=['GET'])
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
            return jsonify({
                "status": "ok",
                "message": f"Paso {step} completado exitosamente",
                "output": stdout_text[-3000:] if len(stdout_text) > 3000 else stdout_text
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

    
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)