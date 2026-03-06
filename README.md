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

# Run (overwrites any existing container)
docker rm -f tct-gui-app 2>/dev/null; docker run --name tct-gui-app -p 5001:5000 tct-gui

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

## Deploying to CERN PaaS (OKD)

The app is deployed at https://itopcptoolkit.web.cern.ch via [CERN PaaS](https://paas.cern.ch).

### Prerequisites (one-time setup)

**1. Install the `oc` CLI**
```bash
brew install openshift-cli   # macOS
```

**2. Log in to the CERN container registry**

Get your CLI secret from https://registry.cern.ch (User Profile → CLI secret), then:
```bash
docker login registry.cern.ch -u ravinab -p <CLI-secret>
```

**3. Log in to OKD**
```bash
oc login --web https://api.paas.okd.cern.ch
oc project itopcptoolkit
```

**4. Create the image pull secret** (allows OKD to pull from `registry.cern.ch`)
```bash
oc create secret docker-registry registry-cern \
  --docker-server=registry.cern.ch \
  --docker-username=ravinab \
  --docker-password=<CLI-secret>
oc secrets link default registry-cern --for=pull
```

**5. Apply the OKD manifests** (first deployment only)
```bash
oc apply -f okd/deployment.yaml
oc apply -f okd/service.yaml
oc apply -f okd/route.yaml
```

### Deploying a new version

Once the one-time setup is done, deploying a new version is:

```bash
# 1. Build the new image
docker build --build-arg AB_TAG=25.2.86 -t tct-gui .
# (add --secret and --build-arg TCT_VERSION=... for TopCPToolkit)

# 2. Tag and push to the CERN registry
docker tag tct-gui registry.cern.ch/itopcptoolkit/itopcptoolkit:latest
docker push registry.cern.ch/itopcptoolkit/itopcptoolkit:latest

# 3. Trigger a rollout on OKD (pulls the new image)
oc rollout restart deployment/itopcptoolkit

# 4. Watch the rollout
oc rollout status deployment/itopcptoolkit
```

Or use the convenience script which does all of the above:
```bash
export CERN_TOKEN=glpat-xxxxxxxxxxxx   # only needed if building with TCT
./deploy.sh                # no TCT
./deploy.sh latest         # TCT from main
./deploy.sh v2.24.0        # specific TCT tag
```

### Checking the deployment

```bash
# Pod status
oc get pods

# App logs
oc logs deployment/itopcptoolkit --follow

# Current route / URL
oc get route itopcptoolkit
```

## Usage

1. **Enable blocks** using the toggles in the left sidebar.
2. **Click a block name** to open its configuration panel.
3. **Fill in options** — each field shows the type, default value, and a help bubble with the full docstring (supports Markdown and LaTeX).
4. **Enable sub-blocks** (e.g. JVT, WorkingPoint, FlavourTagging) inside each block's panel.
5. **For repeatable blocks** (marked `[]`), use "+ Add instance" to configure multiple jet collections, working points, etc.
6. **Watch the live YAML** update in the right panel as you configure.
7. **Export** — enter a filename and click "↓ Export" to download the YAML file.

## Adding more blocks

Edit `backend/block_schema.py` — each entry maps a YAML key to a Python class/function, following the same structure as `ConfigFactory.py` in the Athena codebase.