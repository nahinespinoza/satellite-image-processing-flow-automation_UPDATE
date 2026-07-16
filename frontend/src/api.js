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

export async function procesarGraph(graph, input, output) {
  // Si input es un array (múltiples archivos), convertirlo
  const inputData = Array.isArray(input) ? input : input;
  
  const response = await fetch(`${API_BASE}/procesar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      graph, 
      input: inputData,
      output 
    })
  });

  if (!response.ok) throw new Error("Error al procesar el graph");
  return response.json();
}

export async function procesarFlujo(inputs, outputDir) {
  // Convertir a array si es un string
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  
  const response = await fetch(`${API_BASE}/procesar_flujo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      inputs: inputArray.map(f => f.name || f),
      output_dir: outputDir 
    })
  });

  if (!response.ok) throw new Error("Error al procesar el flujo");
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

