import { describe, expect, it } from "vitest";
import { estimateOptimizedTriangles, optimizeModels } from "../src/core/optimizer";
import type { GeometryOptimizationOptions, Obj8Model } from "../src/core/types";

function grid(path: string, width: number, height: number): Obj8Model {
  const vertices = [];
  for (let y = 0; y <= height; y += 1) for (let x = 0; x <= width; x += 1) vertices.push({
    position: [x, y, Math.sin(x * .05) * .1] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    uv: [x / width, y / height] as [number, number],
  });
  const triangles = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const a = y * (width + 1) + x; const b = a + 1; const c = a + width + 1; const d = c + 1;
    triangles.push({ indices: [a, b, d] as [number, number, number], doubleSided: false });
    triangles.push({ indices: [a, d, c] as [number, number, number], doubleSided: false });
  }
  return { path, name: path, vertices, triangles, diagnostics: [] };
}

const options: GeometryOptimizationOptions = {
  preset: "custom", targetTriangles: 2_000, minTrianglesPerPart: 300,
  preserveThinParts: true, weldVertices: true, removeDegenerateFaces: true,
  removeDuplicateFaces: true, textureMaxSize: 0,
};

describe("geometry optimizer", () => {
  it("reduces geometry while retaining every part", () => {
    const result = optimizeModels([grid("fuselage.obj", 80, 50), grid("rotor.obj", 36, 12)], options);
    expect(result.models).toHaveLength(2);
    expect(result.models.every((model) => model.triangles.length > 0)).toBe(true);
    expect(result.stats.optimizedTriangles).toBeLessThan(result.stats.originalTriangles);
    expect(result.models[1].triangles.length).toBeGreaterThanOrEqual(250);
  });

  it("keeps indices and UV values valid", () => {
    const model = optimizeModels([grid("aircraft.obj", 60, 40)], options).models[0];
    expect(model.triangles.every((triangle) => triangle.indices.every((index) => index >= 0 && index < model.vertices.length))).toBe(true);
    expect(model.vertices.every((vertex) => vertex.uv.every(Number.isFinite))).toBe(true);
  });

  it("honors minimum allocation per part", () => {
    const models = [grid("a.obj", 20, 20), grid("b.obj", 20, 20)];
    expect(estimateOptimizedTriangles(models, { ...options, targetTriangles: 100 })).toBe(600);
  });
});
