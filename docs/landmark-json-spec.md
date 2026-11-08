# Landmark JSON Format Specification

Copy of the shared `landmark-json` specification (updated 2026-11-08 with planes, v0.4, and the fuller Curves section; Bence Viola), kept in this repository so the 2D app can be developed against it. The same format is used by the 3D landmarking app. This app implements the **2D data (v0.2)** section, fixed landmarks and curves; mesh-only parts (anchors, normals, surfaces) do not apply to images, and planes (v0.4) are kept when saving but not used.

## Purpose and principles

One JSON file stores the landmark data for one specimen. It is the app's native save format: lossless, re-openable for editing, and the source for TPS and CSV exports. Version 0.1 implements fixed landmarks only, but the structure already has places for curves and surface semilandmarks.

Design principles:

- **One file per specimen.** Many specimens are merged only at export time (multi-specimen TPS).
- **Template separate from data.** The template defines *what* to place (names, order, curves). The specimen data says *where* it was placed. An instructor writes one template; every student file uses it.
- **Coordinates are the truth.** Positions are stored in the source's own coordinate space: mesh coordinates in 3D, image pixels in 2D. For meshes, a surface anchor (face + barycentric coordinates) is stored alongside, as a helper for editing and geodesic curves.
- **Stable IDs, not array positions.** Everything is referenced by `id`. Export order comes from the template, so reordering in the file never changes the analysis.
- **Readers ignore what they don't know.** Unknown fields are preserved on save, so older versions of the app don't destroy newer data.

## File structure

A file has five required top-level fields and four optional ones. The extension is `.lmk.json`, so it opens in any text editor but is recognisable as a landmark file.

| Field | Type | Required | Content |
| --- | --- | --- | --- |
| `format` | string | yes | Always `"landmark-json"`. Lets the app reject unrelated JSON. |
| `version` | string | yes | Format version, e.g. `"0.1.0"` (see Versioning). |
| `specimen` | object | yes | `id`, optional `notes`, optional `replicate` (v0.3, see Replicates), and exactly one source: `mesh` (`file`, `sha256`, `units`, `vertex_count`, `face_count`) for 3D, or `image` for 2D (see 2D data). |
| `template` | object | yes | Either embedded definitions, or `{ "ref": "<file or URL>", "id": "...", "version": "..." }`. |
| `landmarks` | array | yes | Placed fixed landmarks (may be empty). |
| `curves` | array | no | Traced curves and their semilandmarks (v0.2), see Curves. |
| `surfaces` | array | no | Reserved for later. |
| `provenance` | object | no | `software`, `software_version`, `operator`, `created`, `modified` (ISO 8601). |
| `extensions` | object | no | App- or lab-specific data, keyed by a namespace. |

The `sha256` of the mesh or image lets the app warn when a file is opened against a different or modified source, which would silently shift every landmark.

`vertex_count` and `face_count` are the raw counts as stored in the mesh file. For STL, which has no shared vertices, `vertex_count` is therefore 3 × `face_count`. No vertex merging is reflected in these numbers.

## Template

The template is the landmarking protocol: the list of landmarks (and later curves) every specimen should get, in export order. It can be embedded in each specimen file or kept as a separate `.template.json` that files reference. Embedding a copy is the default, so a file stays self-contained when sent to someone else.

Template fields:

- `id`, `name`, `version`, `dimensions` (`3` for meshes, `2` for images; defaults to 3 if absent), optional `description` and `author`.
- `landmarks`: array of definitions, each with `id` (a short code such as `"LM01"`, never changed once data exists), `name` (the descriptor shown to students, e.g. `"Nasion"`, can be renamed freely), optional `description` (where exactly to place it), optional `image` (path or URL to a reference picture), and optional `bilateral_pair` (the `id` of its left/right counterpart).
- `curves` (v0.2): array of curve definitions, see Curves.
- `planes` (v0.4): optional array of reference planes defined by landmarks, see Planes.
- `export_order`: array of ids giving the row order in TPS and CSV. If absent, the order of `landmarks` is used, followed by curve points in curve order.

