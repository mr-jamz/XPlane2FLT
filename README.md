# XPlane2FLT v1.0.4

A local-first browser application that loads a complete X-Plane 12 aircraft folder or ZIP, reproduces its assembled OBJ8 scene, and exports the resolved aircraft as one OpenFlight 16.0 `.flt` database with its original textures.

## Merged workflow

1. Load an aircraft folder or ZIP.
2. Inspect the complete model using the X-Plane-aware viewer.
3. Toggle OBJ8 objects, saved configuration, LOD, and dataref states.
4. Open the **Export** tab.
5. Build one MCX-compatible FLT or download the FLT with its texture package.

The export stage consumes the same resolved state used by the viewer:

- ACF attachment instances, XYZ positions, and heading/pitch/roll orientation
- `opt_config.ini` defaults and ACF attachment hide datarefs
- Nested OBJ8 animation transforms and show/hide rules
- Current LOD and per-object visibility
- Source vertex positions, normals, UVs, culling, transparency, and material colors
- Diffuse texture bindings plus original lit, normal, gloss, DDS, PNG, JPG, TGA, and BMP support files

Transforms are baked into exported vertices before the OpenFlight coordinate conversion. UV coordinates and source texture bytes are not rewritten.

## OpenFlight compatibility

The writer produces OpenFlight 16.0 big-endian records using the hierarchy verified with ModelConverterX:

- Header record `1`
- Group record `2`
- Object record `4`
- Face record `5`
- Texture palette record `64`
- Vertex palette record `67`
- Vertex-with-normal-and-UV record `70`
- Vertex list record `72`
- Material palette record `113`

Every export is structurally validated before the download buttons are enabled.

## Viewer behavior retained

- Complete, exterior, and cockpit views
- Individual object toggles without scene reload
- Flat/unlit textures by default, with a live lit-mode toggle
- Correct browser-image and DDS texture orientation
- X-Plane normal, gloss, and metalness preview support
- Dataref animation controls
- Frame-aircraft control and incremental loading progress

## Local development

```bash
npm ci
npm run dev
```

## Test and build

```bash
npm test
npm run build
```

The static output is written to `dist/`. The included GitHub Pages workflow runs the tests and production build before deployment.

## Real-aircraft verification

To run the same full-aircraft verification used for the MH-60R Seahawk:

```bash
./node_modules/.bin/vite-node scripts/verify-aircraft.ts /path/to/aircraft.zip
```

The script reports source, attachment, configuration, object, vertex, triangle, texture, FLT-size, package-size, and validation totals.
