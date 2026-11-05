import React, { useState, useEffect } from "react";
import {
  procesarGraph,
  procesarFlujo,
  procesarFlujoBatch,
  obtenerConfig,
  obtenerArchivosDisponibles,
  procesarPaso,
  obtenerProgresoFlujo,
  crearCarpetaSalida,
  leerGraphXML,
  guardarGraphXML,
  subirImagen,
  listarGraphs,
  listarProyectos,
  crearProyecto,
} from "../api";
import "./ProcessorUI.css";
import GraphEditor from "./GraphEditor";
import GraphWorkflowEditor from "./GraphWorkflowEditor";
import MapaVisualizador from "./MapaVisualizador";
import SelectorProyecto from "./SelectorProyecto";
import { PreviewGallery, BatchPreviewGallery } from "./PreviewGallery";

// Vista antigua "Editar Graph XML" (GraphEditor). Desactivada: el editor de grafos
// de cada pestaña la reemplaza. Poner en true para volver a mostrarla.
const MOSTRAR_EDITOR_XML_ANTIGUO = false;

const soloNombreArchivo = (ruta) => ruta.split("/").pop();

// Última elección de proyecto/órbita (comodidad por navegador; puede fallar en modo privado).
const leerPreferencia = (clave, porDefecto) => {
  try {
    return window.localStorage.getItem(clave) ?? porDefecto;
  } catch {
    return porDefecto;
  }
};
const guardarPreferencia = (clave, valor) => {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
};

// Grafos XML estándar del flujo (viven en backend/files/). Cualquier otro .xml
// que haya en esa carpeta (los que se guardan desde el editor) se lista como personalizado.
const GRAFOS_ESTANDAR = [
  { value: "GRAFICO_1.xml", label: "1. Orbit Correction" },
  { value: "GRAFICO_2a.xml", label: "2a. Back-Geocoding" },
  { value: "GRAFICO_2b.xml", label: "2b. Interferogram" },
  { value: "GRAFICO_3.xml", label: "3. Terrain Correction" },
  { value: "GRAFICO_4.xml", label: "4. Final Output (Subset)" },
];

// Plantillas de los pasos 5-7: las cargan los scripts de Scripts_Automatizacion_Snaphu
// (el unwrapping 5b lo hace el binario snaphu, no tiene grafo). No se ejecutan sueltas.
const GRAFOS_PASOS_PYTHON = [
  { value: "GRAFICO_5a_SnaphuExport.xml", label: "5a. Snaphu Export" },
  { value: "GRAFICO_5c_SnaphuImport.xml", label: "5c. Snaphu Import" },
  { value: "GRAFICO_6_PhaseToDisplacement.xml", label: "6. Phase to Displacement" },
  { value: "GRAFICO_7a_TC_Subset.xml", label: "7a. Terrain Correction (Subset)" },
  { value: "GRAFICO_7b_TC_Displacement.xml", label: "7b. Terrain Correction (Displacement)" },
  { value: "GRAFICO_7c_Collocate.xml", label: "7c. Collocate (Stack)" },
  { value: "GRAFICO_7d_BandMaths_Mask.xml", label: "7d. Band Maths (máscara de coherencia)" },
];
const GRAFOS_CONOCIDOS = [...GRAFOS_ESTANDAR, ...GRAFOS_PASOS_PYTHON];

// Grafos que leen /procesar_flujo y el batch (nombres fijos en el backend): el editor
// atenúa los demás en esas pestañas porque editarlos no cambia el flujo.
const GRAFOS_DEL_FLUJO = GRAFOS_CONOCIDOS.map((g) => g.value);

// Grafo elegido en el editor -> opción de "Selecciona un Paso" (pestaña Individual)
const pasoParaGrafo = (nombre) => {
  if (/^GRAFICO_2[ab]\.xml$/.test(nombre)) return "GRAFICO_2";
  if (nombre.startsWith("GRAFICO_5")) return "SNAPHU_FULL";
  if (nombre.startsWith("GRAFICO_6")) return "PHASE_TO_DISPLACEMENT";
  if (nombre.startsWith("GRAFICO_7")) return "TERRAIN_CORRECTION";
  return nombre;
};

