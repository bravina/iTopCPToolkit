# backend/tests/conftest.py
#
# Adds the backend/ directory to sys.path so that test files can import
# app, block_schema, and introspect directly without package installation.

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
