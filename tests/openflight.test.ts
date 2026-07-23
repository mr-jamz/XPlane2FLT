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
  it("writes valid compact OpenFlight mesh records with textured geometry", () => {
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
    expect(opcodes).toEqual(expect.arrayContaining([1, 64, 2, 84, 85, 86]));
    expect(opcodes).not.toContain(5);
    expect(opcodes).not.toContain(67);
    expect(opcodes).not.toContain(72);
  });

  it("splits geometry into legal local vertex pools", () => {
    const lines = ["I", "800", "OBJ"];
    for (let index = 0; index < 4500; index += 1) lines.push(`VT ${index % 17} ${Math.floor(index / 17)} 0 0 1 0 0 0`);
    for (let index = 0; index < 4500; index += 10) lines.push(`IDX10 ${index} ${index + 1} ${index + 2} ${index + 3} ${index + 4} ${index + 5} ${index + 6} ${index + 7} ${index + 8} ${index + 9}`);
    lines.push("TRIS 0 4500");
    const bytes = buildOpenFlight({ models: [parseObj8("large.obj", lines.join("\n"))], textures: [], coordinateMode: "keep-xplane" });
    const opcodes = recordOpcodes(bytes);
    expect(opcodes.filter((opcode) => opcode === 84).length).toBeGreaterThan(1);
    expect(opcodes.filter((opcode) => opcode === 84).length).toBe(opcodes.filter((opcode) => opcode === 85).length);
    expect(opcodes.filter((opcode) => opcode === 84).length).toBe(opcodes.filter((opcode) => opcode === 86).length);
    expect(validateOpenFlight(bytes)).toEqual([]);
  });
});
