# TopCPToolkit Config GUI

A web GUI for building TopCPToolkit/AnalysisBase YAML configuration files.

## Architecture

```
Browser  ←→  Flask (port 5001, inside Docker)  ←→  Athena Python env
                │
                └── Serves built React frontend from /app/frontend/dist
```

- **Backend**: Flask introspects ConfigBlock classes using the live Athena environment and exposes options via `/api/schema`. Handles YAML export via `/api/export-yaml`.
- **Frontend**: React (Vite + Tailwind). Fetches schema on load, maintains config state, renders live YAML preview, calls export endpoint.

## Running

### With Docker (recommended — full Athena introspection)

```bash
# Build (replace 25.2.86 with your desired AnalysisBase tag)
docker build --build-arg AB_TAG=25.2.86 -t tct-gui .

# Run
docker run -p 5001:5000 -v $(pwd)/output:/output tct-gui

# Open http://localhost:5001
```

Or with compose:
```bash
docker-compose up --build
```

### Local development (no Athena — options will be empty)

```bash
# Terminal 1: backend
cd backend && pip install flask flask-cors pyyaml && python app.py

# Terminal 2: frontend dev server (proxies /api → localhost:5001)
cd frontend && npm install && npm run dev
# Open http://localhost:3000
```

## Usage

1. **Enable blocks** using the toggles in the left sidebar.
2. **Click a block name** to open its configuration panel.
3. **Fill in options** — each field shows the type, default value, and a tooltip with the docstring.
4. **Enable sub-blocks** (e.g. JVT, WorkingPoint, FlavourTagging) inside each block's panel.
5. **For repeatable blocks** (marked `[]`), use "+ Add instance" to add multiple jet collections, working points, etc.
6. **Watch the live YAML** update in the right panel as you configure.
7. **Export** — set the output path in the top bar and click "Export YAML".

## Adding more blocks

Edit `backend/block_schema.py` — each entry maps a YAML key to a Python class/function using the same structure as `ConfigFactory.py`.
