import React, { useState } from "react";

/**
 * Selector de destino de los resultados: proyecto (carpeta dentro de
 * output/) + órbita (Ascendente / Descendente). Permite crear un proyecto
 * nuevo escribiendo su nombre; el backend crea las dos subcarpetas.
 *
 * Es "controlado": el estado (proyecto, orbita, lista) vive en ProcessorUI
 * para que la elección sea la misma en Individual, Flujo y Batch.
 */
export default function SelectorProyecto({
  proyectos = [],
  proyecto,
  orbita,
  onProyecto,
  onOrbita,
  onCrear, // async (nombre) => nombre creado; lanza Error con mensaje
  onRefrescar,
  carpetaDestino,
  outputRoot,
  orbitas = ["Ascendente", "Descendente"],
  disabled = false,
}) {
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const crear = async () => {
    const nombre = nombreNuevo.trim();
    if (!nombre || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await onCrear(nombre);
      setNombreNuevo("");
      setCreando(false);
    } catch (e) {
      setError(e.message || "No se pudo crear el proyecto");
    } finally {
      setEnviando(false);
    }
  };

  const actual = proyectos.find((p) => p.nombre === proyecto);
  const rutaRelativa =
    outputRoot && carpetaDestino?.startsWith(outputRoot)
      ? `output${carpetaDestino.slice(outputRoot.length)}`
      : carpetaDestino;

  return (
    <div className="form-group sp-box">
      <label>Proyecto (carpeta de resultados):</label>
      <div className="sp-row">
        <select
          value={proyecto}
          onChange={(e) => onProyecto(e.target.value)}
          disabled={disabled}
        >
          <option value="">— Sin proyecto (directo en output/) —</option>
          {proyectos.map((p) => (
            <option key={p.nombre} value={p.nombre}>
              {p.nombre}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="sp-btn"
          onClick={() => {
            setCreando((v) => !v);
            setError(null);
          }}
          disabled={disabled}
          title="Crear un proyecto nuevo"
        >
          {creando ? "Cancelar" : "＋ Nuevo"}
        </button>
        {onRefrescar && (
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            onClick={onRefrescar}
            disabled={disabled}
            title="Volver a leer los proyectos de output/"
          >
            ⟳
          </button>
        )}
      </div>

      {creando && (
        <div className="sp-row">
          <input
            type="text"
            value={nombreNuevo}
            autoFocus
            maxLength={80}
            placeholder="Nombre del proyecto, ej. Tungurahua 2026"
            onChange={(e) => setNombreNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") crear();
              if (e.key === "Escape") setCreando(false);
            }}
            disabled={disabled || enviando}
          />
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={crear}
            disabled={disabled || enviando || !nombreNuevo.trim()}
          >
            {enviando ? "Creando…" : "Crear"}
          </button>
        </div>
      )}
      {creando && (
        <p className="sp-hint">
          Se crea <code>output/&lt;nombre&gt;/</code> con las subcarpetas
          Ascendente y Descendente.
        </p>
      )}
      {error && <p className="sp-error">{error}</p>}

      <label style={{ marginTop: 6 }}>Órbita:</label>
      <div className="sp-row" role="radiogroup" aria-label="Órbita">
        {orbitas.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={orbita === o}
            className={`sp-btn sp-orbita ${orbita === o ? "sp-orbita-on" : ""}`}
            onClick={() => onOrbita(o)}
            disabled={disabled || !proyecto}
            title={!proyecto ? "Elige o crea un proyecto primero" : undefined}
          >
            {o === "Ascendente" ? "↗ " : "↘ "}
            {o}
            {actual?.orbitas?.[o]?.resultados
              ? ` (${actual.orbitas[o].resultados})`
              : ""}
          </button>
        ))}
      </div>

      <p className="sp-destino" title={carpetaDestino}>
        📂 Se guardará en: <strong>{rutaRelativa || "…"}</strong>
      </p>
    </div>
  );
}
