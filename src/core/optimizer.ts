import type { GeometryOptimizationOptions, Obj8Model, Obj8Triangle, Obj8Vertex, OptimizationStats } from "./types";

const PRESET_TARGETS = { original: Number.MAX_SAFE_INTEGER, balanced: 120_000, performance: 65_000, aggressive: 35_000 } as const;

function areaSquared(a: Obj8Vertex, b: Obj8Vertex, c: Obj8Vertex): number {
  const ab = b.position.map((v, i) => v - a.position[i]);
  const ac = c.position.map((v, i) => v - a.position[i]);
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  return cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
}

function getBounds(vertices: Obj8Vertex[]) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], vertex.position[axis]);
    max[axis] = Math.max(max[axis], vertex.position[axis]);
  }
  const size: [number, number, number] = [
    Math.max(1e-9, max[0] - min[0]), Math.max(1e-9, max[1] - min[1]), Math.max(1e-9, max[2] - min[2]),
  ];
  return { min, size, diagonalSquared: size[0] ** 2 + size[1] ** 2 + size[2] ** 2 };
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
  if (options.weldVertices && vertices.length) {
    const step = Math.sqrt(getBounds(vertices).diagonalSquared) * 1e-7 || 1e-7;
    const byKey = new Map<string, number>();
    const welded: Obj8Vertex[] = [];
    remap = vertices.map((vertex) => {
      const key = [
        ...vertex.position.map((v) => Math.round(v / step)),
        ...vertex.normal.map((v) => Math.round(v * 10_000)),
        ...vertex.uv.map((v) => Math.round(v * 1_000_000)),
      ].join(",");
      let index = byKey.get(key);
      if (index === undefined) {
        index = welded.length;
        byKey.set(key, index);
        welded.push(vertex);
      }
      return index;
    });
    vertices = welded;
  }
  const minimumArea = getBounds(vertices).diagonalSquared ** 2 * 1e-14;
  const seen = new Set<string>();
  const triangles: Obj8Triangle[] = [];
  for (const source of model.triangles) {
    const triangle = { ...source, indices: source.indices.map((index) => remap[index]) as [number, number, number] };
    const [a, b, c] = triangle.indices;
    if (options.removeDegenerateFaces && (a === b || b === c || a === c || areaSquared(vertices[a], vertices[b], vertices[c]) <= minimumArea)) continue;
    if (options.removeDuplicateFaces) {
      const key = `${[...triangle.indices].sort((left, right) => left - right).join(",")}:${triangle.doubleSided ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    triangles.push(triangle);
  }
  return compact(model, triangles, vertices);
}

function normalized(values: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...values) || 1;
  return values.map((value) => value / length) as [number, number, number];
}

function cluster(model: Obj8Model, divisions: number, preserveThinParts: boolean): Obj8Model {
  if (!model.vertices.length) return model;
  const box = getBounds(model.vertices);
  const longest = Math.max(...box.size);
  const axisDivisions = box.size.map((size) => preserveThinParts ? divisions : Math.max(1, Math.round(divisions * size / longest)));
  const positionUse = new Map<string, string>();
  const seamPositions = new Set<string>();
  for (const vertex of model.vertices) {
    const positionKey = vertex.position.map((value) => value.toPrecision(10)).join(",");
    const uvKey = vertex.uv.map((value) => Math.round(value * 2048)).join(",");
    const previous = positionUse.get(positionKey);
    if (previous !== undefined && previous !== uvKey) seamPositions.add(positionKey);
    else positionUse.set(positionKey, uvKey);
  }
  type Cluster = { count: number; position: [number, number, number]; normal: [number, number, number]; uv: [number, number] };
  const clusters: Cluster[] = [];
  const byKey = new Map<string, number>();
  const remap: number[] = [];
  for (const vertex of model.vertices) {
    const cell = vertex.position.map((value, axis) => Math.min(
      axisDivisions[axis] - 1,
      Math.max(0, Math.floor(((value - box.min[axis]) / box.size[axis]) * axisDivisions[axis])),
    ));
    const normalBin = vertex.normal.map((value) => Math.round(value));
    const positionKey = vertex.position.map((value) => value.toPrecision(10)).join(",");
    const seamKey = seamPositions.has(positionKey) ? vertex.uv.map((value) => Math.round(value * 2048)).join(",") : "";
    const key = `${cell.join(",")}|${normalBin.join(",")}|${seamKey}`;
    let index = byKey.get(key);
    if (index === undefined) {
      index = clusters.length;
      byKey.set(key, index);
      clusters.push({ count: 0, position: [0, 0, 0], normal: [0, 0, 0], uv: [0, 0] });
    }
    const target = clusters[index];
    target.count += 1;
    for (let axis = 0; axis < 3; axis += 1) {
      target.position[axis] += vertex.position[axis];
      target.normal[axis] += vertex.normal[axis];
    }
    target.uv[0] += vertex.uv[0]; target.uv[1] += vertex.uv[1];
    remap.push(index);
  }
  const vertices: Obj8Vertex[] = clusters.map((item) => ({
    position: item.position.map((value) => value / item.count) as [number, number, number],
    normal: normalized(item.normal),
    uv: [item.uv[0] / item.count, item.uv[1] / item.count],
  }));
  const seen = new Set<string>();
  const triangles: Obj8Triangle[] = [];
  for (const source of model.triangles) {
    const indices = source.indices.map((index) => remap[index]) as [number, number, number];
    if (indices[0] === indices[1] || indices[1] === indices[2] || indices[0] === indices[2]) continue;
    const key = `${[...indices].sort((a, b) => a - b).join(",")}:${source.doubleSided ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    triangles.push({ ...source, indices });
  }
  return compact(model, triangles, vertices);
}

function simplify(model: Obj8Model, target: number, preserveThinParts: boolean): Obj8Model {
  if (model.triangles.length <= target || target < 4) return model;
  let low = 1; let high = 512; let best = model; let bestDistance = Math.abs(model.triangles.length - target);
  for (let iteration = 0; iteration < 11 && low <= high; iteration += 1) {
    const divisions = Math.floor((low + high) / 2);
    const candidate = cluster(model, divisions, preserveThinParts);
    const distance = Math.abs(candidate.triangles.length - target);
    if (distance < bestDistance || (distance === bestDistance && candidate.triangles.length > best.triangles.length)) {
      best = candidate; bestDistance = distance;
    }
    if (candidate.triangles.length > target) high = divisions - 1; else low = divisions + 1;
  }
  return best;
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

export function optimizeModels(models: Obj8Model[], options: GeometryOptimizationOptions): { models: Obj8Model[]; stats: OptimizationStats } {
  const originalTriangles = models.reduce((sum, model) => sum + model.triangles.length, 0);
  const originalVertices = models.reduce((sum, model) => sum + model.vertices.length, 0);
  const cleaned = models.map((model) => clean(model, options));
  const cleanedTriangles = cleaned.reduce((sum, model) => sum + model.triangles.length, 0);
  const targets = allocations(cleaned, resolveTargetTriangles(options, cleanedTriangles), options.minTrianglesPerPart);
  const optimized = options.preset === "original" ? cleaned : cleaned.map((model, index) => simplify(model, targets[index], options.preserveThinParts));
  return {
    models: optimized,
    stats: {
      originalTriangles, cleanedTriangles,
      optimizedTriangles: optimized.reduce((sum, model) => sum + model.triangles.length, 0),
      originalVertices,
      optimizedVertices: optimized.reduce((sum, model) => sum + model.vertices.length, 0),
      parts: optimized.map((model, index) => ({ path: model.path, originalTriangles: models[index].triangles.length, optimizedTriangles: model.triangles.length })),
    },
  };
}
