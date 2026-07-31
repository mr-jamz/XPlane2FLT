# XPlane2FLT v10.0.2

## Interior shell visibility

- Makes every loaded aircraft face two-sided in both Flat and Lit preview
  modes, including fuselage, doors, exterior, cockpit, interior and glass
  attachments.
- Fixes missing cabin walls where the visible inside surface is the reverse
  side of an exterior or mixed-purpose OBJ8 attachment.
- Writes the identical two-sided face state into the generated OpenFlight FLT,
  so the correction survives conversion.
- Does not duplicate triangles or alter vertex positions, winding, UVs,
  normals, animation matrices, material colors or texture bindings.
- Preserves object visibility toggles, saved aircraft configuration and the
  default Flat / Unlit inspection mode.

## Validation

- Adds regression coverage for an exterior fuselage shell viewed from inside.
- Full automated test suite and production build pass.
