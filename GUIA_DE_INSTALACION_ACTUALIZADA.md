# Guía de instalación — Windows 10/11

**Proyecto:** satellite-image-processing-flow-automation_UPDATE  
**Para:** instalar el sistema en otra computadora Windows (no Linux)  
**Tiempo estimado:** 1–2 horas (más las descargas)

Todo se hace desde **PowerShell**. No hace falta Anaconda completo: solo **Miniconda**.

---

## Tabla de contenidos

1. [Qué vas a instalar](#1-qué-vas-a-instalar)
2. [Requisitos de la PC](#2-requisitos-de-la-pc)
3. [Paso 1 — Git](#paso-1--git)
4. [Paso 2 — SNAP (gpt y pconvert)](#paso-2--snap-gpt-y-pconvert)
5. [Paso 3 — SNAPHU](#paso-3--snaphu)
6. [Paso 4 — Miniconda y librerías Python](#paso-4--miniconda-y-librerías-python)
7. [Paso 5 — Node.js](#paso-5--nodejs)
8. [Paso 6 — Descargar el proyecto](#paso-6--descargar-el-proyecto)
9. [Paso 7 — Configurar las 3 rutas (único archivo a editar)](#paso-7--configurar-las-3-rutas-único-archivo-a-editar)
10. [Paso 8 — Carpetas de datos](#paso-8--carpetas-de-datos)
11. [Paso 9 — Frontend](#paso-9--frontend)
12. [Paso 10 — Arrancar](#paso-10--arrancar)
13. [Paso 11 — Verificar](#paso-11--verificar)
14. [Primer uso](#primer-uso)
15. [Si algo falla](#si-algo-falla)

---

## 1. Qué vas a instalar

| Herramienta | Para qué | ¿Obligatoria? |
|---|---|---|
| Git | Bajar el proyecto | Sí |
| SNAP 13 (Sentinel Toolboxes) | Procesar imágenes (`gpt`) y previews (`pconvert`) | Sí |
| SNAPHU | Desenvolver la fase (paso 5 del flujo) | Sí |
| Miniconda + Python 3.11 | Backend Flask | Sí |
| Node.js LTS | Interfaz web | Sí |

**Qué hace cada binario de SNAP**

- `gpt` — el procesamiento real (órbita, interferograma, terrain correction, etc.)
- `snaphu` — unwrap de la fase
- `pconvert` — solo miniaturas PNG para la web. Si falta, el flujo igual puede terminar; fallan los previews

**Qué NO hay que instalar**

- Python de python.org (Miniconda ya trae Python)
- Anaconda completo
- Docker

---

## 2. Requisitos de la PC

| | Mínimo | Recomendado |
|---|---|---|
| Sistema | Windows 10/11 **64-bit** | Windows 11 |
| RAM | 16 GB | 32 GB |
| Disco libre | 80 GB | 150 GB SSD |
| CPU | 4 núcleos | 8+ |
| Internet | Sí | Órbitas Sentinel + DEM SRTM |

4 GB de RAM no alcanza. Con 8 GB SNAP suele morir a mitad del grafo.

Carpeta de trabajo sugerida:

```text
C:\satelital\
```

---

## PASO 1 — Git

1. Descarga: https://git-scm.com/download/win
2. Instala **64-bit Git for Windows**
3. En el asistente deja lo predeterminado. Importante: *Git from the command line and also from 3rd-party software*
4. Cierra PowerShell, ábrelo de nuevo:

```powershell
git --version
```

---

## PASO 2 — SNAP (gpt y pconvert)

El proyecto se escribió contra **SNAP 13**. Usa el instalador **Sentinel Toolboxes** (trae Sentinel-1 / Microwave). No uses el de solo SMOS.

### 2.1 Descargar

Página: https://step.esa.int/main/download/snap-download/

- **SNAP 13 (recomendado):**  
  https://download.esa.int/step/snap/13.0/installers/esa-snap_sentinel_windows-13.0.0.exe
- **SNAP 14 (si 13 no baja):**  
  https://download.esa.int/step/snap/14.0/installers/esa-snap_sentinel_windows-14.0.0.exe

### 2.2 Instalar

1. Ejecuta el `.exe`
2. Carpeta típica: `C:\Program Files\esa-snap`
3. Marca **Sentinel-1 Toolbox** (Microwave)
4. Deja el Java que trae el instalador
5. Si aparece, marca **agregar SNAP al PATH**
6. Finish. Reinicia Windows si lo pide

### 2.3 Comprobar gpt y pconvert

Abre **PowerShell nueva**:

```powershell
gpt -h
pconvert -h
where.exe gpt
where.exe pconvert
```

Si no reconoce el comando, agrega al PATH:

1. Barra de Windows → escribe `variables de entorno` → **Variables de entorno**
2. En *Variables del sistema* → **Path** → Editar → Nuevo
3. Pega:

```text
C:\Program Files\esa-snap\bin
```

4. Aceptar todo. **Cierra PowerShell y ábrelo de nuevo**
5. Repite `gpt -h`

Anota las dos rutas. Suelen ser:

```text
C:\Program Files\esa-snap\bin\gpt.exe
C:\Program Files\esa-snap\bin\pconvert.exe
```

### 2.4 Subir la RAM de SNAP (no saltar)

1. Abre **SNAP Desktop**
2. **Tools → Options → Performance** (memoria)
3. Asigna ~50–70 % de la RAM de la PC
   - 16 GB RAM → 8–10 GB para SNAP
   - 32 GB RAM → 16–20 GB
4. Apply / OK y cierra SNAP

Sin esto, `gpt` falla con `Java heap space`.

La primera vez SNAP descarga módulos. Deja que termine.

---

## PASO 3 — SNAPHU

En Linux el código apunta a una ruta que **no existe en Windows**. Hay que instalar el `.exe` y anotar su ruta.

### Método A (primero esto): plugin de SNAP

1. Abre **SNAP Desktop**
2. **Tools → Plugins**
3. Pestaña **Available Plugins**
4. Busca **SNAPHU** / **SNAPHU Unwrapping**
5. Install → Next → acepta → **Restart SNAP**

El plugin deja el binario en una carpeta tipo:

```text
C:\Users\TU_USUARIO\.snap\auxdata\snaphu-v2.0.4_win64\bin\snaphu.exe
```

El nombre exacto cambia. Búscalo en PowerShell:

```powershell
Get-ChildItem -Path "$env:USERPROFILE\.snap\auxdata" -Recurse -Filter "snaphu.exe" |
    Select-Object -ExpandProperty FullName
```

Copia la ruta que salga. Prueba:

```powershell
& "PEGA_AQUI_LA_RUTA\snaphu.exe"
```

Debe mostrar la ayuda de SNAPHU, no un error.

### Método B (si el plugin no trae .exe): ZIP de ESA

1. Descarga: https://step.esa.int/thirdparties/snaphu/1.4.2-2/snaphu-v1.4.2_win64.zip
2. Extrae a `C:\satelital\snaphu\`
3. Debe existir `C:\satelital\snaphu\bin\snaphu.exe`
4. Agrégalo al PATH: Variables de entorno → Path → Nuevo → `C:\satelital\snaphu\bin`
5. PowerShell nueva: `snaphu`

Ruta a usar en el código: `C:\satelital\snaphu\bin\snaphu.exe`

---

## PASO 4 — Miniconda y librerías Python

En Windows, `rasterio` con `pip` suele fallar por GDAL. Miniconda lo evita.

**No instales Python de python.org** si vas a usar Miniconda.

### 4.1 Instalar Miniconda

1. Descarga Windows 64-bit: https://docs.anaconda.com/miniconda/
2. Instala para **Just Me**
3. Marca **Add Miniconda3 to my PATH**
4. Finish → **cierra PowerShell y ábrelo de nuevo**

```powershell
conda --version
python --version
```

Si `conda` no se reconoce:

```powershell
& "$env:USERPROFILE\miniconda3\Scripts\conda.exe" init powershell
```

Cierra PowerShell, ábrelo otra vez, y vuelve a probar `conda --version`.

Si `conda activate` dice que los scripts están deshabilitados:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Escribe `Y` y Enter.

### 4.2 Crear el entorno del proyecto

```powershell
conda create -n satelital python=3.11 -y
conda activate satelital
conda install -c conda-forge flask flask-cors pillow numpy rasterio -y
python -c "import flask, flask_cors, PIL, numpy, rasterio; print('OK')"
```

Cuando el prompt empiece con `(satelital)`, el entorno está activo.

Cada vez que abras PowerShell para el backend:

```powershell
conda activate satelital
```

---

## PASO 5 — Node.js

1. https://nodejs.org/ → descarga **LTS** (18 o 20)
2. Instala con Next → Finish
3. Cierra PowerShell y ábrelo de nuevo

```powershell
node --version
npm --version
```

Debe salir `v18...` o `v20...`, no v14.

---

## PASO 6 — Descargar el proyecto

```powershell
cd C:\satelital
git clone https://github.com/nahinespinoza/satellite-image-processing-flow-automation_UPDATE.git
cd satellite-image-processing-flow-automation_UPDATE
```

**No** uses el repo viejo `vicpebarragan/satellite-image-processing-flow-automation`.

Sin Git: en GitHub → botón verde **Code** → **Download ZIP** → extrae en `C:\satelital\`.

---

## PASO 7 — Configurar las 3 rutas (único archivo a editar)

Para usar la **interfaz web** solo se edita:

```text
backend\controller.py
```

No hace falta tocar los scripts de `Scripts_Automatizacion_Snaphu`. El backend les pasa las rutas por variables de entorno.

### 7.1 Sacar las 3 rutas de ESTA computadora

En PowerShell:

```powershell
where.exe gpt
where.exe pconvert
Get-ChildItem "$env:USERPROFILE\.snap\auxdata" -Recurse -Filter "snaphu.exe" |
    Select-Object -ExpandProperty FullName
```

Ejemplo de resultado:

```text
C:\Program Files\esa-snap\bin\gpt.exe
C:\Program Files\esa-snap\bin\pconvert.exe
C:\Users\Ana\.snap\auxdata\snaphu-v2.0.4_win64\bin\snaphu.exe
```

### 7.2 Pegarlas al inicio de controller.py

Abre `backend\controller.py`. Justo **después** de:

```python
app = Flask(__name__)
CORS(app)
```

pega este bloque (cambia las 3 rutas por las de esa PC):

```python
# =============================================================================
# Rutas de SNAP / SNAPHU — editar SOLO aquí
# =============================================================================
GPT_BIN = os.environ.get("GPT_BIN", r"C:\Program Files\esa-snap\bin\gpt.exe")
PCONVERT_BIN = os.environ.get("PCONVERT_BIN", r"C:\Program Files\esa-snap\bin\pconvert.exe")
SNAPHU_BIN = os.environ.get("SNAPHU_BIN", r"C:\Users\TU_USUARIO\.snap\auxdata\snaphu-v2.0.4_win64\bin\snaphu.exe")
```

Usa el prefijo `r"..."` y la extensión `.exe`.

### 7.3 Reemplazar todas las copias viejas (Linux)

En el mismo archivo, **Buscar y reemplazar** (Ctrl+H), reemplazar **todas** las ocurrencias:

| Buscar | Reemplazar por |
|---|---|
| `"/home/nahin/esa-snap/bin/gpt"` | `GPT_BIN` |
| `"/home/nahin/esa-snap/bin/pconvert"` | `PCONVERT_BIN` |
| `"/home/nahin/.snap/auxdata/snaphu-v2.0.4_linux/bin/snaphu"` | `SNAPHU_BIN` |

Ojo con las comillas: si el código era `GPT_PATH = "/home/nahin/..."`, debe quedar `GPT_PATH = GPT_BIN` (sin comillas alrededor de `GPT_BIN`).

Casos típicos, cómo deben quedar:

```python
GPT_PATH = GPT_BIN
env["GPT_BIN"] = GPT_BIN
env["SNAPHU_BIN"] = SNAPHU_BIN
gpt_bin = GPT_BIN
pconvert_bin = pconvert_bin or PCONVERT_BIN
gpt_bin = gpt_bin or GPT_BIN
```

Comprueba que no quede ningún `/home/nahin/esa-snap` ni `snaphu-v2.0.4_linux` en el archivo.

El diccionario `PROCESSORS` (rutas a `.py` en `/home/nahin/Documentos/...`) **no se usa** en el flujo web. Puedes dejarlo.

`frontend\src\api.js` se deja en `http://localhost:5000` si el navegador y el backend están en esa misma PC.

---

## PASO 8 — Carpetas de datos

```powershell
conda activate satelital
cd C:\satelital\satellite-image-processing-flow-automation_UPDATE\backend
New-Item -ItemType Directory -Force -Path files\images, files\output, files\temp\converted | Out-Null
dir files
```

Debes ver:

```text
GRAFICO_1.xml
GRAFICO_2a.xml
GRAFICO_2b.xml
GRAFICO_3.xml
GRAFICO_4.xml
images
output
temp
```

(No existe `GRAFICO_2.xml`; son `2a` y `2b`.)

---

## PASO 9 — Frontend

```powershell
cd C:\satelital\satellite-image-processing-flow-automation_UPDATE\frontend
npm install
```

Si sale `ERESOLVE`:

```powershell
npm install --legacy-peer-deps
```

Al final debe decir `added ... packages`.

---

## PASO 10 — Arrancar

Necesitas **dos** ventanas de PowerShell. No cierres ninguna.

**Ventana 1 — backend**

```powershell
conda activate satelital
cd C:\satelital\satellite-image-processing-flow-automation_UPDATE\backend
python controller.py
```

Debe decir: `Running on http://127.0.0.1:5000`

**Ventana 2 — frontend**

```powershell
cd C:\satelital\satellite-image-processing-flow-automation_UPDATE\frontend
npm start
```

Se abre el navegador en http://localhost:3000

---

## PASO 11 — Verificar

Pega esto en una **tercera** PowerShell, con el backend ya corriendo:

```powershell
Write-Host "=== GPT ==="
where.exe gpt
gpt -h | Select-Object -First 3

Write-Host "=== PCONVERT ==="
where.exe pconvert

Write-Host "=== SNAPHU ==="
Get-ChildItem "$env:USERPROFILE\.snap\auxdata" -Recurse -Filter "snaphu.exe" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName

Write-Host "=== PYTHON ==="
conda activate satelital
python -c "import flask, flask_cors, PIL, numpy, rasterio; print('libs OK')"

Write-Host "=== NODE ==="
node --version
npm --version

Write-Host "=== BACKEND ==="
curl http://127.0.0.1:5000/config
```

`/config` debe devolver JSON con `"status": "ok"`.

Checklist:

```text
□ gpt -h funciona
□ pconvert -h funciona
□ snaphu.exe encontrado
□ python imprime libs OK
□ node v18 o v20
□ curl /config responde JSON
□ el navegador muestra la interfaz en localhost:3000
```

---

## Primer uso

1. Baja un par Sentinel-1 **SLC IW** de https://dataspace.copernicus.eu/ (ZIP, ~1 GB c/u)
2. Cópialos a `backend\files\images\` o elige la carpeta desde la UI
3. En el navegador: flujo completo, 2 imágenes de la misma órbita/geometría
4. Carpeta de salida, por ejemplo `C:\satelital\salida`
5. El flujo completo puede tardar **1–4 horas** y ocupar **10–30 GB**
6. La PC necesita internet (órbitas precisas y DEM SRTM)

---

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `conda` no se reconoce | Reabre PowerShell, o `conda.exe init powershell` (Paso 4.1) |
| `conda activate` bloqueado | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| `gpt` no se reconoce | PATH de `C:\Program Files\esa-snap\bin` + rutas en `controller.py` con `gpt.exe` |
| Paso 5 / unwrap falla | Plugin SNAPHU o ZIP win64; `SNAPHU_BIN` debe apuntar a `snaphu.exe` |
| `Java heap space` | Subir RAM en SNAP: Tools → Options → Performance |
| `ModuleNotFoundError: numpy` | Olvidaste `conda activate satelital` antes de `python controller.py` |
| Puerto 5000 en uso | Cierra el otro Python, o cambia el puerto en `controller.py` y en `frontend\src\api.js` |
| `npm` ERESOLVE | `npm install --legacy-peer-deps` |
| Página en blanco | Mira la ventana de `npm start`; reinstala con `--legacy-peer-deps` |
| CORS en el navegador | El backend tiene que estar corriendo |
| Terrain Correction pide DEM | Internet activo; SNAP baja SRTM solo |
| Sigue buscando `/home/nahin/` | Quedó una ruta Linux en `controller.py`. Busca `nahin` y cámbiala |

---

## Resumen rápido (el día de la instalación)

```text
1. Git
2. SNAP 13 Sentinel Toolboxes + PATH + RAM
3. Plugin SNAPHU → anotar snaphu.exe
4. Miniconda → conda create -n satelital python=3.11
   conda install -c conda-forge flask flask-cors pillow numpy rasterio
5. Node.js LTS
6. git clone del repo UPDATE
7. En controller.py: 3 variables arriba + reemplazar las rutas Linux
8. Crear files\images, output, temp\converted
9. npm install en frontend
10. python controller.py   y   npm start
11. curl http://127.0.0.1:5000/config
```

**Archivo a editar en la otra máquina:** solo `backend\controller.py` (las 3 rutas).  
**No editar:** scripts SNAPHU, `api.js` (si usan localhost), XML.

---

*Guía de instalación Windows — versión 2.0 — agosto 2026*
