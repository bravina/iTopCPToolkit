#!/bin/bash
set -e

# Source the Athena/AnalysisBase environment so that Python imports work
SETUP="/home/atlas/release_setup.sh"
if [ -f "$SETUP" ]; then
    source "$SETUP"
fi

exec python3 /app/backend/app.py
