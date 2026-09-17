# iTopCPToolkit

An interactive web GUI for building [TopCPToolkit](https://topcptoolkit.docs.cern.ch/) / AnalysisBase YAML configuration files.

**Live app**: https://itopcptoolkit.web.cern.ch

---

## Table of contents

1. [What the app does](#what-the-app-does)
2. [Architecture](#architecture)
3. [AI assistant](#ai-assistant)
4. [Where the blocks come from](#where-the-blocks-come-from)
5. [Running locally](#running-locally)
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

**AI assistant** (`ai/`, off by default): an optional chat panel in the
Builder, grounded in the app's own data.  See *AI assistant* below.

**Light and dark** (`hooks/useTheme.js`): the header's ☀/☾ control cycles
system → light → dark, and the choice is remembered in `localStorage`.  The
default, *system*, follows `prefers-color-scheme` and re-follows it live when
the OS switches.  Tailwind runs in `darkMode: 'class'`: light is the base
palette and every dark rule is a `dark:` variant, keyed off a `dark` class on
`<html>` that `index.html` also sets before the first paint (no white flash).
When adding UI, write both — e.g. `bg-white dark:bg-slate-900`.

---

## AI assistant

An optional assistant lives in the Builder's preview column.  It is **not** a
documentation chatbot: the model is given tools backed by what the app already
holds in memory, so anything it says about syntax comes from a tool result
rather than from recall.

| Tool | Backed by |
|---|---|
| `list_blocks(filter, category, enabledOnly)` | the effective schema (base blocks + `AddConfigBlocks`) |
| `describe_block(name)` | one block or `Parent.SubBlock`: options, types, defaults, requiredness, choices, units, docstrings |
| `list_examples()` / `read_example(path)` | the reference configs (`/api/examples`) |
| `current_config()` | the builder state through `utils/yamlSerializer.js` |
| `validate_config()` | `utils/yamlValidator.js` + `utils/dependencyChecker.js` |

The whole loop runs in the browser (`ai/chat.js`): the backend is not involved
and holds no state for it.  Requests go straight to the provider the user
picked — Anthropic (with `anthropic-dangerous-direct-browser-access`), OpenAI,
Google Gemini, or a local Ollama — with the user's own key, which is kept in
`sessionStorage` and never sent to the Flask app.  Model lists are fetched from
each provider; the pinned lists in `ai/providers.js` are only the fallback.

### Turning it on

**It is off unless the build turns it on.** `VITE_AI_ENABLED` is baked in by
Vite, so the image decides at build time; it has three states:

| `VITE_AI_ENABLED` | What the app does |
|---|---|
| `0`, unset, or anything unrecognised | No AI UI renders anywhere: no 🤖 button in the Builder, no panel in the Reader, no "Explain this" in any ⓘ popover.  The default, and what a dev server also gets at an explicit `0`. |
| `gated` | The same — until this browser is unlocked at **`/withai`** with the password the backend holds.  For a soft launch: hand out the link and the password together. |
| `1` / `true` (and a dev server by default) | Always available.  The Builder shows one 🤖 button until a provider is connected. |

`aiEnabled()` in `ai/settings.js` is the single decision every AI affordance
hangs off.  The modules are in the bundle in all three states; at `0` nothing
renders them, and no key or provider call is ever possible.

```bash
# The whole app, assistant included, on http://localhost:5001
VITE_AI_ENABLED=1 ./build_and_serve.sh

# Soft launch: compiled in, but behind a password
VITE_AI_ENABLED=gated AI_ACCESS_PASSWORD='the shared password' ./build_and_serve.sh

# Or the frontend alone
cd frontend && VITE_AI_ENABLED=gated npm run build
```

### The `gated` state, and what it is worth

The password lives only in the backend's `AI_ACCESS_PASSWORD` environment
variable, read at request time:

| Route | |
|---|---|
| `GET /api/ai-access` | `{"configured": …}` — a boolean saying whether a password is set here, and nothing else |
| `POST /api/ai-access` `{"password": …}` | `{"ok": true}`, or 401 with a plain "That password is not right."  Constant-time comparison; after 5 failures from one IP within a minute, 429 until the minute is out, and every failure costs half a second. |

**If `AI_ACCESS_PASSWORD` is unset or empty the gate can never open** — so an
image built without it ships no assistant, whatever `VITE_AI_ENABLED` says.
The password is never logged, never echoed back, and appears in no endpoint
(`/api/health` included).  A success is remembered in `localStorage`, so the
normal URL works from then on; returning to `/withai` offers "Lock again".

**Be clear about what this is.**  Every AI request goes from the browser
straight to the provider and never touches Flask, so the backend cannot enforce
access — it gates *knowledge of the password*, not use of the feature.  The
assistant's code is in the bundle either way and the unlock is a flag in the
browser, so anyone willing to open devtools can set it themselves.  This is a
soft-launch gate, not access control.  It is adequate here only because the
assistant is bring-your-own-key: an uninvited user can spend no money of ours
and reach no CERN service.

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
   blocks actually used. Coverage therefore follows the configs that are in the
   image — a TCT block appears in the GUI once some config declares it.

   Two trees are scanned (see *Example configs* below): the configs shipped
   with the TopCPToolkit build, and the
   [TopCPToolkit_Examples](https://gitlab.cern.ch/atlas/amg/software/topcptoolkit_examples)
   checkout. The latter matters since TCT v3.7.0, which ships only its CI
   configs: most custom blocks (KLFitter, HyPER, VyPER, NeutrinoWeighter, …)
   are declared only in the examples repository now. Blocks declared nowhere
   are still reachable through "Add custom block…" below.

3. **Anything else** — the Builder's "Add custom block…" form and the Reader
   both call `POST /api/introspect` for entries not in the catalogue (any
   module installed in the image can be imported, the same trust level as
   running the YAML).

### Example configs

"Start from template…" offers the `reco.yaml` / `particle.yaml` / `parton.yaml`
of every config directory found in

| Source | Where | Notes |
|---|---|---|
| `TopCPToolkit` | `<build>/x86_64*/data/TopCPToolkit/configs/**` | since v3.7.0 just the CI configs |
| `Examples` | `/opt/TopCPToolkit_Examples/Analysis/<group>/<config>/` | ATLAS-internal, needs `CERN_TOKEN` at build time |

Before an example is offered it is put through two steps:

1. **`include:` resolution.** Fragments are merged in with Athena's own
   `combineConfigFiles`, so precedence matches what `runTop_el.py` would do
   (local keys win; for a list of fragments the earlier one wins). What the GUI
   loads therefore never contains an `include:`.
2. **A staleness check.** The resolved config is run through
   `TextConfig.configure()` — the same code that would configure the job. If it
   references a block or an option this release does not have, or a fragment is
   missing, the example is dropped *silently*: these are other people's configs,
   archived against an older release, and there is nothing the user can do
   about it. The reasons are logged at DEBUG.

Sidebar categories are the only hand-maintained piece: `CATEGORIES` in
`backend/introspect.py` maps block names to a category; everything else lands
in "Others", harvested TCT blocks in "TopCPToolkit".

---

## Running locally

The app only runs inside the AnalysisBase image: the schema is built by
introspecting a live Athena `ConfigFactory`, so without it the backend refuses
to start (`python app.py` exits with an error) and `/api/schema` answers
HTTP 503. Build and run the Docker image.

### Docker (the only supported way to run the app)

```bash
# Build without TopCPToolkit (AnalysisBase blocks only)
docker build --build-arg AB_TAG=25.2.110 -t tct-gui .

# Build with a specific TopCPToolkit version (adds the TCT catalogue, templates and INTnote Writer)
docker build \
  --build-arg AB_TAG=25.2.110 \
  --build-arg TCT_VERSION=v3.7.0 \
  -t tct-gui .

# TopCPToolkit (gitlab.cern.ch/atlas/amg/software/TopCPToolkit) is public, so no
# token is needed.  For a private fork, pass a CERN GitLab PAT as a build secret
# and point TCT_REPO at it:
export CERN_TOKEN=glpat-xxxxxxxxxxxx
docker build \
  --secret id=cern_token,env=CERN_TOKEN \
  --build-arg TCT_REPO=gitlab.cern.ch/<you>/TopCPToolkit.git \
  --build-arg AB_TAG=25.2.110 \
  --build-arg TCT_VERSION=v3.7.0 \
  -t tct-gui .

# Build with the AI assistant compiled in (see "AI assistant" above)
docker build --build-arg VITE_AI_ENABLED=1 --build-arg AB_TAG=25.2.110 -t tct-gui .

# Run
docker run --name tct-gui-app -p 5001:5000 tct-gui
# Open http://localhost:5001

# Or compiled in behind the /withai password: the build arg decides the UI,
# the environment variable is what the running container checks against.
docker build --build-arg VITE_AI_ENABLED=gated -t tct-gui .
docker run --name tct-gui-app -p 5001:5000 -e AI_ACCESS_PASSWORD='…' tct-gui
```

`./build_and_serve.sh` does the build-and-run in one step and honours
`AB_TAG`, `TCT_VERSION`, `TCT_EXAMPLES_REF`, `CERN_TOKEN`, `VITE_AI_ENABLED`
and `AI_ACCESS_PASSWORD` from the environment.

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
| `CERN_TOKEN` | Secret | CERN GitLab PAT — needed for the (ATLAS-internal) example configs, and for a private TopCPToolkit fork |
| `AB_TAG` | Variable | AnalysisBase tag (e.g. `25.2.110`), optional |
| `TCT_VERSION` | Variable | TopCPToolkit version (e.g. `v3.7.0`), optional |
| `TCT_REPO` | Variable | TopCPToolkit repository, optional (default `gitlab.cern.ch/atlas/amg/software/TopCPToolkit.git`) |
| `TCT_EXAMPLES_REPO` | Variable | TopCPToolkit_Examples repository, optional |
| `TCT_EXAMPLES_REF` | Variable | Branch/tag of TopCPToolkit_Examples, optional (default `main`) |
| `VITE_AI_ENABLED` | Variable | AI assistant, optional (default `gated`: compiled in, hidden until `/withai`). Set to `0` to leave it out |

The gate only opens where the *running* deployment also sets
`AI_ACCESS_PASSWORD` — see [AI assistant](#ai-assistant).  Without it a `gated`
image shows no assistant at all, which is the safe direction.

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

### Backend (needs AnalysisBase — no TopCPToolkit required)

The backend is a mirror of Athena's live `ConfigFactory`, so it is only ever
tested against the real thing. There is no stand-in for `AnalysisAlgorithmsConfig`:
without it `conftest.py` aborts collection with an explanatory error.

```bash
docker run --rm -v "$PWD:/src" -w /src/backend \
  gitlab-registry.cern.ch/atlas/athena/analysisbase:25.2.110 bash -c "
    source /home/atlas/release_setup.sh &&
    python3 -m pip install --user flask flask-cors pyyaml pytest &&
    pytest tests/ -v
"
```

`tests/userblocks/AnalysisTestBlocks` stands in for a *user's own analysis
package*: the module an `AddConfigBlocks` entry points at (TopCPToolkit in
production, which a plain AnalysisBase image does not have). It uses nothing
but the public `ConfigBlock` / `groupBlocks` API.

`tests/test_ai_access.py` is the exception: the AI gate is a string comparison
and a throttle, so it needs no Athena and can be run anywhere.

```bash
PYTHONPATH=backend pytest backend/tests/test_ai_access.py --noconftest -v
```

### Frontend (no Docker needed)

```bash
cd frontend
npm install
npm test          # vitest, utilities only
npm run build     # catches JSX / import errors
```

Frontend tests run against `src/__tests__/fixtures/schema.js`, a fixture in the
exact shape of `/api/schema`.

### Inside the built image (Athena + TopCPToolkit)

```bash
docker run --rm tct-gui bash -c "
  source /home/atlas/release_setup.sh &&
  source /opt/TopCPToolkit/build/*/setup.sh &&
  python -m pytest /app/backend/tests/ -v
"
```

Same suite, with TopCPToolkit on top — worth running before a release to check
that the real TCT reference configs and their `AddConfigBlocks` entries still
introspect.

### CI

`.github/workflows/test.yml` runs the backend suite (inside the public
AnalysisBase image — no CERN credentials needed), the frontend suite and a
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
  app.py              Flask application, routes, schema cache
  introspect.py       Walks ConfigFactory → schema (+ CATEGORIES map)
  catalogue.py        Harvests AddConfigBlocks from the TCT reference configs
  tests/              pytest suite (needs AnalysisBase); userblocks/ stands in
                      for a user package registered through AddConfigBlocks

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
    ThemeToggle.jsx        Header control cycling system → light → dark
    AiChatPanel.jsx        AI assistant chat (Builder preview column)
    AiSettingsModal.jsx    Provider / model / API-key setup
    AiUnlock.jsx           The /withai soft-launch unlock form (gated builds only)
  ai/
    tools.js           Schema, config, examples and validation exposed as LLM tools
    providers.js       Anthropic / OpenAI / Gemini / Ollama adapters, called from the browser
    chat.js            The tool-use loop
    systemPrompt.js    What the assistant is for
    settings.js        Build state (off / gated / on), unlock flag, provider preference, key in sessionStorage
  hooks/
    useConfig.js       Reducer for the builder state with undo/redo
    useTheme.js        Colour-scheme preference (localStorage + `dark` class)
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
