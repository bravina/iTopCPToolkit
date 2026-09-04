# iTopCPToolkit

An interactive web GUI for building [TopCPToolkit](https://topcptoolkit.docs.cern.ch/) / AnalysisBase YAML configuration files.

**Live app**: https://itopcptoolkit.web.cern.ch

---

## Table of contents

1. [What the app does](#what-the-app-does)
2. [Architecture](#architecture)
3. [Where the blocks come from](#where-the-blocks-come-from)
4. [Running locally](#running-locally)
5. [The schema snapshot](#the-schema-snapshot)
6. [Deployment](#deployment)
7. [Testing](#testing)
8. [Metadata the GUI understands](#metadata-the-gui-understands)
9. [How to add a new application mode](#how-to-add-a-new-application-mode)
10. [Code map](#code-map)
11. [Contributing](#contributing)

---

## What the app does

iTopCPToolkit has three modes, selectable from the landing screen:

| Mode | Purpose |
|---|---|
| **Builder** | Create a YAML config block by block — from scratch or from a TopCPToolkit reference config. Every block may have several instances; custom blocks are added through `AddConfigBlocks` exactly as in the YAML. Undo/redo, autosave, search. |
| **Reader** | Load an existing YAML file to inspect, validate, annotate, or diff it. Custom blocks declared in the file's `AddConfigBlocks` section are introspected before validation. |
| **INTnote Writer** | Generate a LaTeX+PDF configuration summary for an ATLAS Internal Note (requires TopCPToolkit in the image) |

---

## Architecture

```
Browser  ←→  Flask API (port 5000)  ←→  AnalysisBase Python environment
              │
              ├── Serves built React frontend from /app/frontend/dist
              ├── GET  /api/schema            → block tree introspected from ConfigFactory
              │                                 + TCT catalogue + reference configs
              ├── POST /api/introspect        → introspect one AddConfigBlocks entry
              ├── GET  /api/examples[/<path>] → TopCPToolkit reference configs
              ├── GET  /api/health            → version info
              └── POST /api/generate-intnote  → PDF generation
```

**Backend** (`backend/`): a small Flask app. At startup it builds the schema by
walking the live `AnalysisAlgorithmsConfig.ConfigFactory` — the same registry
`TextConfig` uses to interpret YAML — so the GUI accepts exactly what Athena
accepts. Nothing about blocks, options or defaults is hand-maintained.

**Frontend** (`frontend/src/`): a React (Vite + Tailwind) single-page app. It
fetches the schema once and does editing, serialisation, validation and
autocomplete in the browser.

---

## Where the blocks come from

There are three sources, mirroring how a TopCPToolkit YAML file works:

1. **AnalysisBase blocks** — everything `ConfigFactory.addDefaultAlgs()`
   registers, including sub-blocks (`Jets.JVT`, `Electrons.WorkingPoint`, …),
   factory-level defaults, and `@groupBlocks` functions such as `Jets` or
   `EventSelection` whose options are the union of the `ConfigBlock`s they
   append (each option is tagged with its declaring class).

2. **TopCPToolkit blocks** — TCT does not register its blocks in Python; users
   declare them in YAML through `AddConfigBlocks`:
   ```yaml
   AddConfigBlocks:
     - modulePath: 'TopCPToolkit.KLFitterConfig'
       functionName: 'KLFitterConfig'
       algName: 'KLFitter'
       pos: 'Output'
   ```
   The backend **harvests** every such entry from the reference configs
   installed with the TCT build (`<build>/x86_64*/data/TopCPToolkit/configs/**`)
   and introspects them into a *catalogue*. The Builder offers the catalogue
   with one-click "add"; `AddConfigBlocks` is written to the YAML only for
   blocks actually used. Coverage therefore follows the reference configs —
   a TCT block appears in the GUI once some shipped config declares it.

3. **Anything else** — the Builder's "Add custom block…" form and the Reader
   both call `POST /api/introspect` for entries not in the catalogue (any
   module installed in the image can be imported, the same trust level as
   running the YAML).

Sidebar categories are the only hand-maintained piece: `CATEGORIES` in
`backend/introspect.py` maps block names to a category; everything else lands
in "Others", harvested TCT blocks in "TopCPToolkit".

---

## Running locally

### With Docker (recommended — full Athena introspection)

```bash
# Build without TopCPToolkit (AnalysisBase blocks only)
docker build --build-arg AB_TAG=25.2.106 -t tct-gui .

# Build with a specific TopCPToolkit version (adds the TCT catalogue, templates and INTnote Writer)
export CERN_TOKEN=glpat-xxxxxxxxxxxx   # CERN GitLab personal access token
docker build \
  --secret id=cern_token,env=CERN_TOKEN \
  --build-arg AB_TAG=25.2.106 \
  --build-arg TCT_VERSION=v3.6.0 \
  -t tct-gui .

# Run
docker run --name tct-gui-app -p 5001:5000 tct-gui
# Open http://localhost:5001
```

### Without Docker (no Athena — uses the schema snapshot)

Useful for frontend development. The backend serves
`frontend/src/schema.snapshot.json` (see below) and shows a "Schema snapshot"
badge; `/api/introspect` is unavailable in this mode.

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

## The schema snapshot

`frontend/src/schema.snapshot.json` is the introspected schema dumped from a
real image. It is what the backend serves without Athena and what the frontend
could be developed against. Regenerate it whenever the target AB/TCT release
changes:

```bash
docker build ... -t tct-gui .          # as above, with TCT_VERSION
docker run --name tct-gui-dump tct-gui bash -c \
  "source /home/atlas/release_setup.sh && \
   source /opt/TopCPToolkit/build/*/setup.sh && \
   python3 /app/backend/scripts/dump_schema.py /app/schema.snapshot.json"
docker cp tct-gui-dump:/app/schema.snapshot.json frontend/src/schema.snapshot.json
docker rm tct-gui-dump
```

The script prints how many blocks and catalogue entries were introspected and
lists any that failed (a block failing introspection is still served, with an
`error` field the GUI displays).

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
| `AB_TAG` | Variable | AnalysisBase tag (e.g. `25.2.106`), optional |
| `TCT_VERSION` | Variable | TopCPToolkit version (e.g. `v3.6.0`), optional |

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

## Testing

No expected Athena block lists are hardcoded anywhere: tests assert invariants
and round-trip properties, so they only need updating when behaviour changes
on purpose.

### Backend (no Docker needed)

```bash
cd backend
pip install flask flask-cors pyyaml pytest
pytest tests/ -v
```

`tests/fake_athena/` is a minimal stand-in for `AnalysisAlgorithmsConfig`
(same `ConfigFactory` data structures, fake blocks) that is put on `sys.path`
only when the real package is not importable. `tests/fake_blocks/FakeAlgorithms`
holds custom blocks used through `AddConfigBlocks`; they only use the public
`ConfigBlock` API and therefore also work under real Athena.

### Frontend (no Docker needed)

```bash
cd frontend
npm install
npm test          # vitest, utilities only
npm run build     # catches JSX / import errors
```

Frontend tests run against `src/__tests__/fixtures/schema.js`, a fixture in the
exact shape of `/api/schema`.

### Inside the image (real Athena)

```bash
docker run --rm tct-gui bash -c "
  source /home/atlas/release_setup.sh &&
  source /opt/TopCPToolkit/build/*/setup.sh &&
  python -m pytest /app/backend/tests/ -v
"
```

Here the `TestRealFactory` tests run: every block in the live factory must
introspect without error, grouped blocks must expose several classes, and the
TCT catalogue must resolve.

### CI

`.github/workflows/test.yml` runs the backend suite, the frontend suite and a
production frontend build on every pull request and push to `main`.

---

## Metadata the GUI understands

Everything comes from `ConfigBlock.addOption(...)` and the factory:

| Source | Used for |
|---|---|
| `type`, `defaultValue` (+ factory `defaults=`) | input widget; options at their default are omitted from the YAML |
| `info` | ⓘ tooltip (Markdown + LaTeX); `[MeV]`/`[GeV]`/`[mm]` become a unit badge via `AutogenDocumentation.interpret_physical_unit` |
| `required`, `noneAction='error'` | required marker, Reader warning when absent |
| `expertMode` | option hidden behind the 🧪 Expert toggle; Reader warns when a value needs `CommonServices.enableExpertMode` |
| `addDependency()` | dependency banner and Reader warning |
| class docstrings | block description and search index |
| `meta={...}` (upstream, in progress) | `choices` → dropdown; `role` ∈ `container` / `containerRef` / `selection` → autocomplete and reference checking; `multiline` → textarea |
| `schema.keywords` (upstream, in progress) | form-based editor for `EventSelection.selectionCuts`; until then the cuts are a textarea |

Container autocomplete and reference checking are active **only** for options
that declare `meta.role`. There is no name-based fallback: an option the
upstream block does not annotate is rendered as a plain field and is never
reported as an unknown container — so working points (`Trigger.electronID:
Tight`) and input xAOD names (`Jets.jetCollection`) are left alone. The one
exception is a sub-block `containerName`, which TextConfig propagates from the
parent instance. `optionRole()` in `frontend/src/utils/collectionRegistry.js`
is where that decision is made.

---

## How to add a new application mode

The app currently has three modes: Builder, Reader, INTnote Writer.

1. Add a `ModeCard` in `frontend/src/components/ModeSelector.jsx`
2. Handle the new mode string in `App.jsx` (render branch + header button)
3. Create a component in `frontend/src/components/` for the mode's UI
4. If it needs an API endpoint, add a route in `backend/app.py`

---

## Code map

```
backend/
  app.py              Flask application, routes, schema cache + snapshot fallback
  introspect.py       Walks ConfigFactory → schema (+ CATEGORIES map)
  catalogue.py        Harvests AddConfigBlocks from the TCT reference configs
  scripts/dump_schema.py   Writes frontend/src/schema.snapshot.json
  tests/              pytest suite; fake_athena/ stub, fake_blocks/ custom blocks

frontend/src/
  App.jsx             Top-level component, mode routing, schema fetch, shortcuts, autosave
  api.js              Fetch wrappers for the endpoints
  components/
    Sidebar.jsx            Block toggles by category, TCT catalogue, custom-block form, templates
    BlockPanel.jsx         Editor for the selected block (header, instances, sub-blocks)
    OptionList.jsx         Option rendering shared by blocks and sub-blocks
    SubBlockSection.jsx    One sub-block inside a parent instance (inherited options shown)
    OptionField.jsx        Single option row (widget by type + metadata)
    CollectionField.jsx    Autocomplete for container/selection references
    SelectionCutsEditor.jsx  EventSelection cuts (textarea or spec-driven rows)
    YamlPreview.jsx        Live YAML preview + export
    ConfigReader.jsx       Reader mode: load, validate, diff, annotate, open in Builder
    AnnotatedYamlView.jsx  Colour-coded YAML view used in Reader and Diff
    DiffView.jsx           Side-by-side diff
    SearchOverlay.jsx      Global search (⌘F) across blocks and options
    ModeSelector.jsx, SplashScreen.jsx, InfoPopover.jsx, YamlLoader.jsx,
    ResizablePanels.jsx, MobileLayout.jsx, IntNoteWriter.jsx
  hooks/
    useConfig.js       Reducer for the builder state with undo/redo
  utils/
    configState.js     Builder state shape and constructors
    schema.js          Effective schema (base + AddConfigBlocks), option predicates
    schemaLookup.js    Index of blocks/options by name
    configWalk.js      One walker over builder state or YAML
    yamlSerializer.js  State → YAML (lists everywhere, AddConfigBlocks when used)
    yamlToConfig.js    YAML → state (AddConfigBlocks resolved first)
    yamlValidator.js   Static replication of TextConfig's checks
    collectionRegistry.js  Containers/selections registry; optionRole() heuristics
    dependencyChecker.js   Unresolved container/selection references
    eventSelection.js  selectionCuts helpers (keyword spec aware)
    yamlLineBuilder.js, yamlAnnotator.js   Annotated YAML rendering / export
    autosave.js        localStorage persistence
  contexts/RegistryContext.js
  __tests__/          vitest suites + fixtures/schema.js
```

---

## Contributing

1. Fork the repository and create a feature branch.
2. Backend infrastructure lives in `backend/app.py`, `introspect.py`, `catalogue.py`.
   New blocks need **no** GUI change — they come from Athena / TopCPToolkit.
3. Frontend: `utils/` for logic, `components/` for UI.
4. Run the test suites locally before opening a PR (see [Testing](#testing)).
5. Merging and bumping `VERSION` triggers automatic deployment.
