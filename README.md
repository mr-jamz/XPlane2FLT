# XPlane2FLT

A GitHub Pages tool for inspecting complete X-Plane aircraft ZIPs and exporting ModelConverterX-compatible OpenFlight packages. Aircraft files are processed privately in the browser and are never uploaded.

## What this viewer reproduces

- Native X-Plane coordinates: +Y up, +X east/right, +Z south/aft.
- Clockwise OBJ8 front faces converted at the Three.js rendering boundary.
- ACF attachment discovery, attachment order, common position/rotation records, and interior/exterior/glass roles.
- Command-scoped `TRIS` state: culling, blending/alpha test, depth, material colors, shininess, cockpit tagging, and LOD ranges.
- Day albedo, `_LIT` emissive textures, legacy normal/specular textures, X-Plane 12 `TEXTURE_MAP` textures, and `NORMAL_METALNESS`.
- Nested two-key and multi-key `ANIM_rotate` / `ANIM_trans`, plus `ANIM_show` / `ANIM_hide`.
- OpenFlight export baking for saved `opt_config.ini` values, zero-initialized aircraft configuration datarefs, deterministic OBJ8 transforms, and Plane Maker ACF attachment placement.
- Named, parameterized, and custom light locations.
- Exterior, cockpit, and complete-aircraft views.

## Intentional limits

This is a file renderer, not X-Plane itself. It cannot execute aircraft plugins, SASL/FlyWithLua code, custom datarefs, FMOD, particle systems, rain/ice shaders, live Garmin/panel render targets, X-Plane's private `lights.txt` shader implementation, or Plane Maker's legacy built-in fuselage/wing geometry. The viewer can reproduce saved configuration datarefs from `opt_config.ini`; the FLT converter bakes those values, constant OBJ8 pivots, and ACF attachment transforms while leaving unavailable live simulator motion neutral. The dataref panel lets you manually preview other authored OBJ8 animation states.

## Technical reference

The implementation follows Laminar Research's official [OBJ8 file format specification](https://developer.x-plane.com/article/obj8-file-format-specification/) and [attached object properties](https://developer.x-plane.com/article/attached-object-properties-in-plane-maker/).
