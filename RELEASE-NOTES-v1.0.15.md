# XPlane2FLT v1.0.15

- Speeds up conversion by avoiding redundant compression of the temporary in-memory aircraft archive.
- Reuses exact geometry validation keys to reduce repeated work without changing geometry.
- Adds a staged, monotonic export progress bar that completes at 100%.
- Preserves the v1.0.14 rule that every source OBJ remains an independent FLT hierarchy group.
- Does not alter positions, normals, UV coordinates, textures, materials, face order, or coordinate conversion.
