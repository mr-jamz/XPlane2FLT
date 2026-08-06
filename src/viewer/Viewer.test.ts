import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { animationMatrix, previewMaterialSide, ruleVisible } from "./Viewer";
import type { AnimationTransform, VisibilityRule } from "../core/types";

describe("previewMaterialSide", () => {
  it("keeps aircraft surfaces visible from interior camera positions", () => {
    expect(previewMaterialSide(false)).toBe(THREE.DoubleSide);
    expect(previewMaterialSide(true)).toBe(THREE.DoubleSide);
  });
});

describe("animationMatrix", () => {
  it("keeps plugin-driven aircraft parts at their authored coordinates until a dataref is explicit", () => {
    const rotorFold: AnimationTransform[] = [{
      type: "rotate",
      axis: [0, 1, 0],
      keys: [
        { value: 0, angle: 0 },
        { value: 1, angle: 148 },
      ],
      dataref: "uh60m/rotor/sweep",
    }];

    expect(animationMatrix(rotorFold, {}).equals(animationMatrix([], {}))).toBe(true);
    expect(animationMatrix(rotorFold, { "uh60m/rotor/sweep": 1 }).equals(animationMatrix([], {}))).toBe(false);
  });

  it("still applies OBJ8 constant pivot translations", () => {
    const pivot: AnimationTransform[] = [{
      type: "translate",
      keys: [
        { value: 0, position: [0, 2.5, 4.5] },
        { value: 0, position: [0, 2.5, 4.5] },
      ],
      dataref: "none",
    }];

    const elements = animationMatrix(pivot, {}).elements;
    expect(elements[12]).toBeCloseTo(0);
    expect(elements[13]).toBeCloseTo(2.5);
    expect(elements[14]).toBeCloseTo(4.5);
  });
});

describe("ruleVisible", () => {
  it("uses the neutral numeric state for missing datarefs instead of drawing every configuration branch", () => {
    const unfolded: VisibilityRule[] = [{
      mode: "show",
      min: 0,
      max: 0,
      dataref: "uh60m/rotor/folded",
    }];
    const folded: VisibilityRule[] = [{
      mode: "show",
      min: 1,
      max: 1,
      dataref: "uh60m/rotor/folded",
    }];

    expect(ruleVisible(unfolded, {})).toBe(true);
    expect(ruleVisible(folded, {})).toBe(false);
    expect(ruleVisible(folded, { "uh60m/rotor/folded": 1 })).toBe(true);
  });
});
