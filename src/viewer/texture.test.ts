import { describe, expect, it } from "vitest";
import { findTextureFile } from "./texture";

function mockFile(name: string): File {
  return { name } as File;
}

describe("findTextureFile", () => {
  it("resolves a normal OBJ-relative texture", () => {
    const file = mockFile("pilot.png");
    const files = new Map([["objects/pilot.png", file]]);
    expect(findTextureFile(files, "objects/pilot.obj", "pilot.png")?.file).toBe(file);
  });

  it("recovers a uniquely named texture stored under a different package root", () => {
    const file = mockFile("interior.png");
    const files = new Map([["aircraft/textures/interior.png", file]]);
    expect(findTextureFile(files, "objects/cabin.obj", "interior.png")?.file).toBe(file);
  });

  it("does not guess when multiple textures share the same name", () => {
    const files = new Map([
      ["liveries/a/pilot.png", mockFile("pilot.png")],
      ["liveries/b/pilot.png", mockFile("pilot.png")],
    ]);
    expect(findTextureFile(files, "objects/pilot.obj", "pilot.png")).toBeNull();
  });
});
