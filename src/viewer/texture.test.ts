import { describe, expect, it } from "vitest";
import { findTextureFile } from "./texture";

describe("OBJ8 texture resolution", () => {
  it("preserves the viewer's extension fallback and supports singular/plural package variants", () => {
    const pilots = new File([new Uint8Array([1])], "pilots.dds");
    const normal = new File([new Uint8Array([2])], "pilots_normal.png");
    const files = new Map<string, File>([
      ["objects/pilots.dds", pilots],
      ["objects/pilots_normal.png", normal],
    ]);

    expect(findTextureFile(files, "objects/hook.obj", "pilot.png")).toEqual({
      path: "objects/pilots.dds",
      file: pilots,
    });
    expect(findTextureFile(files, "objects/hook.obj", "pilot_normal.png")).toEqual({
      path: "objects/pilots_normal.png",
      file: normal,
    });
  });
});
