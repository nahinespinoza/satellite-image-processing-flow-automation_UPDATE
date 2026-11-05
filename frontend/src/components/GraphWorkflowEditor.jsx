import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Columns2,
  FileCode2,
  FilePlus2,
  FileText,
  Loader2,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
  Undo2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
// Generado con Scripts_Automatizacion_Snaphu/generar_catalogo_snap.py (gpt <operador> -h)
import SNAP_CATALOG from "../snap_operators.json";
import { Badge, Btn, IconBtn, Switch, inputCls } from "./ui";

/**
 * GraphWorkflowEditor
 * ---------------------------------------------------------------------------
 * Flujo en 2 pasos para los grafos XML de SNAP:
 *   Paso 1 -> elegir un grafo y editar sus parámetros (formulario) o el XML (Monaco)
 *   Paso 2 -> cargar imágenes (drag & drop), configurar y ejecutar
 *
 * Props
 *   initialXml     string   XML inicial / valor de "Resetear" si no hay loadGraph
 *   workflowType   "individual" | "flujo" | "batch"
 *   graphOptions   [{ value, label, group? }]  grafos del servidor; group agrupa la lista
 *   usedGraphs     string[] | null   grafos que usa este flujo (el resto se marca "no se usa aquí")
 *   onGraphChange  (name) => void    avisa al padre qué grafo está activo
 *   loadGraph      (name, original?) => Promise<string>   lee el XML del servidor
 *   onSave         (name, xml) => Promise                 guarda el XML en el servidor
 *   fileMode       "files" | "none"   "none" = el paso 2 no pide archivos (batch)
 *   minFiles / maxFiles   límites de la lista de imágenes
 *   pairLabels     bool     etiqueta 1ª = Master, 2ª = Slave
 *   serverFiles    string[] nombres de imágenes ya presentes en el servidor
 *   uploadFile     (file, onProgress) => Promise<string>  sube y devuelve el nombre en servidor
 *   step2Extra     ReactNode  contenido propio de la pestaña (carpeta de salida, parámetros…)
 *   executeLabel / executeDisabled / executing   estado del botón principal
 *   onExecute      (xmlConfig, files) => void | Promise
 *                  files = [{ name, serverName, size, ... }]  (serverName ya existe en el servidor)
 */

const WORKFLOW_LABELS = {
  individual: "Gráfico Individual",
  flujo: "Flujo Completo",
  batch: "Batch Flujos Completos",
};

// El backend resuelve las entradas por nombre dentro de files/images: .zip y .dim.
// (Un .SAFE es una carpeta; el navegador no la arrastra como archivo, se usa su .zip.)
const ACCEPTED_EXT = [".zip", ".dim"];

// Valores conocidos de SNAP por etiqueta.
//   closed: solo esas opciones (select) · si no: sugerencias, se puede escribir otro valor
const RESAMPLING = [
  "NEAREST_NEIGHBOUR",
  "BILINEAR_INTERPOLATION",
  "CUBIC_CONVOLUTION",
  "BISINC_5_POINT_INTERPOLATION",
  "BISINC_11_POINT_INTERPOLATION",
  "BISINC_21_POINT_INTERPOLATION",
  "BICUBIC_INTERPOLATION",
];
const KNOWN_VALUES = {
  subswath: { closed: true, values: ["IW1", "IW2", "IW3"] },
  statCostMode: { closed: true, values: ["TOPO", "DEFO", "SMOOTH", "NOSTATCOSTS"] },
  initMethod: { closed: true, values: ["MST", "MCF"] },
  demName: { values: ["SRTM 1Sec HGT", "SRTM 3Sec", "Copernicus 30m Global DEM", "Copernicus 90m Global DEM", "ACE30", "GETASSE30"] },
  demResamplingMethod: { values: RESAMPLING },
  imgResamplingMethod: { values: RESAMPLING },
  resamplingMethod: { values: RESAMPLING },
  resamplingType: { values: RESAMPLING },
  formatName: { values: ["BEAM-DIMAP", "GeoTIFF", "GeoTIFF-BigTIFF", "NetCDF4-CF", "ENVI"] },
  mapProjection: { values: ["WGS84(DD)", "AUTO:42001"] },
  selectedPolarisations: { values: ["VV", "VH", "HH", "HV", "VV,VH"] },
};

// Definición de SNAP de cada parámetro: { type, values, default, interval, description, structured }
const snapParams = (operator) => SNAP_CATALOG.operators?.[operator]?.parameters ?? null;
const snapParam = (operator, tag) => snapParams(operator)?.[tag] ?? null;

/** Texto de ayuda (tooltip) a partir de la definición de SNAP. */
function snapHelp(spec) {
  if (!spec) return null;
  return [
    spec.description,
    spec.default != null && `Por defecto: ${spec.default === "" ? "(vacío)" : spec.default}`,
    spec.interval && `Intervalo válido: ${spec.interval}`,
    spec.list && "Lista separada por comas",
    spec.mandatory && "Obligatorio",
  ]
    .filter(Boolean)
    .join("\n");
}

const VIEW_MODES = [
  { id: "form", label: "Formulario", icon: SlidersHorizontal },
  { id: "split", label: "Dividido", icon: Columns2 },
  { id: "xml", label: "XML", icon: Code2 },
];

// localStorage puede fallar (modo privado, cookies bloqueadas): nunca debe romper la UI
const storage = {
  get: (k, d) => {
    try {
      return window.localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* sin persistencia */
    }
  },
};

// ---------------------------------------------------------------------------
// Utilidades XML
// ---------------------------------------------------------------------------

/** Parsea y devuelve { doc, error, line }. */
function parseXml(text) {
  if (!text.trim()) return { doc: null, error: "El XML está vacío.", line: null };
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (!err) return { doc, error: null, line: null };
  const msg = err.textContent;
  // Chrome: "error on line 5 at column 3" · Firefox: "Line Number 5, Column 3"
  const m = msg.match(/line(?: number)?\s+(\d+)/i);
  return { doc: null, error: msg.split("\n").find((l) => l.trim()) || "XML no válido", line: m ? Number(m[1]) : null };
}

/** Re-indenta con 2 espacios. Si el XML no es válido lo devuelve intacto. */
function formatXml(text) {
  const { doc } = parseXml(text);
  if (!doc) return text;
  const compact = new XMLSerializer().serializeToString(doc).replace(/>\s+</g, "><").trim();
  let indent = 0;
  return compact
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3")
    .split("\n")
    .map((line) => {
      if (/^<\/\w/.test(line)) indent = Math.max(0, indent - 1);
      const out = "  ".repeat(indent) + line;
      // etiqueta de apertura sin cierre en la misma línea ni auto-cerrada
      if (/^<[^/!?][^>]*[^/]>$/.test(line) && !/<\/\w/.test(line)) indent += 1;
      return out;
    })
    .join("\n");
}

