# XPlane2FLT v10.0.1

This maintenance release fixes thin cockpit and cabin surfaces disappearing
when the camera moves inside an aircraft.

## Interior rendering and export

- Preserves the existing OBJ8 clockwise-to-Three.js winding correction.
- Classifies numbered cockpit attachments such as `cockpit1.obj` correctly.
- Renders cockpit and interior attachments as two-sided in both Flat and Lit modes.
- Keeps exterior, glass, UV, texture-orientation, coordinate, animation, LOD,
  and per-object visibility behavior unchanged.
- Writes the same cockpit/interior fallback as two-sided OpenFlight faces, so
  converted `.flt` files retain visible cabin surfaces in ModelConverterX and
  other OpenFlight consumers.
- Still honors explicit OBJ8 `ATTR_no_cull` and `ATTR_cull` material state.

## Verification

- Automated tests cover Seahawk-style `cockpit1.obj` and `interior2.obj`
  attachment classification.
- Automated export coverage verifies that an interior triangle is emitted as
  a two-sided OpenFlight face.
