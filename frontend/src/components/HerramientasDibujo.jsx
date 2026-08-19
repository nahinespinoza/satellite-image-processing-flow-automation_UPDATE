import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";

/**
 * Barra de dibujo de Leaflet.draw sobre el mapa actual.
 * onChange(geojsonFeatureCollection) se llama cada vez que
 * se crea, edita o borra una geometría.
 */
export default function HerramientasDibujo({ onChange, position = "topleft" }) {
  const map = useMap();
  const drawnItemsRef = useRef(null);
  const controlRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    const emit = () => {
      if (typeof onChange === "function") {
        onChange(drawnItems.toGeoJSON());
      }
    };

    const control = new L.Control.Draw({
      position,
      draw: {
        polyline: {
          shapeOptions: { color: "#e74c3c", weight: 3 },
        },
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
        marker: {
          // marcador por defecto de Leaflet
        },
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
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
