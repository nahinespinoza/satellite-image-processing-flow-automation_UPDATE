# -*- mode: python ; coding: utf-8 -*-
# Genera UN solo ejecutable: pyinstaller satelital.spec
from PyInstaller.utils.hooks import collect_all
datas = [
    ("frontend/build", "frontend_build"),
    ("Scripts_Automatizacion_Snaphu", "Scripts_Automatizacion_Snaphu"),
    ("backend/files/*.xml", "backend/files"),
]
binaries, hidden = [], ["struct", "glob", "datetime", "xml.sax.saxutils", "PIL.Image"]
for pkg in ("rasterio", "flask_cors"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hidden += h
a = Analysis(["launcher.py"], pathex=["backend"], binaries=binaries, datas=datas,
             hiddenimports=hidden, excludes=["tkinter", "pytest"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="SatelliteFlow",
          console=True, upx=False, runtime_tmpdir=None)
