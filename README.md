# satellite-image-processing-flow-automation_UPDATE
Get-ChildItem $env:TEMP -Directory -Filter "_MEI*" | ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter "main.*" } | Select-Object FullName
## Ejecutable de un solo archivo

`dist/SatelliteFlow` (Linux) / `dist\SatelliteFlow.exe` (Windows) incluye Python, backend, interfaz web y scripts.
Se ejecuta con doble clic: levanta el servidor y abre http://127.0.0.1:5000.

- **Generarlo:** `./build.sh` (Linux) o `.\build.ps1` (Windows). Cada SO debe compilarse en su propio SO
  (o usar el workflow `.github/workflows/build.yml`, que produce ambos).
- **Datos del usuario** (imágenes, salidas, gráficos): `~/.local/share/SatelliteFlow` o `%LOCALAPPDATA%\SatelliteFlow`.
- **Único requisito externo:** ESA SNAP (gpt/pconvert) y SNAPHU. Se autodetectan en rutas típicas/PATH. Si no,
  define `GPT_BIN`, `PCONVERT_BIN`, `SNAPHU_BIN` o crea `snap_paths.json` en la carpeta de datos:
  `{"GPT_BIN": "...", "PCONVERT_BIN": "...", "SNAPHU_BIN": "..."}`. Estado en `/estado-herramientas`.

## Instalador de Windows

`dist\SatelliteFlowSetup.exe` (se genera con `installer.iss` / el workflow de GitHub): verifica si SNAP (gpt, pconvert) y
SNAPHU ya están instalados, descarga e instala solo los que falten, y guarda las rutas en `%LOCALAPPDATA%\SatelliteFlow\snap_paths.json`.
