# Changelog

User-facing changes, newest first.  The version shown in the app header matches
the heading here.  Releases before 1.0.1 are on the
[GitHub releases page](https://github.com/bravina/iTopCPToolkit/releases).

## 1.0.7 — unreleased

- No user-facing changes.  (This changelog, covering 1.0.1 onward; and a backend
  test fix — an assertion still expected the catalogue to list a block whose
  module is not in the build.)

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
