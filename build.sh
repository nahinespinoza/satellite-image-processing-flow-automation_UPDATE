#!/usr/bin/env bash
# Genera dist/SatelliteFlow (un solo ejecutable). Requiere Python 3.10+ y Node.js SOLO para compilar.
set -e
cd "$(dirname "$0")"
(cd frontend && npm install --legacy-peer-deps && npm run build)
python3 -m venv .buildenv && . .buildenv/bin/activate
pip install -q -r backend/requirements.txt pyinstaller
pyinstaller --noconfirm satelital.spec
echo "Listo: dist/SatelliteFlow"
