import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  MapContainer,
  TileLayer,
  ImageOverlay,
  LayersControl,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import "leaflet.sync";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Columns2,
  Crosshair,
  Download,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Loader2,
  Map as MapIcon,
  MapPin,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  SlidersHorizontal,
  Square,
  Upload,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge, Btn, IconBtn, inputCls } from "./ui";

import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const API_BASE = "http://localhost:5000";
const { BaseLayer } = LayersControl;

// Opción "Del servidor" (explorar backend/files/images y output). Oculta por
// ahora porque todo se maneja desde local; poner en true para reactivarla.
const MOSTRAR_SERVIDOR = false;

// Formatos que se pueden abrir en el visor (local o desde backend/files)
const EXT_IMAGEN = ["tif", "tiff", "jpg", "jpeg", "png", "gif", "bmp", "webp"];
const extension = (nombre) => (nombre.split(".").pop() || "").toLowerCase();
const esTiff = (nombre) => /\.tiff?$/i.test(nombre);
const codificarRuta = (rel) => rel.split("/").map(encodeURIComponent).join("/");
const nuevaClave = () => `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

// Paletas heredadas del antiguo Visualizador. Son aproximaciones con filtros
// CSS sobre el preview ya renderizado, no un colormap aplicado a los valores
// del raster.
const PALETAS = [
  { name: "Viridis", value: "viridis", colors: ["#440154", "#31688e", "#35b779", "#fde724"], css: "" },
  { name: "Plasma", value: "plasma", colors: ["#0d0887", "#7e03a8", "#cc4778", "#f89540", "#f0f921"], css: "saturate(150%) hue-rotate(10deg)" },
  { name: "Inferno", value: "inferno", colors: ["#000004", "#420a68", "#932667", "#fca636", "#fcfdbf"], css: "saturate(200%) hue-rotate(20deg) brightness(110%)" },
  { name: "Magma", value: "magma", colors: ["#000004", "#3b0f70", "#8c2981", "#fcfdbf"], css: "saturate(180%) hue-rotate(-20deg)" },
  { name: "Escala de Grises", value: "grayscale", colors: ["#000000", "#404040", "#808080", "#c0c0c0", "#ffffff"], css: "grayscale(100%)" },
  { name: "Heat Map", value: "heat", colors: ["#0000ff", "#00ffff", "#ffff00", "#ff8800", "#ff0000"], css: "saturate(200%) hue-rotate(-30deg)" },
  { name: "Cool", value: "cool", colors: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff"], css: "saturate(150%) hue-rotate(180deg)" },
  { name: "Sepia", value: "sepia", colors: ["#1a0000", "#5c2e0f", "#8b5a3c", "#d4a574", "#e8d4b8"], css: "sepia(100%)" },
];

function filtroCss({ paleta, brillo, contraste }) {
  const p = PALETAS.find((x) => x.value === paleta);
  return `brightness(${brillo}%) contrast(${contraste}%) ${p?.css || ""}`.trim();
}

// ImageOverlay con filtro CSS (paleta/brillo/contraste) aplicado al <img>
// que Leaflet crea para la capa.
function OverlayConFiltro({ url, bounds, filtro }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current?.getElement?.();
    if (el) el.style.filter = filtro;
  }, [filtro, url]);
  return (
    <ImageOverlay
      ref={ref}
      url={url}
      bounds={bounds}
      opacity={0.9}
      eventHandlers={{
        load: (e) => {
          const el = e.target.getElement();
          if (el) el.style.filter = filtro;
        },
      }}
    />
  );
}

// Visor para imágenes sin georreferencia: zoom con rueda/botones y
// arrastre para desplazarse (lo que hacía el antiguo Visualizador).
function VisorImagen({ src, alt, filtro }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [arrastrando, setArrastrando] = useState(false);
  const inicioArrastre = useRef(null);
  const contRef = useRef(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);

  const cambiarZoom = useCallback((delta) => {
    setZoom((z) => {
      const n = Math.max(1, Math.min(z + delta, 8));
      if (n === 1) setPan({ x: 0, y: 0 });
      return n;
    });
  }, []);

  useEffect(() => {
    const el = contRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      cambiarZoom(e.deltaY > 0 ? -0.2 : 0.2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cambiarZoom]);

  const soltar = () => {
    inicioArrastre.current = null;
    setArrastrando(false);
  };

  return (
    <div
      ref={contRef}
      style={{
        ...estilos.imageViewer,
        position: "relative",
        overflow: "hidden",
        cursor: zoom > 1 ? (arrastrando ? "grabbing" : "grab") : "default",
      }}
      onMouseDown={(e) => {
        if (zoom <= 1) return;
        inicioArrastre.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        setArrastrando(true);
      }}
      onMouseMove={(e) => {
        if (!inicioArrastre.current) return;
        setPan({
          x: e.clientX - inicioArrastre.current.x,
          y: e.clientY - inicioArrastre.current.y,
        });
      }}
      onMouseUp={soltar}
      onMouseLeave={soltar}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          ...estilos.imagePreview,
          filter: filtro,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: arrastrando ? "none" : "transform 0.15s ease",
        }}
      />
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-solid border-slate-200 bg-white/95 p-1 shadow-md">
        <IconBtn icon={ZoomOut} label="Alejar" onClick={() => cambiarZoom(-0.25)} disabled={zoom <= 1} />
        <span className="min-w-[44px] text-center text-xs tabular-nums text-slate-600">
          {Math.round(zoom * 100)}%
        </span>
        <IconBtn icon={ZoomIn} label="Acercar" onClick={() => cambiarZoom(0.25)} disabled={zoom >= 8} />
        <IconBtn
          icon={RotateCcw}
          label="Restablecer zoom"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        />
      </div>
    </div>
  );
}

function buildPreviewUrl(item) {
  if (item?.preview_url) return item.preview_url;
  const path = item?.quicklook_png || item?.output_tiff;
  if (!path) return null;
  return `${API_BASE}/preview-image?path=${encodeURIComponent(path)}`;
}

function FitBoundsOnce({ bounds }) {
  const map = useMap();
  const yaAjustado = useRef(false);
  useEffect(() => {
    if (bounds && !yaAjustado.current) {
      map.fitBounds(bounds, { padding: [16, 16] });
      yaAjustado.current = true;
    }
  }, [bounds, map]);
  return null;
}

function GotoControl({ lat, lng, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (trigger == null) return;
    const la = parseFloat(lat);
    const ln = parseFloat(lng);
    if (Number.isNaN(la) || Number.isNaN(ln)) return;
    map.setView([la, ln], Math.max(map.getZoom(), 12));
  }, [trigger, lat, lng, map]);
  return null;
}

async function consultarValorPixel(tiffPath, lat, lng) {
  try {
    const res = await fetch(
      `${API_BASE}/pixel-value?path=${encodeURIComponent(
        tiffPath,
      )}&lat=${lat}&lng=${lng}`,
    );
    return await res.json();
  } catch {
    return {
      status: "error",
      message: "No se pudo consultar el valor del píxel.",
    };
  }
}

function formatearValorPixel(data) {
  if (!data) return "—";
  if (data.status !== "ok") return data.message || "Error";
  if (data.in_bounds === false) return "Fuera del área";
  if (data.is_nodata) return "Sin dato (nodata)";
  if (typeof data.value === "number") return data.value.toFixed(4);
  return String(data.value ?? "—");
}

/**
 * Click en el mapa: consulta el producto de este mapa y, si hay otherItem
 * (modo comparar), también el del otro lado en la misma coordenada.
 */
function InspectorDePixel({
  selectedItem,
  otherItem,
  onResultado,
  onResultadoOther,
  enabled,
}) {
  useMapEvents({
    click: async (e) => {
      if (!enabled || !selectedItem?.output_tiff) return;
      const { lat, lng } = e.latlng;

      onResultado({ lat, lng, loading: true, data: null });
      if (otherItem?.output_tiff && onResultadoOther) {
        onResultadoOther({ lat, lng, loading: true, data: null });
      }

      if (otherItem?.output_tiff && onResultadoOther) {
        const [dataOwn, dataOther] = await Promise.all([
          consultarValorPixel(selectedItem.output_tiff, lat, lng),
          consultarValorPixel(otherItem.output_tiff, lat, lng),
        ]);
        onResultado({ lat, lng, loading: false, data: dataOwn });
        onResultadoOther({ lat, lng, loading: false, data: dataOther });
      } else {
        const data = await consultarValorPixel(
          selectedItem.output_tiff,
          lat,
          lng,
        );
        onResultado({ lat, lng, loading: false, data });
      }
    },
  });
  return null;
}

/**
 * Construye el contenido del popup editable (nombre + nota) para un
 * puntero. Se pasa como función a bindPopup para que Leaflet la vuelva a
 * llamar cada vez que se abre y así reflejar el valor guardado más reciente.
 */
function construirPopupPuntero(marker, emit) {
  return () => {
    const props = marker.feature.properties;

    const container = document.createElement("div");
    container.style.minWidth = "200px";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Nombre del puntero";
    nameInput.value = props.name || "";
    nameInput.style.cssText =
      "width:100%;margin-bottom:6px;padding:4px 6px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;font-size:12px;";

    const noteInput = document.createElement("textarea");
    noteInput.placeholder = "Nota / descripción";
    noteInput.value = props.note || "";
    noteInput.rows = 3;
    noteInput.style.cssText =
      "width:100%;margin-bottom:6px;padding:4px 6px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;font-size:12px;resize:vertical;";

    const coordsLabel = document.createElement("div");
    const ll = marker.getLatLng();
    coordsLabel.textContent = `📍 ${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
    coordsLabel.style.cssText = "font-size:11px;color:#888;margin-bottom:6px;";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 Guardar";
    saveBtn.style.cssText =
      "width:100%;padding:6px;background:#2196f3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;";
    saveBtn.onclick = () => {
      props.name = nameInput.value;
      props.note = noteInput.value;
      marker.setTooltipContent(props.name || "Puntero");
      marker.closePopup();
      if (typeof emit === "function") emit();
    };

    container.appendChild(coordsLabel);
    container.appendChild(nameInput);
    container.appendChild(noteInput);
    container.appendChild(saveBtn);
    return container;
  };
}

