# XPlane2FLT v1.0.6

This release rebuilds XPlane2FLT on the current XPlane 12 Model Viewer foundation.

## Viewer baseline retained

- Complete folder and ZIP loading
- ACF attachment placement and role filtering
- Stateful OBJ8 draw batches, textures, materials, LODs, lights, and animations
- Complete, Exterior, and Cockpit views
- Flat/unlit mode, lit mode, wireframe, LOD distance, and dataref controls
- Object visibility toggles and click selection

## Added in v1.0.6

- ModelConverterX-compatible OpenFlight 16.0 conversion
- Export selection driven by the viewer's visible-object toggles
- Original, balanced, performance, and aggressive geometry presets
- Downloadable FLT-only file or FLT-and-textures ZIP package
- Translucent selected-object highlight
- Red, orange, yellow, green, blue, purple, and white highlight palette
- Persisted highlight color
- Visible v1.0.6 build label

## Architecture

The viewer and converter parsers intentionally remain separate. This prevents the
incompatible path helpers and OBJ8 intermediate types from overwriting one another.
Highlight rendering is preview-only and never changes exported geometry, UVs,
materials, textures, or OpenFlight output.

## Validation

- 28 automated tests
- TypeScript production compilation
- Vite production build
- GitHub Pages workflow uses a single Pages artifact and non-cancelling concurrency
