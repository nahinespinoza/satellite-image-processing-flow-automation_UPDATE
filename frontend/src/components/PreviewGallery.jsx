import React, { useState } from "react";

const API_BASE = "http://localhost:5000";

/**
 * Construye la URL de preview para un ítem devuelto por el backend
 * ({ status, message, output_tiff, quicklook_png, band_name, step }).
 * Se prioriza el quicklook_png (ya es PNG, renderizado con el mismo motor
 * que SNAP Desktop) y si no existe se cae al output_tiff, que el backend
 * convierte a PNG al vuelo vía /preview-image.
 */
const buildPreviewUrl = (item) => {
  const path = item.quicklook_png || item.output_tiff;
  if (!path) return null;
  return `${API_BASE}/preview-image?path=${encodeURIComponent(path)}`;
};

const PreviewCard = ({ item, onOpen }) => {
  const isOk = item.status === "ok";
  const url = isOk ? buildPreviewUrl(item) : null;

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        overflow: "hidden",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          height: "150px",
          background: "#f4f5fa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: url ? "zoom-in" : "default",
          overflow: "hidden",
        }}
        onClick={() => url && onOpen(url, item)}
      >
        {url ? (
          <img
            src={url}
            alt={item.band_name || item.step}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              padding: "10px",
              textAlign: "center",
              fontSize: "12px",
              color: "#c0392b",
            }}
          >
            ⚠️ Sin preview
            {item.message && (
              <div style={{ marginTop: "4px", color: "#888" }}>
                {item.message}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#333" }}>
          {item.step || "Paso"}
        </div>
        {item.band_name && (
          <div style={{ fontSize: "11px", color: "#777" }}>
            Banda: {item.band_name}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Modal simple tipo lightbox para ver el preview en grande.
 */
const Lightbox = ({ url, item, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.8)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      cursor: "zoom-out",
    }}
  >
    <div style={{ maxWidth: "90vw", maxHeight: "90vh", textAlign: "center" }}>
      <img
        src={url}
        alt={item?.band_name || item?.step}
        style={{ maxWidth: "90vw", maxHeight: "80vh", borderRadius: "6px" }}
      />
      <div style={{ color: "#fff", marginTop: "8px", fontSize: "13px" }}>
        {item?.step} {item?.band_name ? `— ${item.band_name}` : ""}
        <div style={{ fontSize: "11px", color: "#ccc", marginTop: "4px" }}>
          Click fuera de la imagen para cerrar · o ábrela en una pestaña nueva:{" "}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#8ecfff" }}
            onClick={(e) => e.stopPropagation()}
          >
            abrir imagen
          </a>
        </div>
      </div>
    </div>
  </div>
);

/**
 * Galería de previews para un conjunto plano de ítems (usada en el tab
 * "Gráfico Individual" y en el tab "Flujo Completo").
 */
export const PreviewGallery = ({ items, title = "Previews generados" }) => {
  const [lightbox, setLightbox] = useState(null);

  if (!items || items.length === 0) return null;

  return (
    <div style={{ marginTop: "18px" }}>
      {title && (
        <h3
          style={{
            fontSize: "14px",
            color: "#444",
            fontWeight: 700,
            marginBottom: "10px",
          }}
        >
          🖼️ {title}
        </h3>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "10px",
        }}
      >
        {items.map((item, idx) => (
          <PreviewCard
            key={idx}
            item={item}
            onOpen={(url, it) => setLightbox({ url, item: it })}
          />
        ))}
      </div>
      {lightbox && (
        <Lightbox
          url={lightbox.url}
          item={lightbox.item}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
};

/**
 * Galería agrupada por carpeta, usada en el tab "Batch": cada carpeta
 * procesada tiene su propio set de visualizaciones y puede colapsarse.
 */
export const BatchPreviewGallery = ({ folders }) => {
  const [expanded, setExpanded] = useState(() => new Set());

  if (!folders || folders.length === 0) return null;

  const toggle = (folder) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  return (
    <div style={{ marginTop: "18px" }}>
      <h3
        style={{
          fontSize: "14px",
          color: "#444",
          fontWeight: 700,
          marginBottom: "10px",
        }}
      >
        🖼️ Previews por carpeta
      </h3>
      {folders.map(({ folder, visualizaciones, status }) => {
        const isOpen = expanded.has(folder);
        return (
          <div
            key={folder}
            style={{
              border: "1px solid #e0e0e0",
              borderRadius: "8px",
              marginBottom: "8px",
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => toggle(folder)}
              style={{
                padding: "8px 12px",
                background: status === "ok" ? "#f0fbf3" : "#fdf3f2",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              <span>
                {status === "ok" ? "✅" : "❌"} {folder}{" "}
                <span style={{ fontWeight: 400, color: "#888" }}>
                  ({(visualizaciones || []).length} previews)
                </span>
              </span>
              <span>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "10px 12px" }}>
                <PreviewGallery items={visualizaciones} title="" />
                {(!visualizaciones || visualizaciones.length === 0) && (
                  <div style={{ fontSize: "12px", color: "#888" }}>
                    No se generaron previews para esta carpeta.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PreviewGallery;
