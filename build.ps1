# Genera dist\SatelliteFlow.exe (un solo ejecutable). Requiere Python 3.10+ y Node.js SOLO para compilar.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Push-Location frontend; npm install --legacy-peer-deps; npm run build; Pop-Location
python -m venv .buildenv
& .\.buildenv\Scripts\pip.exe install -r backend\requirements.txt pyinstaller
& .\.buildenv\Scripts\pyinstaller.exe --noconfirm satelital.spec
Write-Host "Listo: dist\SatelliteFlow.exe"
