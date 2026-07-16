import React, { useState, useEffect, useRef } from "react";
import { obtenerArchivosDisponibles } from "../api";
import "./ProcessorUI.css";

const API_BASE = "http://localhost:5000";

export default function Visualizador() {
  const [outputFiles, setOutputFiles] = useState([]); // array of { name, folder }
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState(null);
  const [isLocalFile, setIsLocalFile] = useState(false);

  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Estado para zoom y pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Estado para paleta de colores
  const [colorPalette, setColorPalette] = useState("viridis");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [showPaletteDropdown, setShowPaletteDropdown] = useState(false);

  const colorPalettes = [
    { name: "Viridis", value: "viridis", colors: ["#440154", "#31688e", "#35b779", "#fde724"] },
    { name: "Plasma", value: "plasma", colors: ["#0d0887", "#7e03a8", "#cc4778", "#f89540", "#f0f921"] },
    { name: "Inferno", value: "inferno", colors: ["#000004", "#420a68", "#932667", "#fca636", "#fcfdbf"] },
    { name: "Magma", value: "magma", colors: ["#000004", "#3b0f70", "#8c2981", "#fcfdbf"] },
    { name: "Escala de Grises", value: "grayscale", colors: ["#000000", "#404040", "#808080", "#c0c0c0", "#ffffff"] },
    { name: "Heat Map", value: "heat", colors: ["#0000ff", "#00ffff", "#ffff00", "#ff8800", "#ff0000"] },
    { name: "Cool", value: "cool", colors: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff"] },
    { name: "Sepia", value: "sepia", colors: ["#1a0000", "#5c2e0f", "#8b5a3c", "#d4a574", "#e8d4b8"] },
  ];

  const selectedPalette = colorPalettes.find(p => p.value === colorPalette) || colorPalettes[0];

  const lastObjectUrlRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const imageContainerRef = useRef(null);
  const imageRef = useRef(null);

  // ================================
  // Helpers
  // ================================
  const isTiff = (name) => /\.tiff?$/i.test(name);
  const extOf = (name) => (name.split(".").pop() || "").toLowerCase();

  const cleanupObjectUrl = () => {
    const last = lastObjectUrlRef.current;
    if (last && typeof last === "string" && last.startsWith("blob:")) {
      URL.revokeObjectURL(last);
    }
    lastObjectUrlRef.current = null;
  };

  useEffect(() => {
    return () => cleanupObjectUrl();
  }, []);

  // ================================
  // Funciones de zoom y pan
  // ================================
  const handleWheel = (e) => {
    if (!imageUrl) return;
    e.preventDefault();
    
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(1, Math.min(zoom + delta, 5));
    setZoom(newZoom);
  };

  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - panX, y: e.clientY - panY });
  };

  const handleMouseMove = (e) => {
    if (!isPanning) return;
    setPanX(e.clientX - panStart.x);
    setPanY(e.clientY - panStart.y);
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const resetZoom = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  const zoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.2, 5));
  };

  const zoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.2, 1));
    if (zoom - 0.2 <= 1) {
      setPanX(0);
      setPanY(0);
    }
  };

  useEffect(() => {
    if (imageContainerRef.current) {
      imageContainerRef.current.addEventListener("wheel", handleWheel, { passive: false });
      return () => {
        imageContainerRef.current?.removeEventListener("wheel", handleWheel);
      };
    }
  }, [imageUrl, zoom]);

  // Resumen de TIFFs por carpeta (input / output)
  const inputTiffFiles = outputFiles.filter((f) => f.folder === "input" && isTiff(f.name));
  const outputTiffFiles = outputFiles.filter((f) => f.folder === "output" && isTiff(f.name));

  // ================================
  // Cargar archivos del backend
  // ================================
  useEffect(() => {
    const loadFiles = async () => {
      try {
        const resp = await obtenerArchivosDisponibles();
        const byCat = resp.files_by_category || {};
        const outFiles = Array.isArray(byCat.output) ? byCat.output.map((n) => ({ name: n, folder: "output" })) : [];
        const inFiles = Array.isArray(byCat.input) ? byCat.input.map((n) => ({ name: n, folder: "input" })) : [];

        const allFiles = [...inFiles, ...outFiles].filter((f) => {
          const ext = extOf(f.name);
          return ["tif", "tiff", "jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext);
        });

        setOutputFiles(allFiles);
      } catch (err) {
        console.warn("No se pudieron cargar archivos del backend:", err);
        setOutputFiles([]);
      }
    };

    loadFiles();
  }, []);

  // ================================
  // Cargar archivo del backend
  // ================================
  // Detectar tipo real leyendo los primeros bytes (PNG, JPG, GIF)
  const detectImageMagic = async (blob) => {
    try {
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png"; // PNG
      if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg"; // JPEG
      if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif"; // GIF
      return null;
    } catch (e) {
      return null;
    }
  };
  const cargarArchivoBackend = async (fileObj) => {
    setLoading(true);
    setError(null);

    cleanupObjectUrl();
    setImageUrl(null);

    let name = null;
    let folder = "output";
    try {
      name = typeof fileObj === "string" ? fileObj : fileObj.name;
      folder = typeof fileObj === "string" ? "output" : fileObj.folder || "output";
      
      // Mapear "input" a "images" para los endpoints del backend
      const backendFolder = folder === "input" ? "images" : folder;
      
      const encoded = encodeURIComponent(name);
      let finalUrl;
      let resp;

      // Para archivos TIFF, intentar primero conversión, luego fallback al archivo directo
      if (isTiff(name)) {
        // Intentar endpoint de conversión
        const convertUrl = `${API_BASE}/convert-image/${backendFolder}/${encoded}?t=${Date.now()}`;
        
        try {
          resp = await fetch(convertUrl);
          
          if (resp.ok) {
            finalUrl = convertUrl;
          } else {
            console.warn(`Conversión TIFF falló (${resp.status}), intentando archivo directo...`);
            // Fallback: usar archivo directo
            finalUrl = `${API_BASE}/files/${backendFolder}/${encoded}?t=${Date.now()}`;
            resp = await fetch(finalUrl);
          }
        } catch (convertError) {
          console.warn('Error en conversión TIFF:', convertError);
          // Fallback: usar archivo directo
          finalUrl = `${API_BASE}/files/${backendFolder}/${encoded}?t=${Date.now()}`;
          resp = await fetch(finalUrl);
        }
      } else {
        // Para otros formatos, usar directamente
        finalUrl = `${API_BASE}/files/${backendFolder}/${encoded}?t=${Date.now()}`;
        resp = await fetch(finalUrl);
      }

      if (!resp.ok) {
        // Si es error 422, probablemente sea un archivo geoespacial complejo
        if (resp.status === 422) {
          try {
            const errorData = await resp.json();
            if (errorData.is_geospatial) {
              throw new Error(
                `📡 Archivo geoespacial complejo (${errorData.file_size_mb}MB)\n\n` +
                `Este archivo TIFF de satélite requiere herramientas especializadas:\n` +
                `• QGIS (software libre GIS)\n` +
                `• ESA SNAP (para datos Sentinel)\n` +
                `• GDAL/OGR\n\n` +
                `El archivo es demasiado complejo para mostrar en navegador web.`
              );
            } else {
              throw new Error(errorData.error || `Error ${resp.status}`);
            }
          } catch (jsonError) {
            throw new Error(`No se pudo convertir TIFF en backend (HTTP ${resp.status})`);
          }
        } else {
          throw new Error(`No se pudo convertir TIFF en backend (HTTP ${resp.status})`);
        }
      }

      const contentType = resp.headers.get("content-type") || "";
      
      // Para TIFF, permitir tanto image/* como application/octet-stream
      if (!contentType.startsWith("image/") && 
          !(isTiff(name) && contentType.includes("octet-stream"))) {
        const preview = await resp.text().catch(() => "");
        throw new Error(
          `La respuesta no es una imagen (Content-Type: ${contentType}). ${preview ? preview.slice(0, 120) : ""}`
        );
      }

      const blob = await resp.blob();

      // Detectar si el blob es realmente una imagen renderizable por el navegador
      const detected = await detectImageMagic(blob);
      const contentTypeHeader = contentType.toLowerCase();

      if (!detected && !(contentTypeHeader.startsWith("image/"))) {
        // No es imagen soportada — probablemente es TIFF crudo
        const preview = await blob.text().catch(() => "(no se pudo leer el contenido)");
        throw new Error(
          `El servidor devolvió un archivo no renderizable en navegador (probablemente TIFF crudo). ` +
            `Si quieres verlo en la app, usa el endpoint de conversión del backend.\n\n` +
            `Respuesta del servidor: Content-Type=${contentType} ; muestra: ${preview.slice(0, 200)}`
        );
      }

      const objectUrl = URL.createObjectURL(blob);
      lastObjectUrlRef.current = objectUrl;
      setImageUrl(objectUrl);

      // metadata
      try {
        const metaResp = await fetch(`${API_BASE}/info-archivo/${encoded}`);
        if (metaResp.ok) {
          const info = await metaResp.json();
          setMetadata(info);
        } else {
          setMetadata(null);
        }
      } catch (err) {
        console.warn("No se pudo obtener metadata:", err);
        setMetadata(null);
      }
    } catch (err) {
      let errorMsg = err?.message || String(err);
      
      if (errorMsg.includes('HTTP 404')) {
        errorMsg = `Archivo no encontrado en el backend: ${name}. Verifica que el backend esté corriendo y que el archivo exista.`;
      } else if (errorMsg.includes('fetch')) {
        errorMsg = `No se puede conectar al backend. Verifica que esté corriendo en ${API_BASE}`;
      }
      
      setError("Error al cargar imagen: " + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // ================================
  // Subir TIFF local al backend para conversión
  // ================================
  const subirTiffYConvertir = async (file) => {
    // Debes implementar este endpoint en el backend:
    // POST /convert-image/upload (multipart/form-data, campo "file")
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(`${API_BASE}/convert-image/upload`, {
      method: "POST",
      body: formData,
    });

    if (!resp.ok) {
      throw new Error(`No se pudo convertir TIFF en backend (HTTP ${resp.status})`);
    }

    // ✅ Ajusta según lo que responda tu backend:
    // Opción A: JSON con URL
    const data = await resp.json();

    // Debe venir una URL directa a PNG/JPG
    // Ej: { image_url: "/files/temp/converted/abc.png" } o URL absoluta
    if (!data?.image_url) {
      throw new Error("Respuesta inesperada del backend al convertir TIFF (falta image_url)");
    }

    // Normalizar a URL absoluta apuntando al backend si viene ruta relativa
    const url = data.image_url.startsWith('http') ? data.image_url : `${API_BASE}${data.image_url}`;
    return url;
  };

  // ================================
  // Cargar archivo local
  // ================================
  const cargarArchivoLocal = async (file) => {
    setLoading(true);
    setError(null);

    cleanupObjectUrl();
    setImageUrl(null);

    try {
      // Imágenes comunes: render nativo
      if (/\.(jpe?g|png|gif|bmp|webp)$/i.test(file.name)) {
        const objectUrl = URL.createObjectURL(file);
        lastObjectUrlRef.current = objectUrl;
        setImageUrl(objectUrl);
        return;
      }

      // TIFF local: NO intentar renderizar en navegador -> subir y convertir
      if (isTiff(file.name)) {
        const convertedUrl = await subirTiffYConvertir(file);

        // Para mostrar, también lo traemos como blob para control de Content-Type
        const resp = await fetch(`${convertedUrl}?t=${Date.now()}`);
        if (!resp.ok) throw new Error(`No se pudo cargar la imagen convertida (HTTP ${resp.status})`);

        const contentType = resp.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) {
          throw new Error(`La conversión no devolvió una imagen (Content-Type: ${contentType})`);
        }

        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        lastObjectUrlRef.current = objectUrl;
        setImageUrl(objectUrl);
        return;
      }

      throw new Error(`Formato no soportado: ${extOf(file.name).toUpperCase()}`);
    } catch (err) {
      setError("Error al cargar imagen: " + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  // ================================
  // Info local
  // ================================
  const obtenerInfoArchivoLocal = (file) => {
    const info = {
      file_info: {
        filename: file.name,
        size_bytes: file.size,
        size_mb: Math.round((file.size / (1024 * 1024)) * 100) / 100,
        modified: file.lastModified ? new Date(file.lastModified).toISOString() : "N/A",
        extension: extOf(file.name),
        type: file.type || "unknown",
      },
    };
    setMetadata(info);
  };

  // ================================
  // Selección local
  // ================================
  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setSelectedFileName(file.name);
    setIsLocalFile(true);
    setMetadata(null);

    obtenerInfoArchivoLocal(file);
    cargarArchivoLocal(file);
  };

  // ================================
  // Subir archivo local al servidor
  // ================================
  const handleUploadToServer = async () => {
    if (!selectedFile || !isLocalFile) return;

    setLoading(true);
    setError(null);

    try {
      // TIFF -> usar endpoint de conversión/upload
      if (isTiff(selectedFile.name)) {
        const convertedUrl = await subirTiffYConvertir(selectedFile);
        const resp = await fetch(`${convertedUrl}?t=${Date.now()}`);
        if (!resp.ok) throw new Error(`No se pudo cargar la imagen convertida (HTTP ${resp.status})`);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        lastObjectUrlRef.current = objectUrl;
        setImageUrl(objectUrl);
        setIsLocalFile(false);
        setSelectedFileName(selectedFile.name + " (subido)");
        return;
      }

      // Otros tipos -> intentar subir a /files/upload (si el backend lo soporta)
      const formData = new FormData();
      formData.append("file", selectedFile);
      const resp = await fetch(`${API_BASE}/files/upload`, { method: "POST", body: formData });
      if (!resp.ok) throw new Error(`Subida falló (HTTP ${resp.status})`);

      const data = await resp.json().catch(() => null);
      if (data?.image_url) {
        const r = await fetch(`${data.image_url}?t=${Date.now()}`);
        if (!r.ok) throw new Error(`No se pudo obtener la imagen subida (HTTP ${r.status})`);
        const blob = await r.blob();
        const objectUrl = URL.createObjectURL(blob);
        lastObjectUrlRef.current = objectUrl;
        setImageUrl(objectUrl);
        setIsLocalFile(false);
        setSelectedFileName(selectedFile.name + " (subido)");
      } else {
        setError("Subida completada (sin URL de preview proporcionada por el backend).");
      }
    } catch (err) {
      setError("Error al subir: " + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  // ================================
  // Selección backend
  // ================================
  const handleBackendFileSelect = async (fileObj) => {
    setSelectedFile(fileObj);
    setSelectedFileName(fileObj.name);
    setIsLocalFile(false);
    setMetadata(null);

    await cargarArchivoBackend(fileObj);
  };

  // ================================
  // Drag & Drop
  // ================================
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dropZoneRef.current?.contains(e.relatedTarget)) setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      const file = files[0];
      const ext = extOf(file.name);

      if (!["tif", "tiff", "jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext)) {
        setError(`Formato no soportado: ${ext.toUpperCase()}`);
        return;
      }

      setSelectedFile(file);
      setSelectedFileName(file.name);
      setIsLocalFile(true);
      setMetadata(null);

      obtenerInfoArchivoLocal(file);
      cargarArchivoLocal(file);
    }
  };

  // ================================
  // Abrir selector
  // ================================
  const openFileSelector = () => fileInputRef.current?.click();

  // ================================
  // Diagnóstico del backend
  // ================================
  const testBackendConnection = async () => {
    try {
      setError(null);
      setLoading(true);
      
      // Test 1: Conexión básica
      const healthResp = await fetch(`${API_BASE}/archivos-disponibles`);
      if (!healthResp.ok) {
        throw new Error(`Backend no responde (HTTP ${healthResp.status})`);
      }

      // Test 2: Verificar si hay archivos
      const data = await healthResp.json();
      const outputFiles = data.files_by_category?.output || [];
      
      if (outputFiles.length === 0) {
        setError("✅ Backend conectado, pero no hay archivos en /output/");
        return;
      }

      // Test 3: Probar endpoint de conversión con primer archivo TIFF
      const tiffFiles = outputFiles.filter(f => isTiff(f));
      if (tiffFiles.length > 0) {
        const testFile = tiffFiles[0];
        const convertResp = await fetch(`${API_BASE}/convert-image/output/${encodeURIComponent(testFile)}`, {
          method: 'HEAD' // Solo verificar que existe
        });
        
        if (convertResp.ok) {
          setError(`✅ Backend funcionando. Conversión TIFF disponible. ${outputFiles.length} archivos encontrados.`);
        } else {
          setError(`⚠️ Backend conectado pero conversión TIFF no disponible (${convertResp.status}). ${outputFiles.length} archivos encontrados.`);
        }
      } else {
        setError(`✅ Backend funcionando. ${outputFiles.length} archivos encontrados (sin TIFF).`);
      }

    } catch (err) {
      setError(`❌ Error de conexión: ${err.message}. Verifica que el backend esté corriendo en ${API_BASE}`);
    } finally {
      setLoading(false);
    }
  };

  // ================================
  // UI
  // ================================
  return (
    <div
      className="content"
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr 280px",
        gridTemplateRows: "1fr",
        gap: "20px",
        height: "100vh",
        padding: "25px",
        backgroundColor: "#f5f5f5",
        alignItems: "start",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".tif,.tiff,.jpg,.jpeg,.png,.gif,.bmp,.webp"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {/* PANEL IZQUIERDA */}
      <div
        style={{
          padding: "20px",
          background: "#c4d4a8",
          borderRadius: "12px",
          border: "3px solid #a8bf7d",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          minHeight: "0",
          maxHeight: "calc(100vh - 50px)",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        }}
      >
        <h2
          style={{
            marginTop: 0,
            marginBottom: "12px",
            color: "#2196F3",
            borderBottom: "3px solid #2196F3",
            paddingBottom: "8px",
            fontSize: "18px",
            fontWeight: "600",
          }}
        >
          Visualizador de Imágenes
        </h2>

        <div style={{ marginBottom: "12px" }}>
          <button
            onClick={openFileSelector}
            style={{
              width: "100%",
              padding: "11px",
              background: "#667eea",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "600",
              marginBottom: "8px",
              transition: "all 0.2s ease",
              boxShadow: "0 2px 6px rgba(102, 126, 234, 0.2)",
            }}
            onMouseEnter={(e) => {
              e.target.style.background = "#5568d3";
              e.target.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.target.style.background = "#667eea";
              e.target.style.boxShadow = "0 2px 6px rgba(102, 126, 234, 0.2)";
            }}
          >
            📁 Seleccionar Imagen Local
          </button>

          <div
            ref={dropZoneRef}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={openFileSelector}
            style={{
              border: isDragging ? "3px dashed #4CAF50" : "2px dashed #ddd",
              borderRadius: "8px",
              padding: "20px",
              textAlign: "center",
              background: isDragging ? "#f0f8f0" : "#fafafa",
              color: isDragging ? "#4CAF50" : "#999",
              fontSize: "13px",
              transition: "all 0.2s ease",
              cursor: "pointer",
            }}
          >
            {isDragging ? (
              <>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>📤</div>
                <div>
                  <strong>Suelta tu imagen aquí</strong>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>🎯</div>
                <div>Arrastra una imagen aquí</div>
                <div style={{ fontSize: "11px", marginTop: "4px" }}>o haz clic para seleccionar</div>
              </>
            )}
          </div>
        </div>

        {/* diagnóstico removido */}

        {outputFiles.length > 0 && (
          <div style={{ marginBottom: "12px" }}>
            <h3
              style={{
                margin: "0 0 10px 0",
                color: "#2196F3",
                fontSize: "14px",
                borderBottom: "2px solid #2196F3",
                paddingBottom: "6px",
                fontWeight: "600",
              }}
            >
              Archivos del Backend ({outputFiles.length})
            </h3>

            <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexDirection: "column" }}>
              <div style={{ padding: "6px", background: "#f6fff6", border: "1px solid #e6f4ea", borderRadius: "6px", fontSize: "12px" }}>
                <strong>TIFFs en input:</strong> {inputTiffFiles.length}
                {inputTiffFiles.length > 0 && (
                  <div style={{ fontSize: "10px", color: "#666", marginTop: "4px", maxHeight: "50px", overflow: "auto", wordBreak: "break-word" }}>
                    {inputTiffFiles.slice(0, 3).map((f, i) => (
                      <div key={i}>{f.name}</div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: "6px", background: "#f6f7ff", border: "1px solid #e6e9f8", borderRadius: "6px", fontSize: "12px" }}>
                <strong>TIFFs en output:</strong> {outputTiffFiles.length}
                {outputTiffFiles.length > 0 && (
                  <div style={{ fontSize: "10px", color: "#666", marginTop: "4px", maxHeight: "50px", overflow: "auto", wordBreak: "break-word" }}>
                    {outputTiffFiles.slice(0, 3).map((f, i) => (
                      <div key={i}>{f.name}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ maxHeight: "170px", overflowY: "auto", fontSize: "11px" }}>
              {outputFiles.map((file, index) => (
                <div
                  key={index}
                  onClick={() => handleBackendFileSelect(file)}
                  style={{
                    padding: "10px 12px",
                    marginBottom: "6px",
                    background: !isLocalFile && selectedFileName === file.name ? "#e8f5e8" : "#f9f9f9",
                    border: !isLocalFile && selectedFileName === file.name ? "2px solid #4CAF50" : "1px solid #ddd",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    fontSize: "12px",
                    wordBreak: "break-word",
                  }}
                >
                  <div
                    style={{
                      fontWeight: !isLocalFile && selectedFileName === file.name ? "600" : "normal",
                      color: "#333",
                      marginBottom: "2px",
                    }}
                  >
                    {file.name}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: "10px", color: "#666" }}>📁 {file.folder}</div>
                    <div style={{ fontSize: "10px", color: "#666" }}>🌐 {extOf(file.name).toUpperCase()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              background: "#ffebee",
              border: "1px solid #f44336",
              padding: "10px",
              borderRadius: "5px",
              marginBottom: "15px",
              color: "#c62828",
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </div>
        )}

        {selectedFileName && (
          <div
            style={{
              background: "#e8f5e8",
              border: "1px solid #4CAF50",
              padding: "8px",
              borderRadius: "5px",
              marginBottom: "8px",
              fontSize: "11px",
            }}
          >
            <div style={{ fontWeight: "600", color: "#333", marginBottom: "3px" }}>
              {isLocalFile ? "📱 Archivo local:" : "🌐 Archivo del backend:"}
            </div>
            <div style={{ fontSize: "10px", color: "#666", wordBreak: "break-word", marginBottom: "5px" }}>{selectedFileName}</div>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {isLocalFile ? (
                <>
                  <button
                    onClick={handleUploadToServer}
                    style={{
                      padding: "6px 8px",
                      background: "#1976d2",
                      color: "white",
                      border: "none",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    ⬆️ Subir
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => cargarArchivoBackend(selectedFile)}
                    style={{
                      padding: "6px 8px",
                      background: "#1976d2",
                      color: "white",
                      border: "none",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    👁️ Ver
                  </button>

                  <button
                    onClick={() => {
                      if (!selectedFile || !selectedFile.name) return;
                      // Mapear "input" a "images" para el backend
                      const backendFolder = selectedFile.folder === "input" ? "images" : selectedFile.folder;
                      const url = `${API_BASE}/download/${encodeURIComponent(backendFolder)}/${encodeURIComponent(selectedFile.name)}`;
                      // Abrir en nueva pestaña para forzar descarga
                      window.open(url, '_blank');
                    }}
                    style={{
                      padding: "6px 8px",
                      background: "#4CAF50",
                      color: "white",
                      border: "none",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    ⬇️ Descargar
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize: "11px", color: "#666", lineHeight: "1.3", marginTop: "auto" }}>
          <strong style={{ fontSize: "11px" }}>Notas:</strong>
          <ul style={{ margin: "4px 0", paddingLeft: "16px", marginBottom: "0" }}>
            <li>JPG/PNG/GIF/WebP/BMP: se visualizan directo</li>
            <li>TIFF local: se sube al backend y se convierte a PNG/JPG</li>
            <li>TIFF del backend: se usa el endpoint de conversión</li>
          </ul>
        </div>
      </div>

      {/* PANEL CENTRAL */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "white",
          borderRadius: "12px",
          border: "3px solid #ddd",
          overflow: "hidden",
          minHeight: "0",
          maxHeight: "calc(100vh - 50px)",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div
          style={{
            padding: "12px 15px",
            background: "#f5f5f5",
            borderBottom: "1px solid #ddd",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "15px",
          }}
        >
          <h3 style={{ margin: 0, color: "#333", flex: 1, minWidth: "100px", fontSize: "14px" }}>
            {selectedFileName || "Sin archivo"}
          </h3>
        </div>

        <div
          ref={imageContainerRef}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            background: "#fafafa",
            position: "relative",
            cursor: isPanning ? "grabbing" : zoom > 1 ? "grab" : "default",
          }}
        >
          {!selectedFile && !loading && (
            <div style={{ textAlign: "center", color: "#999" }}>
              <div style={{ fontSize: "48px", marginBottom: "15px" }}>🖼️</div>
              <div style={{ fontSize: "18px" }}>Carga un archivo local o selecciona uno del backend</div>
            </div>
          )}

          {imageUrl && !loading && (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt={selectedFileName || "imagen"}
                style={{
                  maxWidth: zoom === 1 ? "100%" : "none",
                  maxHeight: zoom === 1 ? "100%" : "none",
                  width: zoom === 1 ? "auto" : `${100 * zoom}%`,
                  height: zoom === 1 ? "auto" : "auto",
                  objectFit: "contain",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
                  borderRadius: "8px",
                  transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: isPanning ? "none" : "transform 0.2s ease",
                  cursor: isPanning ? "grabbing" : "grab",
                  filter: `
                    brightness(${brightness}%)
                    contrast(${contrast}%)
                    ${colorPalette === "grayscale" ? "grayscale(100%)" : ""}
                    ${colorPalette === "sepia" ? "sepia(100%)" : ""}
                    ${colorPalette === "plasma" ? "saturate(150%) hue-rotate(10deg)" : ""}
                    ${colorPalette === "inferno" ? "saturate(200%) hue-rotate(20deg) brightness(110%)" : ""}
                    ${colorPalette === "magma" ? "saturate(180%) hue-rotate(-20deg)" : ""}
                    ${colorPalette === "heat" ? "saturate(200%) hue-rotate(-30deg)" : ""}
                    ${colorPalette === "cool" ? "saturate(150%) hue-rotate(180deg)" : ""}
                  `,
                }}
                onMouseDown={handleMouseDown}
                onError={(e) => {
                  console.error("Error renderizando imagen:", e);
                  setError(
                    "Error al renderizar la imagen en el navegador. " +
                      "Verifica que sea una imagen válida y que la conversión del TIFF funcione."
                  );
                }}
              />
            </div>
          )}

          {/* Controles de zoom flotantes arriba */}
          {imageUrl && !loading && (
            <div
              style={{
                position: "absolute",
                top: "15px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(255,255,255,0.95)",
                border: "1px solid #ddd",
                borderRadius: "6px",
                padding: "8px 12px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                zIndex: 100,
              }}
            >
              <button
                onClick={zoomOut}
                disabled={zoom <= 1}
                style={{
                  padding: "6px 10px",
                  background: zoom <= 1 ? "#ddd" : "#1976d2",
                  color: zoom <= 1 ? "#999" : "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: zoom <= 1 ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: "bold",
                }}
                title="Alejar"
              >
                −
              </button>
              <span style={{ fontSize: "12px", color: "#666", minWidth: "45px", textAlign: "center", fontWeight: "500" }}>
                {(zoom * 100).toFixed(0)}%
              </span>
              <button
                onClick={zoomIn}
                disabled={zoom >= 5}
                style={{
                  padding: "6px 10px",
                  background: zoom >= 5 ? "#ddd" : "#1976d2",
                  color: zoom >= 5 ? "#999" : "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: zoom >= 5 ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: "bold",
                }}
                title="Acercar"
              >
                +
              </button>
              <button
                onClick={resetZoom}
                style={{
                  padding: "6px 10px",
                  background: "#4CAF50",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
                title="Reiniciar zoom"
              >
                ⟲
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PANEL DERECHA */}
      <div
        style={{
          padding: "20px",
          background: "#c4d4a8",
          borderRadius: "12px",
          border: "3px solid #a8bf7d",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          minHeight: "0",
          maxHeight: "calc(100vh - 50px)",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        }}
      >
        <h3
          style={{
            marginTop: 0,
            marginBottom: "12px",
            color: "#2196F3",
            borderBottom: "3px solid #2196F3",
            paddingBottom: "8px",
            fontSize: "16px",
            fontWeight: "600",
          }}
        >
          Información
        </h3>

        {selectedFile && (
          <div>
            <div style={{ marginBottom: "15px" }}>
              <strong>Archivo:</strong>
              <div style={{ fontSize: "12px", color: "#666", wordBreak: "break-word", marginTop: "5px" }}>
                {selectedFileName}
              </div>
            </div>

            <div style={{ marginBottom: "15px" }}>
              <strong>Origen:</strong>
              <div style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
                {isLocalFile ? "📱 Archivo local" : "🌐 Backend"}
              </div>
            </div>

            {imageUrl && (
              <div style={{ marginBottom: "15px" }}>
                <strong style={{ display: "block", marginBottom: "8px" }}>🎨 Paleta de Colores:</strong>
                
                {/* Dropdown personalizado */}
                <div style={{ position: "relative", marginBottom: "12px" }}>
                  <button
                    onClick={() => setShowPaletteDropdown(!showPaletteDropdown)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "2px solid #ddd",
                      borderRadius: "6px",
                      background: "white",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      fontWeight: "500",
                      transition: "border-color 0.2s ease",
                      minHeight: "40px",
                    }}
                    onMouseEnter={(e) => e.target.style.borderColor = "#667eea"}
                    onMouseLeave={(e) => e.target.style.borderColor = "#ddd"}
                  >
                    <span style={{ color: "#333", whiteSpace: "nowrap" }}>{selectedPalette.name}</span>
                    <div
                      style={{
                        flex: 1,
                        height: "20px",
                        borderRadius: "3px",
                        background: `linear-gradient(to right, ${selectedPalette.colors.join(", ")})`,
                        border: "1px solid #999",
                      }}
                    />
                    <span style={{ color: "#667eea" }}>{showPaletteDropdown ? "▲" : "▼"}</span>
                  </button>

                  {showPaletteDropdown && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: "0",
                        right: "0",
                        background: "white",
                        border: "2px solid #667eea",
                        borderRadius: "6px",
                        marginTop: "4px",
                        zIndex: 1000,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        maxHeight: "300px",
                        overflowY: "auto",
                      }}
                    >
                      {colorPalettes.map((palette) => (
                        <button
                          key={palette.value}
                          onClick={() => {
                            setColorPalette(palette.value);
                            setShowPaletteDropdown(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            border: "none",
                            background: colorPalette === palette.value ? "#e8eeff" : "white",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            fontSize: "13px",
                            fontWeight: "500",
                            transition: "background 0.2s ease",
                            borderBottom: "1px solid #eee",
                            textAlign: "left",
                          }}
                          onMouseEnter={(e) => e.target.style.background = "#f9f9f9"}
                          onMouseLeave={(e) => e.target.style.background = colorPalette === palette.value ? "#e8eeff" : "white"}
                        >
                          <span style={{ minWidth: "110px", color: "#333" }}>{palette.name}</span>
                          <div
                            style={{
                              flex: 1,
                              height: "22px",
                              borderRadius: "3px",
                              background: `linear-gradient(to right, ${palette.colors.join(", ")})`,
                              border: "1px solid #999",
                              pointerEvents: "none",
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "12px", display: "block", marginBottom: "4px" }}>
                    ☀️ Brillo: {brightness}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    style={{ width: "100%", cursor: "pointer" }}
                  />
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "12px", display: "block", marginBottom: "4px" }}>
                    ⚖️ Contraste: {contrast}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    style={{ width: "100%", cursor: "pointer" }}
                  />
                </div>

                <button
                  onClick={() => {
                    setColorPalette("viridis");
                    setBrightness(100);
                    setContrast(100);
                  }}
                  style={{
                    width: "100%",
                    padding: "6px",
                    background: "#667eea",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                    marginBottom: "15px",
                    transition: "background 0.2s ease",
                  }}
                  onMouseEnter={(e) => e.target.style.background = "#5568d3"}
                  onMouseLeave={(e) => e.target.style.background = "#667eea"}
                >
                  🔄 Reiniciar colores
                </button>
              </div>
            )}

            {metadata && (
              <div style={{ marginBottom: "15px" }}>
                <strong>Metadatos:</strong>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#666",
                    marginTop: "5px",
                    background: "#f9f9f9",
                    padding: "10px",
                    borderRadius: "5px",
                    maxHeight: "200px",
                    overflow: "auto",
                  }}
                >
                  <pre style={{ margin: 0 }}>{JSON.stringify(metadata, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