const ProcessorUI = () => {
  const [activeTab, setActiveTab] = useState("individual");
  // Carpeta raíz de resultados (backend/files/output, viene de /config).
  const [outputDir, setOutputDir] = useState("");
  // Proyecto = carpeta dentro de output/ con Ascendente/ y Descendente/.
  const [proyectos, setProyectos] = useState([]);
  const [proyecto, setProyectoState] = useState(() => leerPreferencia("snap.proyecto", ""));
  const [orbita, setOrbitaState] = useState(() => leerPreferencia("snap.orbita", "Ascendente"));
  const setProyecto = (v) => {
    setProyectoState(v);
    guardarPreferencia("snap.proyecto", v);
  };
  const setOrbita = (v) => {
    setOrbitaState(v);
    guardarPreferencia("snap.orbita", v);
  };
  const refrescarProyectos = async () => {
    try {
      const data = await listarProyectos();
      setProyectos(data.proyectos || []);
      if (data.output_dir) setOutputDir((prev) => prev || data.output_dir);
      // Si el proyecto recordado ya no existe en disco, se vuelve a "sin proyecto".
      setProyectoState((prev) =>
        prev && !(data.proyectos || []).some((p) => p.nombre === prev) ? "" : prev,
      );
    } catch (error) {
      console.error("Error listando proyectos:", error);
    }
  };
  const handleCrearProyecto = async (nombre) => {
    const data = await crearProyecto(nombre);
    setProyectos(data.proyectos || []);
    setProyecto(data.nombre);
    return data.nombre;
  };
  const destino = { proyecto, orbita };
  const carpetaDestino = proyecto
    ? proyectos.find((p) => p.nombre === proyecto)?.orbitas?.[orbita]?.ruta ||
      `${outputDir}/${proyecto}/${orbita}`
    : outputDir;
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
  const [graphFiles, setGraphFiles] = useState(
    GRAFOS_ESTANDAR.map((g) => g.value),
  );
  const refrescarGraphs = async () => {
    try {
      const { graphs } = await listarGraphs();
      if (graphs.length > 0) setGraphFiles(graphs);
    } catch (error) {
      console.error("Error listando graphs:", error);
    }
  };

  // Orden: grafos estándar (1-4), plantillas de los pasos 5-7 y, al final, los XML
  // personalizados por nombre.
  const graphOptions = [
    ...GRAFOS_ESTANDAR.filter((g) => graphFiles.includes(g.value)).map((g) => ({ ...g, group: "Pasos 1–4" })),
    ...GRAFOS_PASOS_PYTHON.filter((g) => graphFiles.includes(g.value)).map((g) => ({ ...g, group: "Pasos 5–7" })),
    ...graphFiles
      .filter((n) => !GRAFOS_CONOCIDOS.some((g) => g.value === n))
      .map((n) => ({ value: n, label: n, group: "Personalizados" })),
  ];
  const guardarGrafo = async (nombre, contenido) => {
    await guardarGraphXML(nombre, contenido);
    refrescarGraphs();
  };

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

  const cargarArchivos = async () => {
    try {
      const archivos = await obtenerArchivosDisponibles();
      if (archivos.status === "ok") {
        setArchivosDisponibles(archivos.files_by_category || {});
      }
    } catch (error) {
      console.error("Error cargando archivos:", error);
    }
  };

  // Nombres tal como los resuelve el backend: imágenes sueltas en files/images
  // y productos de files/output (prefijo "output/").
  const serverFileNames = [
    ...(archivosDisponibles.input?.sueltos || []),
    ...(archivosDisponibles.output?.sueltos || []).map((n) => `output/${n}`),
  ];

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

    cargarConfig();
    cargarArchivos();
    refrescarGraphs();
    refrescarProyectos();
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
    ...graphOptions
      .filter(
        (g) =>
          g.value.toLowerCase().endsWith(".xml") &&
          !GRAFOS_CONOCIDOS.some((e) => e.value === g.value),
      )
      .map((g) => ({ value: g.value, label: `XML: ${g.value}`, type: "xml" })),
  ];

  const handleProcesarGraph = async (filesIn = []) => {
    if (selectedStep === "GRAFICO_2") {
      if (filesIn.length < 2) {
        setStatus("❌ Este paso requiere 2 archivos (master y slave)");
        setStatusColor("#d32f2f");
        return;
      }
    } else if (filesIn.length === 0) {
      setStatus("❌ Selecciona al menos un archivo de entrada");
      setStatusColor("#d32f2f");
      return;
    }
    if (!carpetaDestino) {
      setStatus("❌ No se conoce la carpeta de salida (¿backend activo?)");
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
      const inputToSend =
        filesIn.length === 1 ? filesIn[0].name : filesIn.map((f) => f.name);
      const nuevosPreviews = [];

      if (selectedStep === "GRAFICO_2") {
        const inputNameWithoutExt = soloNombreArchivo(
          filesIn[0].name,
        ).replace(/\.[^/.]+$/, "");
        const result2a = await procesarGraph(
          "GRAFICO_2a.xml",
          filesIn.map((f) => f.name),
          `${carpetaDestino}/${inputNameWithoutExt}_2a`,
        );
        if (result2a.preview) nuevosPreviews.push(result2a.preview);
        if (result2a.status !== "ok") {
          result = result2a;
        } else {
          result = await procesarGraph(
            "GRAFICO_2b.xml",
            result2a.output,
            `${carpetaDestino}/${inputNameWithoutExt}_Cal`,
            );
          if (result.preview) nuevosPreviews.push(result.preview);
        }
      } else if (selectedStep.endsWith(".xml")) {
        const inputNameWithoutExt = soloNombreArchivo(
          filesIn[0].name,
        ).replace(/\.[^/.]+$/, "");
        result = await procesarGraph(
          selectedStep,
          inputToSend,
          `${carpetaDestino}/${inputNameWithoutExt}`,
        );
        if (result.preview) nuevosPreviews.push(result.preview);
      } else {
        result = await procesarPaso(
          selectedStep,
          inputToSend,
          carpetaDestino,
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
      refrescarProyectos();
      setTimeout(() => setProgress(0), 2500);
    }
  };

  const handleProcesarFlujo = async (filesIn = []) => {
    if (filesIn.length < 2) {
      setStatus(
        "❌ El flujo requiere 2 imágenes (master y slave, Δt ≈ 12 días)",
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

    let pollActivo = true;
    try {
      // Carpeta definitiva de esta corrida (nombre por fechas); se pide antes
      // para poder consultar su progreso.json mientras el flujo corre.
      const flujoOutputDir = await crearCarpetaSalida(
        filesIn,
        outputDir,
        "completo",
        destino,
      );

      const pollearProgreso = async () => {
        while (pollActivo) {
          try {
            const prog = await obtenerProgresoFlujo(flujoOutputDir);
            if (!pollActivo) break;
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

      const result = await procesarFlujo(filesIn, flujoOutputDir);
      pollActivo = false;
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
        const n = (result.visualizaciones || []).filter(
          (v) => v.status === "ok",
        ).length;
        setStatus(
          `❌ Error${result.step ? ` en paso ${result.step}` : ""}: ${
            result.message || "error desconocido"
          }${n ? ` (se conservan ${n} preview(s) de los pasos anteriores)` : ""}`,
        );
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
      refrescarProyectos();
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
      const result = await procesarFlujoBatch(mainFolderPath, {}, 12, destino);
      setBatchResults(result);
      setBatchPreviewFolders(
        (result.resultados || []).map((r) => ({
          folder: r.folder,
          status: r.status,
          visualizaciones: r.visualizaciones || [],
        })),
      );

      // La salida del batch queda en output/[<proyecto>/<órbita>/] con una
      // subcarpeta AAAAMMDD_AAAAMMDD por par. Apuntamos el mapa ahí.
      if (result.output_base || result.main_folder) {
        setMapaOutputDir(result.output_base || result.main_folder);
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
      refrescarProyectos();
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
          {MOSTRAR_EDITOR_XML_ANTIGUO && (
            <div
              className={`menu-item ${activeTab === "edit-xml" ? "active" : ""}`}
              onClick={() => setActiveTab("edit-xml")}
            >
              📝 Editar Graph XML
            </div>
          )}
          <div
            className={`menu-item ${activeTab === "mapa" ? "active" : ""}`}
            onClick={() => setActiveTab("mapa")}
          >
            🗺️ Mapa y visualizador
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
                <div style={{ width: "100%" }}>
                  <GraphWorkflowEditor
                    workflowType="individual"
                    graphOptions={graphOptions}
                    onGraphChange={(nombre) => !loading && setSelectedStep(pasoParaGrafo(nombre))}
                    loadGraph={leerGraphXML}
                    onSave={guardarGrafo}
                    uploadFile={subirImagen}
                    serverFiles={serverFileNames}
                    minFiles={selectedStep === "GRAFICO_2" ? 2 : 1}
                    maxFiles={selectedStep === "GRAFICO_2" ? 2 : 1}
                    pairLabels={selectedStep === "GRAFICO_2"}
                    executing={loading}
                    executeLabel="Procesar gráfico"
                    onExecute={(xml, files) =>
                      handleProcesarGraph(files.map((f) => ({ name: f.serverName })))
                    }
                    step2Extra={
                      <div className="control-panel control-panel-full">
                        <h2>Configuración</h2>
                        <div className="form-group">
                          <label>Selecciona un Paso:</label>
                          <select
                            value={selectedStep}
                            onChange={(e) => setSelectedStep(e.target.value)}
                            disabled={loading}
                          >
                            {processingOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
<SelectorProyecto
                          proyectos={proyectos}
                          proyecto={proyecto}
                          orbita={orbita}
                          onProyecto={setProyecto}
                          onOrbita={setOrbita}
                          onCrear={handleCrearProyecto}
                          onRefrescar={refrescarProyectos}
                          carpetaDestino={carpetaDestino}
                          outputRoot={outputDir}
                          disabled={loading}
                        />
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
                    }
                  />
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
                    Los productos también quedan disponibles en 🗺️ Mapa y
                    visualizador para comparar y ajustar paletas de color.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ===== FLUJO ===== */}
          {activeTab === "flujo" && (
            <>
              <div className="content-row">
                <div style={{ width: "100%" }}>
                  <GraphWorkflowEditor
                    workflowType="flujo"
                    graphOptions={graphOptions}
                    usedGraphs={GRAFOS_DEL_FLUJO}
                    loadGraph={leerGraphXML}
                    onSave={guardarGrafo}
                    uploadFile={subirImagen}
                    serverFiles={serverFileNames}
                    minFiles={2}
                    maxFiles={2}
                    pairLabels
                    executing={loading}
                    executeLabel="Procesar flujo completo"
                    onExecute={(xml, files) =>
                      handleProcesarFlujo(files.map((f) => ({ name: f.serverName })))
                    }
                    step2Extra={
                      <div className="control-panel control-panel-full">
                        <h2>Flujo Completo</h2>
<SelectorProyecto
                          proyectos={proyectos}
                          proyecto={proyecto}
                          orbita={orbita}
                          onProyecto={setProyecto}
                          onOrbita={setOrbita}
                          onCrear={handleCrearProyecto}
                          onRefrescar={refrescarProyectos}
                          carpetaDestino={carpetaDestino}
                          outputRoot={outputDir}
                          disabled={loading}
                        />
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
                    }
                  />
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
                    comparar pares o ajustar paletas de color usa 🗺️ Mapa y
                    visualizador.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ===== BATCH ===== */}
          {activeTab === "batch" && (
            <div className="content-row">
              <div style={{ width: "100%" }}>
                <GraphWorkflowEditor
                  workflowType="batch"
                  graphOptions={graphOptions}
                  usedGraphs={GRAFOS_DEL_FLUJO}
                  loadGraph={leerGraphXML}
                  onSave={guardarGrafo}
                  fileMode="none"
                  executing={batchLoading}
                  executeDisabled={!mainFolderPath.trim()}
                  executeLabel="Procesar batch completo"
                  onExecute={() => handleProcesarFlujoBatch()}
                  step2Extra={
                    <div className="control-panel control-panel-full">
                      <h2>Batch de Flujos Completos</h2>
                      <p className="flow-note">
                        Indica una carpeta con todas tus imágenes; los pares se
                        arman automáticamente comparando fechas (Δt = 12 días):
                      </p>
                      <pre className="batch-tree">
                        {`Carpeta_main/
  Img1.zip
  Img2.zip
  ...
  ImgN.zip

→ genera automáticamente (por cada par válido):
  output/<proyecto>/<órbita>/AAAAMMDD_AAAAMMDD/
  (sin proyecto: output/AAAAMMDD_AAAAMMDD/)`}
                      </pre>

                      <SelectorProyecto
                        proyectos={proyectos}
                        proyecto={proyecto}
                        orbita={orbita}
                        onProyecto={setProyecto}
                        onOrbita={setOrbita}
                        onCrear={handleCrearProyecto}
                        onRefrescar={refrescarProyectos}
                        carpetaDestino={carpetaDestino}
                        outputRoot={outputDir}
                        disabled={batchLoading}
                      />

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


                      {batchStatus && (
                        <div
                          className="status-box"
                          style={{ borderLeftColor: batchStatusColor }}
                        >
                          <p>{batchStatus}</p>
                        </div>
                      )}
                    </div>
                  }
                />

                {batchResults && Array.isArray(batchResults.resultados) && (
                  <div className="control-panel control-panel-full">
                    <div className="files-list">
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
                  </div>
                )}

                <BatchPreviewGallery folders={batchPreviewFolders} />
              </div>
            </div>
          )}

          {MOSTRAR_EDITOR_XML_ANTIGUO && activeTab === "edit-xml" && <GraphEditor />}

          {/* ===== MAPA Y VISUALIZADOR (comparar, cargar disco, abrir imágenes, colores) ===== */}
          {activeTab === "mapa" && (
            <MapaVisualizador
              items={todasLasVisualizaciones}
              title="Mapa y visualizador"
              outputDir={mapaOutputDir}
              onAddItems={(nuevos, origen = "disco") =>
                agregarVisualizaciones(nuevos, origen)
              }
            />
          )}

        </div>
      </div>
    </div>
  );
};

export default ProcessorUI;