const nodeIdOf = (node) => node.getAttribute("id") || "(sin id)";

// Solo los <node> hijos directos de <graph>: <applicationData id="Presentation"> repite
// los mismos ids (posiciones en el Graph Builder de SNAP) y no son nodos del grafo.
const graphNodes = (doc) => Array.from(doc.documentElement.children).filter((el) => el.tagName === "node");
const findNode = (doc, nodeId) => graphNodes(doc).find((n) => nodeIdOf(n) === nodeId);

// Marcadores que se sustituyen al ejecutar: ${inputFile} o $inputFile
const PLACEHOLDER = /\$\{?[A-Za-z_]\w*/;

/** Nodos del grafo en orden de aparición: [{ id, operator, paramTags }]. */
function extractNodes(doc) {
  if (!doc) return [];
  return graphNodes(doc).map((n) => ({
    id: nodeIdOf(n),
    operator: n.querySelector(":scope > operator")?.textContent.trim() || "",
    // todas las etiquetas de <parameters>, también las anidadas (pixelRegion, targetBands…)
    paramTags: Array.from(n.querySelector(":scope > parameters")?.children ?? []).map((c) => c.tagName),
  }));
}

/**
 * Campos editables: cada hijo "hoja" de <parameters> en cada <node>.
 * Se identifica por (nodeId, tag, index) para poder escribir de vuelta en el XML.
 * El tipo de campo lo da el catálogo de SNAP; si el parámetro no está en él, se
 * deduce del valor y de KNOWN_VALUES.
 */
function extractFields(doc) {
  if (!doc) return [];
  const fields = [];
  graphNodes(doc).forEach((node) => {
    const nodeId = nodeIdOf(node);
    const operator = node.querySelector(":scope > operator")?.textContent.trim() || "";
    const params = node.querySelector(":scope > parameters");
    if (!params) return;
    const seen = {};
    Array.from(params.children).forEach((child) => {
      if (child.children.length > 0) return; // solo hojas
      seen[child.tagName] = (seen[child.tagName] ?? -1) + 1;
      const value = child.textContent.trim();
      const known = KNOWN_VALUES[child.tagName];
      const spec = snapParam(operator, child.tagName);
      let type = "text";
      let options = known?.values ?? null;
      if (spec?.values) {
        type = "select";
        options = spec.values;
      } else if (spec ? spec.type === "boolean" : /^(true|false)$/i.test(value)) type = "boolean";
      else if (known?.closed || (!spec && KNOWN_VALUES.subswath.values.includes(value))) {
        type = "select";
        options = known?.values ?? KNOWN_VALUES.subswath.values;
      } else if (spec ? ["int", "double"].includes(spec.type) : value !== "" && !isNaN(Number(value))) type = "number";
      fields.push({
        key: `${nodeId}::${child.tagName}::${seen[child.tagName]}`,
        nodeId,
        operator,
        tag: child.tagName,
        label: child.tagName === "parameter" ? child.getAttribute("name") || "parameter" : child.tagName,
        index: seen[child.tagName],
        value,
        type,
        options,
        help: snapHelp(spec),
        // ${inputFile}, $outputFile… los sustituye el backend al ejecutar: no se editan aquí
        locked: PLACEHOLDER.test(value),
      });
    });
  });
  return fields;
}

function findParam(doc, field) {
  const node = findNode(doc, field.nodeId);
  return node && Array.from(node.querySelectorAll(":scope > parameters > " + field.tag))[field.index];
}

/** Escribe un valor en el XML y devuelve el nuevo texto (o null si falla). */
function writeField(xmlText, field, newValue) {
  const { doc } = parseXml(xmlText);
  const target = doc && findParam(doc, field);
  if (!target) return null;
  target.textContent = newValue;
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Agrega <tag>value</tag> a <parameters> del nodo. Si el operador está en el catálogo de
 * SNAP, lo inserta en la posición en que SNAP escribe ese parámetro; si no, al final.
 * Devuelve el nuevo texto o null.
 */
function addField(xmlText, nodeId, tag, value) {
  const { doc } = parseXml(xmlText);
  if (!doc) return null;
  const node = findNode(doc, nodeId);
  const params = node?.querySelector(":scope > parameters");
  if (!params) return null;
  const el = doc.createElement(tag);
  el.textContent = value;
  const order = Object.keys(snapParams(node.querySelector(":scope > operator")?.textContent.trim()) ?? {});
  const pos = order.indexOf(tag);
  const later = pos < 0 ? [] : order.slice(pos + 1);
  const before = Array.from(params.children).find((c) => later.includes(c.tagName));
  params.insertBefore(el, before ?? null);
  return formatXml(new XMLSerializer().serializeToString(doc));
}

/** Elimina un campo del XML. Devuelve el nuevo texto o null. */
function removeField(xmlText, field) {
  const { doc } = parseXml(xmlText);
  const target = doc && findParam(doc, field);
  if (!target) return null;
  target.remove();
  return formatXml(new XMLSerializer().serializeToString(doc));
}

// ---------------------------------------------------------------------------
// Utilidades de archivos
// ---------------------------------------------------------------------------

const formatSize = (bytes) =>
  !bytes ? "—" : bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1e3)} KB`;

/** Metadatos rápidos a partir del nombre estándar Sentinel-1: S1A_IW_SLC__1SDV_20250101T... */
function quickMeta(name) {
  const m = name.match(/^(S1[ABCD])_(\w{2})_(\w{3})\w*?_\w{4}_(\d{4})(\d{2})(\d{2})T/);
  return m ? { mission: `${m[1]} · ${m[2]} ${m[3]}`, date: `${m[4]}-${m[5]}-${m[6]}` } : { mission: "—", date: "—" };
}

const hasValidExt = (name) => ACCEPTED_EXT.some((ext) => name.toLowerCase().endsWith(ext));

// ---------------------------------------------------------------------------
// UI base (estilo shadcn con Tailwind)
// ---------------------------------------------------------------------------

/** Diálogo modal propio (reemplaza window.confirm / window.prompt). */
function Dialog({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.input ?? "");
  const isPrompt = dialog.input !== undefined;
  const submit = () => onClose(isPrompt ? value : true);
  const cancel = () => onClose(isPrompt ? null : false);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && cancelRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          {dialog.danger && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-slate-900">{dialog.title}</div>
            {dialog.message && <div className="mt-1 text-sm text-slate-600">{dialog.message}</div>}
            {isPrompt && (
              <input
                autoFocus
                className={`${inputCls} mt-3 h-9`}
                value={value}
                placeholder={dialog.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={cancel}>
            Cancelar
          </Btn>
          <Btn variant={dialog.danger ? "danger" : "primary"} onClick={submit} autoFocus={!isPrompt}>
            {dialog.confirmLabel || "Aceptar"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function GraphWorkflowEditor({
  initialXml = "",
  workflowType = "individual",
  graphOptions = [],
  usedGraphs = null,
  onGraphChange,
  loadGraph,
  onSave,
  fileMode = "files",
  minFiles = 1,
  maxFiles = Infinity,
  pairLabels = false,
  serverFiles = [],
  uploadFile,
  step2Extra = null,
  executeLabel = "Ejecutar procesamiento",
  executeDisabled = false,
  executing = false,
  onExecute,
}) {
  const [step, setStep] = useState(1);
  const [graphName, setGraphName] = useState(graphOptions[0]?.value ?? "");
  const [xmlText, setXmlText] = useState(initialXml);
  const [baseXml, setBaseXml] = useState(initialXml); // último XML cargado/guardado (para detectar cambios)
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmedXml, setConfirmedXml] = useState(null);
  const [confirmedGraph, setConfirmedGraph] = useState(null);
  const [entries, setEntries] = useState([]); // { id, name, size, lastModified, file?, progress?, uploaded? }
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [localGraphs, setLocalGraphs] = useState([]); // XML cargados desde el disco y aún no guardados
  const [snapOpen, setSnapOpen] = useState(() => new Set()); // nodos con "Más parámetros de SNAP" abierto
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [viewMode, setViewMode] = useState(() => storage.get("gwe.viewMode", "split"));
  const loadInputRef = useRef(null);
  const filesInputRef = useRef(null);
  const toastTimer = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const sectionRefs = useRef({});
  const initialLoadDone = useRef(false);
  const onGraphChangeRef = useRef(onGraphChange);
  onGraphChangeRef.current = onGraphChange;

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /** Abre el diálogo propio y resuelve con true/false (confirmación) o texto/null (prompt). */
  const ask = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  const closeDialog = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  const changeView = (mode) => {
    setViewMode(mode);
    storage.set("gwe.viewMode", mode);
  };

  // El XML se parsea en cada cambio -> formulario y estado de validez siempre sincronizados
  const { doc, error, line: errorLine } = useMemo(() => parseXml(xmlText), [xmlText]);
  const fields = useMemo(() => extractFields(doc), [doc]);
  const nodes = useMemo(() => extractNodes(doc), [doc]);
  const baseValues = useMemo(() => {
    const map = {};
    extractFields(parseXml(baseXml).doc).forEach((f) => (map[f.key] = f.value));
    return map;
  }, [baseXml]);

  const isModified = (f) => f.key in baseValues && baseValues[f.key] !== f.value;
  const modifiedCount = fields.filter(isModified).length;

  const q = query.trim().toLowerCase();
  const grouped = useMemo(() => {
    const g = {};
    // todos los nodos (aunque no tengan parámetros) para poder navegar y agregar parámetros
    if (!q) nodes.forEach((n) => (g[n.id] ??= { operator: n.operator, items: [], locked: [], missing: [] }));
    fields.forEach((f) => {
      if (q && !`${f.label} ${f.nodeId} ${f.operator} ${f.value}`.toLowerCase().includes(q)) return;
      const bucket = (g[f.nodeId] ??= { operator: f.operator, items: [], locked: [], missing: [] });
      (f.locked ? bucket.locked : bucket.items).push(f);
    });
    // Parámetros que SNAP define para el operador y el XML no tiene (los anidados se editan en el XML)
    nodes.forEach((n) => {
      const missing = Object.values(snapParams(n.operator) ?? {}).filter(
        (p) => !p.structured && !n.paramTags.includes(p.name) && (!q || `${p.name} ${n.id} ${n.operator}`.toLowerCase().includes(q)),
      );
      if (missing.length) (g[n.id] ??= { operator: n.operator, items: [], locked: [], missing: [] }).missing = missing;
    });
    return g;
  }, [fields, nodes, q]);

  const selectOptions = useMemo(() => {
    const known = new Set(graphOptions.map((o) => o.value));
    const extra = [...localGraphs, graphName]
      .filter((n, i, arr) => n && !known.has(n) && arr.indexOf(n) === i)
      .map((n) => ({ value: n, label: n, group: "Cargados del equipo" }));
    return [...graphOptions, ...extra];
  }, [graphOptions, localGraphs, graphName]);

  const optionGroups = useMemo(() => {
    const groups = [];
    selectOptions.forEach((o) => {
      const name = o.group || "Grafos";
      let g = groups.find((x) => x.name === name);
      if (!g) groups.push((g = { name, items: [] }));
      g.items.push(o);
    });
    return groups;
  }, [selectOptions]);

  const labelOf = (name) => selectOptions.find((o) => o.value === name)?.label || name;
  const currentLabel = labelOf(graphName) || "Sin grafo";
  const isUsedHere = (name) => !usedGraphs || usedGraphs.includes(name);

  const dirty = xmlText !== baseXml;
  const isConfirmed = confirmedXml !== null && confirmedXml === xmlText;
  const busy = executing || uploading;

  // Aviso del navegador si se cierra la pestaña con cambios sin guardar
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Marca el error de XML dentro del editor
  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    const ln = errorLine && Math.min(errorLine, model.getLineCount());
    monaco.editor.setModelMarkers(
      model,
      "gwe",
      error && ln
        ? [
            {
              startLineNumber: ln,
              endLineNumber: ln,
              startColumn: 1,
              endColumn: model.getLineMaxColumn(ln),
              message: error,
              severity: monaco.MarkerSeverity.Error,
            },
          ]
        : [],
    );
  }, [error, errorLine, xmlText]);

  // ---- Carga del grafo seleccionado desde el servidor -------------------------
  const fetchGraph = useCallback(
    async (name, original = false) => {
      if (!loadGraph || !name) return;
      setLoadingGraph(true);
      try {
        const text = await loadGraph(name, original);
        setXmlText(text);
        // "Resetear" deja el original en el editor como cambio pendiente de guardar
        if (!original) setBaseXml(text);
        setConfirmedXml(null);
      } catch (err) {
        notify(`No se pudo cargar ${name}: ${err.message}`, "error");
      } finally {
        setLoadingGraph(false);
      }
    },
    [loadGraph, notify],
  );

  // Carga inicial: el primer grafo disponible (o el que ya venía elegido)
  useEffect(() => {
    if (initialLoadDone.current || initialXml) return;
    const name = graphName || graphOptions[0]?.value;
    if (!name) return;
    initialLoadDone.current = true;
    if (!graphName) setGraphName(name);
    fetchGraph(name);
  }, [graphName, graphOptions, initialXml, fetchGraph]);

  useEffect(() => {
    if (graphName) onGraphChangeRef.current?.(graphName);
  }, [graphName]);

  const confirmDiscard = async () =>
    !dirty ||
    ask({
      title: "Hay cambios sin guardar",
      message: `Los cambios en ${currentLabel} se perderán.`,
      confirmLabel: "Descartar cambios",
      danger: true,
    });

  const handleGraphChange = async (name) => {
    if (name === graphName) return;
    if (!(await confirmDiscard())) return;
    setGraphName(name);
    setQuery("");
    setCollapsed(new Set());
    if (localGraphs.includes(name)) return; // XML local aún no guardado: no hay nada que leer
    fetchGraph(name);
  };

  // Formulario -> XML
  const handleFieldChange = (field, value) => {
    const next = writeField(xmlText, field, String(value));
    if (next === null) return notify("No se pudo actualizar el parámetro", "error");
    setXmlText(next);
  };

  // ---- Barra de herramientas ------------------------------------------------------
  const handleLoadLocal = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!(await confirmDiscard())) return;
    const text = await file.text();
    // El XML local es un grafo nuevo con su propio nombre: guardar NO pisa el grafo que estaba seleccionado.
    setGraphName(file.name);
    setLocalGraphs((prev) => (prev.includes(file.name) ? prev : [...prev, file.name]));
    setXmlText(text);
    setBaseXml("");
    setConfirmedXml(null);
    notify(`${file.name} cargado. Guárdalo para usarlo en el servidor.`);
  };

  const saveToServer = async (name = graphName) => {
    if (error) {
      notify("Corrige el XML antes de guardar", "error");
      return false;
    }
    if (!onSave || !name) return true; // nada que persistir
    setSaving(true);
    try {
      await onSave(name, xmlText);
      setBaseXml(xmlText);
      setLocalGraphs((prev) => prev.filter((n) => n !== name));
      return true;
    } catch (err) {
      notify(`Error al guardar: ${err.message || err}`, "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (await saveToServer()) notify(graphName ? `${graphName} guardado en el servidor` : "XML validado");
  };

  const handleSaveAs = async () => {
    if (error) return notify("Corrige el XML antes de guardar", "error");
    const suggested = graphName && !graphName.startsWith("GRAFICO_") ? graphName : "mi_grafo.xml";
    let name = (
      (await ask({
        title: "Guardar como…",
        message: "Se guardará como un grafo nuevo en backend/files/.",
        input: suggested,
        placeholder: "nombre.xml",
        confirmLabel: "Guardar",
      })) || ""
    ).trim();
    if (!name) return;
    if (!name.toLowerCase().endsWith(".xml")) name += ".xml";
    if (/[\\/]/.test(name)) return notify("El nombre no puede contener / ni \\", "error");
    if (
      graphOptions.some((o) => o.value === name) &&
      !(await ask({ title: `${name} ya existe`, message: "Se reemplazará su contenido en el servidor.", confirmLabel: "Sobrescribir", danger: true }))
    )
      return;
    if (await saveToServer(name)) {
      setGraphName(name);
      notify(`${name} guardado en el servidor`);
    }
  };

  // Agrega un parámetro del catálogo de SNAP con su valor por defecto
  const handleAddSnapParam = (nodeId, spec) => {
    const next = addField(xmlText, nodeId, spec.name, spec.default ?? spec.values?.[0] ?? "");
    if (next === null) return notify("Ese nodo no tiene <parameters> donde agregar", "error");
    setXmlText(next);
    notify(`${spec.name} agregado a ${nodeId}`);
  };

  const toggleSnapOpen = (nodeId) =>
    setSnapOpen((prev) => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });

  const handleDeleteParam = async (field) => {
    const ok = await ask({
      title: `¿Eliminar "${field.label}"?`,
      message: `Se quitará del nodo ${field.nodeId}. Mientras no guardes puedes recuperarlo cambiando de grafo y descartando.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const next = removeField(xmlText, field);
    if (next === null) return notify("No se pudo eliminar el parámetro", "error");
    setXmlText(next);
  };

  const handleFormat = () => setXmlText((t) => formatXml(t));

  const handleReset = async () => {
    const ok = await ask({
      title: "¿Volver al XML original?",
      message: "Se cargará la versión original del grafo (la de antes de la primera edición). Para aplicarla en el servidor, guarda después.",
      confirmLabel: "Resetear",
      danger: true,
    });
    if (!ok) return;
    if (loadGraph && graphName && !localGraphs.includes(graphName)) fetchGraph(graphName, true);
    else setXmlText(initialXml || baseXml);
  };

  const handleConfirm = async () => {
    // Confirmar = guardar en el servidor, porque la ejecución lee el grafo desde allí
    if (dirty && !(await saveToServer())) return;
    setConfirmedXml(xmlText);
    setConfirmedGraph(graphName);
    setStep(2);
  };

  // Ctrl/Cmd + S guarda el grafo mientras se está en el paso 1
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    if (step !== 1) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // ---- Navegación ------------------------------------------------------------------
  const revealLine = (lineNumber) => {
    const editor = editorRef.current;
    if (!editor || !lineNumber) return;
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber, column: 1 });
  };

  const goToError = () => {
    if (viewMode === "form") changeView("xml");
    setTimeout(() => {
      revealLine(errorLine);
      editorRef.current?.focus();
    }, 80);
  };

  const goToNode = (nodeId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    sectionRefs.current[nodeId]?.scrollIntoView({ behavior: "smooth", block: "start" });
    // primera aparición = el nodo real (la de applicationData va al final)
    const idx = xmlText.split("\n").findIndex((l) => l.includes(`<node id="${nodeId}"`));
    if (idx >= 0) revealLine(idx + 1);
  };

  const toggleSection = (nodeId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const sectionIds = Object.keys(grouped);
  const allCollapsed = sectionIds.length > 0 && sectionIds.every((k) => collapsed.has(k));

  // ---- Archivos --------------------------------------------------------------------
  const addEntries = (incoming) => {
    const valid = incoming.filter((e) => hasValidExt(e.name));
    if (valid.length < incoming.length) notify(`Solo se aceptan ${ACCEPTED_EXT.join(", ")}`, "error");
    setEntries((prev) => {
      let next = [...prev];
      for (const e of valid) {
        if (next.some((p) => p.name === e.name)) continue;
        if (maxFiles === 1)
          next = [e]; // una sola imagen: reemplaza
        else if (next.length < maxFiles) next.push(e);
        else notify(`Máximo ${maxFiles} imágenes`, "error");
      }
      return next;
    });
  };

  const addLocalFiles = (list) =>
    addEntries(
      Array.from(list).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        file,
      })),
    );

  const addServerFile = (name) => addEntries([{ id: `srv-${name}`, name, size: 0, lastModified: null }]);

  const removeEntry = (id) => setEntries((p) => p.filter((e) => e.id !== id));

  const swapPair = () => setEntries((p) => (p.length === 2 ? [p[1], p[0]] : p));

  const filesOk = fileMode === "none" || (entries.length >= minFiles && entries.length <= maxFiles);

  const handleExecute = async () => {
    setUploading(true);
    try {
      // 1) subir las imágenes locales que aún no estén en el servidor
      const ready = [];
      for (const entry of entries) {
        let serverName = entry.name;
        if (entry.file) {
          if (!uploadFile) throw new Error("No hay función de subida configurada");
          serverName = await uploadFile(entry.file, (p) => setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, progress: p } : e))));
          // ya está en el servidor: si se vuelve a ejecutar no se sube otra vez
          setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, name: serverName, file: undefined, progress: 1, uploaded: true } : e)));
        }
        ready.push({ ...entry, serverName });
      }
      // 2) ejecutar con el XML confirmado en el paso 1
      await onExecute?.(confirmedXml, ready);
    } catch (err) {
      notify(err.message || String(err), "error");
    } finally {
      setUploading(false);
    }
  };

  const filesHint =
    maxFiles === 1 ? "1 imagen" : Number.isFinite(maxFiles) ? `${minFiles === maxFiles ? maxFiles : `${minFiles}–${maxFiles}`} imágenes` : "las que necesites";
  const missingFiles = fileMode === "files" && entries.length < minFiles ? minFiles - entries.length : 0;
  const executeHint = !isConfirmed
    ? "Confirma el grafo en el paso 1"
    : missingFiles > 0
      ? `Falta${missingFiles > 1 ? "n" : ""} ${missingFiles} imagen${missingFiles > 1 ? "es" : ""}`
      : executeDisabled
        ? "Completa la configuración de arriba"
        : null;

  // ---- Render ----------------------------------------------------------------------
  const stepDefs = [
    { n: 1, label: workflowType === "individual" ? "Configurar grafo" : "Configurar grafos", enabled: true },
    { n: 2, label: fileMode === "none" ? "Configurar y ejecutar" : "Imágenes y ejecución", enabled: isConfirmed },
  ];

  const showForm = viewMode !== "xml";
  const showXml = viewMode !== "form";
  const split = showForm && showXml;

  const statusBadge = loadingGraph ? (
    <Badge>
      <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
    </Badge>
  ) : error ? (
    <Badge tone="red">
      <AlertCircle className="h-3 w-3" /> XML con errores
    </Badge>
  ) : dirty ? (
    <Badge tone="amber">● Sin guardar{modifiedCount > 0 && ` · ${modifiedCount} cambio${modifiedCount > 1 ? "s" : ""}`}</Badge>
  ) : (
    <Badge tone="emerald">
      <Check className="h-3 w-3" /> Guardado
    </Badge>
  );

  const renderField = (f) => {
    const modified = isModified(f);
    const listId = f.options && f.type !== "select" ? `gwe-opt-${f.tag}` : undefined;
    const isTrue = /^true$/i.test(f.value);
    return (
      <div key={f.key} className={`group grid grid-cols-12 items-center gap-2 rounded-md px-2 py-1 text-sm ${modified ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
        <label
          htmlFor={`gwe-${f.key}`}
          className={`col-span-5 flex min-w-0 items-center gap-1.5 text-slate-600 ${f.help ? "cursor-help" : ""}`}
          title={f.help ? `${f.label}\n\n${f.help}` : f.label}
        >
          {modified && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" title="Modificado" />}
          <span className={`truncate ${f.help ? "underline decoration-slate-300 decoration-dotted underline-offset-2" : ""}`}>{f.label}</span>
        </label>
        <div className="col-span-7 flex min-w-0 items-center gap-1">
          {f.type === "boolean" ? (
            <span className="flex flex-1 items-center gap-2">
              <Switch checked={isTrue} onChange={(v) => handleFieldChange(f, v)} />
              <span className="text-xs text-slate-400">{isTrue ? "true" : "false"}</span>
            </span>
          ) : f.type === "select" ? (
            <select id={`gwe-${f.key}`} className={inputCls} value={f.value} onChange={(e) => handleFieldChange(f, e.target.value)}>
              {!f.options.includes(f.value) && <option value={f.value}>{f.value || "—"}</option>}
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                id={`gwe-${f.key}`}
                className={inputCls}
                type={f.type === "number" ? "number" : "text"}
                step="any"
                list={listId}
                value={f.value}
                placeholder="(vacío)"
                onChange={(e) => handleFieldChange(f, e.target.value)}
              />
              {listId && (
                <datalist id={listId}>
                  {f.options.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              )}
            </>
          )}
          {modified ? (
            <IconBtn
              icon={Undo2}
              label={`Restaurar valor guardado: ${baseValues[f.key] || "(vacío)"}`}
              className="text-indigo-500"
              onClick={() => handleFieldChange(f, baseValues[f.key])}
            />
          ) : (
            <span className="h-7 w-7 shrink-0" />
          )}
          <IconBtn
            icon={X}
            label={`Eliminar ${f.label}`}
            className="opacity-0 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            onClick={() => handleDeleteParam(f)}
          />
        </div>
      </div>
    );
  };

  const graphList = (
    <nav className="flex flex-col gap-3 p-2">
      {optionGroups.map((g) => (
        <div key={g.name}>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.name}</div>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {g.items.map((o) => {
              const active = o.value === graphName;
              const local = localGraphs.includes(o.value);
              const used = isUsedHere(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => handleGraphChange(o.value)}
                    disabled={loadingGraph}
                    title={used ? o.value : `${o.value} · no se usa en este flujo`}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-wait ${
                      active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700 hover:bg-slate-100"
                    } ${used || active ? "" : "opacity-50"}`}
                  >
                    <FileCode2 className={`h-4 w-4 shrink-0 ${active ? "text-indigo-500" : "text-slate-400"}`} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {active && dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Cambios sin guardar" />}
                    {local && <Badge tone="amber">local</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="gwe">
      <div className="relative flex w-full flex-col gap-4 rounded-xl border border-solid border-slate-200 bg-slate-50 p-4 text-slate-800">
        {/* Encabezado + Stepper */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{WORKFLOW_LABELS[workflowType] ?? workflowType}</div>
            <div className="text-xs text-slate-500">
              {step === 1
                ? "Elige un grafo y ajusta sus parámetros; después continúa al paso 2."
                : fileMode === "none"
                  ? "Configura la carpeta y ejecuta."
                  : "Agrega las imágenes y ejecuta el procesamiento."}
            </div>
          </div>
          <ol className="m-0 flex list-none items-center gap-2 p-0">
            {stepDefs.map((s, i) => (
              <React.Fragment key={s.n}>
                <li>
                  <button
                    type="button"
                    disabled={!s.enabled || busy}
                    onClick={() => setStep(s.n)}
                    title={s.enabled ? undefined : "Primero confirma el grafo"}
                    className={`flex cursor-pointer items-center gap-2 rounded-full border border-solid px-3 py-1.5 text-sm shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      step === s.n ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        step === s.n ? "bg-white/20" : s.n === 1 && isConfirmed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100"
                      }`}
                    >
                      {s.n === 1 && isConfirmed ? <Check className="h-3 w-3" /> : s.n}
                    </span>
                    {s.label}
                  </button>
                </li>
                {i === 0 && <ArrowRight className="h-4 w-4 text-slate-300" />}
              </React.Fragment>
            ))}
          </ol>
        </div>

        {/* ============================ PASO 1 ============================ */}
        {step === 1 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
            {/* Lista de grafos */}
            <aside className="hidden h-[680px] flex-col overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-sm lg:flex">
              <div className="border-b border-solid border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-800">Grafos</div>
              <div className="min-h-0 flex-1 overflow-y-auto">{graphList}</div>
              <div className="flex flex-col gap-1.5 border-t border-solid border-slate-200 p-2">
                <Btn icon={FileCode2} size="sm" onClick={() => loadInputRef.current?.click()} disabled={loadingGraph}>
                  Cargar XML del equipo
                </Btn>
                <Btn icon={FilePlus2} size="sm" onClick={handleSaveAs} disabled={!!error || loadingGraph || saving}>
                  Guardar como…
                </Btn>
              </div>
            </aside>
            <input ref={loadInputRef} type="file" accept=".xml" className="hidden" onChange={handleLoadLocal} />

            <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-sm lg:h-[680px]">
              {/* Selector compacto en pantallas chicas */}
              <div className="flex gap-2 border-b border-solid border-slate-200 p-2 lg:hidden">
                <select className={`${inputCls} h-9`} value={graphName} disabled={loadingGraph} onChange={(e) => handleGraphChange(e.target.value)}>
                  {optionGroups.map((g) => (
                    <optgroup key={g.name} label={g.name}>
                      {g.items.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <IconBtn
                  icon={FileCode2}
                  label="Cargar XML del equipo"
                  className="h-9 w-9 border border-solid border-slate-200"
                  onClick={() => loadInputRef.current?.click()}
                />
                <IconBtn
                  icon={FilePlus2}
                  label="Guardar como…"
                  className="h-9 w-9 border border-solid border-slate-200"
                  onClick={handleSaveAs}
                  disabled={!!error}
                />
              </div>

              {/* Cabecera del grafo */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-solid border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-semibold text-slate-900">{currentLabel}</span>
                    {statusBadge}
                    {!isUsedHere(graphName) && <Badge>No se usa en este flujo</Badge>}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-slate-400">{graphName}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="mr-1 inline-flex rounded-lg border border-solid border-slate-200 bg-slate-100 p-0.5" role="tablist" aria-label="Vista">
                    {VIEW_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="tab"
                        aria-selected={viewMode === m.id}
                        onClick={() => changeView(m.id)}
                        className={`cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          viewMode === m.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                        } ${m.id === "split" ? "hidden xl:inline-flex" : "inline-flex"}`}
                      >
                        <m.icon className="h-3.5 w-3.5" /> {m.label}
                      </button>
                    ))}
                  </div>
                  <Btn icon={Wand2} size="sm" variant="ghost" onClick={handleFormat} disabled={!!error || loadingGraph} title="Re-indentar el XML">
                    Formatear
                  </Btn>
                  <Btn icon={RotateCcw} size="sm" variant="ghost" onClick={handleReset} disabled={loadingGraph} title="Volver a la versión original del grafo">
                    Resetear
                  </Btn>
                  <Btn
                    icon={saving ? Loader2 : Save}
                    size="sm"
                    onClick={handleSave}
                    disabled={!!error || loadingGraph || saving || !dirty}
                    title="Guardar en el servidor (Ctrl+S)"
                  >
                    Guardar
                  </Btn>
                </div>
              </div>

              {/* Nodos del grafo: navegación rápida */}
              {nodes.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto border-b border-solid border-slate-100 bg-slate-50 px-4 py-2">
                  <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Nodos</span>
                  {nodes.map((n, i) => (
                    <React.Fragment key={n.id}>
                      {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
                      <button
                        type="button"
                        onClick={() => goToNode(n.id)}
                        title={`${n.operator} · ir al nodo`}
                        className="shrink-0 cursor-pointer rounded-md border border-solid border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
                      >
                        {n.id}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* Error de XML */}
              {error && !loadingGraph && (
                <div className="flex items-center gap-2 border-b border-solid border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate" title={error}>
                    {error}
                  </span>
                  {errorLine && (
                    <Btn size="sm" onClick={goToError}>
                      Ir a la línea {errorLine}
                    </Btn>
                  )}
                </div>
              )}

              {/* Cuerpo: formulario y/o XML */}
              <div className={`grid min-h-0 flex-1 grid-cols-1 ${split ? "xl:grid-cols-2" : ""}`}>
                {showForm && (
                  <div className={`flex min-h-[420px] flex-col ${split ? "xl:border-r xl:border-solid xl:border-slate-200" : ""}`}>
                    <div className="flex items-center gap-2 border-b border-solid border-slate-100 px-3 py-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
                        <input className={`${inputCls} pl-8`} placeholder="Buscar parámetro o nodo…" value={query} onChange={(e) => setQuery(e.target.value)} />
                      </div>
                      <Btn size="sm" variant="ghost" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(sectionIds))} disabled={!sectionIds.length}>
                        {allCollapsed ? "Expandir todo" : "Contraer todo"}
                      </Btn>
                    </div>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                      {loadingGraph ? (
                        <div className="space-y-3">
                          {[0, 1, 2].map((i) => (
                            <div key={i} className="animate-pulse space-y-2 rounded-lg border border-solid border-slate-100 p-3">
                              <div className="h-3 w-1/3 rounded bg-slate-200" />
                              <div className="h-7 rounded bg-slate-100" />
                              <div className="h-7 rounded bg-slate-100" />
                            </div>
                          ))}
                        </div>
                      ) : error ? (
                        <p className="p-6 text-center text-sm text-slate-400">Corrige el XML para ver los parámetros.</p>
                      ) : sectionIds.length === 0 ? (
                        <p className="p-6 text-center text-sm text-slate-400">{q ? `Sin resultados para "${query}".` : "Este grafo no tiene nodos."}</p>
                      ) : (
                        Object.entries(grouped).map(([nodeId, { operator, items, locked, missing }]) => {
                          const isCollapsed = collapsed.has(nodeId);
                          const changed = items.filter(isModified).length;
                          return (
                            <section
                              key={nodeId}
                              ref={(el) => (sectionRefs.current[nodeId] = el)}
                              className="scroll-mt-2 rounded-lg border border-solid border-slate-200"
                            >
                              <button
                                type="button"
                                onClick={() => toggleSection(nodeId)}
                                aria-expanded={!isCollapsed}
                                className={`flex w-full cursor-pointer items-center gap-2 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100 ${isCollapsed ? "rounded-lg" : "rounded-t-lg"}`}
                              >
                                {isCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                <span className="text-sm font-semibold text-slate-800">{nodeId}</span>
                                {operator && operator !== nodeId && <Badge>{operator}</Badge>}
                                <span className="ml-auto flex items-center gap-1.5">
                                  {changed > 0 && (
                                    <Badge tone="indigo">
                                      {changed} modificado{changed > 1 ? "s" : ""}
                                    </Badge>
                                  )}
                                  <span className="text-xs text-slate-400">
                                    {items.length} parámetro{items.length === 1 ? "" : "s"}
                                  </span>
                                </span>
                              </button>
                              {!isCollapsed && (
                                <div className="space-y-0.5 p-1.5">
                                  {items.map(renderField)}
                                  {items.length === 0 && locked.length === 0 && missing.length === 0 && (
                                    <p className="m-0 px-2 py-1 text-xs text-slate-400">Sin parámetros.</p>
                                  )}
                                  {locked.length > 0 && (
                                    <div className="mx-1 mt-1 rounded-md bg-slate-50 px-2 py-1.5">
                                      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                                        <Lock className="h-3 w-3" /> Se asignan automáticamente al ejecutar
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {locked.map((f) => (
                                          <span
                                            key={f.key}
                                            className="inline-flex items-center gap-1 rounded border border-solid border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
                                            title={`${f.label} = ${f.value}`}
                                          >
                                            {f.label} <span className="text-slate-300">←</span> <span className="text-indigo-600">{f.value}</span>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {missing.length > 0 && (
                                    <div className="mx-1 mt-1 rounded-md border border-dashed border-slate-200">
                                      <button
                                        type="button"
                                        onClick={() => toggleSnapOpen(nodeId)}
                                        aria-expanded={snapOpen.has(nodeId) || !!q}
                                        className="flex w-full cursor-pointer items-center gap-1 px-2 py-1 text-left text-xs font-medium text-slate-500 hover:text-slate-700"
                                      >
                                        {snapOpen.has(nodeId) || q ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                        Más parámetros de SNAP ({missing.length})
                                      </button>
                                      {(snapOpen.has(nodeId) || q) && (
                                        <ul className="m-0 list-none space-y-0.5 px-1 pb-1 pt-0">
                                          {missing.map((p) => (
                                            <li
                                              key={p.name}
                                              className="grid grid-cols-12 items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-50"
                                              title={`${p.name}\n\n${snapHelp(p)}`}
                                            >
                                              <span className="col-span-5 cursor-help truncate text-slate-600">{p.name}</span>
                                              <span className="col-span-6 truncate font-mono text-[11px] text-slate-400">
                                                {p.default != null ? p.default || "(vacío)" : p.values ? p.values[0] : `(${p.type})`}
                                              </span>
                                              <IconBtn
                                                icon={Plus}
                                                label={`Agregar ${p.name} con su valor por defecto`}
                                                className="col-span-1 text-indigo-600 hover:bg-indigo-50"
                                                onClick={() => handleAddSnapParam(nodeId, p)}
                                              />
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </section>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {showXml && (
                  <div className={`min-h-[420px] flex-col ${split ? "hidden xl:flex" : "flex"}`}>
                    {/* absolute inset-0: Monaco necesita una altura definida; dentro del grid flexible el 100% no siempre resuelve */}
                    <div className="relative min-h-0 flex-1">
                      <div className="absolute inset-0">
                        <Editor
                          height="100%"
                          language="xml"
                          value={xmlText}
                          onChange={(v) => setXmlText(v ?? "")}
                          onMount={(editor, monaco) => {
                            editorRef.current = editor;
                            monacoRef.current = monaco;
                          }}
                          loading={
                            <div className="flex items-center gap-2 text-sm text-slate-400">
                              <Loader2 className="h-4 w-4 animate-spin" /> Cargando editor…
                            </div>
                          }
                          options={{
                            minimap: { enabled: false },
                            lineNumbers: "on",
                            folding: true,
                            fontSize: 13,
                            wordWrap: "on",
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            readOnly: loadingGraph,
                          }}
                        />
                      </div>
                    </div>
                    <div
                      className={`flex items-center gap-2 border-t border-solid px-3 py-1.5 text-xs ${
                        error ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      {error ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                      <span className="truncate">
                        {error ? "XML no válido" : `XML válido · ${nodes.length} nodos · ${fields.filter((f) => !f.locked).length} parámetros editables`}
                      </span>
                      <span className="ml-auto hidden text-slate-400 sm:inline">Ctrl+S guarda</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Barra de acciones del paso 1 */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-solid border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-xs text-slate-500">
                  {error
                    ? "Corrige el XML para continuar."
                    : dirty
                      ? "Al continuar se guardan los cambios en el servidor."
                      : "El grafo está guardado en el servidor."}
                </span>
                <Btn
                  icon={saving ? Loader2 : ArrowRight}
                  variant="primary"
                  onClick={handleConfirm}
                  disabled={!!error || !xmlText.trim() || loadingGraph || saving}
                >
                  {dirty ? "Guardar y continuar" : "Continuar"}
                </Btn>
              </div>
            </section>
          </div>
        )}

        {/* ============================ PASO 2 ============================ */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            {/* Resumen del grafo confirmado */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-solid border-slate-200 bg-white px-4 py-3 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </span>
              <div className="min-w-0 flex-1">
                {workflowType === "individual" ? (
                  <>
                    <div className="text-sm font-medium text-slate-900">Grafo confirmado: {labelOf(confirmedGraph)}</div>
                    <div className="truncate font-mono text-xs text-slate-400">{confirmedGraph}</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium text-slate-900">Configuración de grafos confirmada</div>
                    <div className="text-xs text-slate-500">
                      Se ejecutan los pasos 1 a 7 con los XML guardados en el servidor
                      {confirmedGraph && <> · último editado: <span className="font-mono">{confirmedGraph}</span></>}
                    </div>
                  </>
                )}
              </div>
              <Btn icon={ArrowLeft} size="sm" variant="ghost" onClick={() => setStep(1)} disabled={busy}>
                {workflowType === "individual" ? "Cambiar grafo" : "Editar grafos"}
              </Btn>
            </div>

            {fileMode === "files" && (
              <div className="rounded-lg border border-solid border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-solid border-slate-200 px-4 py-2.5">
                  <div className="text-sm font-semibold text-slate-800">
                    Imágenes{" "}
                    <span className="font-normal text-slate-400">
                      · {filesHint}
                      {pairLabels && " · 1ª = Master (día base), 2ª = Slave (+12 días)"}
                    </span>
                  </div>
                  <Badge tone={filesOk ? "emerald" : "slate"}>
                    {entries.length}
                    {Number.isFinite(maxFiles) ? ` / ${maxFiles}` : ""} seleccionada{entries.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                <div className="space-y-3 p-4">
                  <div
                    role="button"
                    tabIndex={0}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      addLocalFiles(e.dataTransfer.files);
                    }}
                    onClick={() => filesInputRef.current?.click()}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && filesInputRef.current?.click()}
                    className={`flex cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center transition-colors ${entries.length ? "p-4" : "flex-col p-8"} ${
                      dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
                    }`}
                  >
                    <UploadCloud className={`${entries.length ? "h-6 w-6" : "h-9 w-9"} text-indigo-500`} />
                    <div>
                      <div className="text-sm font-medium">
                        {dragging ? "Suelta las imágenes aquí" : "Arrastra tus imágenes o haz clic para seleccionarlas"}
                      </div>
                      <div className="text-xs text-slate-500">Formatos: {ACCEPTED_EXT.join(", ")}</div>
                    </div>
                    <input
                      ref={filesInputRef}
                      type="file"
                      multiple={maxFiles !== 1}
                      accept={ACCEPTED_EXT.join(",")}
                      className="hidden"
                      onChange={(e) => {
                        addLocalFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  {serverFiles.filter(hasValidExt).length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <Server className="h-3.5 w-3.5" /> O elige una que ya está en el servidor (files/images)
                      </div>
                      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                        {serverFiles.filter(hasValidExt).map((n) => {
                          const added = entries.some((e) => e.name === n);
                          return (
                            <button
                              key={n}
                              type="button"
                              disabled={added || busy}
                              onClick={() => addServerFile(n)}
                              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border border-solid px-2.5 py-1 text-xs transition-colors disabled:cursor-default ${
                                added
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
                              }`}
                            >
                              {added ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-lg border border-solid border-slate-200">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">{pairLabels ? "Rol" : "#"}</th>
                          <th className="px-3 py-2 font-medium">Archivo</th>
                          <th className="px-3 py-2 font-medium">Misión</th>
                          <th className="px-3 py-2 font-medium">Adquisición</th>
                          <th className="px-3 py-2 font-medium">Tamaño</th>
                          <th className="px-3 py-2 font-medium">Origen</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {entries.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                              Aún no hay imágenes seleccionadas
                            </td>
                          </tr>
                        )}
                        {entries.map((f, i) => {
                          const meta = quickMeta(f.name);
                          return (
                            <tr key={f.id} className="border-t border-solid border-slate-100">
                              <td className="px-3 py-2">
                                {pairLabels ? (
                                  <Badge tone={i === 0 ? "indigo" : "slate"}>{i === 0 ? "Master" : i === 1 ? "Slave" : i + 1}</Badge>
                                ) : (
                                  <span className="text-slate-500">{i + 1}</span>
                                )}
                              </td>
                              <td className="max-w-xs px-3 py-2">
                                <span className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                                  <span className="truncate" title={f.name}>
                                    {f.name}
                                  </span>
                                </span>
                                {f.progress > 0 && f.progress < 1 && (
                                  <div className="mt-1 h-1 w-full overflow-hidden rounded bg-slate-100">
                                    <div className="h-full bg-indigo-500 transition-all" style={{ width: `${f.progress * 100}%` }} />
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-500">{meta.mission}</td>
                              <td className="px-3 py-2 text-slate-500">{meta.date}</td>
                              <td className="px-3 py-2 text-slate-500">{formatSize(f.size)}</td>
                              <td className="px-3 py-2">
                                {f.file ? (
                                  <Badge tone="amber">Local · se subirá</Badge>
                                ) : f.uploaded ? (
                                  <Badge tone="emerald">Subida</Badge>
                                ) : (
                                  <Badge>Servidor</Badge>
                                )}
                              </td>
                              <td className="px-2">
                                <IconBtn
                                  icon={Trash2}
                                  label="Quitar"
                                  disabled={busy}
                                  className="hover:bg-red-50 hover:text-red-600"
                                  onClick={() => removeEntry(f.id)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pairLabels && entries.length === 2 && (
                    <div className="flex justify-end">
                      <Btn size="sm" variant="ghost" onClick={swapPair} disabled={busy}>
                        ⇅ Intercambiar Master / Slave
                      </Btn>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Contenido propio de la pestaña: carpeta de salida, parámetros, estado... */}
            {step2Extra && <div className="gwe-legacy">{step2Extra}</div>}

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-solid border-slate-200 bg-white px-4 py-3 shadow-md">
              <Btn icon={ArrowLeft} variant="ghost" onClick={() => setStep(1)} disabled={busy}>
                Volver al grafo
              </Btn>
              <div className="flex items-center gap-3">
                {executeHint && !busy && <span className="text-xs text-slate-500">{executeHint}</span>}
                <Btn
                  icon={busy ? Loader2 : Play}
                  variant="primary"
                  size="lg"
                  disabled={!filesOk || !isConfirmed || busy || executeDisabled}
                  onClick={handleExecute}
                >
                  {uploading ? "Subiendo imágenes…" : executing ? "Procesando…" : executeLabel}
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            role="status"
            className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${toast.kind === "error" ? "bg-red-600" : "bg-emerald-600"}`}
          >
            {toast.kind === "error" ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{toast.msg}</span>
            <IconBtn icon={X} label="Cerrar" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setToast(null)} />
          </div>
        )}

        {dialog && <Dialog dialog={dialog} onClose={closeDialog} />}
      </div>
    </div>
  );
}
