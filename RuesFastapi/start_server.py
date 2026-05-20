#!/usr/bin/env python
"""
Script para iniciar el servidor SIN --reload
Evita problemas de reloading que pueden causar errores 500
"""
import os
import sys

# Configurar para output sin buffer
os.environ['PYTHONUNBUFFERED'] = '1'

print("[*] Iniciando servidor FastAPI...")
print("[*] PYTHONUNBUFFERED = 1")
print("[*] Sin --reload (para evitar problemas)")
print("-" * 60)

import subprocess

cmd = [
    sys.executable, "-m", "uvicorn",
    "main:app",
    "--host", "0.0.0.0",
    "--port", "8001",
    "--log-level", "info"
    # NO incluimos --reload
]

process = subprocess.Popen(cmd, stdout=sys.stdout, stderr=sys.stderr)
try:
    process.wait()
except KeyboardInterrupt:
    print("\n[*] Deteniendo servidor...")
    process.terminate()
    process.wait()
    print("[OK] Servidor detenido")
