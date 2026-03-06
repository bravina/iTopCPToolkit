#!/bin/bash
set -e

# 1. Source the Athena/AnalysisBase environment
SETUP="/home/atlas/release_setup.sh"
if [ -f "$SETUP" ]; then
    source "$SETUP"
fi

# 2. Source the TopCPToolkit build environment (makes TCT Python packages importable)
TCT_SETUP=$(ls /opt/TopCPToolkit/build/*/setup.sh 2>/dev/null | head -1)
if [ -n "$TCT_SETUP" ]; then
    source "$TCT_SETUP"
else
    echo "WARNING: TopCPToolkit setup.sh not found — Custom blocks will not be introspectable" >&2
fi

exec python3 /app/backend/app.py
