import React, { useState, useEffect } from "react";
import {
  procesarGraph,
  procesarFlujo,
  procesarFlujoBatch,
  obtenerConfig,
  obtenerArchivosDisponibles,
  procesarPaso,
} from "../api";
import "./ProcessorUI.css";
import GraphEditor from "./GraphEditor";
import Visualizador from "./visualizador";
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

  // ---- Batch ----
  const [mainFolderPath, setMainFolderPath] = useState("");
  const [batchResults, setBatchResults] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const [batchStatusColor, setBatchStatusColor] = useState("#888");

  // ---- Parámetros configurables (con defaults ya escritos) ----
  const [pipelineParams, setPipelineParams] = useState({
    subset_region: "0,0,24165,4188",
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

  // Cargar configuración y archivos disponibles
  useEffect(() => {
    const cargarConfig = async () => {
      try {
        const config = await obtenerConfig();
        if (config.status === "ok") {
          setOutputDir(config.default_output_dir);
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
    const newFiles = inputFiles.filter((_, i) => i !== index);
    setInputFiles(newFiles);
    setStatus(`Archivo removido`);
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
    const newFiles = inputFiles.filter((_, i) => i !== index);
    setInputFiles(newFiles);
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
    if (file) {
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
    }
  };

  // ==================== PANEL DE PARÁMETROS (reutilizable) ====================
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
          label="Subset (x,y,ancho,alto)"
          name="subset_region"
          hint="Ej: 0,0,24165,4188"
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
        setStatus("❌ Este paso requiere 2 archivos de entrada");
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
        if (result2a.status !== "ok") {
          result = result2a;
        } else {
          result = await procesarGraph(
            "GRAFICO_2b.xml",
            result2a.output,
            `${outputDir}/${inputNameWithoutExt}_Cal`,
            pipelineParams,
          );
        }
      } else if (selectedStep.endsWith(".xml")) {
        const inputNameWithoutExt = soloNombreArchivo(
          inputFile ? inputFile.name : inputFiles[0].name,
        ).replace(/\.[^/.]+$/, "");
        const outputFilePath = `${outputDir}/${inputNameWithoutExt}`;
        result = await procesarGraph(
          selectedStep,
          inputToSend,
          outputFilePath,
          pipelineParams,
        );
      } else {
        // Pasos Python (5,6,7) — ahora envían parámetros
        result = await procesarPaso(
          selectedStep,
          inputToSend,
          outputDir,
          pipelineParams,
        );
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
    if (inputFiles.length === 0) {
      setStatus("❌ Selecciona al menos un archivo primero");
      setStatusColor("#d32f2f");
      return;
    }
    setLoading(true);
    setProgress(0);
    setStatus("⏳ Procesando flujo completo (4 gráficos + pasos Python)...");
    setStatusColor("#888");
    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 85 ? 85 : prev + Math.random() * 15));
    }, 500);

    try {
      // Ahora enviamos los parámetros configurables
      const result = await procesarFlujo(
        inputFiles,
        `${outputDir}/completo`,
        pipelineParams,
      );
      clearInterval(progressInterval);
      setProgress(100);
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
    setBatchLoading(true);
    setBatchResults(null);
    setBatchStatus("⏳ Procesando batch (esto puede tardar bastante)...");
    setBatchStatusColor("#888");

    try {
      // Enviamos parámetros también en batch
      const result = await procesarFlujoBatch(mainFolderPath, pipelineParams);
      setBatchResults(result);
      if (result.status === "ok") {
        setBatchStatus(
          `✅ Batch completado: ${result.exitosos}/${result.total_carpetas} carpetas exitosas`,
        );
        setBatchStatusColor("#4caf50");
      } else if (result.status === "partial") {
        setBatchStatus(
          `⚠️ Batch terminado con errores: ${result.exitosos} exitosas, ${result.fallidos} fallidas de ${result.total_carpetas}`,
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
          {activeTab === "individual" && (
            <>
              <div className="upload-section">
                <div
                  className="drop-zone"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="drop-icon">📁</div>
                  <p>Arrastra aquí tu archivo .zip o .dim</p>
                  <label className="file-input-label">
                    BROWSER FILE
                    <input
                      type="file"
                      onChange={handleFileSelect}
                      accept=".zip,.dim"
                      style={{ display: "none" }}
                    />
                  </label>
                  {inputFile && <p className="file-name">✓ {inputFile.name}</p>}
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

                {selectedStep === "GRAFICO_2" && inputFiles.length > 0 && (
                  <div className="files-list">
                    <label>Archivos agregados:</label>
                    <div className="file-items">
                      {inputFiles.map((file, index) => (
                        <div key={index} className="file-item">
                          <span>📄 {file.name}</span>
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

                {/* PARÁMETROS AVANZADOS (visible en individual para pasos que lo usan) */}
                <AdvancedParamsPanel />

                {(archivosDisponibles.images?.length > 0 ||
                  archivosDisponibles.output?.length > 0) && (
                  <div className="available-files">
                    <label>📁 Archivos en el servidor:</label>
                    <div className="files-dropdown">
                      {archivosDisponibles.images &&
                        archivosDisponibles.images.length > 0 && (
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
                      {archivosDisponibles.output &&
                        archivosDisponibles.output.length > 0 && (
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
                      ></div>
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
            </>
          )}

          {activeTab === "flujo" && (
            <>
              <div className="upload-section">
                <div
                  className="drop-zone"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="drop-icon">📁</div>
                  <p>Arrastra aquí archivos adicionales (.zip o .dim)</p>
                  <label className="file-input-label">
                    AGREGAR ARCHIVO
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
                <h2>Flujo Completo - Archivos de Entrada</h2>
                {inputFiles.length > 0 && (
                  <div className="files-list">
                    <label>Archivos agregados:</label>
                    <div className="file-items">
                      {inputFiles.map((file, index) => (
                        <div key={index} className="file-item">
                          <span>📄 {file.name}</span>
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

                {/* PANEL DE PARÁMETROS EN FLUJO */}
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
                  disabled={loading || inputFiles.length === 0}
                >
                  {loading ? "Procesando flujo..." : "PROCESAR FLUJO COMPLETO"}
                </button>

                {progress > 0 && (
                  <div className="progress-container">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${progress}%` }}
                      ></div>
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
            </>
          )}

          {activeTab === "batch" && (
            <>
              <div className="control-panel">
                <h2>Batch de Flujos Completos</h2>
                <p className="flow-note">
                  Procesa muchas parejas de imágenes de una sola vez. La carpeta
                  principal debe tener una subcarpeta por cada par de imágenes:
                </p>
                <pre
                  style={{
                    background: "#f5f5f5",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    fontSize: "13px",
                    overflowX: "auto",
                  }}
                >
                  {`Carpeta_main/
  Carpeta_0/  -> Img1, Img2
  Carpeta_1/  -> Img1, Img2
  ...
  Carpeta_n/  -> Img1, Img2`}
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
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: 0,
                        padding: "10px 18px",
                        background: batchLoading ? "#a9b4e8" : "#667eea",
                        color: "#fff",
                        borderRadius: "6px",
                        fontWeight: 600,
                        fontSize: "13px",
                        cursor: batchLoading ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                        userSelect: "none",
                      }}
                    >
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

                {/* PANEL DE PARÁMETROS EN BATCH */}
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
                      Resultado por carpeta ({batchResults.exitosos} ok /{" "}
                      {batchResults.fallidos} error de{" "}
                      {batchResults.total_carpetas} totales):
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
              </div>
            </>
          )}

          {activeTab === "edit-xml" && <GraphEditor />}
          {activeTab === "visualizador" && <Visualizador />}
        </div>
      </div>
    </div>
  );
};

export default ProcessorUI;
