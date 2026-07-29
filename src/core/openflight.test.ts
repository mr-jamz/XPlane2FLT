import { describe, expect, it } from "vitest";
import { buildOpenFlight, validateOpenFlight } from "./openflight";
import type { FltMaterial, FltModel } from "./types";

const material: FltMaterial = {
  diffuse: [1, 1, 1],
  emissive: [0, 0, 0],
  shininess: 0,
  alpha: 1,
  blended: false,
};

function model(path: string, offset = 0): FltModel {
  return {
    path,
    name: path,
    vertices: [
      { position: [offset, 0, 0], normal: [0, 1, 0], uv: [0, 0] },
      { position: [offset + 1, 0, 0], normal: [0, 1, 0], uv: [1, 0] },
      { position: [offset, 1, 0], normal: [0, 1, 0], uv: [0, 1] },
    ],
    triangles: [{ indices: [0, 1, 2], doubleSided: false, material }],
  };
}

function opcodeCount(bytes: Uint8Array, wanted: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let count = 0;
  while (offset + 4 <= bytes.byteLength) {
    const opcode = view.getUint16(offset, false);
    const length = view.getUint16(offset + 2, false);
    if (opcode === wanted) count += 1;
    if (opcode === 67) {
      offset += view.getInt32(offset + 4, false);
      continue;
    }
    offset += length;
  }
  return count;
}

describe("OpenFlight writer", () => {
  it("combines multiple OBJ instances under one MCX-compatible aircraft hierarchy", () => {
    const bytes = buildOpenFlight({
      models: [model("fuselage.obj"), model("rotors.obj", 10)],
      textures: [],
      coordinateMode: "openflight-z-up",
      databaseId: "MERGED",
    });

    expect(validateOpenFlight(bytes)).toEqual([]);
    expect(opcodeCount(bytes, 2)).toBe(1);
    expect(opcodeCount(bytes, 4)).toBe(2);
    expect(opcodeCount(bytes, 5)).toBe(2);
    expect(opcodeCount(bytes, 72)).toBe(2);
  });

  it("writes X-Plane positions as OpenFlight Z-up without changing UVs", () => {
    const bytes = buildOpenFlight({
      models: [model("body.obj")],
      textures: [],
      coordinateMode: "openflight-z-up",
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let palette = 0;
    while (view.getUint16(palette, false) !== 67) palette += view.getUint16(palette + 2, false);
    const firstVertex = palette + 8;
    expect(view.getFloat64(firstVertex + 8, false)).toBeCloseTo(0);
    expect(view.getFloat64(firstVertex + 16, false)).toBeCloseTo(0);
    expect(view.getFloat64(firstVertex + 24, false)).toBeCloseTo(0);
    expect(view.getFloat32(firstVertex + 44, false)).toBeCloseTo(0);
    expect(view.getFloat32(firstVertex + 48, false)).toBeCloseTo(0);
  });
});
