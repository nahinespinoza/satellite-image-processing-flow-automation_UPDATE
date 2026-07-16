import React, { useState, useEffect } from "react";
import {
  procesarGraph,
  procesarFlujo,
  obtenerConfig,
  obtenerArchivosDisponibles,
} from "../api";
import "./ProcessorUI.css";
import GraphEditor from "./GraphEditor";
import Visualizador from "./visualizador";
const soloNombreArchivo = (ruta) => ruta.split("/").pop();

const ProcessorUI = () => {
  const [activeTab, setActiveTab] = useState("individual"); // 'individual' o 'flujo'
  const [inputFile, setInputFile] = useState(null);
  const [inputFiles, setInputFiles] = useState([]); // Para el flujo (múltiples archivos)
  const [graphFile, setGraphFile] = useState("GRAFICO_1.xml");
  const [outputDir, setOutputDir] = useState("");
  const [configLoading, setConfigLoading] = useState(true);
  const [archivosDisponibles, setArchivosDisponibles] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusColor, setStatusColor] = useState("#888");

  // Cargar configuración y archivos disponibles del backend al montar el componente
  useEffect(() => {
    const cargarConfig = async () => {
      try {
        const config = await obtenerConfig();
        if (config.status === "ok") {
          setOutputDir(config.default_output_dir);
          setStatus("✅ Configuración cargada correctamente");
          setStatusColor("#4caf50");
        } else {
          setStatus(
            "⚠️ No se pudo cargar la configuración automática. Especifica la carpeta de salida.",
          );
          setStatusColor("#ff9800");
        }
      } catch (error) {
        setStatus(
          "⚠️ No se pudo cargar la configuración. Verifica que el backend esté activo.",
        );
        setStatusColor("#ff9800");
      } finally {
        setConfigLoading(false);
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

  const graphOptions = [
    { value: "GRAFICO_1.xml", label: "Gráfico 1 - Orbit" },
    { value: "GRAFICO_2.xml", label: "Gráfico 2 - Calibration" },
    { value: "GRAFICO_3.xml", label: "Gráfico 3 - Terrain Correction" },
    { value: "GRAFICO_4.xml", label: "Gráfico 4 - Final Output" },
  ];

  // Manejo de archivos para modo individual
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Los archivos elegidos desde el dropdown del servidor pueden venir
      // con ruta relativa incluida (ej. "output/Grafo 1 - Orbit/archivo.dim"
      // si están dentro de la subcarpeta de un gráfico anterior). Para
      // construir el nombre de SALIDA solo queremos el nombre del archivo,
      // sin arrastrar esa ruta hacia el nuevo archivo.
      // Si GRAFICO_2 está seleccionado, agregar a la lista
      if (graphFile === "GRAFICO_2.xml") {
        // Usar inputFiles para GRAFICO_2 (que requiere 2 archivos)
        if (!inputFiles.includes(file)) {
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
    }
  };

  // Seleccionar archivo del servidor
  const handleSelectServerFile = (filename, category = "images") => {
    // Prefixar con la categoría si está en output
    const filenameWithPath =
      category === "output" ? `output/${filename}` : filename;
    const mockFile = { name: filenameWithPath };

    if (activeTab === "individual") {
      if (graphFile === "GRAFICO_2.xml") {
        // Para GRAFICO_2, agregar a la lista de múltiples archivos
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
    } else {
      setInputFiles([...inputFiles, mockFile]);
      setStatus(`Archivo del servidor agregado: ${filename}`);
      setStatusColor("#888");
    }
  };

  // Remover archivo del GRAFICO_2
  const removeIndividualFile = (index) => {
    const newFiles = inputFiles.filter((_, i) => i !== index);
    setInputFiles(newFiles);
    setStatus(`Archivo removido`);
    setStatusColor("#888");
  };

  // Manejo de archivos para flujo (múltiples)
  const handleFlowFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setInputFiles([...inputFiles, file]);
      setStatus(`Archivo agregado: ${file.name}`);
      setStatusColor("#888");
    }
  };

  // Remover archivo del flujo
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
        if (graphFile === "GRAFICO_2.xml") {
          // Para GRAFICO_2, agregar a la lista
          if (!inputFiles.includes(file)) {
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

  const handleProcesarGraph = async () => {
    // Para GRAFICO_2, verificar que haya 2 archivos
    if (graphFile === "GRAFICO_2.xml") {
      if (inputFiles.length < 2) {
        setStatus(
          "❌ GRAFICO_2 requiere 2 archivos (archivo actual + segundo archivo para interferometría)",
        );
        setStatusColor("#d32f2f");
        return;
      }
    } else {
      // Para otros gráficos, verificar que haya al menos un archivo
      if (!inputFile) {
        setStatus("❌ Selecciona un archivo primero");
        setStatusColor("#d32f2f");
        return;
      }
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

    // Simular progreso
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 45) {
          clearInterval(progressInterval);
          return 45;
        }
        return prev + Math.random() * 20;
      });
    }, 500);

    try {
      let inputFileName,
        inputNameWithoutExt,
        outputFileName,
        outputFilePath,
        result;

      if (graphFile === "GRAFICO_2.xml" && inputFiles.length > 0) {
        // GRAFICO_2 se dividió en dos sub-grafos porque GRAFICO_2.xml no
        // funcionaba ejecutado como uno solo: 2a (Back-Geocoding + ESD,
        // requiere los 2 archivos) y 2b (Interferogram + Deburst, requiere
        // solo la salida de 2a).

        inputFileName = soloNombreArchivo(inputFiles[0].name);
        inputNameWithoutExt =
          inputFileName.substring(0, inputFileName.lastIndexOf(".")) ||
          inputFileName;

        // Paso 2a: usa los dos archivos de entrada
        const outputFilePath2a = `${outputDir}/${inputNameWithoutExt}_2a`;
        const result2a = await procesarGraph(
          "GRAFICO_2a.xml",
          inputFiles.map((f) => f.name),
          outputFilePath2a,
        );

        if (result2a.status !== "ok") {
          result = result2a; // se reporta el error del paso 2a más abajo
        } else {
          // Paso 2b: usa como único input la salida de 2a
          outputFileName = `${inputNameWithoutExt}_Cal`;
          outputFilePath = `${outputDir}/${outputFileName}`;
          result = await procesarGraph(
            "GRAFICO_2b.xml",
            result2a.output,
            outputFilePath,
          );
        }
      } else {
        // Para otros gráficos, un solo archivo
        inputFileName = soloNombreArchivo(inputFile.name);
        inputNameWithoutExt =
          inputFileName.substring(0, inputFileName.lastIndexOf(".")) ||
          inputFileName;
        outputFileName = `${inputNameWithoutExt}_Orb`;
        outputFilePath = `${outputDir}/${outputFileName}`;

        result = await procesarGraph(graphFile, inputFile.name, outputFilePath);
      }

      clearInterval(progressInterval);
      setProgress(100);

      if (result.status === "ok") {
        setStatus(`✅ Procesamiento completado. Salida: ${result.output}`);
        setStatusColor("#4caf50");
      } else {
        setStatus(`❌ Error: ${result.message}`);
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

  const handleProcesarFlujo = async () => {
    if (inputFiles.length === 0) {
      setStatus("❌ Selecciona al menos un archivo primero");
      setStatusColor("#d32f2f");
      return;
    }

    setLoading(true);
    setProgress(0);
    setStatus("⏳ Procesando flujo completo (4 gráficos)...");
    setStatusColor("#888");

    // Simular progreso
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) {
          clearInterval(progressInterval);
          return 85;
        }
        return prev + Math.random() * 15;
      });
    }, 500);

    try {
      // Enviar al backend para procesar el flujo completo
      const result = await procesarFlujo(inputFiles, `${outputDir}/completo`);

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

  return (
    <div className="processor-container">
      {/* Sidebar */}
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

      {/* Main Content */}
      <div className="main-container">
        {/* Header */}
        <div className="header">
          <h1>PROCESAMIENTO DE IMÁGENES SATELITALES</h1>
        </div>

        {/* Content */}
        <div className="content">
          {activeTab === "individual" && (
            <>
              {/* Upload Area - Individual */}
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

              {/* Control Panel - Individual */}
              <div className="control-panel">
                <h2>Configuración</h2>

                <div className="form-group">
                  <label>Selecciona un Gráfico:</label>
                  <select
                    value={graphFile}
                    onChange={(e) => {
                      setGraphFile(e.target.value);
                      // Limpiar archivos cuando cambias de gráfico
                      setInputFile(null);
                      setInputFiles([]);
                    }}
                    disabled={loading}
                  >
                    {graphOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {graphFile === "GRAFICO_2.xml" && inputFiles.length > 0 && (
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

                {graphFile === "GRAFICO_2.xml" && (
                  <div
                    className="form-group"
                    style={{
                      backgroundColor: "#fff3e0",
                      padding: "10px",
                      borderRadius: "6px",
                      border: "1px solid #ffb74d",
                      fontSize: "12px",
                      color: "#e65100",
                    }}
                  >
                    ⚠️ GRAFICO_2 requiere 2 archivos: selecciona o arrastra 2
                    archivos
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
              {/* Upload Area - Flow */}
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

              {/* Control Panel - Flow */}
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

                <div className="flow-info">
                  <h3>Secuencia de Procesamiento:</h3>
                  <ul>
                    <li>📍 Gráfico 1: Orbit Correction</li>
                    <li>📍 Gráfico 2: Calibration (interferometry)</li>
                    <li>📍 Gráfico 3: Terrain Correction</li>
                    <li>📍 Gráfico 4: Final Output</li>
                  </ul>
                  <p className="flow-note">
                    La salida de cada gráfico será la entrada del siguiente.
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
          {activeTab === "edit-xml" && <GraphEditor />}
          {activeTab === "visualizador" && <Visualizador />}
        </div>
      </div>
    </div>
  );
};

export default ProcessorUI;
