# XPlane2FLT v9 — Selected OBJ8 3D Preview

This release is based on the verified v8 stationary/material-safe converter and
preserves its OpenFlight and ModelConverterX compatibility path.

## Corrected in the rebuilt v9

- Reverses triangle winding exactly once when converting OBJ8 coordinates to
  OpenFlight Z-up coordinates, so exterior faces remain visible in
  ModelConverterX.
- Transforms vertex normals with the same coordinate conversion without
  changing source positions, UVs, or material relationships.
- Preserves `ATTR_no_cull` and `ATTR_cull` per draw batch instead of making the
  entire aircraft artificially double-sided.
- Adds record-level regression tests for converted winding, transformed normals,
  source-index immutability, and OpenFlight two-sided draw state.

## Added

- Interactive 3D rendering of the currently selected OBJ8 files.
- Source-coordinate assembly view before conversion.
- Resolved PNG, JPEG, BMP, DDS, and TGA diffuse textures in the preview.
- Orbit, zoom, pan, and frame-selection camera controls.
- Clicked-part identification and removal from the final package.
- Adaptive display-only triangle sampling above 350,000 selected triangles.
- A preview sampling test that guarantees every selected non-empty object stays
  represented when display sampling is required.

## Preserved from v8

- Complete-source-triangle simplification without replacement coordinates.
- Per-OBJ index maps and stationary bounds validation.
- Full position, normal, UV, material, culling, alpha, emissive, and shininess
  preservation.
- Exact full-attribute welding only.
- ModelConverterX-compatible Face, Vertex Palette, Vertex List, Texture Palette,
  and Material Palette records.
- Exterior-only suggestions, editable object selection, geometry presets,
  texture resolution/downscaling, preflight diagnostics, and package reports.
- Browser-only processing and GitHub Pages deployment.

The 3D preview never feeds modified data back into conversion. Camera state,
texture decoding, and preview-only triangle sampling are isolated from the
stationary/material-safe export pipeline.
