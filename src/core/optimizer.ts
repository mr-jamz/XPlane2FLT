import type {
  Diagnostic,
  GeometryOptimizationOptions,
  Obj8Model,
  Obj8Triangle,
  Obj8Vertex,
  OptimizationStats,
} from "./types";

const PRESET_TARGETS = { original: Number.MAX_SAFE_INTEGER, balanced: 120_000, performance: 65_000, aggressive: 35_000 } as const;

function vertexKey(vertex: Obj8Vertex): string {
  return [...vertex.position, ...vertex.normal, ...vertex.uv].map((value) => Object.is(value, -0) ? "0" : String(value)).join("|");
}

function materialKey(triangle: Obj8Triangle): string {
  const material = triangle.material;
  return material
    ? [...material.diffuse, ...material.emissive, material.shininess, material.alpha, material.blended ? 1 : 0].join("|")
    : "default";
}

function triangleStateKey(triangle: Obj8Triangle): string {
  return `${triangle.doubleSided ? 1 : 0}|${materialKey(triangle)}`;
}

function areaSquared(a: Obj8Vertex, b: Obj8Vertex, c: Obj8Vertex): number {
  const ab = b.position.map((value, axis) => value - a.position[axis]);
  const ac = c.position.map((value, axis) => value - a.position[axis]);
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
}

function bounds(vertices: Obj8Vertex[]) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex.position[axis]);
      max[axis] = Math.max(max[axis], vertex.position[axis]);
    }
  }
  return { min, max };
}

