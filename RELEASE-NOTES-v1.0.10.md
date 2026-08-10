# XPlane2FLT v1.0.10

- Restores the helicopter's interior-wall and seat surfaces by preventing exterior fuselage backfaces from covering the cabin.
- Decodes Plane Maker interior and cockpit attachment flags, including generically named meshes such as `seats.obj` and `pax.obj`.
- Keeps interior/cockpit preview materials two-sided while respecting authored culling for exterior and glass objects.
- Retains the v1.0.9 DDS texture-orientation and resilient texture-resolution corrections.
- Does not modify FLT export geometry, UV coordinates, or source textures.
