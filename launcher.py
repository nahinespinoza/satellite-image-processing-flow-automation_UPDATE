"""Punto de entrada del ejecutable: arranca el servidor y abre el navegador.

Uso interno: `launcher --run-script <archivo.py>` ejecuta un script hijo
(el backend lo usa para los pasos 5-7 sin necesitar Python instalado).
"""
import os
import sys

# En Windows la salida redirigida usa cp1252 y los print con emojis/acentos
# hacen fallar los scripts hijos (UnicodeEncodeError). Forzar UTF-8.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if len(sys.argv) >= 3 and sys.argv[1] == "--run-script":
    import runpy
    script = os.path.abspath(sys.argv[2])
    sys.path.insert(0, os.path.dirname(script))
    sys.argv = [script] + sys.argv[3:]
    runpy.run_path(script, run_name="__main__")
    sys.exit(0)

import socket
import threading
import time
import webbrowser

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
import controller  # noqa: E402

PORT = int(os.environ.get("SNAP_APP_PORT", "5000"))


def _port_free(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


if __name__ == "__main__":
    if not _port_free(PORT):
        print(f"El puerto {PORT} ya está en uso; abriendo la instancia existente.")
        webbrowser.open(f"http://127.0.0.1:{PORT}")
        sys.exit(0)
    print("=" * 60)
    print(f" Satellite Flow  -> http://127.0.0.1:{PORT}")
    print(f" Datos          -> {controller.DATA_DIR}")
    for n, p in (("gpt", controller.GPT_BIN), ("pconvert", controller.PCONVERT_BIN), ("snaphu", controller.SNAPHU_BIN)):
        print(f" {n:9s}      -> {p} [{'OK' if os.path.exists(p) else 'NO ENCONTRADO'}]")
    print(" (cierra esta ventana para detener el programa)")
    print("=" * 60)
    if os.environ.get("SNAP_APP_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    controller.app.run(host="127.0.0.1", port=PORT, threaded=True)
