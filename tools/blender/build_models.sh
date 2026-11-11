#!/usr/bin/env bash
# Regenerates every model in public/assets/models from the Blender Python scripts.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "Blender is not installed yet, installing..." >&2
  bash ./install.sh
fi

.venv/bin/python build_models.py "$@"
