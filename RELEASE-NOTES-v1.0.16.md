# XPlane2FLT v1.0.16

## Internal OBJ8 hierarchy preservation

- Keeps every source OBJ as its own OpenFlight group, as in v1.0.15.
- Preserves each top-level `ANIM_begin` / `ANIM_end` branch as an independent child node inside that source group.
- Identifies main- and tail-rotor branches as `MAINROTR` and `TAILROTR` when their X-Plane datarefs distinguish rotor 1 from rotor 2.
- Keeps nested blade and control animations inside their owning top-level rotor branch instead of producing hundreds of small hierarchy nodes.
- Prevents duplicate-face cleanup from merging geometry across part boundaries.
- Retains at least one authored triangle from every hierarchy part during reduced-detail optimization.
- Records hierarchy part names, triangle counts, and source datarefs in `conversion-report.json`.

## Compatibility

- Static OBJ files retain the v1.0.15 hierarchy shape.
- Geometry positions, normals, UVs, material state, texture bindings, and base-pose winding are unchanged.
- The v1.0.15 lossless speed improvements and staged progress bar remain in place.
