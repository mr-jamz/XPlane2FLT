# XPlane2FLT v10.0.0

This release merges the X-Plane 12 Model Viewer v1.0.10 scene pipeline with the MCX-compatible XPlane2FLT OpenFlight writer.

## Conversion pipeline

- Converts all enabled OBJ8 files into one OpenFlight 16.0 `.flt`.
- Bakes ACF attachment position and heading/pitch/roll into exported vertices.
- Bakes the same nested animation and saved-configuration state shown by the viewer.
- Applies ACF attachment hide datarefs and OBJ8 show/hide rules before export.
- Uses the current viewer LOD state.
- Preserves source normals and UV coordinates.
- Preserves OBJ8 material colors, shininess, double-sided state, blending, and alpha-test state.
- Resolves texture extensions and singular/plural filename variants using the same path as the viewer.
- Packages original diffuse, lit, normal, gloss, and material textures without rewriting their bytes.

## OpenFlight compatibility

- OpenFlight 16.0 big-endian output
- ModelConverterX-compatible Header → Group → Object → Face hierarchy
- Face opcode 5
- Texture palette opcode 64
- Vertex palette opcode 67
- Vertex-with-normal-and-UV opcode 70
- Vertex list opcode 72
- Material palette opcode 113
- Pre-download record, hierarchy, palette, and vertex-reference validation

## Viewer functionality retained

- Complete, exterior, and cockpit views
- Instant per-object eye toggles
- Saved `opt_config.ini` state
- Flat/unlit default with live Lit mode
- Correct PNG/JPG/TGA and DDS orientation
- OBJ8 animation/dataref controls
- Live geometry and texture loading progress

## Verification

- 15 automated regression tests pass.
- Production build passes.
- The supplied MH-60R Seahawk package exported with:
  - 383 source files
  - 63 OBJ8 files
  - 52 ACF attachment records
  - 42 saved configuration datarefs
  - 46 configured drawable FLT object instances
  - 1,025,090 triangles
  - 39 resolved original textures
  - 0 OpenFlight validation errors
