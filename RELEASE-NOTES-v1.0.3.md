# XPlane2FLT v1.0.3

- Displays the build number in the site header.
- Replaces the landing-page slogan with a direct product description.
- Correctly treats OBJ8 `ANIM_show` and `ANIM_hide` as ordered draw state.
- Stores visibility rules per draw batch instead of hiding an entire animation
  group, restoring interior wall and configuration meshes that occur earlier
  in the same OBJ8 block.
- Applies identical batch visibility during OpenFlight conversion so the FLT
  matches the viewer.
- Retains aircraft-wide two-sided rendering, flat/unlit textures, coordinates,
  UVs, and object toggles.
