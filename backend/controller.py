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

        # Insertar la subcarpeta descriptiva del gráfico (ej. "Grafo 1 - Orbit")
        # entre el output_dir base y el nombre del archivo, para que cada
        # gráfico guarde sus resultados en su propia carpeta.
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

        # Construir lista de argumentos (evitar shell=True para que Windows no rompa rutas con espacios)
        cmd_list = [GPT_PATH, graph]
        cmd_list.append(f"-PinputFile={absolute_input_files[0]}")
        cmd_list.append(f"-PoutputFile={output_file}")
        if len(absolute_input_files) >= 2:
            cmd_list.append(f"-PinputFile2={absolute_input_files[1]}")

    
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

@app.route('/procesar_flujo', methods=['POST'])
def procesar_flujo():
    """
    Ejecuta los 4 gráficos XML en cola secuencialmente.
    Espera un JSON con los campos:
    {
      "inputs": ["archivo1.zip", "archivo2.dim"],  // Array de archivos de entrada
      "output_dir": "C:/ruta/salida/"
    }
    
    Los archivos pueden estar en:
    - backend/files/images/ (búsqueda por defecto)
    - backend/files/output/ (si es resultado de procesamiento anterior)
    - O ruta absoluta completa
    """
    try:
        data = request.json
        input_files = data.get('inputs', [])
        output_dir = data['output_dir']

        if not input_files:
            return jsonify({
                "status": "error",
                "message": "Se requiere al menos un archivo de entrada"
            }), 400

        # Si solo se proporciona un string, convertirlo a lista
        if isinstance(input_files, str):
            input_files = [input_files]

        # Convertir todas las rutas a absolutas
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        absolute_input_files = []
        
        print(f"[DEBUG] Input files recibidos: {input_files}")
        
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
                    input_file  # Intentar como ruta relativa desde raíz
                ]
                
                for path in search_paths:
                    if os.path.exists(path):
                        abs_path = os.path.abspath(path)
                        print(f"[DEBUG] Archivo encontrado en: {abs_path}")
                        break
            
            print(f"[DEBUG] Buscando archivo: {input_file}")
            
            # Verificar si el archivo existe
            if abs_path is None or not os.path.exists(abs_path):
                print(f"[ERROR] Archivo no encontrado: {input_file}")
                # Listar archivos disponibles en las carpetas
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
        
        output_dir = os.path.abspath(output_dir)
        
        # Crear carpeta de salida si no existe
        os.makedirs(output_dir, exist_ok=True)

        # Definir rutas absolutas de los gráficos
        graph_files = [
            os.path.join(backend_dir, "files", "GRAFICO_1.xml"),
            os.path.join(backend_dir, "files", "GRAFICO_2a.xml"),
            os.path.join(backend_dir, "files", "GRAFICO_2b.xml"),
            os.path.join(backend_dir, "files", "GRAFICO_3.xml"),
            os.path.join(backend_dir, "files", "GRAFICO_4.xml")
        ]
        # Etiquetas de paso para nombrar los archivos intermedios (_step_<label>.dim)
        step_labels = ["1", "2a", "2b", "3", "4"]

        # Solo GRAFICO_2a.xml necesita el segundo archivo de entrada (inputFile2),
        # ya que es el que hace el Back-Geocoding / Enhanced-Spectral-Diversity.
        # GRAFICO_2b.xml solo recibe un input (la salida de 2a).
        graph_needs_second_input = os.path.basename(graph_files[1])  # "GRAFICO_2a.xml"

        # Obtener nombre del archivo de entrada sin extensión
        input_name_without_ext = os.path.splitext(os.path.basename(absolute_input_files[0]))[0]

        # Secuencia de productos
        current_input = absolute_input_files[0]
        #GPT_PATH = r"C:/Users/vpena/AppData/Local/Programs/esa-snap/bin/gpt.exe"}
        GPT_PATH = "/home/nahin/esa-snap/bin/gpt"

        for i, graph in enumerate(graph_files, start=1):
            label = step_labels[i - 1]

            # Cada paso escribe dentro de su propia subcarpeta descriptiva
            # (ej. output_dir/"Grafo 1 - Orbit/") en vez de tirar todo suelto
            # en output_dir.
            folder_name = carpeta_para_grafo(graph)
            step_output_dir = os.path.join(output_dir, folder_name)
            os.makedirs(step_output_dir, exist_ok=True)
            output_file = os.path.join(step_output_dir, f"{input_name_without_ext}_step_{label}.dim")

            # Para GRAFICO_2a, si hay un segundo archivo de entrada, usarlo como parámetro adicional
            cmd_list = [GPT_PATH, graph]
            cmd_list.append(f"-PinputFile={current_input}")
            cmd_list.append(f"-PoutputFile={output_file}")
            if os.path.basename(graph) == graph_needs_second_input and len(absolute_input_files) > 1:
                cmd_list.append(f"-PinputFile2={absolute_input_files[1]}")

            print(f"\n--- Ejecutando paso {label} ---")
            print(cmd_list)

            result = subprocess.run(cmd_list, capture_output=True, text=True)

            if result.returncode != 0:
                print(result.stderr)
                return jsonify({
                    "status": "error",
                    "step": label,
                    "message": result.stderr
                }), 500

            print(f"✅ Paso {label} completado.")
            current_input = output_file  # salida de un paso = entrada del siguiente

        return jsonify({
            "status": "ok",
            "message": "Flujo completo ejecutado correctamente",
            "final_output": current_input
        })

    except Exception as e:
        print(f"[ERROR] Excepción en procesar_flujo: {str(e)}")
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


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
