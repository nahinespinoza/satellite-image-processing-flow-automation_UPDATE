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

import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const API_BASE = "http://localhost:5000";
const { BaseLayer } = LayersControl;

function buildPreviewUrl(item) {
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

function HerramientasDibujo({ onChange, position = "topleft" }) {
  const map = useMap();
  const drawnItemsRef = useRef(null);
  const controlRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    const emit = () => {
      if (typeof onChange === "function") onChange(drawnItems.toGeoJSON());
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
      drawnItems.addLayer(e.layer);
      emit();
    };
    const onEdited = () => emit();
    const onDeleted = () => emit();
    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, onEdited);
    map.on(L.Draw.Event.DELETED, onDeleted);

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
    };
  }, [map, onChange, position]);

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

function MapaProducto({
  bounds,
  item,
  previewUrl,
  onPixel,
  pixelInfo,
  onClosePixel,
  enableDraw,
  onGeomsChange,
  mapRef,
  gotoLat,
  gotoLng,
  gotoTick,
  fitOnce,
  otherItem,
  onPixelOther,
  sideLabel,
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
        <ImageOverlay url={previewUrl} bounds={bounds} opacity={0.9} />
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
      {enableDraw && <HerramientasDibujo onChange={onGeomsChange} />}
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
        (it) => it.status === "ok" && (it.output_tiff || it.quicklook_png),
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
  const mapLeftRef = useRef(null);
  const mapRightRef = useRef(null);
  const [panelCargaAbierto, setPanelCargaAbierto] = useState(false);
  const [productosDisco, setProductosDisco] = useState([]);
  const [cargandoDisco, setCargandoDisco] = useState(false);
  const [errorDisco, setErrorDisco] = useState(null);
  const [seleccionDisco, setSeleccionDisco] = useState(() => new Set());
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
      setLoading(false);
      return;
    }

    async function cargarBounds() {
      setLoading(true);
      setError(null);
      const resultados = await Promise.all(
        pendientes.map(async (item) => {
          pathsConsultados.current.add(item.output_tiff);
          const itemId = item.id || item.step;
          try {
            const res = await fetch(
              `${API_BASE}/geo-info-path?path=${encodeURIComponent(
                item.output_tiff,
              )}`,
            );
            const data = await res.json();
            if (data.status === "ok" && data.has_georeference && data.bounds) {
              const b = data.bounds;
              return {
                id: itemId,
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
              bounds: null,
              meta: {
                has_georeference: false,
                message: "Error de georreferencia.",
              },
            };
          }
        }),
      );
      if (cancelado) return;
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
      setLoading(false);
    }
    cargarBounds();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validItems]);

  // Selección automática
  useEffect(() => {
    if (selectedId) return;
    const conGeo = validItems.find((it) => boundsById[it.id || it.step]);
    if (conGeo) setSelectedId(conGeo.id || conGeo.step);
    else if (validItems.length > 0 && !loading) {
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

  // Cuando hay al menos 2 con geo, asignar L/R si faltan
  useEffect(() => {
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
  }, [validItems, boundsById, selectedId, compareId]);

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
      it.origen === "flujo" ? "🔄 " : it.origen === "individual" ? "🎯 " : "";
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
  return (
    <div style={estilos.contenedor}>
      {title && <h3 style={estilos.titulo}>🗺️ {title}</h3>}
      <div style={estilos.cargaBarra}>
        <button
          type="button"
          style={estilos.cargaBtn}
          onClick={() => {
            const abrir = !panelCargaAbierto;
            setPanelCargaAbierto(abrir);
            if (abrir) cargarListaDisco();
          }}
        >
          📂 Cargar resultados procesados
        </button>
        <span style={{ fontSize: "11px", color: "#888" }}>
          Para comparar pares ya corridos sin volver a procesar
        </span>
      </div>

      {panelCargaAbierto && (
        <div style={estilos.cargaPanel}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <strong style={{ fontSize: "13px" }}>
              Productos en disco
              {outputDir ? ` (${outputDir})` : ""}
            </strong>
            <button
              type="button"
              style={estilos.gotoBtn}
              onClick={cargarListaDisco}
              disabled={cargandoDisco}
            >
              {cargandoDisco ? "Buscando…" : "🔄 Actualizar"}
            </button>
          </div>

          {errorDisco && (
            <div
              style={{
                color: "#c0392b",
                fontSize: "12px",
                marginBottom: "8px",
              }}
            >
              {errorDisco}
            </div>
          )}

          {!cargandoDisco && productosDisco.length === 0 && !errorDisco && (
            <div style={{ fontSize: "12px", color: "#888" }}>
              No se encontraron GeoTIFF de preview en esa carpeta. Ejecuta al
              menos un flujo o un gráfico que genere visualizaciones.
            </div>
          )}

          <div style={estilos.cargaLista}>
            {productosDisco.map((p) => (
              <label key={p.output_tiff} style={estilos.cargaItem}>
                <input
                  type="checkbox"
                  checked={seleccionDisco.has(p.output_tiff)}
                  onChange={() => toggleSeleccionDisco(p.output_tiff)}
                />
                <span style={{ fontSize: "12px" }}>
                  <strong>{p.step}</strong>
                  {p.band_name ? (
                    <span style={{ color: "#666" }}> — {p.band_name}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
            <button
              type="button"
              style={{
                ...estilos.gotoBtn,
                opacity: seleccionDisco.size === 0 ? 0.5 : 1,
              }}
              disabled={seleccionDisco.size === 0}
              onClick={agregarSeleccionadosAlMapa}
            >
              ➕ Añadir {seleccionDisco.size}/2 al mapa
            </button>
            <button
              type="button"
              style={{
                ...estilos.modoBtn,
                padding: "5px 12px",
              }}
              onClick={() => setPanelCargaAbierto(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Controles superiores */}
      <div style={estilos.toolbar}>
        <div style={estilos.modoGrupo}>
          <button
            type="button"
            onClick={() => setModo("single")}
            style={{
              ...estilos.modoBtn,
              ...(modo === "single" ? estilos.modoBtnActivo : {}),
            }}
          >
            Vista simple
          </button>
          <button
            type="button"
            onClick={() => {
              setModo("compare");
              setPanelCargaAbierto(false);
            }}
            disabled={itemsConGeo.length < 2}
            style={{
              ...estilos.modoBtn,
              ...(modo === "compare" ? estilos.modoBtnActivo : {}),
              opacity: itemsConGeo.length < 2 ? 0.5 : 1,
            }}
            title={
              itemsConGeo.length < 2
                ? "Selecciona/carga 2 productos con georreferencia (📍)"
                : "Ver lado a lado"
            }
          >
            ⇔ Comparar
          </button>
        </div>

        {modo === "single" && validItems.length > 0 && (
          <div style={estilos.selectorFila}>
            <label style={estilos.selectorLabel}>Banda / paso:</label>
            <select
              value={selectedId || ""}
              onChange={(e) => setSelectedId(e.target.value)}
              style={estilos.select}
            >
              {validItems.map((it) => (
                <option key={it.id || it.step} value={it.id || it.step}>
                  {labelOption(it)}
                </option>
              ))}
            </select>
          </div>
        )}

        {modo === "compare" && (
          <div style={estilos.compareSelectors}>
            <div style={estilos.selectorFila}>
              <label style={estilos.selectorLabel}>Izquierda:</label>
              <select
                value={selectedId || ""}
                onChange={(e) => setSelectedId(e.target.value)}
                style={estilos.select}
              >
                {itemsConGeo.map((it) => (
                  <option key={it.id || it.step} value={it.id || it.step}>
                    {labelOption(it)}
                  </option>
                ))}
              </select>
            </div>
            <div style={estilos.selectorFila}>
              <label style={estilos.selectorLabel}>Derecha:</label>
              <select
                value={compareId || ""}
                onChange={(e) => setCompareId(e.target.value)}
                style={estilos.select}
              >
                {itemsConGeo.map((it) => (
                  <option key={it.id || it.step} value={it.id || it.step}>
                    {labelOption(it)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {loading && <span style={estilos.actualizando}>actualizando…</span>}
      </div>

      {/* Aviso */}
      {selectedItem && modo === "single" && (
        <div
          style={{
            ...estilos.aviso,
            background: tieneGeo ? "#e8f5e9" : "#fff8e1",
            borderColor: tieneGeo ? "#a5d6a7" : "#ffe082",
          }}
        >
          {tieneGeo ? (
            <>
              📍 Georreferenciado
              {selectedMeta?.source ? ` (vía ${selectedMeta.source})` : ""}.
              Click = valor de píxel · barra izquierda = dibujo.
            </>
          ) : (
            <>
              🖼️ Sin georreferencia.
              {selectedMeta?.message ? ` ${selectedMeta.message}` : ""} Visor de
              imagen.
            </>
          )}
        </div>
      )}

      {modo === "compare" && (
        <div
          style={{
            ...estilos.aviso,
            background: "#e3f2fd",
            borderColor: "#90caf9",
          }}
        >
          ⇔ Comparación sincronizada: click y zoom se replican en ambos mapas.
          El puntero (círculo rojo) se duplica en el otro mapa al mover el
          ratón. Click en cualquiera de los dos → valor del píxel en ambos
          productos (misma coordenada) y diferencia Δ.
        </div>
      )}

      {/* Ir a coordenadas */}
      {((modo === "single" && tieneGeo) ||
        (modo === "compare" && tieneGeo && compareTieneGeo)) && (
        <div style={estilos.gotoFila}>
          <label style={estilos.selectorLabel}>Ir a:</label>
          <input
            type="text"
            placeholder="Lat"
            value={gotoLat}
            onChange={(e) => setGotoLat(e.target.value)}
            style={estilos.gotoInput}
          />
          <input
            type="text"
            placeholder="Lon"
            value={gotoLng}
            onChange={(e) => setGotoLng(e.target.value)}
            style={estilos.gotoInput}
          />
          <button
            type="button"
            onClick={() => setGotoTick((t) => t + 1)}
            style={estilos.gotoBtn}
          >
            Ir
          </button>
        </div>
      )}

      {/* Área de mapas */}
      {validItems.length === 0 ? (
        <div style={estilos.mapaWrapper}>
          <div style={estilos.mensaje}>
            No hay productos disponibles para mostrar todavía.
          </div>
        </div>
      ) : modo === "compare" &&
        tieneGeo &&
        compareTieneGeo &&
        mapaListo &&
        selectedBounds &&
        compareBounds ? (
        <>
          <div style={estilos.mapaWrapperCompare}>
            <div style={estilos.panelMapa}>
              <div style={estilos.panelTitulo}>
                Izquierda: {selectedItem?.step}
                {selectedItem?.band_name ? ` — ${selectedItem.band_name}` : ""}
              </div>
              <div style={estilos.panelMapaInner}>
                <MapaProducto
                  bounds={selectedBounds}
                  item={selectedItem}
                  previewUrl={previewUrl}
                  onPixel={setPixelInfo}
                  pixelInfo={pixelInfo}
                  onClosePixel={() => setPixelInfo(null)}
                  enableDraw={false}
                  mapRef={mapLeftRef}
                  gotoLat={gotoLat}
                  gotoLng={gotoLng}
                  gotoTick={gotoTick}
                  fitOnce
                  otherItem={compareItem}
                  onPixelOther={setPixelInfoRight}
                  sideLabel="Izquierda"
                />
              </div>
            </div>
            <div style={estilos.panelMapa}>
              <div style={estilos.panelTitulo}>
                Derecha: {compareItem?.step}
                {compareItem?.band_name ? ` — ${compareItem.band_name}` : ""}
              </div>
              <div style={estilos.panelMapaInner}>
                <MapaProducto
                  bounds={compareBounds}
                  item={compareItem}
                  previewUrl={comparePreviewUrl}
                  onPixel={setPixelInfoRight}
                  pixelInfo={pixelInfoRight}
                  onClosePixel={() => setPixelInfoRight(null)}
                  enableDraw={false}
                  mapRef={mapRightRef}
                  gotoLat={gotoLat}
                  gotoLng={gotoLng}
                  gotoTick={gotoTick}
                  fitOnce
                  otherItem={selectedItem}
                  onPixelOther={setPixelInfo}
                  sideLabel="Derecha"
                />
              </div>
            </div>
          </div>
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
        </>
      ) : modo === "single" && tieneGeo && mapaListo && selectedBounds ? (
        <div style={estilos.mapaWrapper}>
          <MapaProducto
            bounds={selectedBounds}
            item={selectedItem}
            previewUrl={previewUrl}
            onPixel={setPixelInfo}
            pixelInfo={pixelInfo}
            onClosePixel={() => setPixelInfo(null)}
            enableDraw
            onGeomsChange={setGeometrias}
            gotoLat={gotoLat}
            gotoLng={gotoLng}
            gotoTick={gotoTick}
            fitOnce
          />
        </div>
      ) : (
        <div style={estilos.mapaWrapper}>
          <div style={estilos.imageViewer}>
            {loading ? (
              <div style={estilos.mensaje}>
                Consultando georreferenciación de los productos…
              </div>
            ) : modo === "compare" && itemsConGeo.length < 2 ? (
              <div style={estilos.mensaje}>
                Para comparar necesitas al menos 2 productos con georreferencia
                (📍). Procesa más pasos o espera a que carguen los bounds.
              </div>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt={selectedItem?.band_name || selectedItem?.step}
                style={estilos.imagePreview}
              />
            ) : (
              <div style={estilos.mensaje}>
                {error ||
                  "Este producto no tiene preview ni georreferenciación."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Panel dibujo (solo vista simple) */}
      {modo === "single" && tieneGeo && (
        <div style={estilos.dibujoPanel}>
          <div style={{ fontSize: "12px", color: "#555" }}>
            {nGeoms === 0
              ? "Usa la barra del mapa (arriba izquierda) para dibujar puntos, líneas o polígonos."
              : `${nGeoms} geometría(s) dibujada(s)`}
          </div>
          <button
            type="button"
            onClick={descargarGeoJSON}
            disabled={nGeoms === 0}
            style={{
              ...estilos.gotoBtn,
              opacity: nGeoms === 0 ? 0.5 : 1,
              cursor: nGeoms === 0 ? "not-allowed" : "pointer",
            }}
          >
            ⬇️ Exportar GeoJSON
          </button>
        </div>
      )}

      {selectedItem?.band_name && modo === "single" && (
        <div style={estilos.pie}>
          Mostrando <strong>{selectedItem.band_name}</strong> del paso{" "}
          <strong>{selectedItem.step}</strong>
          {tieneGeo ? " · mapa georreferenciado" : " · visor de imagen"}
        </div>
      )}
    </div>
  );
}

const estilos = {
  contenedor: {
    marginTop: "4px",
    marginBottom: "28px",
    width: "100%",
    minHeight: 0,
  },
  titulo: {
    fontSize: "14px",
    color: "#444",
    fontWeight: 700,
    marginBottom: "8px",
  },
  cargaBarra: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "6px",
    flexWrap: "wrap",
  },
  cargaBtn: {
    padding: "6px 12px",
    fontSize: "13px",
    borderRadius: "6px",
    border: "1px solid #667eea",
    background: "#fff",
    color: "#667eea",
    cursor: "pointer",
    fontWeight: 600,
  },
  cargaPanel: {
    background: "#f7f8fc",
    border: "1px solid #d0d8f0",
    borderRadius: "8px",
    padding: "10px",
    marginBottom: "8px",
    maxHeight: "220px",
    overflowY: "auto",
  },
  cargaLista: {
    maxHeight: "140px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  cargaItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "6px 8px",
    background: "#fff",
    borderRadius: "4px",
    border: "1px solid #eee",
    cursor: "pointer",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    marginBottom: "6px",
  },
  modoGrupo: { display: "flex", gap: "4px" },
  modoBtn: {
    padding: "6px 12px",
    fontSize: "13px",
    borderRadius: "6px",
    border: "1px solid #d0d0d0",
    background: "#fff",
    cursor: "pointer",
    color: "#444",
  },
  modoBtnActivo: {
    background: "#667eea",
    borderColor: "#667eea",
    color: "#fff",
    fontWeight: 600,
  },
  selectorFila: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  compareSelectors: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
  },
  selectorLabel: { fontSize: "13px", color: "#555", fontWeight: 600 },
  actualizando: { fontSize: "11px", color: "#999", fontStyle: "italic" },
  select: {
    fontSize: "13px",
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid #d0d0d0",
    background: "#fff",
    minWidth: "200px",
    maxWidth: "340px",
  },
  aviso: {
    fontSize: "12px",
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid",
    marginBottom: "8px",
    color: "#444",
  },
  gotoFila: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
    flexWrap: "wrap",
  },
  gotoInput: {
    width: "110px",
    padding: "5px 8px",
    fontSize: "13px",
    borderRadius: "4px",
    border: "1px solid #ccc",
  },
  gotoBtn: {
    padding: "5px 12px",
    fontSize: "13px",
    borderRadius: "4px",
    border: "1px solid #667eea",
    background: "#667eea",
    color: "#fff",
    cursor: "pointer",
  },
  mapaWrapper: {
    height: "calc(100vh - 220px)",
    minHeight: "420px",
    width: "100%",
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid #e0e0e0",
    background: "#f4f5fa",
  },
  mapaWrapperCompare: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gridTemplateRows: "1fr",
    gap: "8px",
    width: "100%",
    height: "calc(100vh - 220px)",
    minHeight: "480px",
    background: "#dde1ea",
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid #d0d0d0",
  },
  panelMapa: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    background: "#fff",
    borderRadius: "6px",
    overflow: "hidden",
  },
  panelTitulo: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#333",
    padding: "4px 8px",
    background: "#f0f2f8",
    borderBottom: "1px solid #e0e0e0",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 0,
  },
  panelMapaInner: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
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
  mensaje: {
    padding: "24px",
    textAlign: "center",
    color: "#666",
    fontSize: "13px",
  },
  pie: { marginTop: "8px", fontSize: "12px", color: "#777" },
  dibujoPanel: {
    marginTop: "8px",
    padding: "8px 12px",
    background: "#f8f9ff",
    border: "1px solid #d0d8f0",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
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
