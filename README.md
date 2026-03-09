# iTopCPToolkit

An interactive web GUI for building [TopCPToolkit](https://topcptoolkit.docs.cern.ch/) / AnalysisBase YAML configuration files.

**Live app**: https://itopcptoolkit.web.cern.ch

## Architecture

```
Browser  <-->  Flask (port 5000, inside Docker)  <-->  Athena Python env
                 |
                 +-- Serves built React frontend from /app/frontend/dist
```

- **Backend**: Flask introspects ConfigBlock classes using the live Athena environment and exposes options via `/api/schema`.
- **Frontend**: React (Vite + Tailwind). Fetches schema on load, maintains config state, renders live YAML preview, exports config as a downloaded file.

## Running locally

### With Docker (recommended — full Athena introspection)

```bash
# Build without TopCPToolkit (fast)
docker build --build-arg AB_TAG=25.2.86 -t tct-gui .

# Build with a specific TopCPToolkit version
export CERN_TOKEN=glpat-xxxxxxxxxxxx   # CERN GitLab personal access token
docker build \
  --secret id=cern_token,env=CERN_TOKEN \
  --build-arg AB_TAG=25.2.86 \
  --build-arg TCT_VERSION=v2.24.0 \
  -t tct-gui .

# Build with the latest TopCPToolkit from main
docker build \
  --secret id=cern_token,env=CERN_TOKEN \
  --build-arg AB_TAG=25.2.86 \
  --build-arg TCT_VERSION=latest \
  -t tct-gui .

# Run
docker run --name tct-gui-app -p 5001:5000 tct-gui

# Open http://localhost:5001
```

### Local development (no Athena — options will be empty)

```bash
# Terminal 1: backend
cd backend && pip install flask flask-cors pyyaml && python app.py

# Terminal 2: frontend dev server (proxies /api --> localhost:5000)
cd frontend && npm install && npm run dev
# Open http://localhost:3000
```

## Deployment

The app is deployed at https://itopcptoolkit.web.cern.ch via [CERN PaaS](https://paas.cern.ch).

### Automated deployment

Deployment is fully automated via GitHub Actions. When `VERSION` is updated on `main`:

1. **`release.yml`** creates a new GitHub release tagged with the contents of `VERSION`.
2. **`deploy.yml`** builds the Docker image and pushes it to `registry.cern.ch/itopcptoolkit/itopcptoolkit:latest`.
3. **OKD** detects the new image via its image change trigger and automatically redeploys.

To release a new version, simply update the `VERSION` file and push to `main`.

### Required GitHub secrets and variables

| Name | Type | Description |
|---|---|---|
| `CERN_REGISTRY_USER` | Secret | Harbor registry username |
| `CERN_REGISTRY_TOKEN` | Secret | Harbor CLI secret (from registry.cern.ch → User Profile) |
| `CERN_TOKEN` | Secret | CERN GitLab PAT (only needed for TopCPToolkit builds) |
| `AB_TAG` | Variable | AnalysisBase tag (e.g. `25.2.86`), optional |
| `TCT_VERSION` | Variable | TopCPToolkit version (e.g. `v2.24.0`), optional |

### One-time OKD setup

The OKD deployment was set up via the CERN PaaS UI (**+Add → Container images**) pointing at `registry.cern.ch/itopcptoolkit/itopcptoolkit:latest`, with the image change trigger enabled so new pushes are picked up automatically.

To check the deployment:

```bash
oc login --web https://api.paas.okd.cern.ch
oc project itopcptoolkit
oc get pods
oc logs deployment/itopcptoolkit --follow
```

## Usage

1. **Enable blocks** using the toggles in the left sidebar.
2. **Click a block name** to open its configuration panel.
3. **Fill in options** — each field shows the type, default value, and a help string with the full docstring.
4. **Enable sub-blocks** (e.g. JVT, WorkingPoint, FlavourTagging) inside each block's panel.
5. **For repeatable blocks** (marked `[]`), use "+ Add instance" to configure multiple jet collections, working points, etc.
6. **Watch the live YAML** update in the right panel as you configure.
7. **Export** — enter a filename and click "↓ Export" to download the YAML file.

## Adding more blocks

Edit `backend/block_schema.py` — each entry maps a YAML key to a Python class/function, following the same structure as `ConfigFactory.py` in the Athena codebase.
