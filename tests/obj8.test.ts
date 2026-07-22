import { describe, expect, it } from "vitest";
import { parseObj8 } from "../src/core/obj8";

const SAMPLE_OBJ = `I
800
OBJ
TEXTURE fuselage.png
TEXTURE_LIT fuselage_LIT.png
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
IDX10 0 1 2
ATTR_no_cull
TRIS 0 3
`;

describe("parseObj8", () => {
  it("parses OBJ8 vertices, indices, texture references, and draw state", () => {
    const model = parseObj8("objects/fuselage.obj", SAMPLE_OBJ);

    expect(model.texturePath).toBe("fuselage.png");
    expect(model.litTexturePath).toBe("fuselage_LIT.png");
    expect(model.vertices).toHaveLength(3);
    expect(model.triangles).toEqual([{ indices: [0, 1, 2], doubleSided: true }]);
    expect(model.diagnostics).toEqual([]);
  });

  it("reports malformed triangle references without crashing", () => {
    const model = parseObj8("bad.obj", `I\n800\nOBJ\nVT 0 0 0 0 1 0 0 0\nIDX 0 1 9\nTRIS 0 3`);
    expect(model.triangles).toHaveLength(0);
    expect(model.diagnostics.some((item) => item.code === "OBJ8_INDEX_OUT_OF_RANGE")).toBe(true);
  });
});

