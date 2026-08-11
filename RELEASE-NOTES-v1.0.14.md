# XPlane2FLT v1.0.14

## OBJ8 hierarchy preservation

- Preserves `ANIM_begin` / `ANIM_end` scopes as separate OpenFlight groups.
- Keeps static and animated triangles in independent FLT objects.
- Detects main-rotor and tail-rotor rotation scopes and labels them `MAINROTR` and `TAILROTR` in the FLT hierarchy.
- Prevents geometry cleanup from deduplicating faces across animation boundaries.
- Preserves source vertex positions, normals, UV coordinates, materials, and texture bindings.
- Records hierarchy names, parent relationships, datarefs, and triangle counts in `conversion-report.json`.

X-Plane keyframe animation is still exported in its authored base pose. The hierarchy is retained so animations can be assigned independently in ModelConverterX.
