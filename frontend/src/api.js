// src/api.js
const API_BASE = "http://localhost:5000";

export async function obtenerConfig() {
  const response = await fetch(`${API_BASE}/config`);
  if (!response.ok) throw new Error("Error al obtener configuración");
  return response.json();
}

export async function obtenerArchivosDisponibles() {
  const response = await fetch(`${API_BASE}/archivos-disponibles`);
  if (!response.ok) throw new Error("Error al obtener archivos disponibles");
  return response.json();
}

// ==================== MODIFICADA: ahora acepta params ====================
export async function procesarGraph(graph, input, output, params = {}) {
  const inputData = Array.isArray(input) ? input : input;

  const response = await fetch(`${API_BASE}/procesar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graph,
      input: inputData,
      output,
      params, // <-- NUEVO
    }),
  });

  if (!response.ok) throw new Error("Error al procesar el graph");
  return response.json();
}

// ==================== MODIFICADA: ahora acepta params ====================
// Crea (en el backend) la carpeta de salida definitiva de una corrida, con
// el nombre por fechas master/slave y sufijo "(1)", "(2)"... si ya existe.
// destino = { proyecto, orbita }: si viene proyecto, la carpeta se crea en
// output/<proyecto>/<orbita>/ (tiene prioridad sobre baseDir).
export async function crearCarpetaSalida(inputs, baseDir, sufijo, destino = {}) {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  const response = await fetch(`${API_BASE}/nueva_carpeta_salida`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: inputArray.map((f) => f.name || f),
      base_dir: baseDir || undefined,
      sufijo,
      proyecto: destino.proyecto || undefined,
      orbita: destino.proyecto ? destino.orbita : undefined,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "ok") {
    throw new Error(data?.message || "No se pudo crear la carpeta de salida");
  }
  return data.output_dir;
}

// outputDir debe venir de crearCarpetaSalida: el backend la usa tal cual
// (carpeta_definitiva) y ahí escribe el progreso.json que se consulta por polling.
export async function procesarFlujo(inputs, outputDir, params = {}) {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];

  const response = await fetch(`${API_BASE}/procesar_flujo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: inputArray.map((f) => f.name || f),
      output_dir: outputDir,
      carpeta_definitiva: true,
      params, // <-- NUEVO
    }),
  });

  // En error el backend igual responde JSON con el paso que falló, el
  // mensaje real y los previews generados hasta ahí: se devuelve tal cual.
  const data = await response.json().catch(() => null);
  if (data && typeof data === "object" && data.status) return data;
  throw new Error(`Error al procesar el flujo (HTTP ${response.status})`);
}

// ==================== MODIFICADA: ahora usa /procesar_flujo_batch_auto ====================
// destino = { proyecto, orbita }: sin proyecto, cada par va a output/<fecha1>_<fecha2>/.
export async function procesarFlujoBatch(
  mainFolder,
  params = {},
  diasEsperados = 12,
  destino = {},
) {
  const response = await fetch(`${API_BASE}/procesar_flujo_batch_auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      main_folder: mainFolder,
      dias_esperados: diasEsperados,
      params,
      proyecto: destino.proyecto || undefined,
      orbita: destino.proyecto ? destino.orbita : undefined,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || "Error al procesar el batch de flujos completos",
    );
  }

  return response.json();
}

// ==================== Proyectos (carpetas en output/ con Ascendente y Descendente) ====================
export async function listarProyectos() {
  const response = await fetch(`${API_BASE}/proyectos`);
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "ok") {
    throw new Error(data?.message || "No se pudieron listar los proyectos");
  }
  return data;
}

export async function crearProyecto(nombre) {
  const response = await fetch(`${API_BASE}/proyectos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "ok") {
    throw new Error(data?.message || "No se pudo crear el proyecto");
  }
  return data;
}

// ==================== NUEVA: polling de progreso del flujo completo ====================
export async function obtenerProgresoFlujo(outputDir) {
  const response = await fetch(
    `${API_BASE}/flujo-progreso?output_dir=${encodeURIComponent(outputDir)}`,
  );
  if (!response.ok) throw new Error("Error al obtener progreso del flujo");
  return response.json();
}

export async function guardarGraphXML(fileName, content) {
  const response = await fetch(`${API_BASE}/guardar-graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: fileName, content }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Error guardando graph XML");
  return data;
}

// ==================== MODIFICADA: ahora acepta params ====================
export async function procesarPaso(step, input, outputDir, params = {}) {
  const inputData = Array.isArray(input) ? input : input;

  const response = await fetch(`${API_BASE}/procesar_paso`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      step: step,
      input: inputData,
      output_dir: outputDir,
      params, // <-- NUEVO
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Error al procesar el paso ${step}`);
  }

  return response.json();
}

// ==================== Grafos XML: leer (actual u original) ====================
export async function leerGraphXML(fileName, original = false) {
  const response = await fetch(
    `${API_BASE}/leer-graph?file_name=${encodeURIComponent(fileName)}${original ? "&original=1" : ""}`,
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Error leyendo graph XML");
  return data.content;
}

// ==================== Subir imagen a backend/files/images (con progreso) ====================
// Devuelve el nombre con el que quedó guardada (es el que esperan /procesar*).
export function subirImagen(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/subir-imagen`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && data.status === "ok") {
        resolve(data.name);
      } else {
        reject(new Error(data.message || `Error subiendo ${file.name}`));
      }
    };
    xhr.onerror = () => reject(new Error(`No se pudo conectar para subir ${file.name}`));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

// ==================== Grafos XML: lista de todos los .xml de backend/files ====================
export async function listarGraphs() {
  const response = await fetch(`${API_BASE}/listar-graphs`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Error listando graphs");
  return { graphs: data.graphs || [] };
}
