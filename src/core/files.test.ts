import { describe, expect, it } from "vitest";
import { defaultVisibleModelPaths, parseOptionDefaults } from "./files";
import type { LoadedAircraft } from "./types";

describe("parseOptionDefaults", () => {
  it("maps saved aircraft options to the plugin configuration namespace", () => {
    expect(parseOptionDefaults(`
exterior=1
esss=0
variant=2
tailnum=24611
`, ["uh60m"])).toEqual({
      "uh60m/conf/exterior": 1,
      "uh60m/conf/esss": 0,
      "uh60m/conf/variant": 2,
      "uh60m/conf/tailnum": 24611,
    });
  });

  it("does not turn saved loadout choices into attachment kill switches", () => {
    const defaults = parseOptionDefaults("seats=0\ninterior=0", ["uh60m"]);
    expect(defaults).toEqual({
      "uh60m/conf/seats": 0,
      "uh60m/conf/interior": 0,
    });
    expect(defaults).not.toHaveProperty("uh60m/kill/seats");
    expect(defaults).not.toHaveProperty("uh60m/kill/interior");
  });
});

describe("defaultVisibleModelPaths", () => {
  it("selects ACF attachments and weapon definitions but not unattached helper OBJs", () => {
    const aircraft = {
      manifest: {
        acfPath: "uh60m.acf",
        name: "UH60",
        warnings: [],
        attachments: [{ index: 0, path: "flircam.obj", role: "exterior", position: [0, 0, 0], rotation: [0, 0, 0] }],
      },
      models: [
        { path: "objects/flircam.obj" },
        { path: "objects/ball.obj" },
        { path: "weapons/AGM-179_JAGM.obj" },
      ],
      files: [
        { path: "weapons/AGM-179_JAGM.wpn" },
      ],
    } as unknown as LoadedAircraft;

    expect([...defaultVisibleModelPaths(aircraft)]).toEqual([
      "objects/flircam.obj",
      "weapons/AGM-179_JAGM.obj",
    ]);
  });

  it("keeps every OBJ selected when no ACF attachment table exists", () => {
    const aircraft = {
      manifest: { name: "OBJ package", warnings: [], attachments: [] },
      models: [{ path: "objects/a.obj" }, { path: "objects/b.obj" }],
      files: [],
    } as unknown as LoadedAircraft;

    expect([...defaultVisibleModelPaths(aircraft)]).toEqual(["objects/a.obj", "objects/b.obj"]);
  });
});
