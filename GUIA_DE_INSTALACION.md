# 🚀 GUÍA DE INSTALACIÓN (PARA TODOS)

**¡No necesitas ser programador!**  
**Esta guía está hecha para que CUALQUIERA pueda instalar y usar el sistema**

---

## 📑 TABLA DE CONTENIDOS

1. [Antes de Empezar](#antes-de-empezar)
2. [Paso 1: Descargar e Instalar Python](#paso-1-descargar-e-instalar-python)
3. [Paso 2: Descargar e Instalar Node.js](#paso-2-descargar-e-instalar-nodejs)
4. [Paso 3: Descargar el Proyecto](#paso-3-descargar-el-proyecto)
5. [Paso 4: Preparar el Backend](#paso-4-preparar-el-backend)
6. [Paso 5: Preparar el Frontend](#paso-5-preparar-el-frontend)
7. [Paso 6: Crear Carpetas de Datos](#paso-6-crear-carpetas-de-datos)
8. [Paso 7: Iniciar el Sistema](#paso-7-iniciar-el-sistema)
9. [Paso 8: Verificar que Todo Funciona](#paso-8-verificar-que-todo-funciona)
10. [Ayuda Rápida (Si algo falla)](#ayuda-rápida-si-algo-falla)

---

## ✅ ANTES DE EMPEZAR

### ¿Tengo lo que necesito?

Marca según corresponda:

```
□ Computadora con Windows 10/11, Mac o Linux
□ Conexión a Internet (para descargas)
□ Unos 20 GB de espacio libre en disco
□ SNAP ya instalado y funcionando
□ Paciencia :)
```

**¿Qué es SNAP?** Es el programa que hace el procesamiento real. Ya debe estar instalado en tu computadora.

### Verificar que SNAP está instalado

**Windows:**
1. Abre PowerShell (busca "PowerShell" en Inicio)
2. Copia y pega: `gpt -h`
3. Presiona Enter

Deberías ver un texto con ayuda. Si ves esto, ¡SNAP está bien instalado!

Si no lo ves, revisa la sección "Ayuda Rápida" abajo.

**Mac/Linux:**
1. Abre Terminal
2. Ejecuta: `gpt -h`

---

# PASO 1: DESCARGAR E INSTALAR PYTHON

Python es el lenguaje en el que está programado el servidor.

## Windows

### 1️⃣ Ir a la web de Python

1. Abre navegador (Chrome, Firefox, Edge, etc.)
2. Ve a: **https://www.python.org/downloads/**
3. Verás un botón grande amarillo: **"Download Python 3.x.x"**
4. Haz click

### 2️⃣ Instalar

1. Se descarga un archivo `.exe`
2. Abre ese archivo (haz doble click)
3. **¡IMPORTANTE!** Marca la casilla: **"Add Python to PATH"**

```
☑ Add Python to PATH    <-- MARCA ESTO
☐ Install for all users
```

4. Click en **"Install Now"**
5. Espera que termine (1-2 minutos)

### 3️⃣ Verificar

1. Abre PowerShell (Inicio → busca "PowerShell")
2. Copia: `python --version`
3. Presiona Enter

Deberías ver algo como: `Python 3.11.0`

Si ves error, reinicia computadora y intenta de nuevo.

---

## Mac

### 1️⃣ Si ya tienes Homebrew

Copia en Terminal:
```bash
brew install python@3.11
```

### 2️⃣ Si NO tienes Homebrew

1. Ve a: **https://www.python.org/downloads/macos/**
2. Descarga el instalador macOS
3. Abre el `.pkg`
4. Sigue las instrucciones

### 3️⃣ Verificar

En Terminal, copia:
```bash
python3 --version
```

Deberías ver: `Python 3.x.x`

---

## Linux

Abre Terminal y copia:

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv
python3 --version
```

---

# PASO 2: DESCARGAR E INSTALAR NODE.JS

Node.js es necesario para el interfaz web (lo que ves en el navegador).

## Windows

### 1️⃣ Ir a la web

1. Abre navegador
2. Ve a: **https://nodejs.org/**
3. Verás dos opciones. Descarga la **"LTS"** (es la versión estable)

### 2️⃣ Instalar

1. Se descarga un `.msi`
2. Abre haciendo doble click
3. Siguiente → Siguiente → Siguiente → Finish
4. Reinicia computadora

### 3️⃣ Verificar

Abre PowerShell y copia:
```powershell
node --version
npm --version
```

Deberías ver versiones como:
```
v18.12.0
8.19.2
```

---

## Mac

En Terminal, copia:
```bash
brew install node
node --version
npm --version
```

---

## Linux

En Terminal, copia:
```bash
sudo apt update
sudo apt install -y nodejs npm
node --version
npm --version
```

---

# PASO 3: DESCARGAR EL PROYECTO

## Opción A: Si tienes Git (recomendado)

### Windows (PowerShell):

```powershell
# Ir a carpeta de descargas
cd $HOME\Downloads

# Descargar proyecto
git clone https://github.com/vicpebarragan/satellite-image-processing-flow-automation.git

# Entrar a la carpeta
cd satellite-image-processing-flow-automation
```

### Mac/Linux (Terminal):

```bash
cd ~/Downloads
git clone https://github.com/vicpebarragan/satellite-image-processing-flow-automation.git
cd satellite-image-processing-flow-automation
```

---

## Opción B: Si NO tienes Git

### 1️⃣ Descargar como ZIP

1. Ve a: **https://github.com/vicpebarragan/satellite-image-processing-flow-automation**
2. Click en botón verde: **"Code"**
3. Click en: **"Download ZIP"**

### 2️⃣ Extraer

1. Se descarga `satellite-image-processing-flow-automation-main.zip`
2. Click derecho → "Extraer todo" (Windows) o "Descomprimir" (Mac)
3. Se crea carpeta con el proyecto

### 3️⃣ Abrir carpeta en terminal

**Windows:**
1. Abre PowerShell
2. Copia: `cd C:\Users\[TuUsuario]\Downloads\satellite-image-processing-flow-automation-main`
3. (Reemplaza `[TuUsuario]` con tu nombre de usuario)

**Mac/Linux:**
1. Abre Terminal
2. Copia: `cd ~/Downloads/satellite-image-processing-flow-automation-main`

---

# PASO 4: PREPARAR EL BACKEND

El backend es el "servidor" que hace el trabajo.

## Windows (PowerShell)

### 1️⃣ Entrar a carpeta backend

```powershell
cd backend
```

### 2️⃣ Crear "ambiente virtual" (es como una cajita de Python aislada)

```powershell
python -m venv venv
```

Espera a que termine (30 segundos a 1 minuto).

### 3️⃣ Activar el ambiente

```powershell
.\venv\Scripts\Activate.ps1
```

Si ves `(venv)` al inicio de la línea, ¡está activado!

```powershell
(venv) C:\Users\...\backend>
```

### 4️⃣ Instalar dependencias

```powershell
pip install flask flask-cors pillow rasterio
```

Espera a que termine (2-3 minutos). Verás mucho texto.

### 5️⃣ Listo

Si termina sin errores rojos, ¡estamos bien!

---

## Mac/Linux (Terminal)

### 1️⃣ Entrar a carpeta backend

```bash
cd backend
```

### 2️⃣ Crear ambiente virtual

```bash
python3 -m venv venv
```

### 3️⃣ Activar

```bash
source venv/bin/activate
```

Deberías ver `(venv)` al inicio.

### 4️⃣ Instalar

```bash
pip install flask flask-cors pillow rasterio
```

Espera 2-3 minutos.

### 5️⃣ Listo

Si no hay errores rojos, ¡perfecto!

---

# PASO 5: PREPARAR EL FRONTEND

El frontend es la interfaz que ves en el navegador.

## Windows (PowerShell)

### 1️⃣ Ir a carpeta frontend

```powershell
# Primero, volver a carpeta raíz
cd ..

# Entrar a frontend
cd frontend
```

### 2️⃣ Instalar dependencias

```powershell
npm install
```

Espera **5-10 minutos**. Verás mucho texto. Esto es normal.

```
added 300+ packages in 5m
```

Si ves al final `added ... packages`, ¡está bien!

---

## Mac/Linux (Terminal)

### 1️⃣ Ir a frontend

```bash
cd ..
cd frontend
```

### 2️⃣ Instalar

```bash
npm install
```

Espera 5-10 minutos.

---

# PASO 6: CREAR CARPETAS DE DATOS

El sistema necesita carpetas específicas para guardar archivos.

## Windows (PowerShell)

```powershell
# Ir a carpeta backend
cd ../backend

# Crear carpetas
mkdir -p files/images
mkdir -p files/output
mkdir -p files/temp/converted
```

Verifica que se crearon:
```powershell
ls files/
```

Deberías ver:
```
images/
output/
temp/
GRAFICO_1.xml
GRAFICO_2.xml
GRAFICO_3.xml
GRAFICO_4.xml
```

---

## Mac/Linux (Terminal)

```bash
cd ../backend

mkdir -p files/images
mkdir -p files/output
mkdir -p files/temp/converted

ls files/
```

---

# PASO 7: INICIAR EL SISTEMA

Ahora iniciamos el sistema. Necesitas **DOS terminales** abiertas.

## Opción A: Con 2 Terminales (Recomendado para nuevos)

### Terminal 1 - Backend

```powershell
# PowerShell - desde carpeta backend
cd C:\Users\[TuUsuario]\Downloads\satellite-image-processing-flow-automation\backend

# Activar ambiente
.\venv\Scripts\Activate.ps1

# Iniciar servidor
python controller.py
```

Deberías ver:
```
 * Running on http://127.0.0.1:5000
```

**¡NO CIERRES ESTA TERMINAL!** Déjala corriendo.

### Terminal 2 - Frontend

Abre OTRA terminal PowerShell:

```powershell
cd C:\Users\[TuUsuario]\Downloads\satellite-image-processing-flow-automation\frontend

npm start
```

Espera 30 segundos. Se abrirá automáticamente navegador.

Si se abre en http://localhost:3000, ¡PERFECTO!

---

## Opción B: Con 1 Terminal (Usuarios avanzados)

Si sabes usar `&` en PowerShell para procesos en background:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python controller.py & cd ../frontend & npm start
```

---

# PASO 8: VERIFICAR QUE TODO FUNCIONA

### ✅ Checklist Final

```
□ Backend corriendo (Terminal 1 muestra: Running on http://127.0.0.1:5000)
□ Frontend corriendo (Terminal 2 muestra: Compiled successfully)
□ Navegador abierto en http://localhost:3000
□ No ves errores rojos en ninguna terminal
```

### 🧪 Prueba Simple

1. En navegador (http://localhost:3000), verás 2 pestañas:
   - "Flujo Completo"
   - "Graph Individual"

2. Deberías ver opciones para cargar archivos

Si ves esto, ¡**TODO FUNCIONA!** 🎉

---

# AYUDA RÁPIDA (SI ALGO FALLA)

## Problema: "gpt no encontrado"

**Error:**
```
[ERROR] No se encontró el comando 'gpt'
```

**Solución:**

1. Verificar SNAP está instalado:
   ```powershell
   where gpt  # Windows
   which gpt  # Mac/Linux
   ```

2. Si no muestra ruta, SNAP no está en PATH. Opciones:
   - **Opción 1:** Reinstalar SNAP y marcar "agregar al PATH"
   - **Opción 2:** Encontrar dónde está SNAP:
     - Windows: `C:\Program Files\snap\bin`
     - Linux: `/opt/snap/bin`
   - **Opción 3:** Editar `backend/controller.py` línea 133 con ruta completa

---

## Problema: "Puerto 5000 ya en uso"

**Error:**
```
Address already in use
```

**Solución:**

1. Cerrar otro programa usando puerto 5000

O cambiar puerto:

1. Editar `backend/controller.py`
2. Buscar línea 817: `app.run(port=5000)`
3. Cambiar a: `app.run(port=5001)`
4. Editar `frontend/src/api.js`
5. Línea 1: cambiar `5000` a `5001`

---

## Problema: "No puedo activar venv"

**Error (PowerShell):**
```
No se puede cargar el archivo ... porque los scripts están deshabilitados
```

**Solución:**

1. Ejecutar PowerShell como Administrador
2. Copia:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
3. Escribe: `Y` y presiona Enter
4. Intenta activar venv de nuevo

---

## Problema: "npm install no funciona"

**Error:**
```
npm ERR! code ERESOLVE
```

**Solución:**

```powershell
npm install --legacy-peer-deps
```

O borra node_modules y intenta de nuevo:

```powershell
rmdir node_modules -Force -Recurse
npm install
```

---

## Problema: "Python no reconocido"

**Error:**
```
'python' is not recognized
```

**Solución:**

1. Debes haber olvidado marcar "Add Python to PATH" en instalación
2. Reinstala Python:
   - Ve a https://www.python.org/downloads/
   - Descarga
   - **AL INSTALAR: Marca "Add Python to PATH"**
   - Reinicia computadora

O usa `python3` en lugar de `python`:

```powershell
python3 --version
```

---

## Problema: Frontend no carga archivos

**Error:**
```
No files found
```

**Solución:**

1. Verifica que creaste carpetas (PASO 6)
2. Copia archivo a: `backend/files/images/`
3. Recarga navegador (F5)

---

## Problema: "CORS error" en navegador

**Error en navegador (F12 → Console):**
```
Access to XMLHttpRequest blocked by CORS policy
```

**Solución:**

1. Editar `backend/controller.py`
2. Línea 16, verificar:
   ```python
   CORS(app)
   ```
3. Si no está, añádela
4. Reiniciar backend

---

## Problema: Procesamiento muy lento (>1 hora)

**Causa:** Poca RAM o imagen muy grande

**Soluciones:**

1. **Cerrar otros programas** (especialmente navegadores, Photoshop, etc.)
2. **Verificar RAM:** Abre Administrador de Tareas (Ctrl+Shift+Esc)
3. **Usar imagen más pequeña** (región de interés)
4. **Upgraar computadora** (si es posible)

---

## Problema: "No se puede instalar paquetes Python"

**Error:**
```
ERROR: pip's dependency resolver does not currently take...
```

**Solución:**

1. Upgrade pip:
   ```powershell
   python -m pip install --upgrade pip
   ```

2. Intenta instalar de nuevo:
   ```powershell
   pip install flask flask-cors pillow
   ```

---

## Problema: "Mi navegador muestra página en blanco"

**Causa:** Frontend no compiló bien

**Soluciones:**

1. Revisar Terminal 2 (Frontend) - ¿hay errores rojos?
2. Si hay errores: Ejecutar `npm install` de nuevo
3. Ctrl+Shift+R en navegador (limpiar caché)
4. Reiniciar: Ctrl+C en Terminal 2, luego `npm start`

---

## Problema: "No se qué hacer"

**Orden de verificación:**

1. ¿SNAP funciona? `gpt -h`
2. ¿Python instalado? `python --version`
3. ¿Node.js instalado? `node --version`
4. ¿Backend corre sin errores? Ver Terminal 1
5. ¿Frontend corre sin errores? Ver Terminal 2
6. ¿Puedo ver http://localhost:3000 en navegador?
7. ¿Las carpetas existen? Ver `backend/files/`

Si todas son sí, contacta al autor con screenshot de Terminal 1 y Terminal 2.

---

## Tabla Rápida de Comandos

| Situación | Comando |
|-----------|---------|
| Ver versión Python | `python --version` |
| Ver versión Node | `node --version` |
| Activar venv (Windows) | `.\venv\Scripts\Activate.ps1` |
| Activar venv (Mac/Linux) | `source venv/bin/activate` |
| Desactivar venv | `deactivate` |
| Instalar paquete Python | `pip install nombre` |
| Instalar dependencias frontend | `npm install` |
| Iniciar backend | `python controller.py` |
| Iniciar frontend | `npm start` |
| Ver SNAP disponible | `gpt -h` |
| Ver rasterio | `python -c "import rasterio; print(rasterio.__version__)"` |
| Matar proceso en puerto | `netstat -ano \| findstr :5000` |

---

## 📞 Contacto

Si algo no funciona después de estos pasos:

1. **Revisa la sección "Ayuda Rápida" arriba**
2. **Scattshot de los errores**
3. **Contacta al autor:**
   - Repositorio: https://github.com/vicpebarragan/satellite-image-processing-flow-automation
   - Issues: Abre un issue con detalles

---

## 🎓 Próximos Pasos (Después de instalar)

Una vez que el sistema funciona:

1. **Obtén datos Sentinel-1:**
   - Copernicus Hub: https://scihub.copernicus.eu/
   - Busca "Sentinel-1 Level-1" en ZIP

2. **Prueba tu primer procesamiento:**
   - Copia archivo ZIP a `backend/files/images/`
   - En navegador: "Flujo Completo"
   - Espera a que termine (~2-4 horas)

3. **Lee INFORMACIÓN_TÉCNICA.md** para detalles avanzados

---

**GUÍA DE INSTALACIÓN - Versión 1.0**  
**¡Hecha para que TODOS puedan instalar!**  
**Enero 2026**
