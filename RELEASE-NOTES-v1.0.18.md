# XPlane2FLT v1.0.18

## X-Plane configuration pose baking

- Reads saved aircraft options from `opt_config.ini` and maps them to the aircraft's configuration datarefs.
- Evaluates configured `ANIM_show` and `ANIM_hide` branches before FLT export.
- Bakes deterministic two-key and multi-key `ANIM_trans` / `ANIM_rotate` transforms into exported vertices.
- Applies Plane Maker ACF object attachment position and orientation to the exported geometry.
- Supports multiple ACF instances of the same OBJ without merging their placements.
- Leaves unavailable simulator-driven motion in the authored neutral pose instead of guessing plugin state.
- Records baked transforms, skipped live transforms, attachment indices, and visibility exclusions in `conversion-report.json`.

## MH-60R verification

- Loaded all 29 saved `uh60m/conf/*` values from the supplied aircraft.
- Selected the configured FLIR/exterior branch: 9,521 source triangles retained and 10,019 inactive triangles excluded before geometry cleanup.
- Baked the FLIR OBJ's deterministic pivot transforms and associated it with ACF attachment 23.
- Confirmed that the generated OpenFlight records validate without errors.

## Validation

- 49 automated tests pass.
- TypeScript compilation passes.
- Production Vite build passes.

Copy the included files over the existing repository, preserving their paths, then run `npm install`, `npm test`, and `npm run build`.
