# 🛰️ GPT-TOOL - Satellite Image Processing Interface

Una interfaz moderna y elegante para procesar imágenes satelitales usando SNAP Graph Processing Tool (GPT).

## ✨ Características

- **Interfaz moderna y responsiva**: Diseño limpio y atractivo con animaciones suaves
- **Dos modos de procesamiento**:
  - 🔄 **Flujo Completo**: Ejecuta los 4 gráficos XML en secuencia automáticamente
  - 📊 **Graph Individual**: Procesa un gráfico XML específico
- **Selección de archivos drag-and-drop**: Interfaz intuitiva para cargar archivos
- **Barra de progreso**: Visualización del estado del procesamiento
- **Mensajes de estado**: Feedback claro sobre el proceso

## 🚀 Cómo usar

### Instalación

1. **Instala las dependencias del frontend**:
```bash
cd frontend
npm install
```

2. **Instala las dependencias del backend**:
```bash
cd backend
pip install flask flask-cors
```

### Ejecución

**Terminal 1 - Backend**:
```bash
cd backend
python controller.py
```

**Terminal 2 - Frontend**:
```bash
cd frontend
npm start
```

La aplicación se abrirá en `http://localhost:3000`

## 📋 Uso

### Modo Flujo Completo

1. Haz click en la pestaña "🔄 Flujo Completo"
2. Selecciona el archivo de entrada (.zip o .dim)
3. Especifica el directorio de salida (ej: `C:\output\procesamiento`)
4. Haz click en "▶ Ejecutar Flujo Completo"
5. El sistema ejecutará los 4 gráficos en secuencia

### Modo Graph Individual

1. Haz click en la pestaña "📊 Graph Individual"
2. Especifica la ruta del archivo XML del graph (ej: `C:\graphs\GRAFICO_1.xml`)
3. Selecciona el archivo de entrada
4. Especifica el directorio de salida
5. Haz click en "▶ Procesar Graph"

## 📁 Estructura de archivos esperada

```
satellite-image-processing-flow-automation/
├── backend/
│   ├── controller.py
│   └── files/
│       ├── GRAFICO_1.xml
│       ├── GRAFICO_2.xml
│       ├── GRAFICO_3.xml
│       └── GRAFICO_4.xml
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── FormProcessor.jsx
    │   │   └── FormProcessor.css
    │   ├── App.jsx
    │   ├── api.js
    │   └── index.css
    └── package.json
```

## ⚙️ Configuración

### Ruta de gpt

Si el comando `gpt` no está en tu PATH, edita `backend/controller.py`:

```python
# Línea 23 (en la función procesar)
cmd = f'C:\\Program Files\\snap\\bin\\gpt.exe "{graph}" ...'
```

## 🎨 Estilos

La interfaz utiliza:
- **Colores**: Gradiente púrpura-azul moderno
- **Animaciones**: Transiciones suaves y efecto flotante
- **Tipografía**: Segoe UI para una apariencia profesional
- **Responsivo**: Se adapta a cualquier tamaño de pantalla

## 📝 APIs disponibles

### `/procesar` (POST)
Procesa un gráfico XML individual.

**Request**:
```json
{
  "graph": "C:\\path\\to\\GRAFICO_1.xml",
  "input": "C:\\input\\image.zip",
  "output": "C:\\output\\result.dim"
}
```

**Response**:
```json
{
  "status": "ok",
  "output": "C:\\output\\result.dim"
}
```

### `/procesar_flujo` (POST)
Ejecuta los 4 gráficos en secuencia.

**Request**:
```json
{
  "input": "C:\\input\\image.zip",
  "output_dir": "C:\\output\\"
}
```

**Response**:
```json
{
  "status": "ok",
  "message": "Flujo completo ejecutado correctamente",
  "final_output": "C:\\output\\output_step_4.dim"
}
```

## 🐛 Solución de problemas

### "El comando 'gpt' no se encontró"
- Instala SNAP desde: https://step.esa.int/main/download/
- Agrega `SNAP/bin` a tu PATH

### "El archivo no se encuentra"
- Verifica que las rutas sean rutas absolutas completas
- En Windows, usa formato: `C:\ruta\completa\archivo.zip`

### Error de conexión al backend
- Verifica que el backend esté corriendo en `http://localhost:8080`
- Comprueba que no haya firewall bloqueando el puerto 8080

## 📄 Licencia

Proyecto de procesamiento de imágenes satelitales SNAP.

## 👨‍💻 Autor

Víctor Barragán
