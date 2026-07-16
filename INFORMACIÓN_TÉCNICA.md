# 🔧 INFORMACIÓN TÉCNICA COMPLETA

**Proyecto:** Satellite Image Processing Flow Automation  
**Versión:** 2.0  
**Última actualización:** Enero 2026  

---

## 📑 TABLA DE CONTENIDOS

1. [Descripción General](#descripción-general)
2. [Arquitectura](#arquitectura)
3. [Tecnologías](#tecnologías)
4. [Estructura de Archivos](#estructura-de-archivos)
5. [Configuración Técnica](#configuración-técnica)
6. [API Endpoints](#api-endpoints)
7. [Formatos de Datos](#formatos-de-datos)
8. [Flujos de Procesamiento](#flujos-de-procesamiento)
9. [Archivos Gráficos XML](#archivos-gráficos-xml)
10. [Debugging y Monitoreo](#debugging-y-monitoreo)
11. [Rendimiento y Optimización](#rendimiento-y-optimización)
12. [Referencia Técnica Rápida](#referencia-técnica-rápida)

---

# DESCRIPCIÓN GENERAL

## ¿Qué es el Sistema?

El **Sistema de Procesamiento Automatizado de Imágenes Satelitales** es una aplicación web moderna que automatiza el procesamiento de imágenes Sentinel-1 del ESA (Agencia Espacial Europea) a través de una interfaz intuitiva.

## Propósito Técnico

- Automatización de flujos de procesamiento satelital
- Ejecución de gráficos GPT (SNAP Graph Processing Tool)
- Gestión de archivos DIM, ZIP, TIFF
- API REST para comunicación cliente-servidor
- Interfaz web responsiva para usuarios no técnicos

## Stack Tecnológico

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (React.js)                       │
│              TypeScript/JSX, CSS3, Leaflet                  │
└────────────────────────┬────────────────────────────────────┘
                         │ (HTTP/REST)
                         │ Puerto 5000
┌────────────────────────▼────────────────────────────────────┐
│                   BACKEND (Flask)                            │
│         Python 3.8+, CORS, Subprocess I/O                  │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        │                                 │
    ┌───▼──────────┐         ┌──────────▼──────────┐
    │ SNAP GPT     │         │ Sistema Archivos    │
    │ (ESA Tool)   │         │ • Entrada/Salida    │
    │ Java Runtime │         │ • Temporales        │
    │ Processing   │         │ • Gráficos XML      │
    └──────────────┘         └─────────────────────┘
```

---

# ARQUITECTURA

## Arquitectura de Capas

```
┌──────────────────────────────────────────────────────────────┐
│                    PRESENTACIÓN                              │
│  React Components (ProcessorUI, GraphEditor, Visualizador)  │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ REST API (HTTP)
                     │
┌────────────────────▼─────────────────────────────────────────┐
│                    APLICACIÓN                                │
│  Flask Routes (/config, /procesar, /procesar_flujo, etc)   │
│  Lógica de control y coordinación                           │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ Subprocess & File I/O
                     │
┌────────────────────▼─────────────────────────────────────────┐
│                    PROCESAMIENTO                             │
│  GPT (SNAP Graph Processing Tool)                           │
│  Ejecución de gráficos XML                                  │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ File System Operations
                     │
┌────────────────────▼─────────────────────────────────────────┐
│                    ALMACENAMIENTO                            │
│  • Entrada: backend/files/images/                           │
│  • Salida: backend/files/output/                            │
│  • Temporal: backend/files/temp/converted/                  │
│  • Gráficos: backend/files/GRAFICO_*.xml                   │
└──────────────────────────────────────────────────────────────┘
```

## Flujo de Datos (Modo Flujo Completo)

```
Usuario carga archivo (ZIP/DIM)
           │
           ▼
     [API /procesar_flujo]
           │
           ├─── GRÁFICO_1.xml (Orbit Correction)
           │         └─► step_1.dim
           │
           ├─── GRÁFICO_2.xml (Calibration)
           │         └─► step_2.dim
           │
           ├─── GRÁFICO_3.xml (Terrain Correction)
           │         └─► step_3.dim
           │
           ├─── GRÁFICO_4.xml (Final Output)
           │         └─► step_4.dim
           │
           ▼
    Archivo procesado final
```

## Interacción Cliente-Servidor

```
Frontend (React)                    Backend (Flask)
     │                                   │
     │ GET /config                       │
     │──────────────────────────────────►│
     │                                   │
     │     {"status": "ok", ...}         │
     │◄──────────────────────────────────│
     │                                   │
     │ POST /procesar                    │
     │ {graph, input, output}            │
     │──────────────────────────────────►│
     │                                   │ [Ejecuta GPT]
     │     {"status": "success", ...}    │
     │◄──────────────────────────────────│
     │                                   │
```

---

# TECNOLOGÍAS

## Backend

### Python 3.8+

```python
# Requisitos mínimos
python --version
# >= 3.8.0

# Verificar instalación
python -c "import sys; print(sys.version)"
```

### Flask

```python
# Versión: Latest
# Propósito: Framework web minimalista
# Características:
#   - Routing automático
#   - WSGI compatible
#   - Extensible con blueprints

from flask import Flask, request, jsonify
app = Flask(__name__)

@app.route('/config', methods=['GET'])
def get_config():
    return jsonify({"status": "ok"})
```

### Flask-CORS

```python
# Versión: Latest
# Propósito: Habilitar CORS para comunicación Frontend-Backend

from flask_cors import CORS

CORS(app)  # Permite todas las rutas
# O configuración específica:
# CORS(app, resources={
#     r"/api/*": {"origins": ["http://localhost:3000"]}
# })
```

### Pillow (PIL)

```python
# Versión: Latest
# Propósito: Procesamiento de imágenes estándar

from PIL import Image

img = Image.open("archivo.tif")
img.convert("RGB")
img.save("salida.png")
```

### Rasterio

```python
# Versión: Latest
# Propósito: Lectura/escritura de datos geoespaciales raster
# Características avanzadas:
#   - Soporte para múltiples formatos (GeoTIFF, HDF5, NetCDF)
#   - Acceso a metadatos geoespaciales
#   - Proyecciones y transformaciones
#   - Lectura de archivos grandes sin cargar en memoria
#   - Manejo de datos SAR (Sentinel-1)

import rasterio
from rasterio.plot import show

# Abrir archivo geoespacial
with rasterio.open('archivo.tif') as src:
    data = src.read(1)  # Leer banda 1
    profile = src.profile  # Metadatos
    transform = src.transform  # Georreferenciación
    
# Escribir archivo geoespacial
with rasterio.open(
    'salida.tif',
    'w',
    driver='GTiff',
    height=data.shape[0],
    width=data.shape[1],
    count=1,
    dtype=data.dtype,
    crs=profile['crs'],
    transform=transform,
) as dst:
    dst.write(data, 1)
```

### Subprocess

```python
# Built-in Python
# Propósito: Ejecutar comandos del sistema (GPT)

import subprocess

result = subprocess.run(
    ["gpt", "GRAFICO_1.xml", "-PinputFile=entrada.zip"],
    capture_output=True,
    text=True
)
```

## Frontend

### React 19.2.0

```javascript
// Framework UI moderno
// Características:
//   - Componentes funcionales
//   - Hooks (useState, useEffect)
//   - Virtual DOM
//   - JSX syntax

function ProcessorUI() {
    const [status, setStatus] = useState("");
    
    return (
        <div>
            <h1>Procesador</h1>
            <p>Estado: {status}</p>
        </div>
    );
}
```

### React DOM 19.2.0

```javascript
// Renderización en navegador
import ReactDOM from 'react-dom/client';

const root = ReactDOM.createRoot(
    document.getElementById('root')
);
root.render(<App />);
```

### Leaflet 1.9.4

```javascript
// Librería de mapas interactivos
// Características:
//   - Visualización de geoespacial
//   - Capas personalizables
//   - Soporte GeoJSON

import L from 'leaflet';

const map = L.map('mapid').setView([51.505, -0.09], 13);
L.tileLayer('https://.../tiles/{z}/{x}/{y}.png').addTo(map);
```

## SNAP (Sentinel Application Platform)

### Versión: 13.0+

```bash
# Verificar instalación
gpt -h

# Que es:
#   - Platform ESA oficial para procesamiento Sentinel
#   - Incluye GPT (Graph Processing Tool)
#   - Soporte para múltiples sensores satelitales

# Requisitos:
#   - Java 17+ (incluido en instalador)
#   - 4GB+ RAM
#   - 20GB+ disco
```

### GPT (Graph Processing Tool)

```bash
# Sintaxis básica
gpt graph.xml \
    -PinputFile=entrada.zip \
    -PoutputFile=salida.dim

# Opciones:
#   -P : Parámetro (disponible en XML)
#   -e : Ejecutar
#   -w : Directorio trabajo
```

## Node.js y npm

### Node.js 14+

```bash
# Versión: 14.x, 16.x, 18.x (recomendado)
node --version
npm --version

# Gestión de versiones:
# - nvm (Node Version Manager)
# - fnm (Fast Node Manager)
```

### npm

```bash
# Package manager para JavaScript
npm install          # Instalar dependencias
npm start           # Iniciar proyecto
npm run build       # Compilar para producción
npm test            # Ejecutar tests
```

## Tabla Comparativa de Tecnologías

| Capa | Tecnología | Versión | Lenguaje | Propósito |
|------|-----------|---------|----------|-----------|
| **Presentación** | React | 19.2.0 | JSX/JavaScript | UI |
| **Presentación** | Leaflet | 1.9.4 | JavaScript | Mapas |
| **Aplicación** | Flask | Latest | Python | API REST |
| **Aplicación** | Flask-CORS | Latest | Python | CORS |
| **Almacenamiento** | Pillow | Latest | Python | Imágenes estándar |
| **Almacenamiento** | Rasterio | Latest | Python | Datos geoespaciales raster |
| **Ejecución** | SNAP GPT | 13.0+ | Java/CLI | Procesamiento |
| **Runtime** | Python | 3.8+ | Python | Backend |
| **Runtime** | Node.js | 14+ | JavaScript | Frontend |
| **Control** | Java | 17+ | Java | SNAP Runtime |

---

# ESTRUCTURA DE ARCHIVOS

## Árbol Completo

```
satellite-image-processing-flow-automation/
│
├── backend/                               # 📦 Servidor Flask
│   ├── controller.py                      # Archivo principal (831 líneas)
│   │   ├── Línea 1-15: Imports
│   │   ├── Línea 16: CORS(app)
│   │   ├── Línea 20-50: Configuración
│   │   ├── Línea 60-100: Rutas GET
│   │   ├── Línea 100-400: Rutas POST
│   │   ├── Línea 400-700: Funciones auxiliares
│   │   ├── Línea 700-800: Procesamiento GPT
│   │   └── Línea 817: app.run(port=5000)
│   │
│   ├── Dockerfile                        # Containerización
│   ├── test_tiff.py                      # Tests
│   │
│   └── files/                            # 💾 Almacenamiento datos
│       ├── images/                       # 📥 Entrada usuario
│       │   └── *.zip, *.dim, *.tif
│       │
│       ├── output/                       # 📤 Salida procesada
│       │   └── *_step_4.dim
│       │
│       ├── temp/converted/               # 🗑️ Temporales
│       │   └── conversiones intermedias
│       │
│       ├── GRAFICO_1.xml                 # Orbit Correction
│       ├── GRAFICO_2.xml                 # Calibration
│       ├── GRAFICO_3.xml                 # Terrain Correction
│       └── GRAFICO_4.xml                 # Final Output
│
├── frontend/                             # 🎨 Aplicación React
│   ├── package.json                      # Dependencias npm
│   ├── public/
│   │   ├── index.html                    # HTML raíz
│   │   ├── manifest.json
│   │   └── robots.txt
│   │
│   └── src/                              # Código fuente
│       ├── index.js                      # Entry point
│       ├── App.jsx                       # Componente raíz
│       ├── api.js                        # Cliente REST (Línea 1: API_BASE)
│       ├── index.css                     # Estilos globales
│       │
│       └── components/
│           ├── ProcessorUI.jsx           # Componente principal (675 líneas)
│           │   ├── Modo "Flujo Completo"
│           │   ├── Modo "Graph Individual"
│           │   └── Manejo estado
│           │
│           ├── ProcessorUI.css
│           ├── GraphEditor.jsx           # Editor XML
│           ├── visualizador.jsx          # Visor imágenes (buena versión)
│           ├── visualizador-bad.jsx      # Visor imágenes (versión anterior)
│           ├── ParameterPanel.jsx        # Panel parámetros
│           └── ParameterPanel.module.css
│
└── README.md

```

## Tamaños de Archivos Típicos

| Archivo | Tipo | Tamaño Típico | Rango |
|---------|------|----------------|-------|
| Entrada Sentinel-1 ZIP | SAR Data | 800 MB | 500 MB - 2 GB |
| Archivo DIM (paso) | Procesado | 2.5 GB | 1 GB - 5 GB |
| Imagen TIFF (completa) | Raster | 1.5 GB | 500 MB - 3 GB |
| PNG (vista previa) | Comprimida | 25 MB | 2 MB - 50 MB |
| Gráfico XML | Config | 12 KB | 5 KB - 20 KB |
| controller.py | Python | 28 KB | - |
| ProcessorUI.jsx | React | 22 KB | - |

## Líneas Clave en Código

| Archivo | Línea | Descripción | Rango |
|---------|-------|-------------|-------|
| controller.py | 16 | CORS configuration | 1 línea |
| controller.py | 133 | Comando GPT | 1 línea |
| controller.py | 817 | Puerto Flask | 1 línea |
| api.js | 1 | URL API Base | 1 línea |
| ProcessorUI.jsx | 1-50 | Imports y estado | 50 líneas |
| ProcessorUI.jsx | 100-200 | Manejadores eventos | 100 líneas |
| ProcessorUI.jsx | 300-400 | Render UI | 100 líneas |

---

# CONFIGURACIÓN TÉCNICA

## Backend Configuration

### controller.py - Secciones Críticas

```python
# Línea 1-20: Imports
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import subprocess
import os
from PIL import Image
import rasterio

# Línea 16: CORS (Habilita comunicación con Frontend)
CORS(app)

# Línea 20-50: Rutas base
BASE_FILES_FOLDER = "files"
OUTPUT_FOLDER = os.path.join(BASE_FILES_FOLDER, "output")
IMAGES_FOLDER = os.path.join(BASE_FILES_FOLDER, "images")
TEMP_FOLDER = os.path.join(BASE_FILES_FOLDER, "temp", "converted")

# Rasterio usado para:
# - Leer metadatos geoespaciales de archivos DIM/TIFF
# - Acceder a proyecciones y transformaciones
# - Conversión entre formatos raster
# - Validación de archivos satelitales

# Línea 817: Puerto y ejecución
if __name__ == '__main__':
    app.run(debug=True, port=5000)  # Cambiar puerto si es necesario
```

### Parámetros de Configuración

| Parámetro | Valor | Editable | Efecto |
|-----------|-------|----------|--------|
| PORT | 5000 | Sí | Puerto de escucha backend |
| DEBUG | True | Sí | Modo debug Flask |
| CORS | Enabled | Sí | Permite conexiones CORS |
| BASE_FILES | "files/" | Sí | Ruta base de datos |

## Frontend Configuration

### api.js - URL Base API

```javascript
// Línea 1 - Cambiar según servidor
const API_BASE = "http://localhost:5000";

// Ejemplos:
// const API_BASE = "http://192.168.1.100:5000";  // Red local
// const API_BASE = "https://api.ejemplo.com";     // Servidor remoto
// const API_BASE = "http://mi-servidor:5000";     // Otro servidor
```

### Rutas de API Configuradas

```javascript
// Ejemplos de URLs que se construyen
const CONFIG_URL = `${API_BASE}/config`;
const FILES_URL = `${API_BASE}/archivos-disponibles`;
const PROCESS_URL = `${API_BASE}/procesar`;
const FLOW_URL = `${API_BASE}/procesar_flujo`;
```

## Variables de Entorno (Recomendado)

### Backend (.env)

```env
FLASK_ENV=development
FLASK_DEBUG=True
FLASK_PORT=5000
BASE_FILES_FOLDER=./files
```

### Frontend (.env.local)

```env
REACT_APP_API_BASE=http://localhost:5000
REACT_APP_DEBUG=true
```

---

# API ENDPOINTS

## Endpoints Disponibles

### GET /config

**Propósito:** Obtener configuración general del sistema

**URL:** `http://localhost:5000/config`

**Respuesta exitosa (200):**
```json
{
  "status": "ok",
  "backend_version": "1.0",
  "snap_available": true,
  "output_folder": "files/output"
}
```

**Respuesta error (500):**
```json
{
  "status": "error",
  "message": "SNAP no disponible"
}
```

---

### GET /archivos-disponibles

**Propósito:** Listar archivos disponibles en servidor

**URL:** `http://localhost:5000/archivos-disponibles`

**Parámetros query (opcionales):**
```
?folder=images  # Ver carpeta específica
?extension=.dim # Filtrar por extensión
```

**Respuesta exitosa (200):**
```json
{
  "status": "ok",
  "images": [
    "S1A_IW_SLC.zip",
    "satellite_001.dim"
  ],
  "output": [
    "result_step_4.dim"
  ]
}
```

---

### POST /procesar

**Propósito:** Procesar un gráfico individual

**URL:** `http://localhost:5000/procesar`

**Content-Type:** `application/json`

**Request body:**
```json
{
  "graph": "GRAFICO_1.xml",
  "input": "S1A_IW_SLC.zip",
  "output": "/home/usuario/resultado.dim",
  "params": {
    "param1": "valor1"
  }
}
```

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| graph | string | Sí | Nombre del gráfico (GRAFICO_1-4.xml) |
| input | string | Sí | Archivo entrada (en images/ o ruta completa) |
| output | string | Sí | Ruta salida completa |
| params | object | No | Parámetros adicionales XML |

**Respuesta exitosa (200):**
```json
{
  "status": "success",
  "message": "Procesamiento completado",
  "output_file": "/home/usuario/resultado.dim",
  "processing_time": 145.23
}
```

**Respuesta error (400):**
```json
{
  "status": "error",
  "message": "Archivo no encontrado: S1A_IW_SLC.zip",
  "error_code": "FILE_NOT_FOUND"
}
```

**Respuesta error (500):**
```json
{
  "status": "error",
  "message": "Error ejecutando GPT",
  "stderr": "Graph processing failed..."
}
```

---

### POST /procesar_flujo

**Propósito:** Ejecutar todos 4 gráficos en secuencia

**URL:** `http://localhost:5000/procesar_flujo`

**Content-Type:** `application/json`

**Request body:**
```json
{
  "inputs": ["S1A_IW_SLC.zip"],
  "output_dir": "/home/usuario/procesados/",
  "preserve_intermediates": false
}
```

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| inputs | array | Sí | Array con archivo(s) entrada |
| output_dir | string | Sí | Directorio para archivos salida |
| preserve_intermediates | bool | No | Mantener step_1, step_2, step_3 |

**Respuesta exitosa (200):**
```json
{
  "status": "success",
  "message": "Flujo completado",
  "outputs": {
    "step_1": "S1A_IW_SLC_step_1.dim",
    "step_2": "S1A_IW_SLC_step_2.dim",
    "step_3": "S1A_IW_SLC_step_3.dim",
    "step_4": "S1A_IW_SLC_step_4.dim"
  },
  "processing_times": {
    "step_1": 45.2,
    "step_2": 38.1,
    "step_3": 52.3,
    "step_4": 9.5
  },
  "total_time": 145.1
}
```

---

### POST /guardar-graph

**Propósito:** Guardar cambios en archivo gráfico XML

**URL:** `http://localhost:5000/guardar-graph`

**Content-Type:** `application/json`

**Request body:**
```json
{
  "file_name": "GRAFICO_1.xml",
  "content": "<?xml version=\"1.0\"?><graph>...</graph>"
}
```

**Respuesta exitosa (200):**
```json
{
  "status": "success",
  "message": "Gráfico guardado",
  "file": "GRAFICO_1.xml"
}
```

---

### GET /files/<folder>/<filename>

**Propósito:** Descargar archivo del servidor

**URL:** `http://localhost:5000/files/output/resultado.dim`

**Parámetros path:**
| Parámetro | Valores | Descripción |
|-----------|---------|-------------|
| folder | images, output, temp/converted | Carpeta fuente |
| filename | * | Nombre archivo |

**Respuesta exitosa (200):** Archivo binario

**Respuesta error (404):**
```json
{
  "status": "error",
  "message": "Archivo no encontrado"
}
```

---

## Flujo de Llamadas API Típico

```
1. Cliente carga página
   → GET /config
   → Verifica si SNAP disponible

2. Usuario selecciona archivo
   → GET /archivos-disponibles
   → Muestra lista de archivos

3. Usuario procesa
   → POST /procesar_flujo
   → Inicia procesamiento

4. Monitoreo progreso (opcional)
   → GET /config  (verificar estado)
   → Poll cada 2-5 segundos

5. Usuario descarga resultado
   → GET /files/output/resultado.dim
   → Descarga archivo procesado
```

---

# FORMATOS DE DATOS

## Formatos de Entrada

### ZIP (Sentinel-1 Comprimido)

```
Estructura típica:
Archivo.zip
├── Archivo.xml              # Metadatos
├── measurement/
│   ├── s1a-iw1-slc-vh-...tiff
│   ├── s1a-iw2-slc-vh-...tiff
│   └── s1a-iw3-slc-vh-...tiff
├── annotation/
│   └── s1a-iw1-slc-vh-...xml
└── preview/
    └── quick-look.png

Tamaño: 500 MB - 2 GB
Compresión: ZIP estándar
Formato TIFF interno: GeoTIFF (leído con rasterio)
```

**Características:**
- Datos sin procesar de satélite Sentinel-1
- Radar de Apertura Sintética (SAR)
- Múltiples polarizaciones (VV, VH)
- Archivos TIFF georreferenciados (procesados con rasterio)

### DIM (SNAP Format)

```
Estructura:
Archivo.dim              # Metadatos (XML)
Archivo.data/
├── img_0_TileLayout.xml
└── img_0_data_VV.img

Tamaño: 1 GB - 5 GB
Compresión: Sin comprimir (más rápido)
Procesado con: rasterio (metadatos) y SNAP (datos)
```

**Características:**
- Formato nativo SNAP (usado internamente por GPT)
- Almacenamiento optimizado
- Metadatos integrados
- Soporte para múltiples bandas
- Rasterio puede leer metadatos DIM para validación

### TIFF (GeoTIFF)

```
Estructura:
Single file: Archivo.tif

Tamaño: 500 MB - 3 GB
Metadatos: TIFF tags + georeferenciación
Procesado con: rasterio (lectura) y SNAP GPT (procesamiento)
```

**Características:**
- Formato raster estándar geoespacial
- Información de proyección y transformación
- Múltiples bandas soportadas
- Compatible con ArcGIS, QGIS, etc.
- Lectura eficiente con rasterio sin cargar en memoria completa
- Manejo de datos SAR complejos (amplitud, fase, polarización)

## Formatos de Salida

### Archivo step_4.dim (Final)

```
Salida recomendada del flujo completo
Contiene:
- Datos corregidos en órbita
- Calibrados radiométricamente
- Con corrección geométrica
- Geocodificados
```

### PNG (Vista Previa)

```
Conversión para visualización web
Tamaño: 2 MB - 50 MB
Profundidad: 8-bit o 16-bit
```

---

# FLUJOS DE PROCESAMIENTO

## Flujo Completo (4 Pasos)

```
Entrada: archivo.zip (datos Sentinel-1 crudo)
│
├─ PASO 1: GRÁFICO_1.xml (Orbit Correction)
│  Función: Corrige efemérides del satélite
│  Entrada: datos crudo
│  Salida: archivo_step_1.dim
│  Tiempo: 30-50 minutos típico
│
├─ PASO 2: GRÁFICO_2.xml (Calibration)
│  Función: Calibración radiométrica
│  Entrada: archivo_step_1.dim
│  Salida: archivo_step_2.dim
│  Tiempo: 20-40 minutos típico
│  Nota: Puede usar dos archivos de entrada
│
├─ PASO 3: GRÁFICO_3.xml (Terrain Correction)
│  Función: Corrección geométrica con MDE
│  Entrada: archivo_step_2.dim
│  Salida: archivo_step_3.dim
│  Tiempo: 40-60 minutos típico
│
└─ PASO 4: GRÁFICO_4.xml (Final Output)
   Función: Exportar a formato final
   Entrada: archivo_step_3.dim
   Salida: archivo_step_4.dim
   Tiempo: 5-15 minutos típico
   Formato: BEAM-DIMAP o exportado

Tiempo total: 2-4 horas típico
Espacio requerido: 10-20 GB temporal
```

## Diagrama de Dependencias

```
              Entrada (ZIP)
                    │
                    ▼
             ┌───────────────┐
             │ GRÁFICO_1.xml │
             │ Orbit Corr.   │
             └───────────────┘
                    │
                    ▼
         archivo_step_1.dim
                    │
                    ▼
             ┌───────────────┐
             │ GRÁFICO_2.xml │
             │ Calibration   │  ◄─── (opcional: ref. file)
             └───────────────┘
                    │
                    ▼
         archivo_step_2.dim
                    │
                    ▼
             ┌───────────────┐
             │ GRÁFICO_3.xml │
             │ Terrain Corr. │
             └───────────────┘
                    │
                    ▼
         archivo_step_3.dim
                    │
                    ▼
             ┌───────────────┐
             │ GRÁFICO_4.xml │
             │ Final Output  │
             └───────────────┘
                    │
                    ▼
    archivo_step_4.dim (FINAL)
```

## Graph Individual (Procesamiento Parcial)

```
Permite procesar un solo gráfico:

Opción 1: Solo Orbit (Paso 1)
  Entrada: ZIP crudo
  Salida: step_1.dim
  Tiempo: 30-50 minutos

Opción 2: Solo Calibración (Paso 2)
  Entrada: step_1.dim + referencia (opcional)
  Salida: step_2.dim
  Tiempo: 20-40 minutos

Opción 3: Solo Corrección Geométrica (Paso 3)
  Entrada: step_2.dim
  Salida: step_3.dim
  Tiempo: 40-60 minutos

Opción 4: Solo Exportación (Paso 4)
  Entrada: step_3.dim
  Salida: step_4.dim
  Tiempo: 5-15 minutos

Uso: Pruebas, reprocesamiento parcial, debugging
```

---

# ARCHIVOS GRÁFICOS XML

## Estructura Básica de un Gráfico

```xml
<?xml version="1.0" encoding="UTF-8"?>
<graph id="ProcessingGraph">
  <version>1.0</version>
  <description>Descripción del procesamiento</description>
  
  <!-- NODOS: Pasos del procesamiento -->
  <node id="NodeId">
    <operator>NombreOperador</operator>
    <sources>
      <sourceProduct>NodoAnterior</sourceProduct>
    </sources>
    <parameters>
      <parametro1>valor1</parametro1>
    </parameters>
  </node>
  
  <!-- Conectar nodos automáticamente -->
  <applicationData id="Graph">
    <node id="NodeId">
      <displayPosition x="100" y="100"/>
    </node>
  </applicationData>
</graph>
```

## GRÁFICO_1.xml (Orbit Correction)

```xml
<graph id="OrbitCorrectionGraph">
  <node id="Read">
    <operator>Read</operator>
    <parameters>
      <sourceProduct>${inputFile}</sourceProduct>
    </parameters>
  </node>
  
  <node id="ApplyOrbitFile">
    <operator>Apply-Orbit-File</operator>
    <sources>
      <sourceProduct>Read</sourceProduct>
    </sources>
    <parameters/>
  </node>
  
  <node id="Write">
    <operator>Write</operator>
    <sources>
      <sourceProduct>ApplyOrbitFile</sourceProduct>
    </sources>
    <parameters>
      <file>${outputFile}</file>
      <formatName>BEAM-DIMAP</formatName>
    </parameters>
  </node>
</graph>
```

**Operadores SNAP disponibles:**
```
Apply-Orbit-File       Aplica archivo de órbita
Calibrate              Calibración radiométrica
Terrain-Correction     Corrección geométrica
Import                 Importar datos
Export                 Exportar datos
Read                   Leer archivo
Write                  Escribir archivo
```

## Parámetros Disponibles

### Parámetros Dinámicos (XML)

```xml
<!-- Parámetros reemplazables por GPT -->
${inputFile}          Archivo entrada
${outputFile}         Archivo salida
${inputFile2}         Segundo archivo entrada
${param1}             Parámetros adicionales
```

### Sintaxis GPT de Línea de Comandos

```bash
gpt graph.xml \
    -PinputFile=/path/to/input.zip \
    -PoutputFile=/path/to/output.dim \
    -Pparam1=valor1 \
    -Pparam2=valor2
```

## Validación de Gráficos

```bash
# Probar gráfico
gpt GRAFICO_1.xml -PinputFile=test.zip -PoutputFile=test_out.dim

# Si hay error de XML:
# Error parsing graph XML...
# → Verificar sintaxis XML válida

# Herramientas validación:
# - https://www.xmlvalidation.com/
# - xmllint (Linux)
# - XML Notepad (Windows)
```

---

# DEBUGGING Y MONITOREO

## Logs del Backend

### Ubicación

```bash
# Salida en terminal donde se ejecuta:
# $ python controller.py
# * Running on http://127.0.0.1:5000/
```

### Ejemplos de Output

```
[2026-01-23 10:15:30] INFO: Config solicitado
[2026-01-23 10:15:35] INFO: Archivos disponibles listados
[2026-01-23 10:16:00] INFO: Iniciando procesamiento GRAFICO_1.xml
[2026-01-23 10:16:05] DEBUG: Ejecutando: gpt GRAFICO_1.xml -PinputFile=...
[2026-01-23 10:35:45] INFO: Procesamiento completado exitosamente
[2026-01-23 10:35:46] ERROR: Error en GRAFICO_2.xml: Memory allocation failed
```

## Herramientas de Debugging Frontend

### DevTools del Navegador (F12)

```javascript
// Consola JavaScript
// Ver errores de red
Network tab → Ver requests a /config, /procesar, etc.

// Ver estado de aplicación
Console → Ejecutar:
fetch('http://localhost:5000/config').then(r => r.json()).then(console.log)

// Ver estado React
Instalar React Developer Tools extension
```

## Verificación de Componentes

### Verificar Backend

```bash
# ¿Backend está corriendo?
curl http://localhost:5000/config
# Debe devolver JSON

# ¿SNAP disponible?
gpt -h
# Debe mostrar ayuda

# ¿Rasterio instalado?
python -c "import rasterio; print(rasterio.__version__)"
# Debe mostrar versión

# ¿Puerto está en uso?
# Windows:
netstat -ano | findstr :5000

# Linux:
lsof -i :5000
```

### Verificar Frontend

```bash
# ¿Frontend carga?
# http://localhost:3000 en navegador

# ¿Pueda conectar a Backend?
# F12 → Network → Ver requests
# Si hay CORS error, revisar CORS en controller.py
```

## Monitoreo de Procesos

### Monitoreo en Tiempo Real (Linux)

```bash
# Ver uso de recursos
watch -n 1 'ps aux | grep gpt'
watch -n 1 'free -h'

# Ver archivos creados
watch -n 1 'ls -lh backend/files/output/'
```

### Monitoreo en Tiempo Real (Windows)

```powershell
# Ver procesos Java/GPT
Get-Process | Where-Object {$_.Name -like "*java*"}

# Ver espacio disco
Get-Volume C:

# Monitoreo uso recursos
Get-Process python | Select ProcessName, CPU, Memory
```

---

# RENDIMIENTO Y OPTIMIZACIÓN

## Benchmarks Típicos

### Hardware de Prueba

```
CPU:  Intel i7-10700K
RAM:  32 GB
SSD:  NVMe 1TB
Imagen: Sentinel-1 ~800MB
```

### Tiempos de Procesamiento

| Gráfico | Imagen Pequeña | Imagen Mediana | Imagen Grande |
|---------|----------------|----------------|---------------|
| 1 (Orbit) | 2-5 min | 10-15 min | 30-50 min |
| 2 (Calib) | 2-4 min | 8-12 min | 20-40 min |
| 3 (Terrain) | 3-8 min | 15-20 min | 40-60 min |
| 4 (Export) | 1-2 min | 3-5 min | 5-15 min |
| **Total** | **8-19 min** | **36-52 min** | **95-165 min** |

### Uso de Recursos

| Gráfico | CPU | RAM | Disco |
|---------|-----|-----|-------|
| 1 (Orbit) | 60-80% | 2-4 GB | +3-5 GB |
| 2 (Calib) | 50-70% | 2-3 GB | +2-3 GB |
| 3 (Terrain) | 70-90% | 3-5 GB | +3-5 GB |
| 4 (Export) | 40-60% | 1-2 GB | +2 GB |

## Optimización para Rendimiento

### Nivel 1: Reducir Tamaño de Entrada

```bash
# Opción 1: Recortar región de interés
gpt crop.xml -Pregion="100,100,500,500"

# Opción 2: Remuestrear
gpt resample.xml -Pfactor=2  # Reduce 4x en tamaño

# Opción 3: Reducir bandas
# Procesar solo VV o VH (no ambas)
```

### Nivel 2: Paralelizar Procesamiento

```bash
# Procesar múltiples imágenes en paralelo (diferentes máquinas)
# Máquina 1: Procesa archivo_1.zip
# Máquina 2: Procesa archivo_2.zip
# Máquina 3: Procesa archivo_3.zip

# Backend modificado para soportar colas:
# (requiere cambios en controller.py)
```

### Nivel 3: Optimizaciones de Sistema

```bash
# Usar SSD en lugar de HDD
# Aumentar RAM a 32+ GB
# Dedicar CPU (cerrar otras aplicaciones)
# Usar conexión rápida para entrada/salida

# En Linux: aumentar límites de archivos abiertos
ulimit -n 65536
```

## Caché y Reutilización

```python
# Reutilizar intermedios (no procesar de nuevo)
# backend/files/temp/converted/
# 
# Beneficio: Si falla step 3, solo reprocesar step 3
# No necesitar repetir steps 1 y 2

# Activar: preserve_intermediates=true en /procesar_flujo
```

---

# REFERENCIA TÉCNICA RÁPIDA

## Rutas Base

```
Frontend:    http://localhost:3000
Backend:     http://localhost:5000
API Base:    http://localhost:5000
```

## Carpetas Clave

```
backend/files/images/          Entrada
backend/files/output/          Salida
backend/files/temp/converted/  Temporales
backend/files/GRAFICO_*.xml    Gráficos
```

## Líneas de Edición

```
controller.py (línea 817)      Puerto backend
api.js (línea 1)               URL API
ProcessorUI.jsx (línea 1-50)   Componente principal
```

## Comandos Esenciales

```bash
python controller.py           Iniciar backend
npm start                      Iniciar frontend
gpt -h                         Verificar SNAP
gpt graph.xml -Pparam=val      Ejecutar gráfico
```

## Versiones Mínimas

```
Python:  3.8.0+
Node.js: 14.0.0+
SNAP:    13.0+
Java:    17.0+
```

## Tiempos Típicos

```
Lectura rápida:      5 minutos
Instalación:         15 minutos
Primera prueba:      30-50 minutos
Procesamiento imagen: 2-4 horas
```

---

**INFORMACIÓN TÉCNICA**  
Versión 2.0 - Enero 2026
