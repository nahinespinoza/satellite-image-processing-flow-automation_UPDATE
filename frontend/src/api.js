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
export async function procesarFlujo(inputs, outputDir, params = {}) {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];

  const response = await fetch(`${API_BASE}/procesar_flujo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: inputArray.map((f) => f.name || f),
      output_dir: outputDir,
      params, // <-- NUEVO
    }),
  });

  if (!response.ok) throw new Error("Error al procesar el flujo");
  return response.json();
}

// ==================== MODIFICADA: ahora usa /procesar_flujo_batch_auto ====================
export async function procesarFlujoBatch(
  mainFolder,
  params = {},
  diasEsperados = 12,
) {
  const response = await fetch(`${API_BASE}/procesar_flujo_batch_auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      main_folder: mainFolder,
      dias_esperados: diasEsperados,
      params,
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

  if (!response.ok) throw new Error("Error guardando graph XML");
  return response.json();
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
