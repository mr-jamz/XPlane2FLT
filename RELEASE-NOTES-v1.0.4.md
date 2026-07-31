# XPlane2FLT v1.0.4

- Preserves every OBJ8 `ANIM_hide` and `ANIM_show` command in source order,
  including repeated commands that reference the same dataref.
- Replays X-Plane's draw-suspension state for each triangle batch and light,
  restoring cabin geometry that was incorrectly filtered by rule merging.
- Supports constant show/hide commands whose exporter omits the `none` dataref.
- Uses the identical ordered visibility evaluation in the viewer and FLT export.
- Retains two-sided aircraft surfaces, flat/unlit default rendering, corrected
  coordinates and UVs, texture resolution, object toggles, and saved aircraft
  configuration.
- Updates the website build label, package metadata, README, and release notes
  to v1.0.4.
