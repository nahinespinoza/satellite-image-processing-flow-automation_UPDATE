import React, { useState, useEffect, useRef } from "react";
import { obtenerArchivosDisponibles } from "../api";
import ColorPaletteDropdown from "./ColorPaletteDropdown";
import ImageAdjustments from "./ImageAdjustments";
import ImageMetadata from "./ImageMetadata";
import ZoomControls from "./ZoomControls";
import "./ProcessorUI.css";
import "./visualizador.css";

const API_BASE = "http://localhost:5000";

export default function Visualizador() {
  // File Management
  const [outputFiles, setOutputFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState(null);
  const [isLocalFile, setIsLocalFile] = useState(false);

  // Image Display
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Zoom and Pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Color and Adjustments
  const [colorPalette, setColorPalette] = useState("viridis");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [showPaletteDropdown, setShowPaletteDropdown] = useState(false);

  // Refs
  const lastObjectUrlRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const imageContainerRef = useRef(null);
  const imageRef = useRef(null);

  // Utility Functions
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

  // Zoom and Pan Functions
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

  // File Summary
  const inputTiffFiles = outputFiles.filter((f) => f.folder === "input" && isTiff(f.name));
  const outputTiffFiles = outputFiles.filter((f) => f.folder === "output" && isTiff(f.name));

  // Load Backend Files
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

  // Image Magic Detection
  const detectImageMagic = async (blob) => {
    const buf = await blob.slice(0, 16).arrayBuffer();
    const view = new Uint8Array(buf);

    const signatures = [
      ([0xff, 0xd8, 0xff], "JPEG"),
      ([0x89, 0x50, 0x4e, 0x47], "PNG"),
      ([0x47, 0x49, 0x46], "GIF"),
      ([0x42, 0x4d], "BMP"),
      ([0x52, 0x49, 0x46, 0x46], "WEBP"),
      ([0x49, 0x49, 0x2a, 0x00], "TIFF-LE"),
      ([0x4d, 0x4d, 0x00, 0x2a], "TIFF-BE"),
    ];

    for (const [sig, format] of signatures) {
      if (sig.every((byte, i) => view[i] === byte)) return true;
    }

    return false;
  };

  // Load Image from Backend
  const cargarArchivo = async (name, folder) => {
    setLoading(true);
    setError(null);
    cleanupObjectUrl();
    setImageUrl(null);
    setSelectedFile(null);
    setSelectedFileName(name);
    setIsLocalFile(false);

    try {
      const backendFolder = folder === "input" ? "input" : "output";
      const encoded = encodeURIComponent(name);
      let finalUrl = null;
      let resp = null;

      if (isTiff(name)) {
        try {
          finalUrl = `${API_BASE}/convert-image/${backendFolder}/${encoded}`;
          resp = await fetch(finalUrl);
        } catch (convertError) {
          console.warn("Error en conversión TIFF:", convertError);
          finalUrl = `${API_BASE}/files/${backendFolder}/${encoded}?t=${Date.now()}`;
          resp = await fetch(finalUrl);
        }
      } else {
        finalUrl = `${API_BASE}/files/${backendFolder}/${encoded}?t=${Date.now()}`;
        resp = await fetch(finalUrl);
      }

      if (!resp.ok) {
        if (resp.status === 422) {
          try {
            const errorData = await resp.json();
            if (errorData.is_geospatial) {
              throw new Error(
                `Archivo geoespacial complejo (${errorData.file_size_mb}MB)\n\n` +
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
      
      if (!contentType.startsWith("image/") && 
          !(isTiff(name) && contentType.includes("octet-stream"))) {
        const preview = await resp.text().catch(() => "");
        throw new Error(
          `La respuesta no es una imagen (Content-Type: ${contentType}). ${preview ? preview.slice(0, 120) : ""}`
        );
      }

      const blob = await resp.blob();
      const detected = await detectImageMagic(blob);
      const contentTypeHeader = contentType.toLowerCase();

      if (!detected && !(contentTypeHeader.startsWith("image/"))) {
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
      
      if (errorMsg.includes("HTTP 404")) {
        errorMsg = `Archivo no encontrado en el backend: ${name}. Verifica que el backend esté corriendo y que el archivo exista.`;
      } else if (errorMsg.includes("fetch")) {
        errorMsg = `No se puede conectar al backend. Verifica que esté corriendo en ${API_BASE}`;
      }
      
      setError("Error al cargar imagen: " + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Upload TIFF and Convert
  const subirTiffYConvertir = async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(`${API_BASE}/convert-image/upload`, {
      method: "POST",
      body: formData,
    });

    if (!resp.ok) {
      throw new Error(`No se pudo convertir TIFF en backend (HTTP ${resp.status})`);
    }

    const data = await resp.json();

    if (!data?.image_url) {
      throw new Error("Respuesta inesperada del backend al convertir TIFF (falta image_url)");
    }

    const url = data.image_url.startsWith("http") ? data.image_url : `${API_BASE}${data.image_url}`;
    return url;
  };

  // Load Local File
  const cargarArchivoLocal = async (file) => {
    setLoading(true);
    setError(null);

    cleanupObjectUrl();
    setImageUrl(null);

    try {
      if (/\.(jpe?g|png|gif|bmp|webp)$/i.test(file.name)) {
        const objectUrl = URL.createObjectURL(file);
        lastObjectUrlRef.current = objectUrl;
        setImageUrl(objectUrl);
        setSelectedFile(file);
        setSelectedFileName(file.name);
        setIsLocalFile(true);
        obtenerInfoArchivoLocal(file);
        return;
      }

      if (isTiff(file.name)) {
        const convertedUrl = await subirTiffYConvertir(file);

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
        setSelectedFile(file);
        setSelectedFileName(file.name);
        setIsLocalFile(true);
        obtenerInfoArchivoLocal(file);
        return;
      }

      throw new Error(`Formato no soportado: ${extOf(file.name).toUpperCase()}`);
    } catch (err) {
      setError("Error al cargar imagen: " + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  // Get Local File Info
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

  // Drag and Drop
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
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
    if (files.length > 0) {
      cargarArchivoLocal(files[0]);
    }
  };

  // Filter Functions
  const getFilesWithStatus = (folder, isTiffFilter) => {
    return outputFiles
      .filter((f) => f.folder === folder && isTiff(f.name) === isTiffFilter)
      .map((f) => {
        const isSelected = selectedFileName === f.name && !isLocalFile && folder === "input";
        return { ...f, isSelected };
      });
  };

  const filesWithStatusInput = getFilesWithStatus("input", true);
  const filesWithStatusOutput = getFilesWithStatus("output", true);

  // Color Adjustment Functions
  const getColorEffects = () => {
    const effects = [`brightness(${brightness}%)`, `contrast(${contrast}%)`];
    
    const colorEffectMap = {
      viridis: "",
      plasma: "",
      inferno: "hue-rotate(220deg)",
      magma: "hue-rotate(280deg)",
      grayscale: "grayscale(1)",
      heat: "saturate(1.5)",
      cool: "hue-rotate(180deg)",
      sepia: "sepia(0.8)",
    };

    if (colorEffectMap[colorPalette]) {
      effects.push(colorEffectMap[colorPalette]);
    }

    return effects.join(" ");
  };

  return (
    <div className="visualizador-grid">
      {/* Left Panel - Files */}
      <div className="visualizador-panel visualizador-left">
        <div className="visualizador-section">
          <h3 className="visualizador-title">Archivos</h3>

          {/* Local Drop Zone */}
          <div
            ref={dropZoneRef}
            className={`visualizador-drop-zone ${isDragging ? "dragging" : ""}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <p>Arrastra imagen aquí</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.tif,.tiff"
              onChange={(e) => e.target.files[0] && cargarArchivoLocal(e.target.files[0])}
              className="visualizador-file-input"
            />
          </div>

          {/* Backend Files - Input */}
          {filesWithStatusInput.length > 0 && (
            <div className="visualizador-file-section">
              <strong className="visualizador-label">Entrada ({filesWithStatusInput.length})</strong>
              <div className="visualizador-file-list">
                {filesWithStatusInput.map((f) => (
                  <button
                    key={f.name}
                    className={`visualizador-file-item ${f.isSelected ? "selected" : ""}`}
                    onClick={() => cargarArchivo(f.name, "input")}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Backend Files - Output */}
          {filesWithStatusOutput.length > 0 && (
            <div className="visualizador-file-section">
              <strong className="visualizador-label">Salida ({filesWithStatusOutput.length})</strong>
              <div className="visualizador-file-list">
                {filesWithStatusOutput.map((f) => (
                  <button
                    key={f.name}
                    className={`visualizador-file-item ${selectedFileName === f.name && !isLocalFile ? "selected" : ""}`}
                    onClick={() => cargarArchivo(f.name, "output")}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center Panel - Image Viewer */}
      <div className="visualizador-panel visualizador-center">
        <div className="visualizador-image-wrapper">
          {loading && <div className="visualizador-loading">Cargando imagen...</div>}

          {error && <div className="visualizador-error">{error}</div>}

          {imageUrl && (
            <div
              ref={imageContainerRef}
              className="visualizador-image-container"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />

              <img
                ref={imageRef}
                src={imageUrl}
                alt="Satellite"
                className="visualizador-image"
                style={{
                  transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                  filter: getColorEffects(),
                  cursor: zoom > 1 ? "grab" : "default",
                }}
              />
            </div>
          )}

          {!imageUrl && !loading && !error && (
            <div className="visualizador-placeholder">Selecciona una imagen para visualizar</div>
          )}
        </div>
      </div>

      {/* Right Panel - Controls and Metadata */}
      <div className="visualizador-panel visualizador-right">
        {imageUrl && (
          <div className="visualizador-section">
            <h3 className="visualizador-title">Información</h3>

            <div className="visualizador-info-group">
              <strong className="visualizador-label">Archivo</strong>
              <p className="visualizador-info-text">{selectedFileName}</p>
            </div>

            <div className="visualizador-info-group">
              <strong className="visualizador-label">Origen</strong>
              <p className="visualizador-info-text">{isLocalFile ? "Local" : "Backend"}</p>
            </div>
          </div>
        )}

        {imageUrl && (
          <>
            <ColorPaletteDropdown
              colorPalette={colorPalette}
              onColorChange={setColorPalette}
              isOpen={showPaletteDropdown}
              onToggle={() => setShowPaletteDropdown(!showPaletteDropdown)}
            />

            <ImageAdjustments
              brightness={brightness}
              onBrightnessChange={setBrightness}
              contrast={contrast}
              onContrastChange={setContrast}
              onReset={() => {
                setColorPalette("viridis");
                setBrightness(100);
                setContrast(100);
              }}
            />
          </>
        )}

        <ImageMetadata metadata={metadata} />
      </div>
    </div>
  );
}
