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
    expect(model.triangles).toEqual([{
      indices: [0, 1, 2],
      doubleSided: true,
      drawEnabled: true,
      material: {
        diffuse: [1, 1, 1],
        emissive: [0, 0, 0],
        shininess: 0,
        alpha: 1,
        blended: false,
        alphaCutoff: 0.5,
      },
    }]);
    expect(model.diagnostics).toEqual([]);
  });

  it("applies draw and blend state at each TRIS command", () => {
    const model = parseObj8("state.obj", `I
800
OBJ
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
IDX 0 1 2
ATTR_draw_disable
TRIS 0 3
ATTR_draw_enable
ATTR_blend
TRIS 0 3`);
    expect(model.triangles[0].drawEnabled).toBe(false);
    expect(model.triangles[0].material?.blended).toBe(false);
    expect(model.triangles[1].drawEnabled).toBe(true);
    expect(model.triangles[1].material?.blended).toBe(true);
  });

  it("reports malformed triangle references without crashing", () => {
    const model = parseObj8("bad.obj", `I\n800\nOBJ\nVT 0 0 0 0 1 0 0 0\nIDX 0 1 9\nTRIS 0 3`);
    expect(model.triangles).toHaveLength(0);
    expect(model.diagnostics.some((item) => item.code === "OBJ8_INDEX_OUT_OF_RANGE")).toBe(true);
  });
});
