#!/usr/bin/env bash
# Installs Blender into this repo (tools/blender/.venv).
#
# Uses the official `bpy` wheel published by the Blender Foundation: it is Blender itself, packaged
# as a Python module, so it runs headless and needs no GPU or display.
# Blender 4.5 LTS requires exactly Python 3.11.
set -euo pipefail
cd "$(dirname "$0")"

BPY_VERSION="${BPY_VERSION:-4.5.16}"
PY="${PYTHON311:-python3.11}"

if command -v uv >/dev/null 2>&1; then
  uv venv --python "$PY" .venv
  uv pip install --python .venv/bin/python "bpy==${BPY_VERSION}" numpy
else
  "$PY" -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install "bpy==${BPY_VERSION}" numpy
fi

.venv/bin/python -c "import bpy; print('Blender', bpy.app.version_string, 'installed in tools/blender/.venv')"
