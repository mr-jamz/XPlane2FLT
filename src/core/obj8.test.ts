import { describe, expect, it } from "vitest";
import { parseObj8 } from "./obj8";

const source = `A
800
OBJ
TEXTURE body.png
TEXTURE_LIT body_LIT.png
TEXTURE_NORMAL body_NML.png
NORMAL_METALNESS
GLOBAL_specular 0.8
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 0 1 0 1 0 0 1
IDX10 0 1 2 0 2 1 0 1 2 0
ANIM_begin
ANIM_rotate 0 1 0 0 90 0 1 sim/flightmodel2/gear/deploy_ratio[0]
ATTR_no_cull
ATTR_no_blend 0.35
TRIS 0 3
ANIM_end
`;

describe("parseObj8", () => {
  it("preserves X-Plane render state on each draw batch", () => {
    const model = parseObj8("objects/body.obj", source);
    expect(model.texture).toBe("body.png");
    expect(model.textureLit).toBe("body_LIT.png");
    expect(model.textureNormal).toBe("body_NML.png");
    expect(model.normalMetalness).toBe(true);
    expect(model.globalSpecular).toBe(0.8);
    expect(model.batches).toHaveLength(1);
    expect(model.batches[0].material.doubleSided).toBe(true);
    expect(model.batches[0].material.blend).toBe("test");
    expect(model.batches[0].material.alphaCutoff).toBe(0.35);
    expect(model.batches[0].animationPath).toEqual([0, 1]);
  });

  it("captures nested animation datarefs and key ranges", () => {
    const model = parseObj8("objects/body.obj", source);
    expect(model.datarefs).toEqual(["sim/flightmodel2/gear/deploy_ratio[0]"]);
    expect(model.animations[1].transforms[0]).toMatchObject({
      type: "rotate",
      axis: [0, 1, 0],
      dataref: "sim/flightmodel2/gear/deploy_ratio[0]",
    });
  });

  it("reads the normal-map filename after an optional normal ratio", () => {
    const model = parseObj8("objects/body.obj", source.replace(
      "TEXTURE_NORMAL body_NML.png",
      "TEXTURE_NORMAL 1.0 body_NML.png",
    ));
    expect(model.textureNormal).toBe("body_NML.png");
  });
});
