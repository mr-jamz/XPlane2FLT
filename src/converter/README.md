This directory intentionally contains the isolated XPlane2FLT conversion engine.

It must not import from `src/core`: the viewer and converter use different OBJ8
intermediate models and keeping that boundary prevents parser API collisions.
