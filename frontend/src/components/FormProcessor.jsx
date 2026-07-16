// src/components/FormProcessor.jsx
import React, { useState } from "react";
import { procesarGraph } from "../api";

export default function FormProcessor() {
  const [graph, setGraph] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ message: "Procesando...", color: "#888" });

    try {
      const data = await procesarGraph(graph, input, output);
      setStatus({ message: JSON.stringify(data, null, 2), color: "green" });
    } catch (err) {
      setStatus({ message: err.message, color: "red" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h2>SNAP Graph Processing Tool (GPT)</h2>
      <form onSubmit={handleSubmit}>
        <label>Archivo Graph XML</label>
        <input
          value={graph}
          onChange={(e) => setGraph(e.target.value)}
          placeholder="Ej: GRAFICO_PARAM.xml"
          required
        />

        <label>Archivo de entrada (.zip / .dim)</label>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="/data/entrada.zip"
          required
        />

        <label>Archivo de salida (.dim)</label>
        <input
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          placeholder="/data/salida.dim"
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? "Procesando..." : "Ejecutar"}
        </button>
      </form>

      {status && (
        <pre style={{ color: status.color, marginTop: "1rem" }}>
          {status.message}
        </pre>
      )}
    </div>
  );
}
