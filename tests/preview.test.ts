import { describe, expect, it } from "vitest";
import { previewTriangleIndices, selectTriangleIndices } from "../src/Obj8Preview";
import type { Obj8Model } from "../src/core/types";

function model(path: string, triangleCount: number): Obj8Model {
  return {
    path,
    name: path,
    vertices: [
      { position: [0, 0, 0], normal: [0, 1, 0], uv: [0, 0] },
      { position: [1, 0, 0], normal: [0, 1, 0], uv: [1, 0] },
      { position: [0, 0, 1], normal: [0, 1, 0], uv: [0, 1] },
    ],
    triangles: Array.from({ length: triangleCount }, () => ({
      indices: [0, 1, 2] as [number, number, number],
      doubleSided: false,
      drawEnabled: true,
    })),
    diagnostics: [],
  };
}

describe("OBJ8 preview geometry", () => {
  it("converts OBJ8 winding for Three.js without mutating source indices", () => {
    const source: [number, number, number] = [4, 7, 9];
    expect(previewTriangleIndices(source)).toEqual([4, 9, 7]);
    expect(source).toEqual([4, 7, 9]);
  });

  it("shows every source triangle when the selection is within budget", () => {
    const models = [model("body.obj", 12), model("rotor.obj", 6)];
    const selected = selectTriangleIndices(models);
    expect(selected.get("body.obj")).toHaveLength(12);
    expect(selected.get("rotor.obj")).toHaveLength(6);
  });

  it("renders every drawable triangle in a very large selection without making holes", () => {
    const models = [model("body.obj", 500_000), model("rotor.obj", 10), model("gear.obj", 25)];
    const selected = selectTriangleIndices(models);
    expect(selected.get("body.obj")).toHaveLength(500_000);
    expect(selected.get("rotor.obj")).toHaveLength(10);
    expect(selected.get("gear.obj")).toHaveLength(25);
  });
});
