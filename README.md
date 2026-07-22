# XPlane2FLT

A local-first browser converter for packaging X-Plane 12 OBJ8 aircraft geometry as a binary OpenFlight 16.0 (`.flt`) database with its texture files intact.
Access it [HERE](https://mr-jamz.github.io/XPlane2FLT/)

## What it does

- Opens an X-Plane aircraft ZIP entirely in the browser—nothing is uploaded.
- Finds `.acf`, OBJ8, texture, and texture attribute assets.
- Parses `VT`, `IDX`/`IDX10`, `TRIS`, texture references, and culling state from OBJ8 files.
- Converts X-Plane Y-up coordinates to OpenFlight Z-up coordinates by default.
- Writes real big-endian OpenFlight 16.0 header, palette, hierarchy, face, and vertex records.
- Preserves UV coordinates, vertex normals, diffuse texture references, and original texture bytes.
- Validates the generated record stream before enabling download.
- Exports a texture-complete ZIP containing the `.flt`, textures, and a JSON conversion report.

## Current conversion scope

The current milestone converts static OBJ8 triangle geometry. All discovered OBJ8 files are combined at their authored coordinates. X-Plane dataref animations, ACF attachment transforms, LOD switching, manipulators, normal-map shading, and lit-texture behavior are reported but not yet recreated as OpenFlight behavior. Lit and normal texture files are still preserved in the output package when referenced.

OpenFlight stores texture paths rather than embedding image data in the `.flt`, so the exported ZIP is the complete deliverable. Keep its `.flt` and `textures/` directory together.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, then select an aircraft ZIP.

## Deploy to GitHub Pages

This repository includes a GitHub Actions workflow that builds and deploys the app automatically.

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

## Architecture

- `src/core/obj8.ts` — X-Plane OBJ8 parser
- `src/core/openflight.ts` — OpenFlight 16.0 binary writer and validator
- `src/core/archive.ts` — ZIP inspection, texture resolution, conversion, and packaging
- `src/App.tsx` — browser workflow and diagnostics UI
- `tests/` — parser, binary writer, and end-to-end archive tests

The OpenFlight writer follows the [OGC OpenFlight Scene Description Database Specification 16.0](https://docs.ogc.org/cs/19-065/19-065.pdf).

## License

MIT
