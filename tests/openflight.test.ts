import { describe, expect, it } from "vitest";
import { buildOpenFlight, validateOpenFlight } from "../src/core/openflight";
import { parseObj8 } from "../src/core/obj8";

function recordOpcodes(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const opcodes: number[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.byteLength) {
    const opcode = view.getUint16(offset, false);
    const length = view.getUint16(offset + 2, false);
    opcodes.push(opcode);
    offset += length;
  }
  return opcodes;
}

describe("OpenFlight writer", () => {
  it("writes ModelConverterX-compatible face records with textured geometry", () => {
    const model = parseObj8(
      "objects/body.obj",
      `I\n800\nOBJ\nTEXTURE body.png\nVT 0 0 0 0 1 0 0 0\nVT 1 0 0 0 1 0 1 0\nVT 0 1 0 0 1 0 0 1\nIDX 0 1 2\nTRIS 0 3`,
    );
    model.texturePath = "objects/body.png";
    const bytes = buildOpenFlight({
      models: [model],
      textures: [{ sourcePath: "objects/body.png", outputPath: "textures/body.png", index: 0 }],
      coordinateMode: "openflight-z-up",
      databaseId: "TEST",
    });

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(0, false)).toBe(1);
    expect(view.getUint16(2, false)).toBe(324);
    expect(view.getInt32(12, false)).toBe(1600);
    expect(validateOpenFlight(bytes)).toEqual([]);
    const opcodes = recordOpcodes(bytes);
    expect(opcodes).toEqual(expect.arrayContaining([1, 64, 67, 2, 4, 5, 70, 72]));
    expect(opcodes).toContain(113);
    expect(opcodes).not.toContain(84);
    expect(opcodes).not.toContain(85);
    expect(opcodes).not.toContain(86);
    expect(opcodes.indexOf(10)).toBeLessThan(opcodes.indexOf(2));
    expect(opcodes.filter((opcode) => opcode === 10)).toHaveLength(4);
    expect(opcodes.filter((opcode) => opcode === 11)).toHaveLength(4);
  });

  it("writes a white texture-modulating material and preserves X-Plane surface state", () => {
    const model = parseObj8(
      "objects/body.obj",
      `I\n800\nOBJ\nTEXTURE body.png\nATTR_diffuse_rgb 1 1 1\nATTR_shiny_rat 0.5\nATTR_no_cull\nVT 0 0 0 0 1 0 0 0\nVT 1 0 0 0 1 0 1 0\nVT 0 1 0 0 1 0 0 1\nIDX 0 1 2\nTRIS 0 3`,
    );
    model.texturePath = "objects/body.png";
    const bytes = buildOpenFlight({
      models: [model],
      textures: [{ sourcePath: "objects/body.png", outputPath: "textures/body.png", index: 0 }],
      coordinateMode: "keep-xplane",
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    let materialOffset = -1;
    let faceOffset = -1;
    while (offset < bytes.byteLength) {
      const opcode = view.getUint16(offset, false);
      if (opcode === 113) materialOffset = offset;
      if (opcode === 5) faceOffset = offset;
      const length = view.getUint16(offset + 2, false);
      offset += opcode === 67 ? view.getInt32(offset + 4, false) : length;
    }
    expect(materialOffset).toBeGreaterThan(0);
    expect(view.getFloat32(materialOffset + 72, false)).toBeCloseTo(64);
    expect(view.getInt8(faceOffset + 18)).toBe(1);
    expect(view.getInt16(faceOffset + 30, false)).toBe(0);
    expect(view.getInt16(faceOffset + 28, false)).toBe(0);
    expect(view.getUint32(faceOffset + 56, false)).toBe(0xffffffff);
  });

  it("writes large geometry through a single valid vertex palette", () => {
    const lines = ["I", "800", "OBJ"];
    for (let index = 0; index < 4500; index += 1) lines.push(`VT ${index % 17} ${Math.floor(index / 17)} 0 0 1 0 0 0`);
    for (let index = 0; index < 4500; index += 10) lines.push(`IDX10 ${index} ${index + 1} ${index + 2} ${index + 3} ${index + 4} ${index + 5} ${index + 6} ${index + 7} ${index + 8} ${index + 9}`);
    lines.push("TRIS 0 4500");
    const bytes = buildOpenFlight({ models: [parseObj8("large.obj", lines.join("\n"))], textures: [], coordinateMode: "keep-xplane" });
    const opcodes = recordOpcodes(bytes);
    expect(opcodes.filter((opcode) => opcode === 67)).toHaveLength(1);
    expect(opcodes.filter((opcode) => opcode === 5)).toHaveLength(1500);
    expect(opcodes.filter((opcode) => opcode === 72)).toHaveLength(1500);
    expect(validateOpenFlight(bytes)).toEqual([]);
  });

  it("rejects the balanced but parentless hierarchy that makes ModelConverterX report Stack empty", () => {
    const model = parseObj8(
      "body.obj",
      `I\n800\nOBJ\nVT 0 0 0 0 1 0 0 0\nVT 1 0 0 0 1 0 1 0\nVT 0 1 0 0 1 0 0 1\nIDX 0 1 2\nTRIS 0 3`,
    );
    const bytes = buildOpenFlight({ models: [model], textures: [], coordinateMode: "keep-xplane" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let groupOffset = 0;
    while (view.getUint16(groupOffset, false) !== 2) groupOffset += view.getUint16(groupOffset + 2, false);
    const withoutHeaderLevel = new Uint8Array(bytes.byteLength - 8);
    withoutHeaderLevel.set(bytes.subarray(0, groupOffset - 4));
    withoutHeaderLevel.set(bytes.subarray(groupOffset, bytes.byteLength - 4), groupOffset - 4);
    expect(validateOpenFlight(withoutHeaderLevel)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FLT_MISSING_HEADER_LEVEL", severity: "error" }),
    ]));
  });
});
