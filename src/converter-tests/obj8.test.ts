import { describe, expect, it } from "vitest";
import { parseObj8 } from "../converter/obj8";

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
      hierarchyPartId: "static",
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

  it("preserves top-level animated parts and identifies main and tail rotors", () => {
    const model = parseObj8("objects/rotors.obj", `I
800
OBJ
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
VT 10 0 0 0 1 0 0 0
VT 11 0 0 0 1 0 1 0
VT 10 1 0 0 1 0 0 1
IDX 0 1 2 3 4 5
ANIM_begin
ANIM_rotate 0 1 0 0 360 0 360 uh60m/rotor/rotor1_deg
ANIM_begin
TRIS 0 3
ANIM_end
ANIM_end
ANIM_begin
ANIM_rotate 1 0 0 0 360 0 360 uh60m/rotor/rotor2_deg
TRIS 3 3
ANIM_end`);

    expect(model.hierarchyParts).toEqual([
      expect.objectContaining({ id: "anim-1", name: "MAINROTR", kind: "animation" }),
      expect.objectContaining({ id: "anim-2", name: "TAILROTR", kind: "animation" }),
    ]);
    expect(model.triangles.map((triangle) => triangle.hierarchyPartId)).toEqual(["anim-1", "anim-2"]);
    expect(model.hierarchyParts?.[0].datarefs).toContain("uh60m/rotor/rotor1_deg");
    expect(model.hierarchyParts?.[1].datarefs).toContain("uh60m/rotor/rotor2_deg");
  });

  it("keeps only the FLIR branch selected by explicit saved configuration values", () => {
    const model = parseObj8("objects/flircam.obj", `I
800
OBJ
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
VT 10 0 0 0 1 0 0 0
VT 11 0 0 0 1 0 1 0
VT 10 1 0 0 1 0 0 1
IDX 0 1 2 3 4 5
ANIM_begin
ANIM_hide 0 0.9 uh60m/conf/flir
ANIM_begin
ANIM_show 1 1.5 uh60m/conf/exterior
TRIS 0 3
ANIM_end
ANIM_begin
ANIM_hide 1 1.5 uh60m/conf/exterior
TRIS 3 3
ANIM_end
ANIM_end`, {
      datarefs: {
        "uh60m/conf/flir": 1,
        "uh60m/conf/exterior": 1,
      },
    });

    expect(model.triangles).toHaveLength(1);
    expect(model.triangles[0].indices).toEqual([0, 1, 2]);
    expect(model.excludedByVisibility).toBe(1);
    expect(model.diagnostics).toContainEqual(expect.objectContaining({ code: "OBJ8_VISIBILITY_FILTERED" }));
  });

  it("uses X-Plane's neutral zero value for unavailable visibility datarefs", () => {
    const model = parseObj8("optional.obj", `I
800
OBJ
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
IDX 0 1 2
ANIM_begin
ANIM_show 1 1 custom/plugin/value
TRIS 0 3
ANIM_end`);

    expect(model.triangles).toHaveLength(0);
    expect(model.excludedByVisibility).toBe(1);
  });

  it("bakes saved dataref transforms into exported vertex positions", () => {
    const model = parseObj8("configured.obj", `I
800
OBJ
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
IDX 0 1 2
ANIM_begin
ANIM_trans 0 0 0 10 0 0 0 1 demo/conf/position
TRIS 0 3
ANIM_end`, { datarefs: { "demo/conf/position": 1 } });

    expect(model.vertices.map((vertex) => vertex.position)).toEqual([
      [10, 0, 0],
      [11, 0, 0],
      [10, 1, 0],
    ]);
    expect(model.bakedTransformCount).toBe(1);
    expect(model.skippedLiveTransformCount).toBe(0);
    expect(model.diagnostics).toContainEqual(expect.objectContaining({ code: "OBJ8_CONFIGURATION_POSE_BAKED" }));
  });

  it("bakes ACF attachment position and orientation but leaves unavailable live motion neutral", () => {
    const model = parseObj8("attached.obj", `I
800
OBJ
VT 1 0 0 0 1 0 0 0
VT 0 1 0 0 1 0 1 0
VT 0 0 0 0 1 0 0 1
IDX 0 1 2
ANIM_begin
ANIM_rotate 0 1 0 0 90 0 1 sim/live/motion
TRIS 0 3
ANIM_end`, {
      attachment: { index: 7, position: [1, 2, 3], rotation: [0, 90, 0] },
    });

    expect(model.vertices[0].position[0]).toBeCloseTo(1);
    expect(model.vertices[0].position[1]).toBeCloseTo(2);
    expect(model.vertices[0].position[2]).toBeCloseTo(2);
    expect(model.skippedLiveTransformCount).toBe(1);
    expect(model.attachmentIndex).toBe(7);
    expect(model.attachmentTransformApplied).toBe(true);
  });

  it("supports multi-key OBJ8 transforms used by aircraft plugins", () => {
    const model = parseObj8("keys.obj", `I
800
OBJ
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
IDX 0 1 2
ANIM_begin
ANIM_trans_begin demo/conf/offset
ANIM_trans_key 0 0 0 0
ANIM_trans_key 2 0 4 0
ANIM_trans_end
TRIS 0 3
ANIM_end`, { datarefs: { "demo/conf/offset": 1 } });

    expect(model.vertices[0].position).toEqual([0, 2, 0]);
    expect(model.bakedTransformCount).toBe(1);
  });
});
