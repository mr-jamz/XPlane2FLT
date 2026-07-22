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
    if (opcode === 67) {
      offset += view.getInt32(offset + 4, false);
    } else {
      offset += length;
    }
  }
  return opcodes;
}

describe("OpenFlight writer", () => {
  it("writes a valid big-endian OpenFlight 16.0 hierarchy with textured geometry", () => {
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
    expect(recordOpcodes(bytes)).toEqual(expect.arrayContaining([1, 64, 67, 2, 4, 5, 72]));
  });
});

