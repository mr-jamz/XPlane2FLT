# X-Plane 12 Model Viewer

A static, local-first GitHub Pages app for inspecting complete X-Plane aircraft folders. Drop an aircraft folder or ZIP into the browser to view its OBJ8 objects together, toggle individual parts, inspect textures and render state, and drive dataref animations.

## What this viewer reproduces

- Native X-Plane coordinates: +Y up, +X east/right, +Z south/aft.
- Clockwise OBJ8 front faces converted at the Three.js rendering boundary.
- ACF attachment discovery, attachment order, common position/rotation records, and interior/exterior/glass roles.
- Command-scoped `TRIS` state: culling, blending/alpha test, depth, material colors, shininess, cockpit tagging, and LOD ranges.
- Day albedo, `_LIT` emissive textures, legacy normal/specular textures, X-Plane 12 `TEXTURE_MAP` textures, and `NORMAL_METALNESS`.
- Nested two-key and multi-key `ANIM_rotate` / `ANIM_trans`, plus `ANIM_show` / `ANIM_hide`.
- Named, parameterized, and custom light locations.
- Exterior, cockpit, and complete-aircraft views.

## Intentional limits

This is a file renderer, not X-Plane itself. It cannot execute aircraft plugins, SASL/FlyWithLua code, custom datarefs, FMOD, particle systems, rain/ice shaders, live Garmin/panel render targets, X-Plane's private `lights.txt` shader implementation, or Plane Maker's legacy built-in fuselage/wing geometry. The dataref panel lets you manually preview authored OBJ8 animation states. Compatibility notes inside the viewer call out files that need simulator-only behavior.

## Run locally

```bash
npm install
npm run dev
```

The app runs entirely in the browser. Aircraft files are never uploaded.

## Test and build

```bash
npm test
npm run build
```

The static output is written to `dist/`.

## Publish as a separate GitHub Page

1. Create a new GitHub repository and add these files.
2. Push the project to the repository's `main` branch.
3. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
4. The included `Deploy GitHub Pages` workflow builds and publishes the page.

`vite.config.ts` uses a relative asset base, so this works for both `username.github.io` and project pages such as `username.github.io/xplane12-model-viewer/`.

## Browser support

Use a current Chromium, Firefox, or Safari browser with WebGL 2. Folder drag-and-drop is most reliable in Chromium browsers; the **Choose aircraft folder** and **Open ZIP** actions are available as fallbacks.

## Technical reference

The implementation follows Laminar Research's official [OBJ8 file format specification](https://developer.x-plane.com/article/obj8-file-format-specification/) and [attached object properties](https://developer.x-plane.com/article/attached-object-properties-in-plane-maker/).