/** Convierte un L.Marker "plano" en un puntero con nombre + nota editables. */
function habilitarPunteroEditable(marker, emit, initialProps = {}) {
  marker.feature = {
    type: "Feature",
    properties: {
      ...initialProps,
      name: initialProps.name || "",
      note: initialProps.note || "",
    },
  };
  marker.bindTooltip(initialProps.name || "Puntero", {
    permanent: false,
    direction: "top",
  });
  marker.bindPopup(construirPopupPuntero(marker, emit), { minWidth: 220 });
  return marker;
}

// ---------------------------------------------------------------------------
// Importar punteros / figuras desde un archivo .geojson o .json
// ---------------------------------------------------------------------------

const primerTexto = (obj, claves) => {
  for (const k of claves) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
};
const CLAVES_NOMBRE = ["name", "nombre", "Name", "NAME", "title", "titulo", "label", "id"];
const CLAVES_NOTA = ["note", "nota", "description", "descripcion", "desc", "comment", "comentario"];
const CLAVES_LAT = ["lat", "latitude", "latitud", "y", "Lat", "LAT"];
const CLAVES_LNG = ["lng", "lon", "long", "longitude", "longitud", "x", "Lon", "LON", "Lng"];
const TIPOS_GEOMETRIA = [
  "Point", "MultiPoint", "LineString", "MultiLineString",
  "Polygon", "MultiPolygon", "GeometryCollection",
];

/** Convierte {lat, lon, nombre, ...} en un Feature Point; null si no hay coordenadas válidas. */
function objetoLatLngAFeature(o) {
  if (!o || typeof o !== "object") return null;
  const lat = parseFloat(primerTexto(o, CLAVES_LAT));
  const lng = parseFloat(primerTexto(o, CLAVES_LNG));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const properties = { ...o };
  for (const k of [...CLAVES_LAT, ...CLAVES_LNG]) delete properties[k];
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
}

/**
 * Normaliza el contenido de un archivo a una lista de Features GeoJSON.
 * Acepta: FeatureCollection, Feature, geometría suelta, lista de Features,
 * y JSON "plano" de punteros: [{lat, lon, nombre, nota}, ...] o
 * {"punteros": [...]} / {"points": [...]} / {"markers": [...]}.
 */
function normalizarAFeatures(data) {
  if (Array.isArray(data)) {
    return data.flatMap((x) =>
      x && (x.type === "Feature" || x.type === "FeatureCollection" || TIPOS_GEOMETRIA.includes(x.type))
        ? normalizarAFeatures(x)
        : [objetoLatLngAFeature(x)].filter(Boolean),
    );
  }
  if (!data || typeof data !== "object") return [];
  if (data.type === "FeatureCollection") return (data.features || []).filter(Boolean);
  if (data.type === "Feature") return [data];
  if (TIPOS_GEOMETRIA.includes(data.type)) {
    return [{ type: "Feature", geometry: data, properties: {} }];
  }
  for (const k of ["punteros", "points", "markers", "features", "puntos"]) {
    if (Array.isArray(data[k])) return normalizarAFeatures(data[k]);
  }
  const unico = objetoLatLngAFeature(data);
  return unico ? [unico] : [];
}

/** true si el GeoJSON declara un sistema de coordenadas que no es lat/lon WGS84. */
function crsNoWgs84(data) {
  const nombre = data?.crs?.properties?.name;
  if (!nombre) return false;
  return !/(4326|CRS84|WGS ?84)/i.test(String(nombre));
}

function HerramientasDibujo({
  onChange,
  position = "topleft",
  registerAddMarker,
  registerImportar,
}) {
  const map = useMap();
  const drawnItemsRef = useRef(null);
  const controlRef = useRef(null);

  // Guardamos las últimas versiones de los callbacks en refs para que el
  // efecto de abajo NO tenga que reiniciarse cada vez que el padre se
  // re-renderiza (ej. al escribir en los inputs de lat/lon/nombre/nota).
  // Antes, `registerAddMarker` iba directo en las dependencias del efecto:
  // como en cada render el padre pasaba una función nueva, el efecto se
  // desmontaba/remontaba constantemente, borrando el FeatureGroup y el
  // control de dibujo (por eso dejaba de dibujar y se perdían los puntos).
  const onChangeRef = useRef(onChange);
  const registerAddMarkerRef = useRef(registerAddMarker);
  const registerImportarRef = useRef(registerImportar);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    registerAddMarkerRef.current = registerAddMarker;
  }, [registerAddMarker]);

  useEffect(() => {
    registerImportarRef.current = registerImportar;
  }, [registerImportar]);

  useEffect(() => {
    if (!map) return;
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    const emit = () => {
      if (typeof onChangeRef.current === "function") {
        onChangeRef.current(drawnItems.toGeoJSON());
      }
    };

    const control = new L.Control.Draw({
      position,
      draw: {
        polyline: { shapeOptions: { color: "#e74c3c", weight: 3 } },
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: "#2980b9", weight: 2, fillOpacity: 0.25 },
        },
        rectangle: {
          shapeOptions: { color: "#8e44ad", weight: 2, fillOpacity: 0.2 },
        },
        circle: false,
        circlemarker: false,
        marker: true,
      },
      edit: { featureGroup: drawnItems, remove: true },
    });
    map.addControl(control);
    controlRef.current = control;

    const onCreated = (e) => {
      let layer = e.layer;
      if (e.layerType === "marker") {
        habilitarPunteroEditable(layer, emit);
        drawnItems.addLayer(layer);
        emit();
        layer.openPopup(); // pide nombre/nota apenas se coloca
      } else {
        drawnItems.addLayer(layer);
        emit();
      }
    };
    const onEdited = () => emit();
    const onDeleted = () => emit();
    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, onEdited);
    map.on(L.Draw.Event.DELETED, onDeleted);

    // Permite que el panel externo (inputs de lat/lon manuales) agregue
    // punteros programáticamente, reusando el mismo FeatureGroup y el
    // mismo popup editable que los creados a mano con la barra de dibujo.
    if (typeof registerAddMarkerRef.current === "function") {
      registerAddMarkerRef.current((lat, lng, name, note) => {
        const marker = L.marker([lat, lng]);
        habilitarPunteroEditable(marker, emit, { name, note });
        drawnItems.addLayer(marker);
        emit();
        map.panTo([lat, lng]);
        marker.openPopup();
      });
    }

    // Importar un archivo: cada punto entra como puntero editable y cada
    // línea/polígono como figura suelta del mismo FeatureGroup, para que la
    // barra de dibujo pueda editarlos/borrarlos y se exporten igual que los
    // dibujados a mano. Devuelve cuántos elementos se agregaron.
    if (typeof registerImportarRef.current === "function") {
      registerImportarRef.current((features) => {
        let puntos = 0;
        let figuras = 0;
        let omitidas = 0;
        const agregadas = [];

        const agregarHoja = (layer, props) => {
          if (layer instanceof L.Marker) {
            const ll = layer.getLatLng();
            const marker = L.marker(ll);
            habilitarPunteroEditable(marker, emit, {
              ...props,
              name: primerTexto(props, CLAVES_NOMBRE),
              note: primerTexto(props, CLAVES_NOTA),
            });
            drawnItems.addLayer(marker);
            agregadas.push(marker);
            puntos += 1;
          } else if (layer instanceof L.Polyline) {
            const estilo =
              layer instanceof L.Polygon
                ? { color: "#2980b9", weight: 2, fillOpacity: 0.25 }
                : { color: "#e74c3c", weight: 3 };
            layer.setStyle(estilo);
            layer.feature = {
              type: "Feature",
              properties: { ...props },
            };
            const nombre = primerTexto(props, CLAVES_NOMBRE);
            if (nombre) layer.bindTooltip(nombre, { sticky: true });
            drawnItems.addLayer(layer);
            agregadas.push(layer);
            figuras += 1;
          } else {
            omitidas += 1;
          }
        };

        // Recorre grupos anidados (MultiPoint, GeometryCollection) hasta las capas simples.
        const recorrer = (layer, props) => {
          if (layer instanceof L.LayerGroup) {
            layer.eachLayer((hijo) => recorrer(hijo, props));
          } else {
            agregarHoja(layer, props);
          }
        };

        for (const f of features) {
          try {
            const grupo = L.geoJSON(f);
            const props = f?.properties || {};
            let n = 0;
            grupo.eachLayer((l) => {
              n += 1;
              recorrer(l, props);
            });
            if (n === 0) omitidas += 1;
          } catch (err) {
            console.warn("[Importar GeoJSON] elemento omitido:", err);
            omitidas += 1;
          }
        }

        if (agregadas.length > 0) {
          emit();
          const b = L.featureGroup(agregadas).getBounds();
          if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
        }
        return { puntos, figuras, omitidas };
      });
    }

    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      map.off(L.Draw.Event.EDITED, onEdited);
      map.off(L.Draw.Event.DELETED, onDeleted);
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
      if (drawnItemsRef.current) {
        map.removeLayer(drawnItemsRef.current);
        drawnItemsRef.current = null;
      }
      if (typeof registerAddMarkerRef.current === "function") {
        registerAddMarkerRef.current(null);
      }
      if (typeof registerImportarRef.current === "function") {
        registerImportarRef.current(null);
      }
    };
    // OJO: SOLO map y position — nada de onChange/registerAddMarker aquí,
    // esos ya se leen vía ref y no deben reiniciar el efecto.
  }, [map, position]);

  return null;
}

/**
 * Evita un crash conocido (y nunca arreglado) de Leaflet:
 * https://github.com/Leaflet/Leaflet/issues/6981
 *
 * `invalidateSize()` programa un `setTimeout(..., 200ms)` interno que
 * guarda en `map._sizeTimer`. Si el contenedor del mapa se remueve del
 * DOM (p.ej. al desmontar este componente al cambiar de pestaña) antes
 * de que pasen esos 200ms, el timer igual se dispara e intenta leer la
 * posición de un pane que ya no existe:
 *   "Cannot read properties of undefined (reading '_leaflet_pos')"
 * `map.remove()` de Leaflet NO limpia ese timer por su cuenta. Lo
 * limpiamos acá a mano, justo antes de que el mapa se desmonte, para
 * que ese callback fantasma nunca llegue a ejecutarse.
 */
function MapCrashGuard() {
  const map = useMap();
  useEffect(() => {
    return () => {
      if (map && map._sizeTimer) {
        clearTimeout(map._sizeTimer);
        map._sizeTimer = null;
      }
    };
  }, [map]);
  return null;
}

