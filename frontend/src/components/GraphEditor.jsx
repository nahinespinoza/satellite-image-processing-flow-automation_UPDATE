import React, { useState, useEffect } from "react";
import "./ProcessorUI.css";
import { guardarGraphXML, obtenerArchivosDisponibles } from "../api";
import ParameterPanel from "./ParameterPanel";

export default function GraphEditor() {
  const [xmlText, setXmlText] = useState("");
  const [fileName, setFileName] = useState("");
  const [, setXmlFiles] = useState([]);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const textareaRef = React.useRef(null);

  // ================================
  // Cargar lista de archivos del servidor
  // ================================
  useEffect(() => {
    const loadFiles = async () => {
      try {
        const resp = await obtenerArchivosDisponibles();
        const images = resp.files_by_category?.images || [];
        const output = resp.files_by_category?.output || [];

        const xmlOnly = [...images, ...output].filter(f =>
          f.toLowerCase().endsWith(".xml")
        );

        setXmlFiles(xmlOnly);
      } catch (err) {
        console.error(err);
      }
    };
    loadFiles();
  }, []);

  // ================================
  // Cargar archivo local
  // ================================
  const handleLocalLoad = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => setXmlText(e.target.result);
    reader.readAsText(file);
  };

  // ================================
  // Guardar en servidor
  // ================================
  const handleSave = async () => {
    if (!fileName) {
      alert("Selecciona un archivo antes de guardar.");
      return;
    }

    try {
      await guardarGraphXML(fileName, xmlText);
      setShowSavedModal(true);
      setTimeout(() => setShowSavedModal(false), 1800);
    } catch (err) {
      alert("Error al guardar: " + err);
    }
  };

  // ================================
  // Manejar parámetros
  // ================================
  const handleAddParameter = (newParameter) => {
    try {
      // Obtener la posición del cursor en el textarea
      const cursorPos = textareaRef.current?.selectionStart || xmlText.length;

      // Crear el elemento según si es una etiqueta o un parámetro
      let paramString;
      if (newParameter.isTag) {
        // Si es una etiqueta, usar el nombre directamente: <pixelRegion>valor</pixelRegion>
        paramString = `<${newParameter.name}>${newParameter.value}</${newParameter.name}>\n`;
      } else {
        // Si es un parámetro manual, usar formato parameter
        paramString = `<parameter name="${newParameter.name}">${newParameter.value}</parameter>\n`;
      }

      // Insertar en la posición del cursor
      const newXmlText = xmlText.slice(0, cursorPos) + paramString + xmlText.slice(cursorPos);

      setXmlText(newXmlText);
      alert("Elemento insertado en la posición del cursor");
    } catch (err) {
      alert("Error al agregar elemento: " + err.message);
    }
  };

  const handleUpdateParameter = (paramName, newValue) => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");

      if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        alert("El XML actual no es válido.");
        return;
      }

      const params = xmlDoc.querySelectorAll("parameter");
      let found = false;

      params.forEach((param) => {
        if (param.getAttribute("name") === paramName) {
          param.textContent = newValue;
          found = true;
        }
      });

      if (!found) {
        alert(`Parámetro "${paramName}" no encontrado`);
        return;
      }

      const serializer = new XMLSerializer();
      const updatedXML = serializer.serializeToString(xmlDoc);
      const formattedXML = formatXML(updatedXML);
      setXmlText(formattedXML);
    } catch (err) {
      alert("Error al actualizar parámetro: " + err.message);
    }
  };

  const handleDeleteParameter = (paramName) => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");

      if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        alert("El XML actual no es válido.");
        return;
      }

      const params = xmlDoc.querySelectorAll("parameter");
      let found = false;

      params.forEach((param) => {
        if (param.getAttribute("name") === paramName) {
          param.remove();
          found = true;
        }
      });

      if (!found) {
        alert(`Parámetro "${paramName}" no encontrado`);
        return;
      }

      const serializer = new XMLSerializer();
      const updatedXML = serializer.serializeToString(xmlDoc);
      const formattedXML = formatXML(updatedXML);
      setXmlText(formattedXML);
    } catch (err) {
      alert("Error al eliminar parámetro: " + err.message);
    }
  };

  // ================================
  // Formatear XML para legibilidad
  // ================================
  const formatXML = (xml) => {
    let formatted = "";
    let indent = 0;
    const tab = "  ";

    xml.split(/>\s*</).forEach((node) => {
      if (node.match(/^\/\w/)) indent--;
      formatted += tab.repeat(Math.max(0, indent)) + "<" + node + ">\r\n";
      if (node.match(/^<?\w[^>]*[^/]$/) && !node.startsWith("!")) indent++;
    });

    return formatted.substring(1, formatted.length - 3);
  };

  return (
    <div className="content" style={{ display: "flex", gap: "12px", padding: "12px", height: "calc(100vh - 150px)" }}>
      
      {/* ================================
          PANEL IZQUIERDA (Mini panel)
         ================================ */}
      <div style={{ width: "120px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <label className="file-input-label" style={{ width: "100%", margin: "0", padding: "8px", fontSize: "11px", textAlign: "center" }}>
          Cargar XML
          <input
            type="file"
            accept=".xml"
            onChange={handleLocalLoad}
            style={{ display: "none" }}
          />
        </label>

        <button
          className="process-button"
          onClick={handleSave}
          style={{ width: "100%", padding: "8px", fontSize: "11px", margin: "0" }}
        >
          Guardar
        </button>

        <div style={{ fontSize: "10px", color: "#666", padding: "8px", background: "#f5f5f5", borderRadius: "4px", textAlign: "center", wordBreak: "break-word" }}>
          {fileName ? fileName.substring(0, 15) + (fileName.length > 15 ? "..." : "") : "Sin archivo"}
        </div>
      </div>

      {/* ================================
          COLUMNA PRINCIPAL (Editor - 60%)
         ================================ */}
      <div style={{ flex: 1.5, display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}>

        {/* EDITOR XML - PROMINENTE */}
        <textarea
          ref={textareaRef}
          value={xmlText}
          onChange={(e) => setXmlText(e.target.value)}
          placeholder="Carga un archivo XML para empezar..."
          style={{
            flex: 1,
            width: "100%",
            background: "white",
            padding: "12px",
            fontFamily: '"Courier New", monospace',
            fontSize: "12px",
            lineHeight: "1.5",
            borderRadius: "6px",
            border: "2px solid #2196f3",
            resize: "none",
            boxShadow: "0 2px 8px rgba(33, 150, 243, 0.1)",
          }}
        />
      </div>

      {/* ================================
          PANEL PARÁMETROS (Derecha - 40%)
         ================================ */}
      <div style={{ flex: 1, minWidth: "200px" }}>
        <ParameterPanel
          xmlText={xmlText}
          onAddParameter={handleAddParameter}
          onUpdateParameter={handleUpdateParameter}
          onDeleteParameter={handleDeleteParameter}
        />
      </div>

      {/* MODAL DE GUARDADO */}
      {showSavedModal && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "white",
            padding: "30px",
            borderRadius: "12px",
            boxShadow: "0 4px 25px rgba(0,0,0,0.25)",
            zIndex: 9999,
            textAlign: "center"
          }}
        >
          <div style={{ fontSize: "48px", color: "#4caf50" }}>✔</div>
          <p style={{ marginTop: "10px", fontSize: "18px", fontWeight: "600" }}>
            Guardado exitoso
          </p>
        </div>
      )}
    </div>
  );
}
