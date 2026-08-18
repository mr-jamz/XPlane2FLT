# XPlane2FLT v1.0.19

## MCX detached-assembly correction

- Missing OBJ8 visibility datarefs now use X-Plane's neutral numeric value of zero.
- Aircraft configuration datarefs referenced by OBJ8 but absent from `opt_config.ini` are discovered and initialized to zero.
- Live movement datarefs remain unbaked when their actual value is unavailable, preventing guessed door, rotor, or control motion.
- `conversion-report.json` lists every inferred configuration default.

## Supplied MH-60R result

- Removed the detached `refuel_basket.obj` drogue shown in MCX.
- Removed the extended hose/cable geometry from `ramp.obj`.
- Removed the extended rescue-rope geometry from `rope_mount.obj`.
- Suppressed inactive RBF rope branches while retaining valid RBF geometry located on the aircraft.
- Preserved the configured FLIR branch: 9,521 source triangles retained and 10,019 inactive triangles excluded.
- No conversion or OpenFlight validation errors were found.

## Validation

- 50 automated tests pass.
- TypeScript compilation passes.
- Production Vite build passes.

Copy the included files over the existing repository, preserving their paths, then run `npm install`, `npm test`, and `npm run build`.
