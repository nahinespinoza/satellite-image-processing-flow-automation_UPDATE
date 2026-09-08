import React, { useState, useEffect } from "react";
import {
  procesarGraph,
  procesarFlujo,
  procesarFlujoBatch,
  obtenerConfig,
  obtenerArchivosDisponibles,
  procesarPaso,
  obtenerProgresoFlujo,
} from "../api";
import "./ProcessorUI.css";
import GraphEditor from "./GraphEditor";
import MapaVisualizador from "./MapaVisualizador";
import Visualizador from "./visualizador";
import { PreviewGallery, BatchPreviewGallery } from "./PreviewGallery";

const soloNombreArchivo = (ruta) => ruta.split("/").pop();

const ProcessorUI = () => {
  const [activeTab, setActiveTab] = useState("individual");
  const [inputFile, setInputFile] = useState(null);
  const [inputFiles, setInputFiles] = useState([]);
  const [outputDir, setOutputDir] = useState("");
  const [archivosDisponibles, setArchivosDisponibles] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusColor, setStatusColor] = useState("#888");
  const [selectedStep, setSelectedStep] = useState("GRAFICO_1.xml");

  const [individualPreviews, setIndividualPreviews] = useState([]);
  const [flowPreviews, setFlowPreviews] = useState([]);
  const [flowCurrentStep, setFlowCurrentStep] = useState(null);
  const [batchPreviewFolders, setBatchPreviewFolders] = useState([]);
  const [todasLasVisualizaciones, setTodasLasVisualizaciones] = useState([]);
  const [mapaOutputDir, setMapaOutputDir] = useState("");

  const agregarVisualizaciones = (nuevas, origen) => {
    setTodasLasVisualizaciones((prev) => [
      ...prev,
      ...nuevas.map((v) => ({
        ...v,
        origen,
        id: `${origen}:${v.step}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 7)}`,
      })),
    ]);
  };

  const actualizarVisualizacionesDeCorrida = (nuevas, origen, runId) => {
    setTodasLasVisualizaciones((prev) => {
      const sinEstaCorrida = prev.filter((v) => v.runId !== runId);
      const actualizadas = nuevas.map((v) => ({
        ...v,
        origen,
        runId,
        id: `${runId}:${v.step}`,
      }));
      return [...sinEstaCorrida, ...actualizadas];
    });
  };

  const [mainFolderPath, setMainFolderPath] = useState("");
  const [batchResults, setBatchResults] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const [batchStatusColor, setBatchStatusColor] = useState("#888");

  const [pipelineParams, setPipelineParams] = useState({
    subset_region: "",
    snaphu_tile_rows: 4,
    snaphu_tile_cols: 4,
    snaphu_processors: 4,
    snaphu_row_overlap: 300,
    snaphu_col_overlap: 300,
    snaphu_cost_threshold: 500,
    coherence_threshold: 0.3,
    displacement_max_m: 2.0,
    band_maths_expression: "",
  });

  const handleParamChange = (key, value) => {
    setPipelineParams((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    const cargarConfig = async () => {
      try {
        const config = await obtenerConfig();
        if (config.status === "ok") {
          setOutputDir(config.default_output_dir);
          setMapaOutputDir(config.default_output_dir);
          setStatus("✅ Configuración cargada correctamente");
          setStatusColor("#4caf50");
        } else {
          setStatus("⚠️ No se pudo cargar la configuración automática.");
          setStatusColor("#ff9800");
        }
      } catch (error) {
        setStatus(
          "⚠️ No se pudo cargar la configuración. Verifica que el backend esté activo.",
        );
        setStatusColor("#ff9800");
      }
    };

    const cargarArchivos = async () => {
      try {
        const archivos = await obtenerArchivosDisponibles();
        if (archivos.status === "ok") {
          setArchivosDisponibles(
            archivos.files_by_category || { images: [], output: [] },
          );
        }
      } catch (error) {
        console.error("Error cargando archivos:", error);
      }
    };

    cargarConfig();
    cargarArchivos();
  }, []);

  const processingOptions = [
    { value: "GRAFICO_1.xml", label: "1. Orbit Correction", type: "xml" },
    {
      value: "GRAFICO_2",
      label: "2. Calibration + Interferogram (2a + 2b)",
      type: "xml",
    },
    { value: "GRAFICO_3.xml", label: "3. Terrain Correction", type: "xml" },
    { value: "GRAFICO_4.xml", label: "4. Final Output", type: "xml" },
    {
      value: "SNAPHU_FULL",
      label: "5. Snaphu Pipeline Completo (Export + Unwrap + Import)",
      type: "python",
    },
    {
      value: "PHASE_TO_DISPLACEMENT",
      label: "6. Phase to Displacement",
      type: "python",
    },
    {
      value: "TERRAIN_CORRECTION",
      label: "7. Terrain Correction + Máscara de Coherencia",
      type: "python",
    },
  ];

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (selectedStep === "GRAFICO_2") {
      if (!inputFiles.some((f) => f.name === file.name)) {
        setInputFiles([...inputFiles, file]);
        setStatus(`Archivo agregado: ${file.name}`);
      } else {
        setStatus(`⚠️ Este archivo ya está agregado`);
        setStatusColor("#ff9800");
      }
    } else {
      setInputFile(file);
      setStatus(`Archivo seleccionado: ${file.name}`);
    }
    setStatusColor("#888");
  };

  const handleSelectServerFile = (filename, category = "images") => {
    const filenameWithPath =
      category === "output" ? `output/${filename}` : filename;
    const mockFile = { name: filenameWithPath };
    if (selectedStep === "GRAFICO_2") {
      if (!inputFiles.some((f) => f.name === filenameWithPath)) {
        setInputFiles([...inputFiles, mockFile]);
        setStatus(`Archivo del servidor agregado: ${filename}`);
      } else {
        setStatus(`⚠️ Este archivo ya está agregado`);
        setStatusColor("#ff9800");
      }
    } else {
      setInputFile(mockFile);
      setStatus(`Archivo del servidor seleccionado: ${filename}`);
      setStatusColor("#888");
    }
  };

  const removeIndividualFile = (index) => {
    setInputFiles(inputFiles.filter((_, i) => i !== index));
    setStatus("Archivo removido");
    setStatusColor("#888");
  };

  const handleFlowFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setInputFiles([...inputFiles, file]);
      setStatus(`Archivo agregado: ${file.name}`);
      setStatusColor("#888");
    }
  };

  const removeFlowFile = (index) => {
    setInputFiles(inputFiles.filter((_, i) => i !== index));
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.currentTarget.style.borderColor = "#667eea";
    event.currentTarget.style.backgroundColor = "#f0f0ff";
  };

  const handleDragLeave = (event) => {
    event.currentTarget.style.borderColor = "#ccc";
    event.currentTarget.style.backgroundColor = "#fafafa";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.currentTarget.style.borderColor = "#ccc";
    event.currentTarget.style.backgroundColor = "#fafafa";
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (activeTab === "individual") {
      if (selectedStep === "GRAFICO_2") {
        if (!inputFiles.some((f) => f.name === file.name)) {
          setInputFiles([...inputFiles, file]);
          setStatus(`Archivo agregado: ${file.name}`);
        }
      } else {
        setInputFile(file);
        setStatus(`Archivo seleccionado: ${file.name}`);
      }
    } else {
      setInputFiles([...inputFiles, file]);
      setStatus(`Archivo seleccionado: ${file.name}`);
    }
    setStatusColor("#888");
  };

  const ParamField = ({ label, name, type = "text", hint }) => (
    <div className="form-group" style={{ marginBottom: "8px" }}>
      <label style={{ fontSize: "12px", color: "#555", fontWeight: 600 }}>
        {label}
      </label>
      <input
        type={type}
        value={pipelineParams[name]}
        onChange={(e) =>
          handleParamChange(
            name,
            type === "number"
              ? parseFloat(e.target.value) || 0
              : e.target.value,
          )
        }
        disabled={loading || batchLoading}
        style={{
          width: "100%",
          padding: "6px 8px",
          fontSize: "13px",
          borderRadius: "4px",
          border: "1px solid #ccc",
        }}
      />
      {hint && (
        <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>
          {hint}
        </div>
      )}
    </div>
  );

  const AdvancedParamsPanel = () => (
    <div
      style={{
        background: "#f8f9ff",
        border: "1px solid #d0d8f0",
        borderRadius: "8px",
        padding: "14px",
        marginTop: "14px",
      }}
    >
      <h3
        style={{
          fontSize: "14px",
          marginBottom: "10px",
          color: "#444",
          fontWeight: 700,
        }}
      >
        ⚙️ Parámetros Configurables{" "}
        <span style={{ fontWeight: 400, color: "#777" }}>
          (borra el valor para cambiarlo)
        </span>
      </h3>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}
      >
        <ParamField
          label="Área de interés (POLYGON WKT) *"
          name="subset_region"
          hint="Obligatorio. Ejemplo: POLYGON((-78.7021 -2.744,-78.4572 -2.744,-78.4572 -2.5278,-78.7021 -2.5278,-78.7021 -2.744))"
        />
        <ParamField label="Tile Rows" name="snaphu_tile_rows" type="number" />
        <ParamField label="Tile Cols" name="snaphu_tile_cols" type="number" />
        <ParamField label="Processors" name="snaphu_processors" type="number" />
        <ParamField
          label="Row Overlap"
          name="snaphu_row_overlap"
          type="number"
        />
        <ParamField
          label="Col Overlap"
          name="snaphu_col_overlap"
          type="number"
        />
        <ParamField
          label="Cost Threshold"
          name="snaphu_cost_threshold"
          type="number"
        />
        <ParamField
          label="Coherence Threshold"
          name="coherence_threshold"
          type="number"
        />
        <ParamField
          label="Max Displacement (m)"
          name="displacement_max_m"
          type="number"
        />
      </div>
      <div style={{ marginTop: "10px" }}>
        <label style={{ fontSize: "12px", color: "#555", fontWeight: 600 }}>
          Expresión Band Maths (opcional)
        </label>
        <textarea
          value={pipelineParams.band_maths_expression}
          onChange={(e) =>
            handleParamChange("band_maths_expression", e.target.value)
          }
          placeholder="if Coherencia<=0.3 then 0 else displacement_VV"
          disabled={loading || batchLoading}
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: "12px",
            minHeight: "52px",
            fontFamily: "monospace",
            borderRadius: "4px",
            border: "1px solid #ccc",
          }}
        />
        <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>
          Si lo dejas vacío se usa la expresión automática del backend.
        </div>
      </div>
    </div>
  );

  const handleProcesarGraph = async () => {
    if (selectedStep === "GRAFICO_2") {
      if (inputFiles.length < 2) {
        setStatus("❌ Este paso requiere 2 archivos (master y slave)");
        setStatusColor("#d32f2f");
        return;
      }
    } else if (!inputFile && inputFiles.length === 0) {
      setStatus("❌ Selecciona al menos un archivo de entrada");
      setStatusColor("#d32f2f");
      return;
    }
    if (!outputDir) {
      setStatus("❌ Especifica la carpeta de salida");
      setStatusColor("#d32f2f");
      return;
    }
    if (
      selectedStep === "GRAFICO_4.xml" &&
      !pipelineParams.subset_region.trim()
    ) {
      setStatus(
        "❌ El Gráfico 4 (Subset) requiere el Área de interés (POLYGON WKT) en Parámetros Configurables",
      );
      setStatusColor("#d32f2f");
      return;
    }

    setLoading(true);
    setProgress(0);
    setStatus("⏳ Procesando...");
    setStatusColor("#888");

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? 90 : prev + Math.random() * 12));
    }, 600);

    try {
      let result;
      const inputToSend = inputFile
        ? inputFile.name
        : inputFiles.map((f) => f.name);
      const nuevosPreviews = [];

      if (selectedStep === "GRAFICO_2") {
        const inputNameWithoutExt = soloNombreArchivo(
          inputFiles[0].name,
        ).replace(/\.[^/.]+$/, "");
        const result2a = await procesarGraph(
          "GRAFICO_2a.xml",
          inputFiles.map((f) => f.name),
          `${outputDir}/${inputNameWithoutExt}_2a`,
          pipelineParams,
        );
        if (result2a.preview) nuevosPreviews.push(result2a.preview);
        if (result2a.status !== "ok") {
          result = result2a;
        } else {
          result = await procesarGraph(
            "GRAFICO_2b.xml",
            result2a.output,
            `${outputDir}/${inputNameWithoutExt}_Cal`,
            pipelineParams,
          );
          if (result.preview) nuevosPreviews.push(result.preview);
        }
      } else if (selectedStep.endsWith(".xml")) {
        const inputNameWithoutExt = soloNombreArchivo(
          inputFile ? inputFile.name : inputFiles[0].name,
        ).replace(/\.[^/.]+$/, "");
        result = await procesarGraph(
          selectedStep,
          inputToSend,
          `${outputDir}/${inputNameWithoutExt}`,
          pipelineParams,
        );
        if (result.preview) nuevosPreviews.push(result.preview);
      } else {
        result = await procesarPaso(
          selectedStep,
          inputToSend,
          outputDir,
          pipelineParams,
        );
        if (result.preview) nuevosPreviews.push(result.preview);
      }

      if (nuevosPreviews.length > 0) {
        setIndividualPreviews((prev) => [...prev, ...nuevosPreviews]);
        agregarVisualizaciones(nuevosPreviews, "individual");
      }

      clearInterval(progressInterval);
      setProgress(100);
      if (result.status === "ok") {
        setStatus(`✅ ${selectedStep} completado correctamente`);
        setStatusColor("#4caf50");
      } else {
        setStatus(`❌ Error: ${result.message || "Error desconocido"}`);
        setStatusColor("#d32f2f");
      }
    } catch (error) {
      clearInterval(progressInterval);
      setStatus(`❌ Error: ${error.message}`);
      setStatusColor("#d32f2f");
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 2500);
    }
  };

  const handleProcesarFlujo = async () => {
    if (inputFiles.length < 2) {
      setStatus(
        "❌ El flujo requiere 2 imágenes (master y slave, Δt ≈ 12 días)",
      );
      setStatusColor("#d32f2f");
      return;
    }
    if (!pipelineParams.subset_region.trim()) {
      setStatus(
        "❌ El flujo completo requiere el Área de interés (POLYGON WKT) en Parámetros Configurables (lo necesita el Gráfico 4)",
      );
      setStatusColor("#d32f2f");
      return;
    }
    setLoading(true);
    setProgress(0);
    setFlowPreviews([]);
    setFlowCurrentStep(null);
    const runId = `flujo-${Date.now()}`;
    setStatus("⏳ Procesando flujo completo (4 gráficos + pasos Python)...");
    setStatusColor("#888");
    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 85 ? 85 : prev + Math.random() * 15));
    }, 500);

    const flujoOutputDir = `${outputDir}/completo`;
    let pollActivo = true;
    const pollearProgreso = async () => {
      while (pollActivo) {
        try {
          const prog = await obtenerProgresoFlujo(flujoOutputDir);
          if (prog && Array.isArray(prog.visualizaciones)) {
            setFlowPreviews(prog.visualizaciones);
            actualizarVisualizacionesDeCorrida(
              prog.visualizaciones,
              "flujo",
              runId,
            );
          }
          if (prog && prog.current_step) setFlowCurrentStep(prog.current_step);
          if (prog && (prog.status === "completado" || prog.status === "error"))
            break;
        } catch (pollError) {
          console.warn("Polling de progreso falló (reintentando):", pollError);
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    };
    pollearProgreso();

    try {
      const result = await procesarFlujo(
        inputFiles,
        flujoOutputDir,
        pipelineParams,
      );
      clearInterval(progressInterval);
      setProgress(100);
      setFlowPreviews(result.visualizaciones || []);
      if (result.visualizaciones) {
        actualizarVisualizacionesDeCorrida(
          result.visualizaciones,
          "flujo",
          runId,
        );
      }
      if (result.status === "ok") {
        setStatus(`✅ Flujo completado. Salida: ${result.final_output}`);
        setStatusColor("#4caf50");
      } else {
        setStatus(`❌ Error en paso ${result.step}: ${result.message}`);
        setStatusColor("#d32f2f");
      }
    } catch (error) {
      clearInterval(progressInterval);
      setStatus(`❌ Error: ${error.message}`);
      setStatusColor("#d32f2f");
    } finally {
      pollActivo = false;
      setFlowCurrentStep(null);
      setLoading(false);
      setTimeout(() => setProgress(0), 2000);
    }
  };

  const handleBrowseMainFolder = (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const primeraRutaRelativa = files[0].webkitRelativePath || files[0].name;
    const nombreCarpeta = primeraRutaRelativa.split("/")[0];
    setMainFolderPath(nombreCarpeta);
    setBatchStatus(
      `📁 Carpeta seleccionada: "${nombreCarpeta}". El backend la buscará en sus carpetas conocidas.`,
    );
    setBatchStatusColor("#2196f3");
    event.target.value = "";
  };

  const handleProcesarFlujoBatch = async () => {
    if (!mainFolderPath.trim()) {
      setBatchStatus("❌ Especifica la carpeta principal");
      setBatchStatusColor("#d32f2f");
      return;
    }
    if (!pipelineParams.subset_region.trim()) {
      setBatchStatus(
        "❌ El batch requiere el Área de interés (POLYGON WKT) en Parámetros Configurables (lo necesita el Gráfico 4 en cada par)",
      );
      setBatchStatusColor("#d32f2f");
      return;
    }
    setBatchLoading(true);
    setBatchResults(null);
    setBatchStatus("⏳ Procesando batch (esto puede tardar bastante)...");
    setBatchStatusColor("#888");

    try {
      const result = await procesarFlujoBatch(mainFolderPath, pipelineParams);
      setBatchResults(result);
      setBatchPreviewFolders(
        (result.resultados || []).map((r) => ({
          folder: r.folder,
          status: r.status,
          visualizaciones: r.visualizaciones || [],
        })),
      );

      // La salida real del batch queda dentro de main_folder (una
      // subcarpeta AAAAMMDD_AAAAMMDD por par). Apuntamos el mapa ahí
      // en vez de dejarlo en el output por defecto del backend.
      if (result.main_folder) {
        setMapaOutputDir(result.main_folder);
      }

      if (result.status === "ok") {
        setBatchStatus(
          `✅ Batch completado: ${result.exitosos}/${result.total_pares} pares exitosos`,
        );
        setBatchStatusColor("#4caf50");
      } else if (result.status === "partial") {
        setBatchStatus(
          `⚠️ Batch terminado con errores: ${result.exitosos} exitosas, ${result.fallidos} fallidas de ${result.total_pares}`,
        );
        setBatchStatusColor("#ff9800");
      } else {
        setBatchStatus(`❌ Error: ${result.message || "Error desconocido"}`);
        setBatchStatusColor("#d32f2f");
      }
    } catch (error) {
      setBatchStatus(`❌ Error: ${error.message}`);
      setBatchStatusColor("#d32f2f");
    } finally {
      setBatchLoading(false);
    }
  };

  const etiquetaPar = (index) => {
    if (index === 0) return "① Master";
    if (index === 1) return "② Slave";
    return `${index + 1}.`;
  };

  return (
    <div className="processor-container">
      <div className="sidebar">
        <div className="logo">🛰️ SNAP</div>
        <nav className="menu">
          <div
            className={`menu-item ${activeTab === "individual" ? "active" : ""}`}
            onClick={() => setActiveTab("individual")}
          >
            📊 Gráfico Individual
          </div>
          <div
            className={`menu-item ${activeTab === "flujo" ? "active" : ""}`}
            onClick={() => setActiveTab("flujo")}
          >
            🔄 Flujo Completo
          </div>
          <div
            className={`menu-item ${activeTab === "batch" ? "active" : ""}`}
            onClick={() => setActiveTab("batch")}
          >
            📦 Batch Flujos Completos
          </div>
          <div
            className={`menu-item ${activeTab === "edit-xml" ? "active" : ""}`}
            onClick={() => setActiveTab("edit-xml")}
          >
            📝 Editar Graph XML
          </div>
          <div
            className={`menu-item ${activeTab === "mapa" ? "active" : ""}`}
            onClick={() => setActiveTab("mapa")}
          >
            🗺️ Mapa geoespacial
          </div>
          <div
            className={`menu-item ${activeTab === "visualizador" ? "active" : ""}`}
            onClick={() => setActiveTab("visualizador")}
          >
            🖼️ Visualizador
          </div>
        </nav>
        <div className="sidebar-footer">
          <a href="#settings">⚙️ Settings</a>
          <a href="#help">❓ Help</a>
        </div>
      </div>

      <div className="main-container">
        <div className="header">
          <h1>PROCESAMIENTO DE IMÁGENES SATELITALES</h1>
        </div>

        <div className="content">
          {/* ===== INDIVIDUAL ===== */}
          {activeTab === "individual" && (
            <>
              <div className="content-row">
                <div className="upload-section">
                  <div
                    className="drop-zone"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className="drop-icon">📁</div>
                    {selectedStep === "GRAFICO_2" ? (
                      <>
                        <p className="drop-title">
                          Par interferométrico (2 imágenes)
                        </p>
                        <p className="drop-hint">
                          1ª = Master (día base) · 2ª = Slave (+12 días)
                        </p>
                      </>
                    ) : (
                      <p>Arrastra aquí tu archivo .zip o .dim</p>
                    )}
                    <label className="file-input-label">
                      {selectedStep === "GRAFICO_2"
                        ? "AGREGAR IMAGEN"
                        : "BROWSER FILE"}
                      <input
                        type="file"
                        onChange={handleFileSelect}
                        accept=".zip,.dim"
                        style={{ display: "none" }}
                      />
                    </label>
                    {inputFile && (
                      <p className="file-name">✓ {inputFile.name}</p>
                    )}
                  </div>
                </div>

                <div className="control-panel">
                  <h2>Configuración</h2>
                  <div className="form-group">
                    <label>Selecciona un Paso:</label>
                    <select
                      value={selectedStep}
                      onChange={(e) => {
                        setSelectedStep(e.target.value);
                        setInputFile(null);
                        setInputFiles([]);
                      }}
                      disabled={loading}
                    >
                      {processingOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedStep === "GRAFICO_2" && (
                    <div className="files-list">
                      <label>Imágenes del par:</label>
                      <div className="file-items">
                        {inputFiles.map((file, index) => (
                          <div key={index} className="file-item">
                            <span>
                              {etiquetaPar(index)}: {file.name}
                            </span>
                            <button
                              className="remove-btn"
                              onClick={() => removeIndividualFile(index)}
                              disabled={loading}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      {inputFiles.length < 2 && (
                        <p className="flow-note">
                          Falta la{" "}
                          {inputFiles.length === 0
                            ? "1ª imagen (Master)"
                            : "2ª imagen (Slave)"}
                          .
                        </p>
                      )}
                      {inputFiles.length >= 2 && (
                        <p className="flow-note" style={{ color: "#2e7d32" }}>
                          Par completo: listo para procesar.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="form-group">
                    <label>Carpeta de Salida:</label>
                    <input
                      type="text"
                      value={outputDir}
                      onChange={(e) => setOutputDir(e.target.value)}
                      placeholder="C:\output"
                      disabled={loading}
                    />
                  </div>

                  <AdvancedParamsPanel />

                  {(archivosDisponibles.images?.length > 0 ||
                    archivosDisponibles.output?.length > 0) && (
                    <div className="available-files">
                      <label>📁 Archivos en el servidor:</label>
                      <div className="files-dropdown">
                        {archivosDisponibles.images?.length > 0 && (
                          <>
                            <div className="file-category-header">
                              📥 Entrada (images)
                            </div>
                            {archivosDisponibles.images.map((archivo, idx) => (
                              <div key={`img-${idx}`} className="file-option">
                                <button
                                  className="file-select-btn"
                                  onClick={() =>
                                    handleSelectServerFile(archivo, "images")
                                  }
                                  disabled={loading}
                                >
                                  📄 {archivo}
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                        {archivosDisponibles.output?.length > 0 && (
                          <>
                            <div className="file-category-header">
                              📤 Salida procesada (output)
                            </div>
                            {archivosDisponibles.output.map((archivo, idx) => (
                              <div key={`out-${idx}`} className="file-option">
                                <button
                                  className="file-select-btn file-select-btn-output"
                                  onClick={() =>
                                    handleSelectServerFile(archivo, "output")
                                  }
                                  disabled={loading}
                                >
                                  📄 {archivo}
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    className="process-button"
                    onClick={handleProcesarGraph}
                    disabled={loading}
                  >
                    {loading ? "Procesando..." : "PROCESAR GRÁFICO"}
                  </button>

                  {progress > 0 && (
                    <div className="progress-container">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="progress-text">{Math.round(progress)}%</p>
                    </div>
                  )}
                  {status && (
                    <div
                      className="status-box"
                      style={{ borderLeftColor: statusColor }}
                    >
                      <p>{status}</p>
                    </div>
                  )}
                </div>
              </div>

              {individualPreviews.length > 0 && (
                <div className="control-panel control-panel-full">
                  <div className="preview-header">
                    <h2 style={{ margin: 0 }}>Previews de este gráfico</h2>
                    <button
                      className="link-btn"
                      onClick={() => setIndividualPreviews([])}
                    >
                      Limpiar
                    </button>
                  </div>
                  <PreviewGallery items={individualPreviews} title="" />
                  <p className="flow-note" style={{ marginTop: "10px" }}>
                    Los productos también quedan disponibles en 🗺️ Mapa
                    geoespacial para comparar. Para paletas de color usa 🖼️
                    Visualizador.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ===== FLUJO ===== */}
          {activeTab === "flujo" && (
            <>
              <div className="content-row">
                <div className="upload-section">
                  <div
                    className="drop-zone"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className="drop-icon">📁</div>
                    <p className="drop-title">
                      Par interferométrico (2 imágenes Sentinel-1)
                    </p>
                    <p className="drop-hint">
                      Agrega primero la Master (día base) y luego la Slave (+12
                      días exactos)
                    </p>
                    <label className="file-input-label">
                      AGREGAR IMAGEN
                      <input
                        type="file"
                        onChange={handleFlowFileSelect}
                        accept=".zip,.dim"
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                </div>

                <div className="control-panel">
                  <h2>Flujo Completo</h2>

                  <div className="files-list">
                    <label>Imágenes del par:</label>
                    <div className="file-items">
                      {inputFiles.map((file, index) => (
                        <div key={index} className="file-item">
                          <span>
                            {etiquetaPar(index)}: {file.name}
                          </span>
                          <button
                            className="remove-btn"
                            onClick={() => removeFlowFile(index)}
                            disabled={loading}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    {inputFiles.length === 0 && (
                      <p className="flow-note">
                        Aún no hay imágenes. Agrega la 1ª (Master).
                      </p>
                    )}
                    {inputFiles.length === 1 && (
                      <p className="flow-note">
                        Falta la 2ª imagen (Slave, +12 días).
                      </p>
                    )}
                    {inputFiles.length >= 2 && (
                      <p className="flow-note" style={{ color: "#2e7d32" }}>
                        Par completo: listo para procesar.
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Carpeta de Salida:</label>
                    <input
                      type="text"
                      value={outputDir}
                      onChange={(e) => setOutputDir(e.target.value)}
                      placeholder="C:\output"
                      disabled={loading}
                    />
                  </div>

                  <AdvancedParamsPanel />

                  <div className="flow-info">
                    <h3>Secuencia de Procesamiento:</h3>
                    <ul>
                      <li>📍 Gráfico 1: Orbit Correction</li>
                      <li>📍 Gráfico 2: Calibration (interferometry)</li>
                      <li>📍 Gráfico 3: Terrain Correction</li>
                      <li>📍 Gráfico 4: Subset</li>
                      <li>📍 Paso 5: Snaphu Export / Unwrap / Import</li>
                      <li>📍 Paso 6: Phase to Displacement</li>
                      <li>📍 Paso 7: Terrain Correction + Máscara</li>
                    </ul>
                    <p className="flow-note">
                      La salida de cada paso será la entrada del siguiente.
                    </p>
                  </div>

                  <button
                    className="process-button"
                    onClick={handleProcesarFlujo}
                    disabled={loading || inputFiles.length < 2}
                  >
                    {loading
                      ? "Procesando flujo..."
                      : "PROCESAR FLUJO COMPLETO"}
                  </button>

                  {progress > 0 && (
                    <div className="progress-container">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="progress-text">{Math.round(progress)}%</p>
                    </div>
                  )}
                  {loading && flowCurrentStep && (
                    <p className="current-step">
                      🔄 Ejecutando: {flowCurrentStep}
                    </p>
                  )}
                  {status && (
                    <div
                      className="status-box"
                      style={{ borderLeftColor: statusColor }}
                    >
                      <p>{status}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="control-panel control-panel-full">
                <PreviewGallery
                  items={flowPreviews}
                  title="Previews del flujo completo (pasos 1-7)"
                />
                {flowPreviews.length === 0 && (
                  <p className="flow-note">
                    Los previews aparecerán aquí al terminar cada paso. Para
                    comparar pares en el mapa usa 🗺️ Mapa geoespacial; para
                    paletas de color, 🖼️ Visualizador.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ===== BATCH ===== */}
          {activeTab === "batch" && (
            <div className="content-row">
              <div
                className="control-panel"
                style={{ width: "100%", maxWidth: "520px" }}
              >
                <h2>Batch de Flujos Completos</h2>
                <p className="flow-note">
                  Sube una carpeta con todas tus imágenes; los pares se arman
                  automáticamente comparando fechas (Δt = 12 días):
                </p>
                <pre className="batch-tree">
                  {`Carpeta_main/
  Img1.zip
  Img2.zip
  Img3.zip
  ...
  ImgN.zip

→ genera automáticamente:
  Carpeta_main/AAAAMMDD_AAAAMMDD/  (por cada par válido)`}
                </pre>

                <div className="form-group">
                  <label>Carpeta Principal (ruta en el servidor):</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      value={mainFolderPath}
                      onChange={(e) => setMainFolderPath(e.target.value)}
                      placeholder="/home/nahin/.../Carpeta_main"
                      disabled={batchLoading}
                      style={{ flex: 1 }}
                    />
                    <label className="browse-btn">
                      📁 BROWSE
                      <input
                        type="file"
                        webkitdirectory="true"
                        directory=""
                        multiple
                        onChange={handleBrowseMainFolder}
                        disabled={batchLoading}
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                </div>

                <AdvancedParamsPanel />

                <button
                  className="process-button"
                  onClick={handleProcesarFlujoBatch}
                  disabled={batchLoading || !mainFolderPath.trim()}
                >
                  {batchLoading
                    ? "Procesando batch..."
                    : "PROCESAR BATCH COMPLETO"}
                </button>

                {batchStatus && (
                  <div
                    className="status-box"
                    style={{ borderLeftColor: batchStatusColor }}
                  >
                    <p>{batchStatus}</p>
                  </div>
                )}

                {batchResults && Array.isArray(batchResults.resultados) && (
                  <div className="files-list" style={{ marginTop: "16px" }}>
                    <label>
                      Resultado ({batchResults.exitosos} ok /{" "}
                      {batchResults.fallidos} error de{" "}
                      {batchResults.total_pares}):
                    </label>
                    <div className="file-items">
                      {batchResults.resultados.map((r, idx) => (
                        <div
                          key={idx}
                          className="file-item"
                          style={{
                            borderLeft: `4px solid ${r.status === "ok" ? "#4caf50" : "#d32f2f"}`,
                            paddingLeft: "8px",
                            flexDirection: "column",
                            alignItems: "flex-start",
                          }}
                        >
                          <span>
                            {r.status === "ok" ? "✅" : "❌"}{" "}
                            <strong>{r.folder}</strong>
                          </span>
                          <span style={{ fontSize: "12px", color: "#666" }}>
                            {r.status === "ok"
                              ? r.final_output
                              : `Paso ${r.step || "?"}: ${r.message}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <BatchPreviewGallery folders={batchPreviewFolders} />
              </div>
            </div>
          )}

          {activeTab === "edit-xml" && <GraphEditor />}

          {/* ===== MAPA GEOESPACIAL (comparar / cargar disco) ===== */}
          {activeTab === "mapa" && (
            <MapaVisualizador
              items={todasLasVisualizaciones}
              title="Mapa geoespacial — comparar y cargar resultados"
              outputDir={mapaOutputDir}
              onAddItems={(nuevos) => agregarVisualizaciones(nuevos, "disco")}
            />
          )}

          {/* ===== VISUALIZADOR CLÁSICO (colores, zoom, etc.) ===== */}
          {activeTab === "visualizador" && <Visualizador />}
        </div>
      </div>
    </div>
  );
};

export default ProcessorUI;
