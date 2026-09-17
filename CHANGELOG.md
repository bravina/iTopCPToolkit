# Changelog

User-facing changes, newest first.  The version shown in the app header matches
the heading here.  Releases before 1.0.1 are on the
[GitHub releases page](https://github.com/bravina/iTopCPToolkit/releases).

## 1.1.0 — 2026-09-17

### AI assistant (optional, off unless the build enables it)

- An optional AI assistant in the Builder and the Reader.  It is grounded in the
  app's own data, not the documentation site: tools give the model this
  release's blocks and options, the reference configs, the config you are
  editing, and the app's validator and dependency checker.
- Bring your own key.  The conversation goes from your browser straight to
  Claude, ChatGPT, Gemini or a local Ollama; the key stays in the tab and is
  never sent to the iTopCPToolkit server.  Model lists come from the provider.
- It can propose changes to your config — targeted edits, or a whole config —
  shown as a card with a side-by-side diff.  Nothing is applied until you press
  Apply, and an applied set of edits is a single ⌘Z.  Applying a whole config
  replaces your config and clears the undo history; the card says so first.
- "Explain this" on any ⓘ bubble — option, block header or YAML line, in either
  mode — answers in a teaching voice for someone meeting a config for the first
  time.  It separates what the option *is* (from the schema and the glossary
  below) from general physics background, which is marked as background to
  verify.  Answers are short and end with follow-up questions you can click to
  go deeper.  It never fires on hover: each answer spends your own API credit.
- A small curated glossary ships with the app for the physics the schema cannot
  carry.  Entries are hand-written and record whether a physicist has reviewed
  them; an unreviewed entry is flagged as a draft rather than quoted as fact.
- In the Reader the assistant is strictly an inspector — the tools that propose
  edits are absent, since the route to editing is "Open in Builder".
- A local model that cannot do tool calling is marked as such in the picker and
  refused with the reason, rather than failing mid-answer.  Llama 3.1 or newer,
  Qwen or Mistral Small work; `llama3` does not.
- For a soft launch, `VITE_AI_ENABLED=gated` builds the assistant in but renders
  none of it until the browser is unlocked at `/withai`, with a password the
  server holds in `AI_ACCESS_PASSWORD`.  With no password set the gate never
  opens.  This keeps the password out of a forwarded link; it is not access
  control, since the conversation never touches the server and the code is in
  the bundle either way.  `0` and `1` behave exactly as before.

### Fixes and smaller changes

- Text anywhere in the app can be selected and copied again: the panel splitter
  was suppressing selection at all times rather than only while dragging.
- The assistant panel and the YAML preview share the preview column through a
  draggable divider; the split is kept for the session.
- An option that names a selection now offers the names already defined on the
  same container.  A new name creates the selection, an existing one overwrites
  it — both valid, so an unreferenced name is still never flagged.
- An option that names a *region* now offers the regions the config's
  `EventSelection` blocks define, and writes the decoration the algorithms read
  (`pass_<region>_%SYS%,as_char`).  Only `EventSelection`'s `selectionName`
  creates a region.
- A long assistant exchange no longer breaks the conversation: a tool call left
  unanswered used to make every later message fail.  The step limit is also
  twice as high, and on reaching it the assistant answers from what it has.
- A proposal can no longer leave an empty sub-block instance behind, and one
  that leaves a required option unset is reported back as incomplete before you
  are asked to apply it.
- The assistant no longer reports an option as missing because it addressed the
  lookup wrongly; blocks, sub-blocks and options are now addressed separately.
- Inline `code` in the assistant's prose no longer renders as a full-width
  block, and a tool call printed as JSON text is no longer shown as the answer.
- This changelog, covering 1.0.1 onward, and a backend test fix: an assertion
  still expected the catalogue to list a block whose module is not in the build.

## 1.0.6 — 2026-09-15

- Custom blocks declared by a reference config but whose Python module is not in
  this image are no longer offered in the catalogue: they cannot be configured
  here, so listing them only offered something broken.  A block named by *your
  own* config is unaffected — the reader still reports exactly why it failed.
- Quieter startup: Athena's `include should be followed with a list of files`
  warning, raised by example configs in the TopCPToolkit and Examples
  repositories, no longer reaches the log.

## 1.0.5 — 2026-09-15

- Press <kbd>Esc</kbd> twice to return to the Builder / Reader / INTnote menu.
  A single press still cancels whatever is open — search, a popover, a field
  being edited — so the shortcut never fires by accident.

## 1.0.4 — 2026-09-15

- No user-facing changes.  (Build output removed from version control, and a
  `.dockerignore` that cuts the image build context from 123 MB to under 1 MB.)

## 1.0.3 — 2026-09-15

- Taller header bar with larger text throughout.  The Builder / Reader / INTnote
  buttons now read as a segmented control instead of bare labels, so the mode
  you are in — and the ones you can switch to — are easier to spot.

## 1.0.2 — 2026-09-15

- No user-facing changes.  (Node version bump in the release workflow.)

## 1.0.1 — 2026-09-15

- No user-facing changes.  (Backend test fixes.)
