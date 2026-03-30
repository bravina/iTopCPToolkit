# iTopCPToolkit

An interactive web GUI for building [TopCPToolkit](https://topcptoolkit.docs.cern.ch/) / AnalysisBase YAML configuration files.

**Live app**: https://itopcptoolkit.web.cern.ch

---

## Table of contents

1. [What the app does](#what-the-app-does)
2. [Architecture](#architecture)
3. [Running locally](#running-locally)
4. [Deployment](#deployment)
5. [How to add a new config block](#how-to-add-a-new-config-block)
6. [How to add a new sub-block](#how-to-add-a-new-sub-block)
7. [How to add a new event-selection keyword](#how-to-add-a-new-event-selection-keyword)
8. [How to add a new physics-object type to the collection registry](#how-to-add-a-new-physics-object-type-to-the-collection-registry)
9. [How to add a new application mode](#how-to-add-a-new-application-mode)
10. [Code map](#code-map)
11. [Contributing](#contributing)

---

## What the app does

iTopCPToolkit has three modes, selectable from the landing screen:

| Mode | Purpose |
|---|---|
| **Builder** | Create a new YAML config from scratch using a block-by-block editor |
| **Reader** | Load an existing YAML file to inspect, validate, annotate, or diff it |
| **INTnote Writer** | Generate a LaTeX+PDF configuration summary for an ATLAS Internal Note (requires TopCPToolkit in the image) |

---

## Architecture

```
Browser  ←→  Flask API (port 5000)  ←→  Athena Python environment
              │
              ├── Serves built React frontend from /app/frontend/dist
              ├── GET  /api/schema          → introspected block options
              ├── GET  /api/health          → version info
              ├── POST /api/export-yaml     → YAML file download
              └── POST /api/generate-intnote → PDF generation
```

**Backend** (`backend/`): A small Flask app. On the first request it imports every
Python class listed in `block_schema.py`, instantiates them inside Athena, and
calls `getOptions()` to extract option names, types, defaults and help strings.
The result is cached in memory for the lifetime of the process.

**Frontend** (`frontend/src/`): A React (Vite + Tailwind) single-page app. It
fetches the schema once on load and uses it to render the editor, validator,
autocomplete and YAML annotator entirely in the browser.

---

## Running locally

### With Docker (recommended — full Athena introspection)

```bash
# Build without TopCPToolkit (fast, options will be introspected)
docker build --build-arg AB_TAG=25.2.86 -t tct-gui .

# Build with a specific TopCPToolkit version (enables INTnote Writer)
export CERN_TOKEN=glpat-xxxxxxxxxxxx   # CERN GitLab personal access token
docker build \
  --secret id=cern_token,env=CERN_TOKEN \
  --build-arg AB_TAG=25.2.86 \
  --build-arg TCT_VERSION=v2.24.0 \
  -t tct-gui .

# Run
docker run --name tct-gui-app -p 5001:5000 tct-gui
# Open http://localhost:5001
```

### Without Docker (no Athena — options will be empty)

Useful for rapid frontend development. The GUI renders correctly; every block
just shows "No options introspected".

```bash
# Terminal 1: backend
cd backend
pip install flask flask-cors pyyaml
python app.py

# Terminal 2: frontend dev server (proxies /api → localhost:5000)
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

---

## Deployment

The app is deployed at https://itopcptoolkit.web.cern.ch via [CERN PaaS](https://paas.cern.ch).

### Automated deployment

Deployment is fully automated via GitHub Actions. When `VERSION` is updated on `main`:

1. **`release.yml`** creates a new GitHub release tagged with the contents of `VERSION`.
2. **`deploy.yml`** builds the Docker image and pushes it to `registry.cern.ch/itopcptoolkit/itopcptoolkit:latest`.
3. **OKD** detects the new image via an image-change trigger and automatically redeploys.

To release a new version, update `VERSION` and push to `main`.

### Required GitHub secrets and variables

| Name | Type | Description |
|---|---|---|
| `CERN_REGISTRY_USER` | Secret | Harbor registry username |
| `CERN_REGISTRY_TOKEN` | Secret | Harbor CLI secret (from registry.cern.ch → User Profile) |
| `CERN_TOKEN` | Secret | CERN GitLab PAT (only needed for TopCPToolkit builds) |
| `AB_TAG` | Variable | AnalysisBase tag (e.g. `25.2.86`), optional |
| `TCT_VERSION` | Variable | TopCPToolkit version (e.g. `v2.24.0`), optional |

### One-time OKD setup

The OKD deployment was set up via the CERN PaaS UI (**+Add → Container images**)
pointing at `registry.cern.ch/itopcptoolkit/itopcptoolkit:latest`, with the
image-change trigger enabled so new pushes are picked up automatically.

```bash
oc login --web https://api.paas.okd.cern.ch
oc project itopcptoolkit
oc get pods
oc logs deployment/itopcptoolkit --follow
```

---

## How to add a new config block

Everything you need to touch is in **`backend/block_schema.py`**.

### Step 1 — add an entry to `BLOCK_TREE`

```python
{
    "name":        "MyNewBlock",   # Key used in the YAML output (must match ConfigFactory)
    "label":       "My New Block", # Human-readable name shown in the sidebar
    "group":       "Core",         # Sidebar group: "Core" | "Objects" | "Selection" | "Output"
    "repeatable":  False,          # True → block is a YAML list (multiple instances allowed)
    "class_path":  "MyPkg.MyModule.MyNewBlockConfig",  # Python import path (inside Docker)
    "is_function": False,          # True only if class_path is a factory function, not a class
    "sub_blocks":  [],             # Sub-block definitions (see next section)
},
```

That's it. On the next request the backend will import the class, call
`getOptions()`, and return the options to the frontend.

### Step 2 — verify `class_path`

The class must:
- Be importable inside the Docker container (i.e. in the AnalysisBase environment)
- Inherit from `ConfigBlock` and call `self.addOption(...)` in `__init__`
  (or be a factory function if `is_function: True`)

If the import fails the block still appears in the GUI; it just shows
"No options introspected" and writes `MyNewBlock: {}` to the YAML.

### Step 3 — update the collection registry (if needed)

If the new block **creates** a physics-object container (i.e. it has a
`containerName` option that defines a new collection), add it to the
`DEFINING_BLOCK_TYPES` dict in `frontend/src/utils/collectionRegistry.js`:

```js
MyNewBlock: 'jets',   // or 'electrons', 'muons', 'photons', 'taus', 'met', etc.
```

This tells the autocomplete and dependency checker about the new container type.

If the block only **consumes** existing containers (e.g. OverlapRemoval), no
change to `collectionRegistry.js` is needed.

---

## How to add a new sub-block

Sub-blocks appear as toggleable sections inside a parent block's editor panel
(e.g. JVT, WorkingPoint, FlavourTagging inside Jets/Electrons/etc.).

Add an entry to the `"sub_blocks"` list of the parent block in `block_schema.py`:

```python
{
    "name":        "MySubBlock",    # Key under the parent in the YAML output
    "label":       "My Sub-Block",  # Label shown in the editor
    "repeatable":  False,           # True → multiple instances allowed (e.g. WorkingPoint)
    "class_path":  "MyPkg.MyModule.MySubBlockConfig",
    "is_function": False,
    "sub_blocks":  [],              # Sub-blocks cannot nest further
},
```

If the sub-block defines named selections (i.e. it has a `selectionName` option
that registers a selection on the parent container), add its name to
`SELECTION_DEFINING_SUBBLOCKS` in `collectionRegistry.js`:

```js
const SELECTION_DEFINING_SUBBLOCKS = new Set([
  'WorkingPoint', 'JVT', 'PtEtaSelection', 'BJetCalib',
  'FlavourTagging', 'Uncertainties',
  'MySubBlock',  // ← add here
])
```

---

## How to add a new event-selection keyword

The `EventSelection` block uses a dedicated cut editor. To add a new keyword:

### 1 — `frontend/src/utils/selectionCutsSerializer.js`

Add a `case` to `parseLine()` to parse the keyword from a raw text line, and a
`case` to `serializeCut()` to convert the structured args back to text.

### 2 — `frontend/src/components/CutRowForm.jsx`

- Add the keyword to the appropriate group in `KEYWORD_GROUPS`
- Add its default args to `defaultArgs()` 
- Add a `case` to `renderArgs()` to render the form fields

### 3 — `frontend/src/utils/selectionCutsSerializer.js` (confirm roundtrip)

Check that `parseSelectionCutsString(cutsToRawText(cuts))` round-trips correctly
for your new keyword.

---

## How to add a new physics-object type to the collection registry

If you introduce a new type of physics object (e.g. "ditaus"):

### 1 — `frontend/src/utils/collectionRegistry.js`

Add to `DEFINING_BLOCK_TYPES`:
```js
DiTauJets: 'ditaus',
```

Add to `inferFieldType()` if the new type should be inferred from option names:
```js
if (/ditau/.test(n)) return 'ditaus'
```

Add to `getAutocompleteMode()` if option names referencing ditaus should show
autocomplete:
```js
/ditau/.test(n) ||
```

### 2 — `backend/block_schema.py`

Make sure any block that produces ditau containers is listed (see above).

---

## How to add a new application mode

The app currently has three modes: Builder, Reader, INTnote Writer.

### Frontend

1. Add a new `ModeCard` entry in `frontend/src/components/ModeSelector.jsx`
2. Handle the new mode string in `App.jsx` (add a branch in the render section
   and a button in the header's mode switcher)
3. Create a new component in `frontend/src/components/` for the mode's UI

### Backend (if the new mode needs an API endpoint)

Add a new route to `backend/app.py` following the pattern of the existing
`/api/export-yaml` or `/api/generate-intnote` endpoints.

---

## Code map

```
backend/
  app.py            Flask application, route handlers
  block_schema.py   ← PRIMARY CONFIG FILE: defines all blocks and sub-blocks
  introspect.py     Imports Python classes and extracts option metadata

frontend/src/
  App.jsx           Top-level component, mode routing, schema fetching
  components/
    Sidebar.jsx           Left sidebar (block enable toggles + navigation)
    BlockPanel.jsx        Main editor panel for a selected block
    SubBlockSection.jsx   Collapsible sub-block editor within BlockPanel
    OptionField.jsx       Single option row (input field + type badge + info popover)
    CollectionField.jsx   Autocomplete input for container/selection references
    YamlPreview.jsx       Live YAML preview panel (right side)
    AnnotatedYamlView.jsx Colour-coded YAML view used in Reader and Diff modes
    ConfigReader.jsx      Reader mode: file loading, validation, diff
    DiffView.jsx          Side-by-side diff of two YAML configs
    SelectionCutsDictEditor.jsx  Visual editor for EventSelection.selectionCutsDict
    SelectionCutsEditor.jsx      List of CutRowForms for one selection region
    CutRowForm.jsx               Single cut row with keyword picker and arg fields
    IntNoteWriter.jsx    INTnote Writer mode: upload JSON, trigger PDF generation
    SearchOverlay.jsx    Global search (Cmd+F) across all blocks and options
    ModeSelector.jsx     Landing screen for choosing a mode
    SplashScreen.jsx     Canvas-based animated splash screen
    InfoPopover.jsx      Hoverable ⓘ tooltip with Markdown + KaTeX rendering
    YamlLoader.jsx       File-drop / paste widget for loading YAML files
    ResizablePanels.jsx  Drag-to-resize three-column layout
    MobileLayout.jsx     Tab-based layout for narrow screens
  hooks/
    useConfig.js         useReducer-based state for the builder config
  utils/
    collectionRegistry.js  ← Builds registry of containers/selections; controls autocomplete
    dependencyChecker.js   Checks container/selection references exist
    schemaLookup.js        Fast index of schema by block/option name
    yamlSerializer.js      Config state → plain JS object → YAML string
    yamlLineBuilder.js     Config object → annotated line array (used by Reader)
    yamlValidator.js       Schema-based validation of a parsed YAML object
    yamlToConfig.js        YAML object → builder useConfig state (for "Open in Builder")
    yamlAnnotator.js       Generates the downloadable annotated YAML file
    selectionCutsSerializer.js  Parse/serialise EventSelection cut strings
  contexts/
    RegistryContext.js   React context providing the collection registry to components
```

---

## Contributing

1. Fork the repository and create a feature branch.
2. For backend changes: edit `backend/block_schema.py` (adding blocks) or
   `backend/app.py` / `backend/introspect.py` (infrastructure).
3. For frontend changes: the utility files in `frontend/src/utils/` are the
   most common extension point; component files are self-contained.
4. Test locally with Docker (see [Running locally](#running-locally)).
5. Open a pull request against `main`. Merging and bumping `VERSION` triggers
   automatic deployment.