/** Registra la instancia del mapa en un ref externo (para sync). */
function MapInstanceRegistrar({ mapRef }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

function PixelPopup({ pixelInfo, bandName, onClose, sideLabel }) {
  if (!pixelInfo) return null;
  return (
    <Popup
      position={[pixelInfo.lat, pixelInfo.lng]}
      eventHandlers={{ remove: onClose }}
    >
      {pixelInfo.loading ? (
        "Consultando valor…"
      ) : pixelInfo.data?.status !== "ok" ? (
        pixelInfo.data?.message || "Error consultando el valor."
      ) : pixelInfo.data.in_bounds === false ? (
        "Fuera del área del producto."
      ) : pixelInfo.data.is_nodata ? (
        "Sin dato (nodata) en este punto."
      ) : (
        <div style={{ fontSize: "12px" }}>
          {sideLabel && (
            <div style={{ color: "#667eea", fontWeight: 700, marginBottom: 2 }}>
              {sideLabel}
            </div>
          )}
          <strong>{bandName}</strong>
          <div>Valor: {pixelInfo.data.value?.toFixed(4)}</div>
          <div style={{ color: "#888", marginTop: "2px" }}>
            fila {pixelInfo.data.row}, col {pixelInfo.data.col}
          </div>
        </div>
      )}
    </Popup>
  );
}

/** Panel bajo los mapas: valor izquierdo + derecho + diferencia en el mismo punto. */
function PanelPixelComparacion({
  pixelLeft,
  pixelRight,
  itemLeft,
  itemRight,
  onClose,
}) {
  if (!pixelLeft && !pixelRight) return null;

  const lat = pixelLeft?.lat ?? pixelRight?.lat;
  const lng = pixelLeft?.lng ?? pixelRight?.lng;
  const loading = pixelLeft?.loading || pixelRight?.loading;

  const vL =
    pixelLeft?.data?.status === "ok" &&
    pixelLeft?.data?.in_bounds !== false &&
    !pixelLeft?.data?.is_nodata &&
    typeof pixelLeft?.data?.value === "number"
      ? pixelLeft.data.value
      : null;
  const vR =
    pixelRight?.data?.status === "ok" &&
    pixelRight?.data?.in_bounds !== false &&
    !pixelRight?.data?.is_nodata &&
    typeof pixelRight?.data?.value === "number"
      ? pixelRight.data.value
      : null;
  const delta = vL != null && vR != null ? vR - vL : null;

  return (
    <div style={estilos.pixelComparePanel}>
      <div style={estilos.pixelCompareHeader}>
        <strong style={{ fontSize: "13px" }}>
          📍 Punto inspeccionado
          {lat != null && lng != null
            ? ` · ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
            : ""}
        </strong>
        <button
          type="button"
          style={estilos.pixelCompareCerrar}
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: "12px", color: "#666" }}>
          Consultando ambos productos…
        </div>
      ) : (
        <div style={estilos.pixelCompareGrid}>
          <div style={estilos.pixelCompareCard}>
            <div style={estilos.pixelCompareSide}>Izquierda</div>
            <div style={{ fontSize: "12px", fontWeight: 600 }}>
              {itemLeft?.step}
              {itemLeft?.band_name ? ` — ${itemLeft.band_name}` : ""}
            </div>
            <div style={estilos.pixelCompareValor}>
              {formatearValorPixel(pixelLeft?.data)}
            </div>
            {pixelLeft?.data?.status === "ok" &&
              pixelLeft?.data?.row != null && (
                <div style={{ fontSize: "11px", color: "#888" }}>
                  fila {pixelLeft.data.row}, col {pixelLeft.data.col}
                </div>
              )}
          </div>
          <div style={estilos.pixelCompareCard}>
            <div style={estilos.pixelCompareSide}>Derecha</div>
            <div style={{ fontSize: "12px", fontWeight: 600 }}>
              {itemRight?.step}
              {itemRight?.band_name ? ` — ${itemRight.band_name}` : ""}
            </div>
            <div style={estilos.pixelCompareValor}>
              {formatearValorPixel(pixelRight?.data)}
            </div>
            {pixelRight?.data?.status === "ok" &&
              pixelRight?.data?.row != null && (
                <div style={{ fontSize: "11px", color: "#888" }}>
                  fila {pixelRight.data.row}, col {pixelRight.data.col}
                </div>
              )}
          </div>
          {delta != null && (
            <div style={estilos.pixelCompareDelta}>
              <span style={{ color: "#555" }}>Δ (Derecha − Izquierda)</span>
              <strong
                style={{
                  color: delta > 0 ? "#c0392b" : delta < 0 ? "#2980b9" : "#333",
                  fontSize: "15px",
                }}
              >
                {delta > 0 ? "+" : ""}
                {delta.toFixed(4)}
              </strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Panel bajo el mapa en modo simple: coordenada + valor del producto inspeccionado. */
function PanelPixelSimple({ pixelInfo, item, onClose }) {
  if (!pixelInfo) return null;

  const { lat, lng, loading, data } = pixelInfo;

  return (
    <div style={estilos.pixelComparePanel}>
      <div style={estilos.pixelCompareHeader}>
        <strong style={{ fontSize: "13px" }}>
          📍 Punto inspeccionado
          {lat != null && lng != null
            ? ` · ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
            : ""}
        </strong>
        <button
          type="button"
          style={estilos.pixelCompareCerrar}
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: "12px", color: "#666" }}>
          Consultando el producto…
        </div>
      ) : (
        <div style={estilos.pixelCompareCard}>
          <div style={{ fontSize: "12px", fontWeight: 600 }}>
            {item?.step}
            {item?.band_name ? ` — ${item.band_name}` : ""}
          </div>
          <div style={estilos.pixelCompareValor}>
            {formatearValorPixel(data)}
          </div>
          {data?.status === "ok" && data?.row != null && (
            <div style={{ fontSize: "11px", color: "#888" }}>
              fila {data.row}, col {data.col}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MapaProducto({
  bounds,
  item,
  previewUrl,
  onPixel,
  pixelInfo,
  onClosePixel,
  enableDraw,
  onGeomsChange,
  registerAddMarker,
  registerImportar,
  mapRef,
  gotoLat,
  gotoLng,
  gotoTick,
  fitOnce,
  otherItem,
  onPixelOther,
  sideLabel,
  filtro,
}) {
  if (!bounds || !item) return null;
  return (
    <MapContainer
      bounds={bounds}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <LayersControl position="topright">
        <BaseLayer checked name="OpenStreetMap">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
        </BaseLayer>
        <BaseLayer name="Satélite (Esri)">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
          />
        </BaseLayer>
      </LayersControl>

      {previewUrl && (
        <OverlayConFiltro url={previewUrl} bounds={bounds} filtro={filtro} />
      )}

      <InspectorDePixel
        selectedItem={item}
        otherItem={otherItem}
        onResultado={onPixel}
        onResultadoOther={onPixelOther}
        enabled={Boolean(item?.output_tiff)}
      />
      <PixelPopup
        pixelInfo={pixelInfo}
        bandName={item?.band_name}
        onClose={onClosePixel}
        sideLabel={sideLabel}
      />

      {fitOnce && <FitBoundsOnce bounds={bounds} />}
      <GotoControl lat={gotoLat} lng={gotoLng} trigger={gotoTick} />
      <MapCrashGuard />
      {enableDraw && (
        <HerramientasDibujo
          onChange={onGeomsChange}
          registerAddMarker={registerAddMarker}
          registerImportar={registerImportar}
        />
      )}
      {mapRef && <MapInstanceRegistrar mapRef={mapRef} />}
    </MapContainer>
  );
}

export default function MapaVisualizador({
  items = [],
  title = "Visor geoespacial",
  outputDir = "",
  onAddItems,
}) {
  const validItems = useMemo(
    () =>
      items.filter(
        (it) =>
          it.status === "ok" &&
          (it.output_tiff || it.quicklook_png || it.preview_url),
      ),
    [items],
  );

  const [selectedId, setSelectedId] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const [modo, setModo] = useState("single"); // 'single' | 'compare'
  const [boundsById, setBoundsById] = useState({});
  const [geoMetaById, setGeoMetaById] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pixelInfo, setPixelInfo] = useState(null);
  const [pixelInfoRight, setPixelInfoRight] = useState(null);
  const [mapaListo, setMapaListo] = useState(false);
  const [gotoLat, setGotoLat] = useState("");
  const [gotoLng, setGotoLng] = useState("");
  const [gotoTick, setGotoTick] = useState(0);
  const [geometrias, setGeometrias] = useState(null);

  const pathsConsultados = useRef(new Set());
  // Bandera SÍNCRONA (no state) para saber si hay una consulta de bounds
  // en curso. Se necesita porque, al montar el componente, el efecto que
  // arranca la consulta de georreferencia (setLoading(true)) y el efecto
  // de selección automática corren en el MISMO commit: el segundo lee el
  // `loading` de state todavía desactualizado (false) y no espera a que
  // termine el fetch. Con un ref, el primer efecto puede avisarle al
  // segundo "ya arranqué" de forma inmediata, sin depender del re-render.
  const cargaEnCursoRef = useRef(false);
  const mapLeftRef = useRef(null);
  const mapRightRef = useRef(null);
  const [panelCargaAbierto, setPanelCargaAbierto] = useState(false);
  const [productosDisco, setProductosDisco] = useState([]);
  const [cargandoDisco, setCargandoDisco] = useState(false);
  const [errorDisco, setErrorDisco] = useState(null);
  const [parFiltro, setParFiltro] = useState("todos");
  const [seleccionDisco, setSeleccionDisco] = useState(() => new Set());
  // --- Funciones heredadas del antiguo Visualizador ---
  const [paleta, setPaleta] = useState("viridis");
  const [brillo, setBrillo] = useState(100);
  const [contraste, setContraste] = useState(100);
  const [ajustesAbiertos, setAjustesAbiertos] = useState(true);
  const [dibujoAbierto, setDibujoAbierto] = useState(true);
  const [infoAbierta, setInfoAbierta] = useState(false);
  const [infoArchivo, setInfoArchivo] = useState(null);
  const [panelServidorAbierto, setPanelServidorAbierto] = useState(false);
  const [archivosServidor, setArchivosServidor] = useState([]);
  const [filtroServidor, setFiltroServidor] = useState("");
  const [cargandoServidor, setCargandoServidor] = useState(false);
  const [errorServidor, setErrorServidor] = useState(null);
  const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [avisoApertura, setAvisoApertura] = useState(null); // { tipo: 'error' | 'ok', texto }
  // Imagen recién abierta que hay que seleccionar cuando el padre la agregue
  const [clavePendiente, setClavePendiente] = useState(null);
  // true cuando el usuario eligió un producto a mano: la selección automática
  // ya no lo reemplaza aunque no tenga georreferencia (p. ej. un JPG).
  const seleccionManualRef = useRef(false);
  const fileInputRef = useRef(null);
  const filtro = useMemo(
    () => filtroCss({ paleta, brillo, contraste }),
    [paleta, brillo, contraste],
  );

  const addMarkerRef = useRef(null);
  const handleRegisterAddMarker = useCallback((fn) => {
    addMarkerRef.current = fn;
  }, []);
  const importarRef = useRef(null);
  const handleRegisterImportar = useCallback((fn) => {
    importarRef.current = fn;
  }, []);
  const archivoPunterosRef = useRef(null);
  const [avisoImport, setAvisoImport] = useState(null); // { tipo: 'error' | 'ok', texto }

  const cargarArchivoPunteros = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    if (typeof importarRef.current !== "function") {
      setAvisoImport({ tipo: "error", texto: "El mapa todavía no está listo para importar." });
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setAvisoImport({
        tipo: "error",
        texto: `"${file.name}" no es un JSON válido.`,
      });
      return;
    }
    const features = normalizarAFeatures(data);
    if (features.length === 0) {
      setAvisoImport({
        tipo: "error",
        texto:
          `"${file.name}" no tiene elementos reconocibles. Se espera un GeoJSON ` +
          "(FeatureCollection / Feature) o una lista con lat y lon.",
      });
      return;
    }
    const r = importarRef.current(features);
    const partes = [];
    if (r.puntos) partes.push(`${r.puntos} puntero${r.puntos === 1 ? "" : "s"}`);
    if (r.figuras) partes.push(`${r.figuras} figura${r.figuras === 1 ? "" : "s"}`);
    let texto = partes.length
      ? `Cargado "${file.name}": ${partes.join(" y ")}.`
      : `No se pudo agregar ningún elemento de "${file.name}".`;
    if (r.omitidas) texto += ` ${r.omitidas} elemento(s) omitido(s).`;
    if (crsNoWgs84(data)) {
      texto +=
        " Atención: el archivo declara un sistema de coordenadas distinto de WGS84 " +
        "(lat/lon); los puntos pueden quedar fuera de lugar.";
    }
    setAvisoImport({
      tipo: partes.length && !crsNoWgs84(data) ? "ok" : "error",
      texto,
    });
  }, []);
  const punteros = useMemo(() => {
    if (!geometrias?.features?.length) return [];
    return geometrias.features
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => f.geometry?.type === "Point")
      .map(({ f, idx }) => ({
        idx,
        name: f.properties?.name || `Puntero ${idx + 1}`,
        note: f.properties?.note || "",
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      }));
  }, [geometrias]);

  const irAPuntero = useCallback((p) => {
    setGotoLat(String(p.lat));
    setGotoLng(String(p.lng));
    setGotoTick((t) => t + 1);
  }, []);
  const [nuevoPunteroLat, setNuevoPunteroLat] = useState("");
  const [nuevoPunteroLng, setNuevoPunteroLng] = useState("");
  const [nuevoPunteroNombre, setNuevoPunteroNombre] = useState("");
  const [nuevoPunteroNota, setNuevoPunteroNota] = useState("");

  const agregarPunteroManual = useCallback(() => {
    const lat = parseFloat(nuevoPunteroLat);
    const lng = parseFloat(nuevoPunteroLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    if (typeof addMarkerRef.current === "function") {
      addMarkerRef.current(lat, lng, nuevoPunteroNombre, nuevoPunteroNota);
    }
    setNuevoPunteroLat("");
    setNuevoPunteroLng("");
    setNuevoPunteroNombre("");
    setNuevoPunteroNota("");
  }, [nuevoPunteroLat, nuevoPunteroLng, nuevoPunteroNombre, nuevoPunteroNota]);
  useEffect(() => {
    setPixelInfo(null);
    setPixelInfoRight(null);
  }, [selectedId, compareId, modo]);

  // Cargar bounds
  useEffect(() => {
    let cancelado = false;
    const pendientes = validItems.filter(
      (it) => it.output_tiff && !pathsConsultados.current.has(it.output_tiff),
    );
    if (pendientes.length === 0) {
      cargaEnCursoRef.current = false;
      setLoading(false);
      return;
    }
    cargaEnCursoRef.current = true;

    async function cargarBounds() {
      setLoading(true);
      setError(null);
      const resultados = await Promise.all(
        pendientes.map(async (item) => {
          // OJO: NO marcamos el path como "consultado" acá todavía. Si lo
          // hiciéramos antes de esperar la respuesta, una cancelación de
          // este efecto (por ejemplo el doble-montaje de StrictMode en
          // desarrollo, o salir/volver rápido de la pestaña) dejaría el
          // path marcado para siempre aunque el fetch nunca haya llegado a
          // aplicarse, y el mapa quedaba atascado en "Sin georreferencia"
          // sin reintentar jamás. Lo marcamos recién más abajo, solo si el
          // efecto no fue cancelado.
          const itemId = item.id || item.step;
          try {
            const res = await fetch(
              `${API_BASE}/geo-info-path?path=${encodeURIComponent(
                item.output_tiff,
              )}`,
            );
            const data = await res.json();
            console.log(
              `[MapaVisualizador] geo-info-path(${itemId}) -> status=${data.status} has_georeference=${data.has_georeference} message=${data.message || ""}`,
            );
            if (data.status === "ok" && data.has_georeference && data.bounds) {
              const b = data.bounds;
              return {
                id: itemId,
                path: item.output_tiff,
                bounds: [
                  [b.south, b.west],
                  [b.north, b.east],
                ],
                meta: {
                  has_georeference: true,
                  source: data.source || "unknown",
                  crs: data.crs_original,
                },
              };
            }
            return {
              id: itemId,
              path: item.output_tiff,
              bounds: null,
              meta: {
                has_georeference: false,
                message: data.message || "Sin georreferenciación embebida.",
              },
            };
          } catch (e) {
            console.error(`[MapaVisualizador] geo-info falló ${itemId}:`, e);
            return {
              id: itemId,
              path: item.output_tiff,
              bounds: null,
              meta: {
                has_georeference: false,
                message: "Error de georreferencia.",
              },
            };
          }
        }),
      );
      if (cancelado) {
        // Efecto cancelado (desmontaje real o doble-invocación de
        // StrictMode): NO marcamos nada como consultado, para que la
        // próxima vez que el componente/efecto corra, vuelva a intentarlo
        // en vez de quedarse atascado con boundsById vacío para siempre.
        return;
      }
      for (const r of resultados) pathsConsultados.current.add(r.path);
      setBoundsById((prev) => {
        const next = { ...prev };
        for (const r of resultados) {
          if (r.bounds) next[r.id] = r.bounds;
        }
        if (Object.keys(next).length > 0) setMapaListo(true);
        return next;
      });
      setGeoMetaById((prev) => {
        const next = { ...prev };
        for (const r of resultados) next[r.id] = r.meta;
        return next;
      });
      cargaEnCursoRef.current = false;
      setLoading(false);
    }
    cargarBounds();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validItems]);

  // Selección automática
  //
  // Antes: chequeaba `!loading` leído de state, pero en el primer commit
  // (justo al montar, o al re-montar al volver de otra pestaña) el efecto
  // de arriba (Cargar bounds) todavía no había hecho efectivo su
  // setLoading(true) para ESTE efecto — ambos corren en el mismo commit
  // con el `loading` de state desactualizado. Resultado: este efecto
  // "adivinaba" eligiendo validItems[0] ANTES de tener respuesta del
  // backend, y si ese primer producto no tenía georreferencia, el mapa
  // quedaba pegado en "Sin georreferencia" para siempre porque después
  // no se volvía a re-evaluar la elección.
  //
  // Ahora: usa `cargaEnCursoRef` (ref síncrono) para esperar a que la
  // consulta realmente termine, y se auto-corrige si el seleccionado
  // actual no tiene bounds válidos (no solo cuando no hay selección),
  // así que también se recupera solo al volver de otra pestaña.
  useEffect(() => {
    if (cargaEnCursoRef.current) return; // aún consultando georreferencia

    // Ya hay una selección con bounds válidos, o el usuario eligió a mano
    // (aunque no tenga geo): no tocar nada.
    if (
      selectedId &&
      (boundsById[selectedId] ||
        (seleccionManualRef.current &&
          validItems.some((it) => (it.id || it.step) === selectedId)))
    )
      return;

    const conGeo = validItems.find((it) => boundsById[it.id || it.step]);
    if (conGeo) {
      setSelectedId(conGeo.id || conGeo.step);
    } else if (!selectedId && validItems.length > 0) {
      // Nada tiene georreferencia: al menos mostrar algo (visor de imagen).
      setSelectedId(validItems[0].id || validItems[0].step);
    }
  }, [boundsById, validItems, selectedId, loading]);

  // Segundo producto por defecto: otro con geo distinto al primero
  useEffect(() => {
    if (modo !== "compare" || compareId) return;
    const otros = validItems.filter((it) => {
      const id = it.id || it.step;
      return id !== selectedId && boundsById[id];
    });
    if (otros.length > 0) setCompareId(otros[0].id || otros[0].step);
  }, [modo, compareId, selectedId, validItems, boundsById]);

  // Cuando hay al menos 2 con geo, asignar L/R si faltan (solo al comparar,
  // para no reemplazar en vista simple una imagen sin geo elegida a mano)
  useEffect(() => {
    if (modo !== "compare") return;
    const conGeo = validItems.filter((it) => boundsById[it.id || it.step]);
    if (conGeo.length < 2) return;
    if (!selectedId || !boundsById[selectedId]) {
      setSelectedId(conGeo[0].id || conGeo[0].step);
    }
    if (!compareId || !boundsById[compareId] || compareId === selectedId) {
      const otro = conGeo.find((it) => {
        const id = it.id || it.step;
        return id !== (selectedId || conGeo[0].id || conGeo[0].step);
      });
      if (otro) setCompareId(otro.id || otro.step);
    }
  }, [modo, validItems, boundsById, selectedId, compareId]);

  // Seleccionar la imagen recién abierta en cuanto el padre la agregue
  useEffect(() => {
    if (!clavePendiente) return;
    const it = validItems.find((v) => v.clave === clavePendiente);
    if (!it) return;
    seleccionManualRef.current = true;
    setModo("single");
    setSelectedId(it.id || it.step);
    setClavePendiente(null);
  }, [clavePendiente, validItems]);

  // Sincronizar los dos mapas (pan/zoom + cursor)
  useEffect(() => {
    if (modo !== "compare") return undefined;

    const cursorOpts = {
      syncCursor: true,
      syncCursorMarkerOptions: {
        radius: 8,
        weight: 2,
        color: "#e74c3c",
        fillColor: "#e74c3c",
        fillOpacity: 0.35,
        opacity: 0.9,
      },
    };

    let leftMap = null;
    let rightMap = null;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40;
    let timerId = null;

    const trySync = () => {
      if (cancelled) return;
      const left = mapLeftRef.current;
      const right = mapRightRef.current;
      if (!left || !right) {
        attempts += 1;
        if (attempts < maxAttempts) {
          timerId = setTimeout(trySync, 100);
        }
        return;
      }
      try {
        try {
          left.unsync(right);
          right.unsync(left);
        } catch (_) {
          /* ignore */
        }
        left.sync(right, cursorOpts);
        right.sync(left, cursorOpts);
        right.setView(left.getCenter(), left.getZoom(), { animate: false });
        leftMap = left;
        rightMap = right;
      } catch (e) {
        console.warn("[MapaVisualizador] leaflet.sync falló:", e);
      }
    };

    timerId = setTimeout(trySync, 50);

    return () => {
      cancelled = true;
      if (timerId != null) clearTimeout(timerId);
      try {
        if (leftMap && rightMap) {
          leftMap.unsync(rightMap);
          rightMap.unsync(leftMap);
        }
      } catch (_) {
        /* ignore */
      }
    };
  }, [modo, selectedId, compareId, mapaListo]);

  const selectedItem = validItems.find(
    (it) => (it.id || it.step) === selectedId,
  );
  const compareItem = validItems.find((it) => (it.id || it.step) === compareId);
  const selectedBounds = selectedId ? boundsById[selectedId] : null;
  const compareBounds = compareId ? boundsById[compareId] : null;
  const selectedMeta = selectedId ? geoMetaById[selectedId] : null;
  const tieneGeo = Boolean(selectedBounds);
  const compareTieneGeo = Boolean(compareBounds);
  useEffect(() => {
    console.log(
      `[MapaVisualizador] estado -> selectedId=${selectedId} mapaListo=${mapaListo} loading=${loading} tieneGeo=${tieneGeo} boundsKeys=[${Object.keys(boundsById).join(", ")}] selectedMetaMsg=${selectedMeta?.message || ""} selectedMetaGeo=${selectedMeta?.has_georeference}`,
    );
  }, [selectedId, mapaListo, loading, tieneGeo, boundsById, selectedMeta]);
  const previewUrl = selectedItem ? buildPreviewUrl(selectedItem) : null;
  const comparePreviewUrl = compareItem ? buildPreviewUrl(compareItem) : null;
  const nGeoms = geometrias?.features?.length || 0;

  const itemsConGeo = useMemo(
    () => validItems.filter((it) => boundsById[it.id || it.step]),
    [validItems, boundsById],
  );

  const descargarGeoJSON = useCallback(() => {
    if (!geometrias || !geometrias.features?.length) return;
    const blob = new Blob([JSON.stringify(geometrias, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zonas_${selectedItem?.step || "mapa"}_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }, [geometrias, selectedItem]);

  const labelOption = (it) => {
    const itemId = it.id || it.step;
    const geo = Boolean(boundsById[itemId]);
    const origen =
      {
        flujo: "🔄 ",
        individual: "🎯 ",
        local: "📱 ",
        servidor: "🗂️ ",
      }[it.origen] || "";
    return `${origen}${it.step}${it.band_name ? ` — ${it.band_name}` : ""}${
      geo ? " 📍" : " (sin geo)"
    }`;
  };
  const cargarListaDisco = async () => {
    setCargandoDisco(true);
    setErrorDisco(null);
    try {
      const q = outputDir ? `?base_dir=${encodeURIComponent(outputDir)}` : "";
      const res = await fetch(`${API_BASE}/productos-visualizables${q}`);
      const data = await res.json();
      if (data.status !== "ok") {
        setErrorDisco(data.message || "No se pudieron listar productos");
        setProductosDisco([]);
        return;
      }
      setProductosDisco(data.productos || []);
      setSeleccionDisco(new Set());
    } catch (e) {
      setErrorDisco(String(e.message || e));
      setProductosDisco([]);
    } finally {
      setCargandoDisco(false);
    }
  };

  const toggleSeleccionDisco = (tiffPath) => {
    setSeleccionDisco((prev) => {
      const next = new Set(prev);
      if (next.has(tiffPath)) {
        next.delete(tiffPath);
        return next;
      }
      // Máximo 2 para comparación lado a lado
      if (next.size >= 2) {
        // reemplaza el más antiguo: quita el primero y añade el nuevo
        const arr = [...next];
        arr.shift();
        return new Set([...arr, tiffPath]);
      }
      next.add(tiffPath);
      return next;
    });
  };

  const agregarSeleccionadosAlMapa = () => {
    if (!onAddItems || seleccionDisco.size === 0) return;
    const elegidos = productosDisco.filter((p) =>
      seleccionDisco.has(p.output_tiff),
    );
    onAddItems(elegidos);
    setPanelCargaAbierto(false);
    setSeleccionDisco(new Set());
    if (elegidos.length >= 2) {
      setModo("compare");
    }
  };

  // ================== Abrir imágenes (local / servidor) ==================
  const agregarYSeleccionar = (item, origen) => {
    const clave = nuevaClave();
    onAddItems([{ status: "ok", band_name: "", ...item, clave }], origen);
    setClavePendiente(clave);
  };

  // JPG/PNG/...: se muestran directo en el navegador (sin georreferencia).
  // TIFF: se sube al backend, que lo convierte a PNG y devuelve también la
  // ruta del TIFF en el servidor, así el mapa puede georreferenciarlo y
  // leer valores de píxel igual que un producto procesado.
  const abrirArchivoLocal = async (file) => {
    if (!file || !onAddItems) return;
    const ext = extension(file.name);
    if (!EXT_IMAGEN.includes(ext)) {
      setAvisoApertura({
        tipo: "error",
        texto: `Formato no soportado: ${ext.toUpperCase() || "?"}`,
      });
      return;
    }
    setAvisoApertura(null);

    if (!esTiff(file.name)) {
      agregarYSeleccionar(
        {
          step: file.name,
          preview_url: URL.createObjectURL(file),
          archivo_local: file,
        },
        "local",
      );
      return;
    }

    setAbriendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`${API_BASE}/convert-image/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.path) {
        throw new Error(data.message || data.error || `HTTP ${resp.status}`);
      }
      agregarYSeleccionar(
        {
          step: file.name,
          output_tiff: data.path,
          preview_url: data.image_url ? `${API_BASE}${data.image_url}` : undefined,
        },
        "local",
      );
    } catch (e) {
      setAvisoApertura({
        tipo: "error",
        texto: `No se pudo abrir ${file.name}: ${e.message}`,
      });
    } finally {
      setAbriendo(false);
    }
  };

  // Guarda en backend/files/images una imagen local (no TIFF) abierta en el visor
  const guardarEnServidor = async (item) => {
    if (!item?.archivo_local) return;
    setAbriendo(true);
    try {
      const fd = new FormData();
      fd.append("file", item.archivo_local);
      const resp = await fetch(`${API_BASE}/files/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);
      setAvisoApertura({
        tipo: "ok",
        texto: `✅ ${item.step} guardado en el servidor (${
          (data.path || "").split("/").pop() || "images"
        })`,
      });
    } catch (e) {
      setAvisoApertura({ tipo: "error", texto: `Error al subir: ${e.message}` });
    } finally {
      setAbriendo(false);
    }
  };

  // Lista plana de imágenes en backend/files/images (input) y files/output.
  // /archivos-disponibles las devuelve agrupadas por par de fechas.
  const cargarArchivosServidor = async () => {
    setCargandoServidor(true);
    setErrorServidor(null);
    try {
      const [cfg, lista] = await Promise.all([
        fetch(`${API_BASE}/config`).then((r) => r.json()),
        fetch(`${API_BASE}/archivos-disponibles`).then((r) => r.json()),
      ]);
      if (lista.status !== "ok") {
        throw new Error(lista.message || "No se pudieron listar los archivos");
      }
      const raiz = {
        input: cfg.default_images_dir,
        output: cfg.default_output_dir,
      };
      const archivos = [];
      for (const carpeta of ["input", "output"]) {
        const grupo = lista.files_by_category?.[carpeta] || {};
        const rutas = [
          ...(grupo.pares || []).flatMap((p) =>
            p.archivos.map((a) => `${p.folder}/${a}`),
          ),
          ...(grupo.sueltos || []),
        ];
        for (const rel of rutas) {
          if (!EXT_IMAGEN.includes(extension(rel))) continue;
          archivos.push({
            carpeta,
            rel,
            abs: raiz[carpeta] ? `${raiz[carpeta]}/${rel}` : null,
          });
        }
      }
      setArchivosServidor(archivos);
    } catch (e) {
      setErrorServidor(String(e.message || e));
      setArchivosServidor([]);
    } finally {
      setCargandoServidor(false);
    }
  };

  const abrirArchivoServidor = (a) => {
    if (!onAddItems) return;
    const carpetaBackend = a.carpeta === "input" ? "images" : a.carpeta;
    const item = {
      step: a.rel.split("/").pop(),
      ruta_servidor: a.abs,
      descarga_url: `${API_BASE}/download/${carpetaBackend}/${codificarRuta(a.rel)}`,
    };
    if (esTiff(a.rel) && a.abs) item.output_tiff = a.abs;
    else item.preview_url = `${API_BASE}/files/${carpetaBackend}/${codificarRuta(a.rel)}`;
    setAvisoApertura(null);
    agregarYSeleccionar(item, "servidor");
  };

  const archivosServidorVisibles = useMemo(() => {
    const q = filtroServidor.trim().toLowerCase();
    return q
      ? archivosServidor.filter((a) => a.rel.toLowerCase().includes(q))
      : archivosServidor;
  }, [archivosServidor, filtroServidor]);

  // Información del archivo seleccionado (tamaño, dimensiones, bandas, CRS)
  const rutaInfo = selectedItem?.output_tiff || selectedItem?.ruta_servidor;
  useEffect(() => {
    if (!infoAbierta || !rutaInfo) {
      setInfoArchivo(null);
      return undefined;
    }
    let cancelado = false;
    fetch(`${API_BASE}/info-archivo-path?path=${encodeURIComponent(rutaInfo)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado) {
          setInfoArchivo(
            d.status === "ok" ? d.file_info : { error: d.message || "Sin información" },
          );
        }
      })
      .catch((e) => {
        if (!cancelado) setInfoArchivo({ error: String(e.message || e) });
      });
    return () => {
      cancelado = true;
    };
  }, [infoAbierta, rutaInfo]);

  // Arrastrar y soltar una imagen sobre cualquier parte del visor
  const onDragOver = (e) => {
    if (!onAddItems || !e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    setArrastrandoArchivo(true);
  };
  const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setArrastrandoArchivo(false);
  };
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    setArrastrandoArchivo(false);
    abrirArchivoLocal(e.dataTransfer.files[0]);
  };

  const paletaActual = PALETAS.find((p) => p.value === paleta) || PALETAS[0];

  const seleccionar = (id, lado = "izq") => {
    seleccionManualRef.current = true;
    if (lado === "der") setCompareId(id);
    else setSelectedId(id);
  };

  const abrirPanelDisco = () => {
    setPanelServidorAbierto(false);
    setPanelCargaAbierto(true);
    cargarListaDisco();
  };
  const abrirPanelServidor = () => {
    setPanelCargaAbierto(false);
    setPanelServidorAbierto(true);
    cargarArchivosServidor();
  };

  // ---------------------- Área del mapa / visor ----------------------
  let areaMapa;
  if (validItems.length === 0) {
    areaMapa = (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50">
          <MapIcon className="h-7 w-7 text-indigo-600" />
        </span>
        <div>
          <div className="text-base font-semibold text-slate-800">
            Todavía no hay imágenes en el visor
          </div>
          <div className="mt-1 max-w-md text-sm text-slate-500">
            Procesa un flujo, carga resultados procesados o abre una imagen
            de tu equipo. También puedes arrastrarla a esta pantalla.
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Btn icon={FolderOpen} onClick={abrirPanelDisco}>
            Resultados procesados
          </Btn>
          <Btn icon={Upload} onClick={() => fileInputRef.current?.click()} disabled={!onAddItems || abriendo}>
            Abrir del equipo
          </Btn>
          {MOSTRAR_SERVIDOR && (
            <Btn icon={Server} onClick={abrirPanelServidor}>
              Del servidor
            </Btn>
          )}
        </div>
      </div>
    );
  } else if (
    modo === "compare" &&
    tieneGeo &&
    compareTieneGeo &&
    mapaListo &&
    selectedBounds &&
    compareBounds
  ) {
    areaMapa = (
      <div className="grid h-full grid-cols-2 gap-px bg-slate-200">
        {[
          { lado: "Izquierda", item: selectedItem, bounds: selectedBounds, url: previewUrl, px: pixelInfo, setPx: setPixelInfo, setOtro: setPixelInfoRight, ref: mapLeftRef, otro: compareItem },
          { lado: "Derecha", item: compareItem, bounds: compareBounds, url: comparePreviewUrl, px: pixelInfoRight, setPx: setPixelInfoRight, setOtro: setPixelInfo, ref: mapRightRef, otro: selectedItem },
        ].map((m) => (
          <div key={m.lado} className="flex min-h-0 min-w-0 flex-col bg-white">
            <div className="flex items-center gap-2 border-b border-solid border-slate-200 px-3 py-1.5 text-xs">
              <Badge tone={m.lado === "Izquierda" ? "indigo" : "amber"}>{m.lado}</Badge>
              <span className="truncate font-medium text-slate-700" title={m.item?.step}>
                {m.item?.step}
                {m.item?.band_name ? ` — ${m.item.band_name}` : ""}
              </span>
            </div>
            <div className="relative min-h-0 flex-1">
              <MapaProducto
                bounds={m.bounds}
                item={m.item}
                previewUrl={m.url}
                onPixel={m.setPx}
                pixelInfo={m.px}
                onClosePixel={() => m.setPx(null)}
                enableDraw={false}
                mapRef={m.ref}
                gotoLat={gotoLat}
                gotoLng={gotoLng}
                gotoTick={gotoTick}
                fitOnce
                otherItem={m.otro}
                onPixelOther={m.setOtro}
                sideLabel={m.lado}
                filtro={filtro}
              />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (modo === "single" && tieneGeo && mapaListo && selectedBounds) {
    areaMapa = (
      <MapaProducto
        bounds={selectedBounds}
        item={selectedItem}
        previewUrl={previewUrl}
        onPixel={setPixelInfo}
        pixelInfo={pixelInfo}
        onClosePixel={() => setPixelInfo(null)}
        enableDraw
        onGeomsChange={setGeometrias}
        registerAddMarker={handleRegisterAddMarker}
        registerImportar={handleRegisterImportar}
        gotoLat={gotoLat}
        gotoLng={gotoLng}
        gotoTick={gotoTick}
        fitOnce
        filtro={filtro}
      />
    );
  } else if (loading && !previewUrl) {
    areaMapa = (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Consultando la georreferenciación…
      </div>
    );
  } else if (modo === "compare" && itemsConGeo.length < 2) {
    areaMapa = (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
        Para comparar necesitas al menos 2 imágenes georreferenciadas.
      </div>
    );
  } else if (previewUrl) {
    areaMapa = (
      <VisorImagen
        src={previewUrl}
        alt={selectedItem?.band_name || selectedItem?.step}
        filtro={filtro}
      />
    );
  } else {
    areaMapa = (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
        {error || "Este producto no tiene preview ni georreferenciación."}
      </div>
    );
  }

  // Línea de estado bajo la barra del mapa
  let estado = null;
  if (modo === "compare") {
    estado = (
      <>
        <Columns2 className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
        Mapas sincronizados: el zoom y el cursor se replican. Haz clic en
        cualquiera para ver el valor del píxel en ambos y su diferencia (Δ).
      </>
    );
  } else if (selectedItem && tieneGeo) {
    estado = (
      <>
        <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        Georreferenciado{selectedMeta?.source ? ` (vía ${selectedMeta.source})` : ""}.
        Haz clic para ver el valor del píxel · usa la barra izquierda del mapa
        para dibujar.
      </>
    );
  } else if (selectedItem && !loading) {
    estado = (
      <>
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        Sin georreferencia{selectedMeta?.message ? `: ${selectedMeta.message}` : ""}.
        Se muestra como imagen (rueda = zoom, arrastrar = mover).
      </>
    );
  }

  const ORIGEN = {
    flujo: "Flujo",
    individual: "Gráfico",
    disco: "Procesado",
    local: "Local",
    servidor: "Servidor",
  };

  return (
    <div
      className="gwe relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={EXT_IMAGEN.map((e) => `.${e}`).join(",")}
        className="hidden"
        onChange={(e) => {
          abrirArchivoLocal(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="flex w-full flex-col gap-3 rounded-xl border border-solid border-slate-200 bg-slate-50 p-4 text-slate-800">
        {/* Encabezado */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            <div className="text-xs text-slate-500">
              Visualiza, compara y ajusta imágenes procesadas, del servidor o de tu equipo.
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-solid border-slate-200 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setModo("single")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                modo === "single" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Square className="h-3.5 w-3.5" /> Vista simple
            </button>
            <button
              type="button"
              onClick={() => {
                setModo("compare");
                setPanelCargaAbierto(false);
              }}
              disabled={itemsConGeo.length < 2}
              title={
                itemsConGeo.length < 2
                  ? "Necesitas 2 imágenes georreferenciadas para comparar"
                  : "Ver dos imágenes lado a lado"
              }
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                modo === "compare" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" /> Comparar
            </button>
          </div>
        </div>

        {avisoApertura && (
          <div
            className={`flex items-start gap-2 rounded-lg border border-solid px-3 py-2 text-sm ${
              avisoApertura.tipo === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {avisoApertura.tipo === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="flex-1 whitespace-pre-wrap">{avisoApertura.texto}</span>
            <IconBtn icon={X} label="Cerrar aviso" onClick={() => setAvisoApertura(null)} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* =================== Panel lateral =================== */}
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-sm lg:h-[calc(100vh-230px)] lg:min-h-[520px]">
            <div className="border-b border-solid border-slate-200 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agregar imágenes
              </div>
              <div className="flex flex-col gap-1.5">
                <Btn icon={FolderOpen} size="sm" className="justify-start" onClick={abrirPanelDisco}>
                  Resultados procesados
                </Btn>
                <Btn
                  icon={abriendo ? Loader2 : Upload}
                  size="sm"
                  className="justify-start"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!onAddItems || abriendo}
                  title="PNG/JPG se ven directo; los TIFF se convierten y, si traen georreferencia, se ubican en el mapa"
                >
                  {abriendo ? "Abriendo…" : "Abrir del equipo"}
                </Btn>
                {MOSTRAR_SERVIDOR && (
                  <Btn icon={Server} size="sm" className="justify-start" onClick={abrirPanelServidor}>
                    Del servidor
                  </Btn>
                )}
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                o arrastra un archivo sobre el visor
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Capas */}
              <div className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Capas ({validItems.length})
                  </span>
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                </div>
                {validItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                    Sin imágenes todavía
                  </div>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {validItems.map((it) => {
                      const id = it.id || it.step;
                      const geo = Boolean(boundsById[id]);
                      const izq = id === selectedId;
                      const der = modo === "compare" && id === compareId;
                      return (
                        <li
                          key={id}
                          className={`flex items-start gap-1 rounded-lg border border-solid transition-colors ${
                            izq
                              ? "border-indigo-300 bg-indigo-50"
                              : der
                                ? "border-amber-300 bg-amber-50"
                                : "border-transparent hover:bg-slate-50"
                          }`}
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left"
                            onClick={() => seleccionar(id)}
                            disabled={modo === "compare" && !geo}
                            title={it.step}
                          >
                            <div className="truncate text-sm font-medium text-slate-800">{it.step}</div>
                            {it.band_name && (
                              <div className="truncate text-xs text-slate-500">{it.band_name}</div>
                            )}
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Badge tone={geo ? "emerald" : "slate"}>
                                {geo ? <MapPin className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                                {geo ? "Georref." : "Sin geo"}
                              </Badge>
                              {ORIGEN[it.origen] && <Badge>{ORIGEN[it.origen]}</Badge>}
                            </div>
                          </button>
                          {modo === "compare" && geo && (
                            <div className="flex flex-col gap-1 p-1.5">
                              <button
                                type="button"
                                onClick={() => seleccionar(id, "izq")}
                                title="Mostrar a la izquierda"
                                className={`h-6 w-7 cursor-pointer rounded text-[11px] font-semibold ${
                                  izq ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                }`}
                              >
                                Izq
                              </button>
                              <button
                                type="button"
                                onClick={() => seleccionar(id, "der")}
                                title="Mostrar a la derecha"
                                className={`h-6 w-7 cursor-pointer rounded text-[11px] font-semibold ${
                                  der ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                }`}
                              >
                                Der
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Ajustes de imagen */}
              <Seccion
                icon={SlidersHorizontal}
                titulo="Ajustes de imagen"
                abierta={ajustesAbiertos}
                onToggle={() => setAjustesAbiertos((v) => !v)}
              >
                <label className="mb-1 block text-xs font-medium text-slate-600">Paleta</label>
                <select className={inputCls} value={paleta} onChange={(e) => setPaleta(e.target.value)}>
                  {PALETAS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div
                  className="mt-1.5 h-2.5 rounded-full border border-solid border-slate-200"
                  style={{ background: `linear-gradient(to right, ${paletaActual.colors.join(", ")})` }}
                />
                {[
                  { label: "Brillo", valor: brillo, set: setBrillo },
                  { label: "Contraste", valor: contraste, set: setContraste },
                ].map((s) => (
                  <div key={s.label} className="mt-3">
                    <div className="mb-1 flex justify-between text-xs font-medium text-slate-600">
                      <span>{s.label}</span>
                      <span className="tabular-nums text-slate-400">{s.valor}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={s.valor}
                      onChange={(e) => s.set(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                ))}
                <Btn
                  icon={RotateCcw}
                  size="sm"
                  variant="ghost"
                  className="mt-2 w-full"
                  onClick={() => {
                    setPaleta("viridis");
                    setBrillo(100);
                    setContraste(100);
                  }}
                >
                  Restablecer
                </Btn>
                <p className="m-0 mt-1 text-[11px] leading-snug text-slate-400">
                  Filtro visual sobre la imagen (en ambos lados al comparar). No
                  cambia los valores de píxel.
                </p>
              </Seccion>

              {/* Información */}
              <Seccion
                icon={Info}
                titulo="Información"
                abierta={infoAbierta}
                onToggle={() => setInfoAbierta((v) => !v)}
                disabled={!selectedItem}
              >
                {selectedItem && (
                  <>
                    <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                      <dt className="text-slate-500">Archivo</dt>
                      <dd className="m-0 break-all text-slate-800">{selectedItem.step}</dd>
                      {selectedItem.band_name && (
                        <>
                          <dt className="text-slate-500">Banda</dt>
                          <dd className="m-0 text-slate-800">{selectedItem.band_name}</dd>
                        </>
                      )}
                      <dt className="text-slate-500">Origen</dt>
                      <dd className="m-0 text-slate-800">
                        {{
                          flujo: "Flujo completo",
                          individual: "Gráfico individual",
                          disco: "Resultados procesados",
                          local: "Archivo local",
                          servidor: "Servidor",
                        }[selectedItem.origen] || selectedItem.origen || "—"}
                      </dd>
                      <dt className="text-slate-500">Georref.</dt>
                      <dd className="m-0 text-slate-800">
                        {selectedMeta?.has_georeference
                          ? `Sí${selectedMeta.source ? ` (${selectedMeta.source})` : ""}`
                          : selectedMeta?.message || "No"}
                      </dd>
                      {selectedItem.archivo_local && (
                        <>
                          <dt className="text-slate-500">Tamaño</dt>
                          <dd className="m-0 text-slate-800">
                            {(selectedItem.archivo_local.size / (1024 * 1024)).toFixed(2)} MB
                          </dd>
                        </>
                      )}
                      {infoArchivo &&
                        !infoArchivo.error &&
                        Object.entries(infoArchivo)
                          .filter(([k]) => k !== "nombre")
                          .map(([k, v]) => (
                            <React.Fragment key={k}>
                              <dt className="capitalize text-slate-500">{k.replace(/_/g, " ")}</dt>
                              <dd className="m-0 break-all text-slate-800">{String(v ?? "—")}</dd>
                            </React.Fragment>
                          ))}
                      {rutaInfo && (
                        <>
                          <dt className="text-slate-500">Ruta</dt>
                          <dd className="m-0 break-all text-[11px] text-slate-500">{rutaInfo}</dd>
                        </>
                      )}
                    </dl>
                    {infoArchivo?.error && (
                      <div className="mt-2 text-xs text-red-600">{infoArchivo.error}</div>
                    )}
                    {(selectedItem.descarga_url || selectedItem.archivo_local) && (
                      <div className="mt-3 flex flex-col gap-1.5">
                        {selectedItem.descarga_url && (
                          <a
                            href={selectedItem.descarga_url}
                            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-solid border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 no-underline shadow-sm hover:bg-slate-50"
                          >
                            <Download className="h-4 w-4" /> Descargar original
                          </a>
                        )}
                        {selectedItem.archivo_local && (
                          <Btn
                            icon={UploadCloud}
                            size="sm"
                            onClick={() => guardarEnServidor(selectedItem)}
                            disabled={abriendo}
                          >
                            Guardar en el servidor
                          </Btn>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Seccion>

              {/* Dibujo y punteros (solo vista simple georreferenciada) */}
              {modo === "single" && tieneGeo && (
                <Seccion
                  icon={PenLine}
                  titulo={`Dibujo y punteros${nGeoms ? ` (${nGeoms})` : ""}`}
                  abierta={dibujoAbierto}
                  onToggle={() => setDibujoAbierto((v) => !v)}
                >
                  <p className="m-0 mb-2 text-[11px] leading-snug text-slate-500">
                    Dibuja puntos, líneas o polígonos con la barra de la
                    izquierda del mapa, agrega un puntero por coordenadas o
                    carga un archivo .geojson / .json.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input className={inputCls} placeholder="Lat" value={nuevoPunteroLat} onChange={(e) => setNuevoPunteroLat(e.target.value)} />
                    <input className={inputCls} placeholder="Lon" value={nuevoPunteroLng} onChange={(e) => setNuevoPunteroLng(e.target.value)} />
                  </div>
                  <input className={`${inputCls} mt-1.5`} placeholder="Nombre (opcional)" value={nuevoPunteroNombre} onChange={(e) => setNuevoPunteroNombre(e.target.value)} />
                  <input className={`${inputCls} mt-1.5`} placeholder="Nota (opcional)" value={nuevoPunteroNota} onChange={(e) => setNuevoPunteroNota(e.target.value)} />
                  <div className="mt-2 flex gap-1.5">
                    <Btn
                      icon={MapPin}
                      size="sm"
                      variant="primary"
                      className="flex-1"
                      onClick={agregarPunteroManual}
                      disabled={!nuevoPunteroLat || !nuevoPunteroLng}
                    >
                      Agregar puntero
                    </Btn>
                    <IconBtn
                      icon={Upload}
                      label="Cargar punteros (.geojson / .json)"
                      className="h-8 w-8 border border-solid border-slate-200"
                      onClick={() => archivoPunterosRef.current?.click()}
                    />
                    <IconBtn
                      icon={Download}
                      label="Exportar GeoJSON"
                      className="h-8 w-8 border border-solid border-slate-200"
                      onClick={descargarGeoJSON}
                      disabled={nGeoms === 0}
                    />
                    <input
                      ref={archivoPunterosRef}
                      type="file"
                      accept=".geojson,.json,application/geo+json,application/json"
                      className="hidden"
                      onChange={cargarArchivoPunteros}
                    />
                  </div>
                  {avisoImport && (
                    <div
                      className={`mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug ${
                        avisoImport.tipo === "error"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {avisoImport.tipo === "error" ? (
                        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="flex-1">{avisoImport.texto}</span>
                      <button
                        type="button"
                        onClick={() => setAvisoImport(null)}
                        className="cursor-pointer border-0 bg-transparent p-0 text-current opacity-60 hover:opacity-100"
                        aria-label="Cerrar aviso"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {punteros.length > 0 && (
                    <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
                      {punteros.map((p) => (
                        <li key={p.idx}>
                          <button
                            type="button"
                            onClick={() => irAPuntero(p)}
                            title="Ir a este puntero"
                            className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                          >
                            <div className="text-xs font-medium text-slate-800">{p.name}</div>
                            {p.note && <div className="text-[11px] text-slate-500">{p.note}</div>}
                            <div className="text-[11px] tabular-nums text-slate-400">
                              {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {punteros.length > 0 && (
                    <p className="m-0 mt-1 text-[11px] text-slate-400">
                      Para borrar usa la papelera de la barra de dibujo del mapa.
                    </p>
                  )}
                </Seccion>
              )}
            </div>
          </aside>

          {/* =================== Mapa =================== */}
          <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-solid border-slate-200 px-3 py-2">
              {modo === "compare" ? (
                <>
                  <Badge tone="indigo">Izq</Badge>
                  <select
                    className={`${inputCls} w-auto max-w-[220px]`}
                    value={selectedId || ""}
                    onChange={(e) => seleccionar(e.target.value, "izq")}
                  >
                    {itemsConGeo.map((it) => (
                      <option key={it.id || it.step} value={it.id || it.step}>
                        {labelOption(it)}
                      </option>
                    ))}
                  </select>
                  <Badge tone="amber">Der</Badge>
                  <select
                    className={`${inputCls} w-auto max-w-[220px]`}
                    value={compareId || ""}
                    onChange={(e) => seleccionar(e.target.value, "der")}
                  >
                    {itemsConGeo.map((it) => (
                      <option key={it.id || it.step} value={it.id || it.step}>
                        {labelOption(it)}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <div className="min-w-0 truncate text-sm font-medium text-slate-800">
                  {selectedItem
                    ? `${selectedItem.step}${selectedItem.band_name ? ` — ${selectedItem.band_name}` : ""}`
                    : "Sin imagen seleccionada"}
                </div>
              )}

              {((modo === "single" && tieneGeo) || (modo === "compare" && tieneGeo && compareTieneGeo)) && (
                <div
                  className="ml-auto flex items-center gap-1.5"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && gotoLat && gotoLng) setGotoTick((t) => t + 1);
                  }}
                >
                  <Crosshair className="h-4 w-4 text-slate-400" />
                  <input className={`${inputCls} w-24`} placeholder="Lat" value={gotoLat} onChange={(e) => setGotoLat(e.target.value)} />
                  <input className={`${inputCls} w-24`} placeholder="Lon" value={gotoLng} onChange={(e) => setGotoLng(e.target.value)} />
                  <Btn size="sm" onClick={() => setGotoTick((t) => t + 1)} disabled={!gotoLat || !gotoLng}>
                    Ir
                  </Btn>
                </div>
              )}
            </div>

            {estado && (
              <div className="flex items-center gap-1.5 border-b border-solid border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                {estado}
              </div>
            )}

            <div className="relative h-[calc(100vh-330px)] min-h-[420px] bg-slate-100">{areaMapa}</div>

            {modo === "compare" && tieneGeo && compareTieneGeo && (
              <div className="border-t border-solid border-slate-200 p-2">
                <PanelPixelComparacion
                  pixelLeft={pixelInfo}
                  pixelRight={pixelInfoRight}
                  itemLeft={selectedItem}
                  itemRight={compareItem}
                  onClose={() => {
                    setPixelInfo(null);
                    setPixelInfoRight(null);
                  }}
                />
              </div>
            )}
            {modo === "single" && tieneGeo && pixelInfo && (
              <div className="border-t border-solid border-slate-200 p-2">
                <PanelPixelSimple pixelInfo={pixelInfo} item={selectedItem} onClose={() => setPixelInfo(null)} />
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Soltar archivo */}
      {arrastrandoArchivo && (
        <div className="pointer-events-none absolute inset-0 z-[1200] flex items-center justify-center rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-50/80">
          <div className="flex flex-col items-center gap-2 text-indigo-700">
            <UploadCloud className="h-10 w-10" />
            <div className="text-base font-semibold">Suelta la imagen para abrirla</div>
            <div className="text-xs">TIFF, PNG, JPG, GIF, BMP o WebP</div>
          </div>
        </div>
      )}

      {/* =================== Modal: resultados procesados =================== */}
      {panelCargaAbierto && (
        <Modal
          titulo="Resultados procesados"
          subtitulo={
            outputDir
              ? `Previews en ${outputDir.split("/").filter(Boolean).slice(-1)[0]} · elige 1 para verlo o 2 para comparar`
              : "Elige 1 para verlo o 2 para compararlos"
          }
          onClose={() => setPanelCargaAbierto(false)}
          acciones={
            <>
              <Btn variant="ghost" onClick={() => setPanelCargaAbierto(false)}>
                Cancelar
              </Btn>
              <Btn
                variant="primary"
                icon={Plus}
                disabled={seleccionDisco.size === 0}
                onClick={agregarSeleccionadosAlMapa}
              >
                {seleccionDisco.size === 2
                  ? "Añadir y comparar"
                  : `Añadir al mapa (${seleccionDisco.size}/2)`}
              </Btn>
            </>
          }
        >
          {(() => {
            const pares = [
              ...new Map(
                productosDisco
                  .filter((p) => p.par)
                  .map((p) => [p.par, { par: p.par, fecha1: p.fecha1, fecha2: p.fecha2 }]),
              ).values(),
            ].sort((x, y) => (x.fecha1 || "").localeCompare(y.fecha1 || ""));
            const sueltos = productosDisco.some((p) => !p.par);
            const visibles =
              parFiltro === "todos"
                ? productosDisco
                : parFiltro === "__sueltos__"
                  ? productosDisco.filter((p) => !p.par)
                  : productosDisco.filter((p) => p.par === parFiltro);
            return (
              <>
                <div className="mb-3 flex gap-2">
                  {pares.length > 0 && (
                    <select className={`${inputCls} h-9`} value={parFiltro} onChange={(e) => setParFiltro(e.target.value)}>
                      <option value="todos">Todos los pares ({productosDisco.length})</option>
                      {pares.map((p) => (
                        <option key={p.par} value={p.par}>
                          {p.fecha1} → {p.fecha2}
                        </option>
                      ))}
                      {sueltos && <option value="__sueltos__">Sin par identificado</option>}
                    </select>
                  )}
                  <Btn
                    icon={cargandoDisco ? Loader2 : RefreshCw}
                    onClick={cargarListaDisco}
                    disabled={cargandoDisco}
                    className="ml-auto"
                  >
                    Actualizar
                  </Btn>
                </div>
                {errorDisco && <div className="mb-2 text-sm text-red-600">{errorDisco}</div>}
                {!cargandoDisco && productosDisco.length === 0 && !errorDisco && (
                  <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                    No hay GeoTIFF de preview en esa carpeta. Ejecuta al menos
                    un flujo o un gráfico que genere visualizaciones.
                  </div>
                )}
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {visibles.map((p) => {
                    const sel = seleccionDisco.has(p.output_tiff);
                    return (
                      <li key={p.output_tiff}>
                        <label
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border border-solid px-3 py-2 transition-colors ${
                            sel ? "border-indigo-300 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-indigo-600"
                            checked={sel}
                            onChange={() => toggleSeleccionDisco(p.output_tiff)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-slate-800">
                              {p.step}
                              {p.band_name && <span className="font-normal text-slate-500"> — {p.band_name}</span>}
                            </span>
                            {p.par && (
                              <span className="text-xs text-indigo-600">
                                {p.fecha1} → {p.fecha2}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            );
          })()}
        </Modal>
      )}

      {/* =================== Modal: archivos del servidor =================== */}
      {panelServidorAbierto && (
        <Modal
          titulo="Imágenes del servidor"
          subtitulo="backend/files/images y backend/files/output"
          onClose={() => setPanelServidorAbierto(false)}
          acciones={
            <Btn variant="ghost" onClick={() => setPanelServidorAbierto(false)}>
              Cerrar
            </Btn>
          }
        >
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className={`${inputCls} h-9 pl-8`}
                placeholder="Filtrar por nombre o fecha…"
                value={filtroServidor}
                onChange={(e) => setFiltroServidor(e.target.value)}
                autoFocus
              />
            </div>
            <Btn icon={cargandoServidor ? Loader2 : RefreshCw} onClick={cargarArchivosServidor} disabled={cargandoServidor}>
              Actualizar
            </Btn>
          </div>
          {errorServidor && <div className="mb-2 text-sm text-red-600">{errorServidor}</div>}
          {!cargandoServidor && archivosServidorVisibles.length === 0 && !errorServidor && (
            <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              {archivosServidor.length === 0
                ? "No hay imágenes en backend/files/images ni en backend/files/output."
                : "Ningún archivo coincide con el filtro."}
            </div>
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {archivosServidorVisibles.map((a) => {
              const partes = a.rel.split("/");
              const nombre = partes.pop();
              return (
                <li
                  key={`${a.carpeta}/${a.rel}`}
                  className="flex items-center gap-2 rounded-lg border border-solid border-slate-200 px-3 py-2 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800" title={a.rel}>
                      {nombre}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Badge tone={a.carpeta === "input" ? "slate" : "indigo"}>
                        {a.carpeta === "input" ? "images" : "output"}
                      </Badge>
                      <span className="truncate" title={partes.join("/")}>
                        {partes.join(" / ")}
                      </span>
                    </div>
                  </div>
                  <Btn
                    size="sm"
                    variant="primary"
                    icon={Eye}
                    onClick={() => {
                      abrirArchivoServidor(a);
                      setPanelServidorAbierto(false);
                    }}
                  >
                    Ver
                  </Btn>
                  <a
                    href={`${API_BASE}/download/${a.carpeta === "input" ? "images" : "output"}/${codificarRuta(a.rel)}`}
                    title="Descargar el archivo original"
                    aria-label="Descargar el archivo original"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/** Sección plegable del panel lateral. */
function Seccion({ icon: Icon, titulo, abierta, onToggle, disabled, children }) {
  return (
    <div className="border-t border-solid border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={abierta}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="flex-1">{titulo}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${abierta ? "rotate-180" : ""}`} />
      </button>
      {abierta && !disabled && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** Ventana modal (se cierra con Escape o clic fuera). */
function Modal({ titulo, subtitulo, onClose, acciones, children }) {
  const cerrarRef = useRef(onClose);
  cerrarRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && cerrarRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-solid border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-slate-900">{titulo}</div>
            {subtitulo && <div className="mt-0.5 text-xs text-slate-500">{subtitulo}</div>}
          </div>
          <IconBtn icon={X} label="Cerrar" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {acciones && (
          <div className="flex justify-end gap-2 border-t border-solid border-slate-200 px-5 py-3">{acciones}</div>
        )}
      </div>
    </div>
  );
}

const estilos = {
  imageViewer: {
    height: "100%",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1a1a1a",
  },
  imagePreview: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  },
  pixelComparePanel: {
    marginTop: "8px",
    padding: "10px 12px",
    background: "#f7f9fc",
    border: "1px solid #c5d0e8",
    borderRadius: "8px",
  },
  pixelCompareHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
    flexWrap: "wrap",
  },
  pixelCompareCerrar: {
    padding: "4px 10px",
    fontSize: "12px",
    borderRadius: "4px",
    border: "1px solid #bbb",
    background: "#fff",
    cursor: "pointer",
    color: "#555",
  },
  pixelCompareGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
  },
  pixelCompareCard: {
    background: "#fff",
    border: "1px solid #e0e4ef",
    borderRadius: "6px",
    padding: "8px 10px",
  },
  pixelCompareSide: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#667eea",
    marginBottom: "2px",
    textTransform: "uppercase",
    letterSpacing: "0.02em",
  },
  pixelCompareValor: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#222",
    marginTop: "4px",
    fontFamily: "ui-monospace, monospace",
  },
  pixelCompareDelta: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "8px 10px",
    background: "#fff",
    border: "1px dashed #b0bec5",
    borderRadius: "6px",
    marginTop: "2px",
  },
};
