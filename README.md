# landmarker2D

A lightweight browser tool for placing 2D landmarks and curve semilandmarks on images. It saves the `landmark-json` format (`.lmk.json`) and exports TPS and CSV for geometric morphometrics. It runs entirely in the browser: no installation, and images never leave the computer.

It is the 2D companion of a 3D landmarking app that uses the same file format.

## Using it

Open the hosted version (GitHub Pages, once enabled), or download `landmarker2d.html` from the site or from a build and open it in any modern browser.

1. **Open image** (JPG, PNG or WebP). The specimen ID is taken from the file name.
2. Set up the template in the **Template** tab (it works like the one in the 3D app):
   - name the template, add landmarks one at a time or paste a list, rename them, write where to place each one, set bilateral pairs and change the order;
   - add curves: choose the landmarks they start and end on (or a closed loop), the number of semilandmarks, and straight or smooth lines between clicks;
   - **Save template file** to share it, or **Open template file…** to use your lab's `.template.json`. **Edit as text…** shows the whole template as lines like `LM01 | Nasion | pair=LM02`, handy for pasting.

   IDs (`LM01`, `C01`) lock once a landmark or curve has data; names can always change. Every edit can be undone.
3. Click to place the selected landmark; the next one is selected automatically. For a curve, click along it in order: the ends snap to the `start`/`end` landmarks and `n` semilandmarks are spaced at equal arc length.
4. **Measure scale bar** (two clicks plus the known length) to calibrate.
5. **Save .lmk.json**, and **Export TPS** / **Export CSV** for analysis.

Work is also kept in the browser, keyed to the image's checksum: reopening the same image restores unsaved work.

| Action | How |
| --- | --- |
| Place / move | Click / drag a point |
| Pan, zoom | Drag empty space, mouse wheel, pinch on touch screens |
| Next unfinished | `N` |
| Estimated, missing | `E`, `M` |
| Clear | `Delete` (`Backspace` removes the last curve point) |
| Nudge | Arrow keys (0.25 px, 1 px with Shift) |
| Undo | `Ctrl`+`Z` |

### Coordinates and exports

- Positions are stored in raw image pixels: origin at the top-left, y pointing down, pixel centres at .5. They are never pre-scaled.
- **TPS** follows tpsDig: y flipped (`height − y`), `IMAGE=`, `ID=` and `SCALE=` lines, missing points as `-999 -999`. Points not yet done are also written as missing, and the app says how many.
- **CSV** keeps the image orientation, in scale units when calibrated (pixels otherwise), with `units` and `status` columns.
- Order: template landmarks, then curve points, then ad hoc points (or the template's `export_order`).

## Development

Requires Node 20 or later.

```sh
npm install
npm start            # http://localhost:8080
npm test             # unit tests (node:test, no browser)
npm run test:e2e     # builds, then runs browser tests (Playwright)
npm run build        # dist/landmarker2d.html, a single file with everything inlined
```

First time with the browser tests: `npx playwright install chromium`, or use an installed Chrome with `PW_CHANNEL=chrome npm run test:e2e`.

### Layout

```
index.html           page markup
src/core.js          format logic, no DOM: curves, templates, .lmk.json read/write, TPS/CSV (window.LmkCore / require)
src/app.js           UI: canvas, pointer and keyboard input, side panel tabs, file handling
src/template-editor.js  the Template tab (modelled on Landmarker3D's js/template-editor.js)
src/styles.css       styles (light and dark)
tests/unit/          node:test suites for core.js
tests/e2e/           Playwright tests driving the real page
scripts/serve.mjs    static server for npm start and the browser tests
scripts/build.mjs    single-file build
docs/                landmark-json format specification
```

Plain JavaScript with no build step and no runtime dependencies, so it can be hosted as static files.

### Continuous integration

- `.github/workflows/test.yml` runs the unit and browser tests on every push and pull request and keeps the single-file build as a workflow artifact.
- `.github/workflows/pages.yml` deploys to GitHub Pages after the tests pass on `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## File format

The full specification is in [docs/landmark-json-spec.md](docs/landmark-json-spec.md). This app implements `landmark-json` version 0.2, 2D section: one file per image, `specimen.image` (`file`, `sha256`, `width`, `height`, optional `scale`), template with `dimensions: 2`, statuses `placed` / `estimated` / `missing`. Fields the app doesn't know are kept when a file is saved again.

Not yet supported: templates referenced by `ref` instead of embedded, the geomorph curve-sliders file, TIFF images.

## Licence

MIT, see [LICENSE](LICENSE).