function compact(model: Obj8Model, triangles: Obj8Triangle[], vertices = model.vertices): Obj8Model {
  const used = new Set<number>();
  for (const triangle of triangles) triangle.indices.forEach((index) => used.add(index));
  const ordered = [...used].sort((a, b) => a - b);
  const remap = new Map(ordered.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  return {
    ...model,
    vertices: ordered.map((index) => vertices[index]),
    triangles: triangles.map((triangle) => ({
      ...triangle,
      indices: triangle.indices.map((index) => remap.get(index)!) as [number, number, number],
    })),
  };
}

function clean(model: Obj8Model, options: GeometryOptimizationOptions): Obj8Model {
  let vertices = model.vertices;
  let remap = vertices.map((_, index) => index);
  if (options.weldVertices) {
    const byKey = new Map<string, number>();
    const welded: Obj8Vertex[] = [];
    remap = vertices.map((vertex) => {
      // Exact full-attribute welding only. Positions with different UVs or
      // normals remain separate, and near-but-distinct coordinates never move.
      const key = vertexKey(vertex);
      const existing = byKey.get(key);
      if (existing !== undefined) return existing;
      const index = welded.length;
      byKey.set(key, index);
      welded.push(vertex);
      return index;
    });
    vertices = welded;
  }

  const seen = new Set<string>();
  const triangles: Obj8Triangle[] = [];
  for (const source of model.triangles) {
    const indices = source.indices.map((index) => remap[index]) as [number, number, number];
    const [a, b, c] = indices;
    if (options.removeDegenerateFaces && (
      a === b || b === c || a === c || areaSquared(vertices[a], vertices[b], vertices[c]) <= Number.EPSILON
    )) continue;
    if (options.removeDuplicateFaces) {
      const key = `${[...indices].sort((left, right) => left - right).join(",")}|${triangleStateKey(source)}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    triangles.push({ ...source, indices });
  }
  return compact(model, triangles, vertices);
}

function selectWholeTriangles(model: Obj8Model, target: number, preserveThinParts: boolean): Obj8Model {
  if (model.triangles.length <= target || target < 4) return model;
  const required = new Set<number>();

  // Preserve triangles containing each positional extreme. This keeps the
  // authored object bounds and coordinate frame exactly stationary.
  const box = bounds(model.vertices);
  for (let axis = 0; axis < 3; axis += 1) {
    for (const extreme of [box.min[axis], box.max[axis]]) {
      const triangleIndex = model.triangles.findIndex((triangle) => triangle.indices.some(
        (index) => model.vertices[index].position[axis] === extreme,
      ));
      if (triangleIndex >= 0) required.add(triangleIndex);
    }
  }

  if (preserveThinParts) {
    // Retain the smallest-area authored faces as anchors for blades, probes,
    // antennas, gear struts, and other thin geometry.
    const thinCount = Math.min(Math.max(8, Math.floor(target * 0.04)), target);
    model.triangles
      .map((triangle, index) => ({
        index,
        area: areaSquared(
          model.vertices[triangle.indices[0]],
          model.vertices[triangle.indices[1]],
          model.vertices[triangle.indices[2]],
        ),
      }))
      .sort((left, right) => left.area - right.area || left.index - right.index)
      .slice(0, thinCount)
      .forEach(({ index }) => required.add(index));
  }

  const chosen = new Set([...required].slice(0, target));
  const quota = target - chosen.size;
  if (quota > 0) {
    const available = model.triangles.length - chosen.size;
    for (let slot = 0; slot < quota; slot += 1) {
      let cursor = Math.min(model.triangles.length - 1, Math.floor((slot + 0.5) * available / quota));
      let visited = 0;
      while (chosen.has(cursor) && visited < model.triangles.length) {
        cursor = (cursor + 1) % model.triangles.length;
        visited += 1;
      }
      chosen.add(cursor);
    }
  }

  const triangles = [...chosen].sort((left, right) => left - right).map((index) => model.triangles[index]);
  return compact(model, triangles);
}

function allocations(models: Obj8Model[], totalTarget: number, minimumPerPart: number): number[] {
  const original = models.map((model) => model.triangles.length);
  const base = original.map((count) => Math.min(count, Math.max(4, minimumPerPart)));
  const baseTotal = base.reduce((sum, count) => sum + count, 0);
  const originalTotal = original.reduce((sum, count) => sum + count, 0);
  const target = Math.min(originalTotal, Math.max(baseTotal, totalTarget));
  const reducible = original.map((count, index) => count - base[index]);
  const reducibleTotal = reducible.reduce((sum, count) => sum + count, 0);
  if (!reducibleTotal) return original;
  const available = target - baseTotal;
  const result = base.map((count, index) => count + Math.floor(available * reducible[index] / reducibleTotal));
  let remainder = target - result.reduce((sum, count) => sum + count, 0);
  const order = reducible.map((count, index) => ({ count, index })).sort((a, b) => b.count - a.count);
  for (let cursor = 0; remainder > 0; cursor = (cursor + 1) % order.length) {
    const index = order[cursor].index;
    if (result[index] < original[index]) { result[index] += 1; remainder -= 1; }
  }
  return result;
}

export function resolveTargetTriangles(options: GeometryOptimizationOptions, original: number): number {
  if (options.preset === "original") return original;
  if (options.preset === "custom") return Math.max(1, Math.min(original, options.targetTriangles));
  return Math.min(original, PRESET_TARGETS[options.preset]);
}

export function estimateOptimizedTriangles(models: Obj8Model[], options: GeometryOptimizationOptions): number {
  const original = models.reduce((sum, model) => sum + model.triangles.length, 0);
  if (options.preset === "original") return original;
  const minimum = models.reduce((sum, model) => sum + Math.min(model.triangles.length, Math.max(4, options.minTrianglesPerPart)), 0);
  return Math.max(minimum, resolveTargetTriangles(options, original));
}

export function validateStationaryGeometry(sourceModels: Obj8Model[], outputModels: Obj8Model[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  sourceModels.forEach((source, modelIndex) => {
    const output = outputModels[modelIndex];
    if (!output || output.path !== source.path) {
      diagnostics.push({ severity: "error", code: "OPT_PART_ORDER_CHANGED", file: source.path, message: "Optimization changed the per-object model mapping." });
      return;
    }
    const sourceVertices = new Set(source.vertices.map(vertexKey));
    const sourceTriangles = new Set(source.triangles.map((triangle) => (
      `${triangle.indices.map((index) => vertexKey(source.vertices[index])).join(">")}|${triangleStateKey(triangle)}`
    )));
    if (output.vertices.some((vertex) => !sourceVertices.has(vertexKey(vertex)))) {
      diagnostics.push({ severity: "error", code: "OPT_VERTEX_MOVED", file: source.path, message: "Optimization created or moved a vertex instead of preserving an authored coordinate and its UV/normal attributes." });
    }
    for (const triangle of output.triangles) {
      if (triangle.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= output.vertices.length)) {
        diagnostics.push({ severity: "error", code: "OPT_INDEX_OUT_OF_RANGE", file: source.path, message: "An optimized triangle references a vertex outside its own object." });
        break;
      }
      const key = `${triangle.indices.map((index) => vertexKey(output.vertices[index])).join(">")}|${triangleStateKey(triangle)}`;
      if (!sourceTriangles.has(key)) {
        diagnostics.push({ severity: "error", code: "OPT_TRIANGLE_REMAPPED", file: source.path, message: "Optimization changed a triangle-to-vertex or material relationship." });
        break;
      }
    }
    if (output.vertices.length > 0) {
      const before = bounds(source.vertices);
      const after = bounds(output.vertices);
      if ([0, 1, 2].some((axis) => before.min[axis] !== after.min[axis] || before.max[axis] !== after.max[axis])) {
        diagnostics.push({ severity: "error", code: "OPT_BOUNDS_SHIFTED", file: source.path, message: "Optimization changed the authored bounds or placement of this object." });
      }
    }
  });
  return diagnostics;
}

export function optimizeModels(models: Obj8Model[], options: GeometryOptimizationOptions): { models: Obj8Model[]; stats: OptimizationStats; diagnostics: Diagnostic[] } {
  const originalTriangles = models.reduce((sum, model) => sum + model.triangles.length, 0);
  const originalVertices = models.reduce((sum, model) => sum + model.vertices.length, 0);
  const cleaned = models.map((model) => clean(model, options));
  const cleanedTriangles = cleaned.reduce((sum, model) => sum + model.triangles.length, 0);
  const targets = allocations(cleaned, resolveTargetTriangles(options, cleanedTriangles), options.minTrianglesPerPart);
  const optimized = options.preset === "original"
    ? cleaned
    : cleaned.map((model, index) => selectWholeTriangles(model, targets[index], options.preserveThinParts));
  const diagnostics = validateStationaryGeometry(models, optimized);
  return {
    models: optimized,
    diagnostics,
    stats: {
      originalTriangles,
      cleanedTriangles,
      optimizedTriangles: optimized.reduce((sum, model) => sum + model.triangles.length, 0),
      originalVertices,
      optimizedVertices: optimized.reduce((sum, model) => sum + model.vertices.length, 0),
      parts: optimized.map((model, index) => ({ path: model.path, originalTriangles: models[index].triangles.length, optimizedTriangles: model.triangles.length })),
    },
  };
}