A specimen may contain a landmark that is not in the template (`"template_id": null`). This allows ad hoc landmarking without writing a template first; such points are exported after the template points.

## Fixed landmarks (v0.1)

Each entry in `landmarks` is one placed (or deliberately skipped) landmark.

| Field | Type | Required | Content |
| --- | --- | --- | --- |
| `id` | string | yes | Unique within the file. Equals `template_id` when the landmark comes from the template. |
| `template_id` | string or null | yes | The template definition this fulfils; null for ad hoc points. |
| `label` | string | no | Display name; defaults to the template `name`. |
| `status` | string | yes | `"placed"`, `"missing"` or `"estimated"` (see Conventions). |
| `position` | [x, y, z] or [x, y] | when not missing | Coordinates in mesh space, in `specimen.mesh.units`; in 2D, image pixels (see 2D data). Null when missing. |
| `anchor` | object | no | `{ "face": <int>, "bary": [u, v, w] }`: the triangle index (in the file's own face order) and barycentric weights of the picked point. 3D only. |
| `normal` | [x, y, z] | no | Surface normal at the point; useful for display and later sliding. |
| `placed_at` | string | no | ISO 8601 timestamp of the last edit. |
| `note` | string | no | Free text, e.g. "broken here, estimated from contralateral side". |

When `anchor` and `position` disagree (the mesh was changed), `position` wins and the app should warn and re-snap.

## Curves (v0.2)

A curve stores both what the user clicked and what was computed from it, so it can be re-edited and re-sampled later without losing the original intent.

Template curve definition:

- `id`, `name`, optional `description`.
- `start` and `end`: optional landmark ids the curve must begin and end on (anchored endpoints). Endpoints shared with fixed landmarks are not exported twice.
- `n_points`: number of semilandmarks to sample, excluding anchored endpoints.
- `path`: in 3D, `"geodesic"` (shortest path across the surface) or `"euclidean"` (straight segments, projected onto the surface); in 2D, `"polyline"` or `"spline"`.
- `spacing`: `"equal_arc_length"` (default) for points equally spaced along the path.
- `closed`: true for loops (e.g. an orbit rim), where no start/end applies.

Specimen curve entry:

- `id`, `template_id`, `status`.
- `control_points`: the clicked points, each `{ "position": [x,y,z], "anchor": {...} }`, in order.
- `points`: the resampled semilandmarks, each `{ "position", "anchor", "normal" }`.
- `length`: path length in mesh units, and `sampling`: the `path`, `spacing` and `n_points` actually used.

The TPS export writes `points` as ordinary rows; the curve definition file for geomorph sliding (which point slides between which neighbours) is generated from this structure.

**Ids.** Curves share one set of ids with landmarks and planes (a curve can't be called `LM01`). Apps number new curves `C01`, `C02`, …

**Number of points.** `n_points` semilandmarks are spaced at equal arc length:

- Both ends anchored: the points lie strictly between the two landmarks, which are exported once, as landmarks.
- A free end gets a semilandmark of its own at the end of the path; with both ends free, the first and last points are the curve's ends.
- A closed loop gets `n_points` around the loop, starting at its first clicked point.
- With one point it sits in the middle of the path.

**Computing a curve in 3D (`"euclidean"`).** The path runs through the start landmark, the clicked points in order and the end landmark. Its straight segments are cut into short steps, and each step is moved to the nearest point on the surface, so the path follows the surface between the clicks. `length` is the length of that surface path. The semilandmarks are spaced along it and moved onto the surface too, so each has an `anchor` and a `normal` like a landmark. An open curve needs at least two points (counting anchored ends), a loop at least three. If an anchored landmark isn't placed, or is missing, the curve has no semilandmarks until it is placed. On thin structures the nearest surface can lie on the other side; `"geodesic"` paths (planned) avoid this.

**When the template changes.** If `n_points` changes, curves already traced are re-sampled from their `control_points` when the mesh is open. A curve whose `points` don't match the template's `n_points` counts as not done in exports.

**Exports.**

- Rows follow `export_order` if it lists curve ids, otherwise landmarks first, then each curve's semilandmarks in curve order, then ad hoc points.
- Each semilandmark is a row named `<curve id>_<nn>` (`C01_01`, `C01_02`, …). In CSV it has `type = curve`, the curve id in `curve` and its number in `index`.
- A curve that is missing or not finished is written as `n_points` missing rows (TPS: the missing value; CSV: `NA` with status `missing` or `not_done`), so every specimen has the same rows.

**Unknown curves.** A curve entry whose `template_id` isn't in the template is kept unchanged when the file is saved again, like any field the app doesn't know.

## Surface semilandmarks (reserved, later)

Only the slot is fixed now, so later versions don't need a breaking change. A `surfaces` entry is expected to hold:

- `id`, `template_id`, `status`.
- `boundary`: ids of curves and/or landmarks enclosing the patch, or `null` for a whole-mesh patch.
- `method`: how points were generated, e.g. `"template_projection"` (points transferred from a template specimen) or `"patch_grid"` (grid inside the boundary).
- `points`: array of `{ "position", "anchor", "normal" }`, as for curves.

Surface points get their own block in the CSV export (`type = surface`) and are written after curves in TPS.

## 2D data (v0.2)

Landmarks digitised on photographs or other images use the same file structure, with an image in place of a mesh. There is one file per image. Several images of the same specimen are separate files sharing `specimen.id`; multi-view work is better collected in 3D.

**Source.** `specimen` contains exactly one of `mesh` or `image`, and the dimensionality follows from it: mesh means 3D, image means 2D. The template declares `dimensions` (2 or 3), and the app refuses to apply a template to a source of the wrong kind.

| Field | Type | Required | Content |
| --- | --- | --- | --- |
| `file` | string | yes | Image filename. |
| `sha256` | string | yes | Hash of the image file, used as for meshes. |
| `width`, `height` | integer | yes | Image size in pixels. `height` is needed to flip y for TPS. |
| `scale` | object | no | `{ "value": <units per pixel>, "units": "mm", "method": "scale_bar" }`. `method` is `scale_bar`, `calibration` or `manual`. With `scale_bar`, the object also stores the two clicked end points and the known length, so the scale can be checked or re-measured. Absent means uncalibrated; exports are then in pixels. |

**Coordinates.** `position` is `[x, y]` in raw image pixels and is never pre-scaled; calibration is applied only at export.

- The origin is the top-left corner of the image, x points right and y points down.
- Pixel centres are at half-integers: (0.5, 0.5) is the centre of the top-left pixel.
- Sub-pixel values are allowed.

**Anchors.** None. `anchor` and `normal` are omitted in 2D, because the pixel position is already tied to the image.

**Curves.** They work as in 3D, with `path` set to `"polyline"` (straight segments between control points) or `"spline"` (a smooth curve through them). `spacing` and `n_points` are unchanged, and `length` is in pixels.

**Surfaces.** Not used in 2D.

**Export.**

- TPS: y is flipped to point up (`y_tps = height − y`), matching tpsDig. Coordinates stay in pixels, with `IMAGE=` and, when a scale is set, `SCALE=` lines. Missing landmarks are written as `-999 -999`.
- CSV: no `z` column. Coordinates are in units when a scale is set and in pixels otherwise, with a `units` column saying which; the image orientation (y down) is kept.

Example of a 2D file (template shortened):

```json
{
  "format": "landmark-json",
  "version": "0.2.0",
  "specimen": {
    "id": "SKULL_014",
    "image": {
      "file": "SKULL_014_lateral.jpg",
      "sha256": "51ab...07cd",
      "width": 4000,
      "height": 3000,
      "scale": {
        "value": 0.0125, "units": "mm", "method": "scale_bar",
        "bar": { "points": [[310.5, 2810.0], [1110.5, 2810.0]], "length": 10 }
      }
    }
  },
  "template": { "id": "cranium-lateral", "version": "1.0", "dimensions": 2, "landmarks": [ ... ] },
  "landmarks": [
    { "id": "LM01", "template_id": "LM01", "status": "placed", "position": [1834.25, 942.75] },
    { "id": "LM02", "template_id": "LM02", "status": "missing", "position": null }
  ]
}
```

## Replicates (v0.3)

A replicate is the same specimen landmarked again on the same source, to measure how reliably landmarks are placed. Each replicate is its own file. Replicates of a specimen share `specimen.id` and the source (same mesh or image file, same `sha256`), and differ only in `specimen.replicate`.

- `specimen.replicate`: optional whole number, 1 or more. Absent means 1, so every existing file counts as a first replicate.
- Several images or views of one specimen are not replicates: they have different sources (see 2D data). Use replicates only for repeated placement on the same source.
- Because replicates share the source, their coordinates can be compared directly, without alignment.
- File name: `<id>_r<n>.lmk.json` for replicates after the first, e.g. `SKULL_014_r2.lmk.json`.
- Apps should hide earlier replicates while a new one is placed, so each replicate is independent.

Export:

- TPS: when a combined export holds more than one replicate of any specimen, every `ID=` line gets the suffix `_r<n>` (`SKULL_014_r1`, `SKULL_014_r2`), so IDs stay unique and the replicate can be read back. Otherwise `ID=` is the specimen ID alone.
- CSV: separate `specimen_id` and `replicate` columns, ready to use as factors for a measurement-error analysis (e.g. Procrustes ANOVA in geomorph).

## Planes (v0.4)

A plane is a reference for display and checking, such as the midsagittal plane: midline landmarks should lie on it, and left/right pairs should lie at mirror distances from it. Planes are defined in the template from landmarks, so a plane is the same on every specimen and moves when its landmarks move. For now planes are used in 3D only; a 2D app keeps the field when saving but need not use it.

- `template.planes`: optional array, each `{ "id": "PL01", "name": "Midsagittal", "landmarks": ["LM01", "LM03", "LM06"], "description": "..." }`. `description` is optional.
- `id`: a short stable code, unique among all ids in the template (landmarks, curves and planes).
- `landmarks`: ids of at least three template landmarks. With three, the plane passes through them. With more, it is the least-squares best-fit plane: the plane with the smallest sum of squared perpendicular distances to the points, whose normal is the eigenvector of the points' covariance matrix with the smallest eigenvalue.
- The plane is computed from the current positions of its landmarks whenever it is needed. Its position and orientation are never stored, because coordinates are the truth.
- Orientation: the normal points to the side given by the first three landmarks in list order (right-hand rule on `(B − A) × (C − A)`), so signed distances to the plane keep their sign from specimen to specimen.
- On a specimen where fewer than three of a plane's landmarks have positions (missing or not yet placed), or where they lie (nearly) on one line, the plane is undefined there. Apps say so rather than guess.
- Planes add no rows to TPS or CSV exports. Distances of landmarks to a plane are derived values that apps may show; they are not stored.
- Planes from points clicked on the surface, rather than from landmarks, are not part of the format. Apps may offer them for exploring, but don't save them.

A file whose template has planes is written as format version `0.4.0`. Older apps open it with a note about the newer version and keep `planes` when saving, as for any unknown field.

```json
"template": {
  "id": "cranium-basic",
  "version": "1.1",
  "dimensions": 3,
  "landmarks": [ ... ],
  "planes": [
    { "id": "PL01", "name": "Midsagittal", "landmarks": ["LM01", "LM02", "LM06", "LM07"],
      "description": "Best fit through the midline landmarks." }
  ]
}
```

## Conventions

**Status values.** Every landmark, curve and surface carries one:

| Status | Meaning | `position` | TPS export |
| --- | --- | --- | --- |
| `placed` | Placed on the surface by the operator | coordinates | coordinates |
| `estimated` | Placed, but on damaged or reconstructed anatomy | coordinates | coordinates (flag kept in CSV) |
| `missing` | Cannot be placed on this specimen | `null` | `-999 -999 -999` (configurable) |

A template landmark with no entry in the file counts as "not yet done", which the app shows as a to-do; it is different from an explicit `missing`.

**Coordinates.** Always in the source's own coordinate system (mesh coordinates, or raw image pixels in 2D), with no rotation, scaling or alignment applied. Any alignment is done downstream (e.g. Procrustes in R).

**Units.** `specimen.mesh.units` is one of `mm`, `cm`, `m`, `um` or `unknown`. STL and PLY files don't record units, so the operator sets this; the app defaults to `mm`.

**Numbers.** Coordinates are written with up to 6 decimal places. JSON has no NaN, so missing values are always `null`, never a sentinel number inside the JSON.

## Versioning and extensibility

`version` follows MAJOR.MINOR.PATCH:

- **Minor** (0.1 → 0.2): new optional fields or sections, such as `curves`. Older apps can still open the file and must keep fields they don't understand when saving.
- **Major** (1.x → 2.0): a field changes meaning or is removed. Older apps refuse the file with a clear message rather than misreading it.
- **Patch**: wording or documentation fixes only, no structural change.

Lab- or app-specific data goes under `extensions`, keyed by a namespace (e.g. `"extensions": { "mylab": { ... } }`), never as new top-level fields. A JSON Schema file (`landmark-json.schema.json`) should accompany each version, so both apps and students' files can be validated automatically.

## Example (v0.1)

A specimen with three template landmarks: two placed, one missing.

```json
{
  "format": "landmark-json",
  "version": "0.1.0",
  "specimen": {
    "id": "SKULL_014",
    "notes": "Left zygomatic arch broken",
    "mesh": {
      "file": "SKULL_014.ply",
      "sha256": "9f2c...e41a",
      "units": "mm",
      "vertex_count": 248113,
      "face_count": 496222
    }
  },
  "template": {
    "id": "cranium-basic",
    "name": "Cranium, basic set",
    "version": "1.0",
    "landmarks": [
      { "id": "LM01", "name": "Nasion" },
      { "id": "LM02", "name": "Zygion L", "bilateral_pair": "LM03" },
      { "id": "LM03", "name": "Zygion R", "bilateral_pair": "LM02" }
    ],
    "export_order": ["LM01", "LM02", "LM03"]
  },
  "landmarks": [
    {
      "id": "LM01", "template_id": "LM01", "status": "placed",
      "position": [12.4031, -3.2210, 88.9172],
      "anchor": { "face": 182044, "bary": [0.21, 0.47, 0.32] },
      "placed_at": "2026-11-06T15:02:11Z"
    },
    {
      "id": "LM02", "template_id": "LM02", "status": "missing",
      "position": null,
      "note": "Arch broken"
    },
    {
      "id": "LM03", "template_id": "LM03", "status": "placed",
      "position": [-61.0874, 2.5531, 40.1186],
      "anchor": { "face": 90317, "bary": [0.66, 0.10, 0.24] }
    }
  ],
  "provenance": {
    "software": "landmarker",
    "software_version": "0.1.0",
    "operator": "student01",
    "created": "2026-11-06T14:55:00Z",
    "modified": "2026-11-06T15:02:11Z"
  }
}
```

## Decisions

- [x] Decided: the template is embedded by default; referencing a shared template file is optional.
- [x] Decided: landmark ids are short stable codes (`LM01`), with `name` as the human-readable descriptor.
- [x] Decided: extension `.lmk.json`, format name `landmark-json`. No other use of `.lmk.json` was found; bare `.lmk` is used only in unrelated domains.
- [ ] Deferred: a Slicer `.mrk.json` export is not planned for now but may be added later.
- [x] Decided: v0.1 includes all three statuses, `placed`, `estimated` and `missing`.
- [x] Decided: `vertex_count` and `face_count` are raw file counts (for STL, `vertex_count` = 3 × `face_count`).
- [x] Decided: replicates are recorded in an optional `specimen.replicate` field (v0.3), not encoded in the specimen ID. Both apps follow this.
- [x] Decided (2026-11-08): planes (v0.4) are optional template definitions built from landmarks (exact for three, best fit for more). Planes from clicked points are for exploring only and are not saved. The 2D app keeps them when saving but does not use them.
- [x] Decided: semilandmark rows are named `<curve id>_<nn>` in both apps.
