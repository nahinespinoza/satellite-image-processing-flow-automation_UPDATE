import React, { useState } from "react";
import "./ParameterPanel.module.css";

export default function ParameterPanel({ xmlText, onAddParameter, onUpdateParameter, onDeleteParameter }) {
  const [parameters, setParameters] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [selectedParam, setSelectedParam] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingParam, setEditingParam] = useState(null);

  // Extraer parámetros y etiquetas XML disponibles
  React.useEffect(() => {
    if (!xmlText) {
      setParameters([]);
      setAvailableTags([]);
      return;
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");

      if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        setParameters([]);
        setAvailableTags([]);
        return;
      }

      // Extraer parámetros
      const params = [];
      const paramElements = xmlDoc.getElementsByTagName("parameter");

      for (let i = 0; i < paramElements.length; i++) {
        const elem = paramElements[i];
        params.push({
          id: `param-${i}`,
          name: elem.getAttribute("name") || "Sin nombre",
          description: elem.getAttribute("description") || "",
          default: elem.textContent || "",
        });
      }

      // Extraer todas las etiquetas XML únicas (excepto parámetros)
      const tagsSet = new Set();
      const walkTree = (node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.nodeName;
          if (tagName !== "parameter" && tagName !== "#document") {
            tagsSet.add(tagName);
          }
        }
        for (let child of node.childNodes) {
          walkTree(child);
        }
      };
      walkTree(xmlDoc);

      const tags = Array.from(tagsSet).sort();

      setParameters(params);
      setAvailableTags(tags);
      setSelectedParam(null);
      setEditingParam(null);
    } catch (err) {
      console.error("Error parsing XML:", err);
      setParameters([]);
      setAvailableTags([]);
    }
  }, [xmlText]);

  const handleAddNew = () => {
    setShowAddModal(true);
    setEditingParam(null);
    setEditingValue("");
  };

  const handleSelectTag = (tag) => {
    setSelectedTag(tag);
    setShowTagsModal(true);
  };

  const handleConfirmTagSelection = (paramValue, insertLocation) => {
    if (!paramValue.trim()) {
      alert("El valor no puede estar vacío");
      return;
    }

    const newParameter = {
      name: selectedTag,
      value: paramValue,
      location: insertLocation,
      isTag: true,
    };

    onAddParameter(newParameter);
    setShowTagsModal(false);
    setSelectedTag(null);
    alert("Parámetro agregado. Guarda los cambios para aplicarlos.");
  };

  const handleConfirmAdd = (paramName, paramValue, insertLocation) => {
    if (!paramName.trim() || !paramValue.trim()) {
      alert("Nombre y valor son requeridos");
      return;
    }

    const newParameter = {
      name: paramName,
      value: paramValue,
      location: insertLocation,
      isTag: false,
    };

    onAddParameter(newParameter);
    setShowAddModal(false);
    alert("Parámetro agregado. Guarda los cambios para aplicarlos.");
  };

  const handleUpdateParam = (param, newValue) => {
    if (!newValue.trim()) {
      alert("El valor no puede estar vacío");
      return;
    }

    onUpdateParameter(param.name, newValue);
    setEditingParam(null);
    setEditingValue("");
    alert("Parámetro actualizado. Guarda los cambios para aplicarlos.");
  };

  const handleDeleteParam = (paramName) => {
    if (window.confirm(`¿Eliminar el parámetro "${paramName}"?`)) {
      onDeleteParameter(paramName);
      setSelectedParam(null);
      alert("Parámetro eliminado. Guarda los cambios para aplicarlos.");
    }
  };

  return (
    <div className="parameter-panel" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "8px", background: "#f5f5f5", borderRadius: "6px", maxHeight: "100%", overflow: "hidden" }}>
      
      {/* BOTONES PRINCIPALES */}
      <button className="add-param-btn" onClick={handleAddNew} style={{ width: "100%", padding: "8px", fontSize: "11px", fontWeight: "600" }}>
        Agregar Parámetro
      </button>

      {/* LISTA COMPACTA DE PARÁMETROS */}
      {parameters.length === 0 ? (
        <div style={{ fontSize: "10px", color: "#999", textAlign: "center", padding: "8px" }}>
          Sin parámetros
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", fontSize: "10px" }}>
          {parameters.map((param) => (
            <div
              key={param.id}
              style={{
                padding: "6px",
                marginBottom: "4px",
                background: selectedParam?.id === param.id ? "#2196f3" : "white",
                color: selectedParam?.id === param.id ? "white" : "black",
                borderRadius: "3px",
                cursor: "pointer",
                border: "1px solid #ddd",
                fontSize: "9px",
              }}
              onClick={() => setSelectedParam(param)}
            >
              <div style={{ fontWeight: "600", marginBottom: "2px" }}>{param.name}</div>
              <div style={{ opacity: 0.8, marginBottom: "2px" }}>{param.default.substring(0, 20)}</div>

              {selectedParam?.id === param.id && (
                <div style={{ marginTop: "4px", paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.3)", display: "flex", gap: "3px" }}>
                  <button
                    style={{
                      flex: 1,
                      padding: "3px",
                      background: "rgba(255,255,255,0.2)",
                      color: "white",
                      border: "none",
                      borderRadius: "2px",
                      cursor: "pointer",
                      fontSize: "8px",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingParam(param);
                      setEditingValue(param.default);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    style={{
                      flex: 1,
                      padding: "3px",
                      background: "rgba(255,0,0,0.3)",
                      color: "white",
                      border: "none",
                      borderRadius: "2px",
                      cursor: "pointer",
                      fontSize: "8px",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteParam(param.name);
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              )}

              {editingParam?.id === param.id && (
                <div style={{ marginTop: "4px", paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.3)", display: "flex", flexDirection: "column", gap: "3px" }}>
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    style={{ padding: "3px", fontSize: "9px", borderRadius: "2px", border: "1px solid white" }}
                    autoFocus
                  />
                  <button
                    style={{
                      padding: "3px",
                      background: "rgba(255,255,255,0.3)",
                      color: "white",
                      border: "none",
                      borderRadius: "2px",
                      cursor: "pointer",
                      fontSize: "8px",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpdateParam(param, editingValue);
                    }}
                  >
                    Guardar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ETIQUETAS XML DISPONIBLES - Más grandes */}
      {availableTags.length > 0 && (
        <div style={{ fontSize: "10px", borderTop: "1px solid #ddd", paddingTop: "8px" }}>
          <div style={{ fontWeight: "600", marginBottom: "6px", color: "#333" }}>Etiquetas:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", maxHeight: "100px", overflow: "auto" }}>
            {availableTags.map((tag) => (
              <button
                key={tag}
                onClick={() => handleSelectTag(tag)}
                style={{
                  padding: "5px 8px",
                  background: "#2196f3",
                  color: "white",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "10px",
                  fontWeight: "500",
                  whiteSpace: "nowrap",
                }}
                title={tag}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {showAddModal && (
        <AddParameterModal
          onConfirm={handleConfirmAdd}
          onCancel={() => setShowAddModal(false)}
        />
      )}

      {showTagsModal && selectedTag && (
        <TagSelectionModal
          tag={selectedTag}
          onConfirm={handleConfirmTagSelection}
          onCancel={() => {
            setShowTagsModal(false);
            setSelectedTag(null);
          }}
        />
      )}
    </div>
  );
}

function AddParameterModal({ onConfirm, onCancel }) {
  const [paramName, setParamName] = useState("");
  const [paramValue, setParamValue] = useState("");
  const [insertLocation, setInsertLocation] = useState("end");

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>Agregar Nuevo Parámetro</h3>

        <div className="form-group">
          <label>Nombre del Parámetro *</label>
          <input
            type="text"
            value={paramName}
            onChange={(e) => setParamName(e.target.value)}
            placeholder="ej: inputFile, outputFile"
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label>Valor *</label>
          <input
            type="text"
            value={paramValue}
            onChange={(e) => setParamValue(e.target.value)}
            placeholder="ej: /path/to/file"
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label>Dónde agregarlo</label>
          <select
            value={insertLocation}
            onChange={(e) => setInsertLocation(e.target.value)}
            className="form-select"
          >
            <option value="beginning">Al inicio</option>
            <option value="end">Al final</option>
          </select>
        </div>

        <div className="modal-actions">
          <button
            className="confirm-btn"
            onClick={() => onConfirm(paramName, paramValue, insertLocation)}
          >
            Agregar
          </button>
          <button className="cancel-btn" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function TagSelectionModal({ tag, onConfirm, onCancel }) {
  const [paramValue, setParamValue] = useState("");
  const [insertLocation, setInsertLocation] = useState("end");

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>Agregar Parámetro: {tag}</h3>
        <p className="modal-subtitle">Basado en la etiqueta XML encontrada</p>

        <div className="form-group">
          <label>Valor *</label>
          <input
            type="text"
            value={paramValue}
            onChange={(e) => setParamValue(e.target.value)}
            placeholder={`Valor para ${tag}`}
            className="form-input"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>Dónde agregarlo</label>
          <select
            value={insertLocation}
            onChange={(e) => setInsertLocation(e.target.value)}
            className="form-select"
          >
            <option value="beginning">Al inicio</option>
            <option value="end">Al final</option>
          </select>
        </div>

        <div className="modal-actions">
          <button
            className="confirm-btn"
            onClick={() => onConfirm(paramValue, insertLocation)}
          >
            Agregar
          </button>
          <button className="cancel-btn" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
