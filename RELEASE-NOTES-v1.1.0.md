# XPlane2FLT v1.1.0

## Saved ACF attachment selection

- Matches each ACF attachment hide dataref in `prefix/kill/name` form to an explicit saved `prefix/conf/name` option.
- Attachments whose matching saved option equals `0` now start disabled in the Parts panel.
- Attachments whose option is enabled, or whose state is controlled only by secured plugin logic, remain selected.
- A user can manually turn any default-disabled part back on before conversion; the Parts selection remains the final export authority.

## Supplied MH-60R result

- `guns.obj` starts disabled because `guns=0`.
- `medevac.obj` starts disabled because `medevac=0`.
- `vip_interior.obj` starts disabled because `vip=0`.
- These three changes prevent 111,057 configured-off source triangles from entering the default export.
- `flircam.obj` and `exterior.obj` remain selected because their saved options equal `1`.
- Plugin-only states such as `exterior1/2/3`, `gears_fh`, and RBF are not guessed.

## README

- Removed local development, local build, browser-support, and separate hosting instructions.
- The README now describes the deployed GitHub Pages tool, its supported X-Plane behavior, intentional limits, and technical references.

## Validation

- 52 automated tests pass.
- TypeScript compilation passes.
- Production Vite build passes.
