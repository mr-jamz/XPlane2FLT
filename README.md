# XPlane2FLT

Version 9.2 rebuild: stationary/material-safe OpenFlight conversion, corrected
ModelConverterX face winding and culling, plus an interactive selected-OBJ8
preview with corrected exterior-facing OBJ8 rendering.

A local-first browser converter for packaging X-Plane 12 OBJ8 aircraft geometry as a binary OpenFlight 16.0 (`.flt`) database with its texture files intact.

## What it does

- Opens an X-Plane aircraft ZIP entirely in the browser—nothing is uploaded.
- Finds `.acf`, OBJ8, texture, and texture attribute assets.
- Parses `VT`, `IDX`/`IDX10`, `TRIS`, texture references, and culling state from OBJ8 files.
- Converts X-Plane Y-up coordinates to OpenFlight Z-up coordinates by default.
- Writes real big-endian OpenFlight 16.0 Face, Vertex Palette, and Vertex List records supported by ModelConverterX 1.8.
- Preserves authored part coordinates, UV coordinates, vertex normals, diffuse texture references, and original texture bytes.
- Offers Original, Balanced, Performance, Aggressive, and custom triangle targets.
- Simplifies every exterior part independently with a configurable per-part minimum.
- Resolves X-Plane's common same-stem PNG/DDS texture substitutions (including singular/plural filename variants).
- Stops conversion when a selected mesh would otherwise be exported without a diffuse texture.
- Protects UV seams, hard edges, and thin components such as rotor blades, landing gear, probes, and antennas.
- Optionally welds duplicate vertices, removes degenerate/duplicate faces, and downsizes PNG/JPEG textures.
- Shows original-versus-optimized triangle and estimated FLT sizes before conversion.
- Renders the currently selected OBJ8 files in an interactive, texture-aware 3D preview before conversion.
- Lets you orbit, zoom, pan, frame the selected package, inspect a clicked part, and remove it from the package directly from the viewport.
- Renders every selected drawable source triangle so the preview never creates
  artificial holes by omitting fuselage faces.
- Interprets per-command draw, blend, alpha-cutoff, and culling state.
- Validates the generated record stream before enabling download.
- Exports a texture-complete ZIP containing the `.flt`, textures, and a JSON conversion report.

## Current conversion scope

The converter handles static OBJ8 triangle geometry. Selected exterior OBJ8 files are combined at their authored coordinates, and simplification only reuses source vertex positions so optimization cannot recenter or translate a part. X-Plane dataref animations, nonzero ACF attachment transforms, LOD switching, manipulators, normal-map shading, and lit-texture behavior are reported but not recreated as OpenFlight behavior. Lit and normal texture files are still preserved in the output package when referenced.

OpenFlight stores texture paths rather than embedding image data in the `.flt`, so the exported ZIP is the complete deliverable. Keep its `.flt` and `textures/` directory together. The exporter uses a preallocated binary buffer to keep large face-based conversions within practical browser memory limits.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, then select an aircraft ZIP.

## Deploy to GitHub Pages

This repository includes a GitHub Actions workflow that builds and deploys the app automatically.

For this preview release, see [DEPLOYMENT.md](DEPLOYMENT.md). It includes the
recommended `preview-v9-obj8-render` branch flow and rollback instructions.

1. Upload this project to the `main` branch of your GitHub repository.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab and wait for **Deploy XPlane2FLT to GitHub Pages** to finish.

For `mr-jamz/XPlane2FLT`, the resulting URL will be:

`https://mr-jamz.github.io/XPlane2FLT/`

Every later push to `main` redeploys the site. The converter is fully static and performs conversion in the visitor's browser, so it does not require a server, API key, or environment variables.

## Verify the project

```bash
npm test
npm run build
```

To check a generated file against the exact MCX 1.8 reader signatures and hierarchy rules:

```bash
node scripts/verify-mcx-compat.mjs /path/to/ModelConverterX.zip /path/to/model.flt
```

## Architecture

- `src/core/obj8.ts` — X-Plane OBJ8 parser
- `src/core/openflight.ts` — OpenFlight 16.0 binary writer and validator
- `src/core/optimizer.ts` — per-part geometry cleanup, allocation, and shape-aware simplification
- `src/core/texture.ts` — optional browser-side PNG/JPEG downscaling
- `src/core/archive.ts` — ZIP inspection, texture resolution, conversion, and packaging
- `src/App.tsx` — browser workflow and diagnostics UI
- `tests/` — parser, binary writer, and end-to-end archive tests

The OpenFlight writer follows the [OGC OpenFlight Scene Description Database Specification 16.0](https://docs.ogc.org/cs/19-065/19-065.pdf).

## License

MIT
Version 9 uses stationary, source-triangle simplification. It never creates
replacement coordinates or reconnects vertices across parts. OBJ8 position,
normal, UV, diffuse texture, culling, shininess, emissive color, and alpha state
are carried into ModelConverterX-compatible OpenFlight Face, Vertex Palette,
Vertex List, Texture Palette, and Material Palette records. Conversion is
blocked if any optimized face cannot be proven to be an intact source triangle.
The OBJ8 viewport is an independent read-only visualization path: changing the
camera interaction never mutates the geometry supplied to the converter.
