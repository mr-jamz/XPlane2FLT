# XPlane2FLT v1.0.17

## FLIR and aircraft-object selection fix

- Evaluates `ANIM_show` and `ANIM_hide` when the aircraft package provides the corresponding saved value in `opt_config.ini`.
- Excludes inactive mutually exclusive geometry branches from the static FLT export.
- Leaves branches unchanged when their simulator or plugin dataref value is unavailable.
- Shows and export-selects ACF-attached objects by default instead of every OBJ found in the package.
- Keeps unattached helper OBJ files available in the Parts list for manual inspection and selection.
- Keeps same-stem X-Plane weapon OBJ/WPN assets selected by default.
- Preserves v1.0.16 object and rotor hierarchy behavior, geometry accuracy, texture bindings, UVs, and export progress reporting.
