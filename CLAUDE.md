# landmarker2D: notes for Claude Code

Browser app for 2D landmarking on images. Plain JavaScript, no framework, no build step, no runtime dependencies; hosted as static files on GitHub Pages and shared with students.

## Structure

- `src/core.js`: all format logic, pure and DOM-free (UMD: `window.LmkCore` in the browser, `require` in Node). New logic goes here so it can be unit tested.
- `src/template-editor.js`: the Template tab, deliberately close to Landmarker3D's `js/template-editor.js` so both apps behave the same. Its edits call `core.js` functions (`addDefs`, `updateDef`, `updateCurve`, …) through `mutate()`, which records one undo step per change.
- `src/app.js`: UI only (side panel tabs: Landmarks, Template, Specimen). It keeps one state object `S` (document fields from `LmkCore.newState()` plus UI fields) and exposes `window.__lmk = { S, C }` for the browser tests.
- **Specimen sets:** `app.js` keeps a set (`LmkCore.newSet`, one shared template) of specimen records (image, landmarks, scale, view). `S`'s document fields read and write the current record, so most UI code is unaware of the set. Template edits in `core.js` act on every member (`members()`), and undo snapshots the whole set. Exports, hand-in zips and combining hand-ins are in `core.js` (`toTPS`/`toCSV` take a list, `handInFiles`, `combineEntries`, a small built-in zip writer/reader).
- Must keep working when opened from `file://`: classic `<script src>` only, no ES module imports.

## File format rules (landmark-json 0.2, 2D)

The specification is `docs/landmark-json-spec.md` (a copy of the shared spec also used by the 3D app). Follow it; if a change needs the format to change, say so rather than diverging silently.

- Positions are raw image pixels, origin top-left, y down, pixel centres at .5, never pre-scaled. Scale is applied only at export.
- Unknown fields are preserved on save (`state.raw` is the base of `buildDoc`). Fields starting with `_` are private and never saved.
- Statuses: `placed`, `estimated`, `missing`. No entry means "not yet done", which is different from `missing`.
- Ids are stable codes (`LM01`); names can change. Export order: template landmarks, curve points, ad hoc points, or `template.export_order`.
- `n_points` excludes anchored curve ends. Templates must say `dimensions: 2`.
- A newer minor version opens; a newer major version is refused.

## Tests

- `npm test`: unit tests in `tests/unit/` (node:test). Add one for any change to `core.js`.
- `npm run test:e2e`: builds, then runs Playwright in `tests/e2e/`. Use `PW_CHANNEL=chrome` to run with an installed Chrome.
- Run both before committing.
