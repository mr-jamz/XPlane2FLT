import type { Diagnostic, Obj8HierarchyPart, Obj8Model, Obj8Triangle, Obj8Vertex } from "./types";
import { basename } from "./path";
import { Euler, Matrix3, Matrix4, Vector3 } from "three";

interface ParseObj8Options {
  datarefs?: Record<string, number>;
  attachment?: {
    index: number;
    position: [number, number, number];
    rotation: [number, number, number];
  };
}

type AnimationTransform =
  | { type: "rotate"; axis: [number, number, number]; keys: Array<{ value: number; angle: number }>; dataref: string }
  | { type: "translate"; keys: Array<{ value: number; position: [number, number, number] }>; dataref: string };

function interpolatedKeys<T extends { value: number }>(keys: T[], value: number): [T, T, number] | null {
  if (keys.length === 0) return null;
  const sorted = [...keys].sort((left, right) => left.value - right.value);
  if (sorted.length === 1 || value <= sorted[0].value) return [sorted[0], sorted[0], 0];
  if (value >= sorted.at(-1)!.value) return [sorted.at(-1)!, sorted.at(-1)!, 0];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (value < left.value || value > right.value) continue;
    const span = right.value - left.value;
    return [left, right, span === 0 ? 0 : (value - left.value) / span];
  }
  return [sorted[0], sorted[0], 0];
}

function transformMatrix(transform: AnimationTransform, datarefs: Record<string, number>): Matrix4 | null {
  const normalizedDataref = transform.dataref.toLowerCase();
  const constant = !normalizedDataref || normalizedDataref === "none" || normalizedDataref === "null";
  if (!constant && !Object.prototype.hasOwnProperty.call(datarefs, transform.dataref)) return null;
  const value = constant ? 0 : datarefs[transform.dataref];

  if (transform.type === "rotate") {
    const pair = interpolatedKeys(transform.keys, value);
    if (!pair) return null;
    const [left, right, ratio] = pair;
    const axis = new Vector3(...transform.axis);
    if (axis.lengthSq() === 0) return new Matrix4();
    const angle = left.angle + (right.angle - left.angle) * ratio;
    return new Matrix4().makeRotationAxis(axis.normalize(), angle * Math.PI / 180);
  }

  const pair = interpolatedKeys(transform.keys, value);
  if (!pair) return null;
  const [left, right, ratio] = pair;
  return new Matrix4().makeTranslation(
    left.position[0] + (right.position[0] - left.position[0]) * ratio,
    left.position[1] + (right.position[1] - left.position[1]) * ratio,
    left.position[2] + (right.position[2] - left.position[2]) * ratio,
  );
}

function attachmentMatrix(options: ParseObj8Options): Matrix4 {
  const attachment = options.attachment;
  if (!attachment) return new Matrix4();
  const rotation = new Euler(
    attachment.rotation[0] * Math.PI / 180,
    attachment.rotation[1] * Math.PI / 180,
    attachment.rotation[2] * Math.PI / 180,
    "XYZ",
  );
  return new Matrix4()
    .makeRotationFromEuler(rotation)
    .setPosition(...attachment.position);
}

function matrixKey(matrix: Matrix4): string {
  return matrix.elements.map((value) => Math.abs(value) < 1e-12 ? "0" : value.toPrecision(12)).join("|");
}

function hasNonIdentityTransform(matrix: Matrix4): boolean {
  const identity = new Matrix4().elements;
  return matrix.elements.some((value, index) => Math.abs(value - identity[index]) > 1e-10);
}

function finiteNumbers(parts: string[], start: number, count: number): number[] | null {
  if (parts.length < start + count) return null;
  const values = parts.slice(start, start + count).map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function animationPartName(index: number, datarefs: string[]): string {
  const references = datarefs.map((dataref) => dataref.toLowerCase());
  const hasTailRotor = references.some((dataref) => (
    /(?:tail[_/-]?rotor|rotor[_/-]?tail)/.test(dataref)
    || /(?:^|[/_.-])rotor[_-]?2(?:[/_.-]|$)/.test(dataref)
    || /(?:^|[/_.-])prop[_-]?2(?:[/_.-]|$)/.test(dataref)
    || /prop_speed_rpm\[1\]/.test(dataref)
  ));
  if (hasTailRotor) return "TAILROTR";

  const hasMainRotor = references.some((dataref) => (
    /(?:main[_/-]?rotor|rotor[_/-]?main)/.test(dataref)
    || /(?:^|[/_.-])rotor[_-]?1(?:[/_.-]|$)/.test(dataref)
    || /(?:^|[/_.-])prop[_-]?1(?:[/_.-]|$)/.test(dataref)
    || /prop_speed_rpm\[0\]/.test(dataref)
  ));
  if (hasMainRotor) return "MAINROTR";
  return `ANIM${String(index).padStart(4, "0")}`;
}

function animationDataref(command: string, parts: string[]): string | undefined {
  if (!["ANIM_ROTATE", "ANIM_ROTATE_BEGIN", "ANIM_TRANS", "ANIM_TRANS_BEGIN", "ANIM_HIDE", "ANIM_SHOW"].includes(command)) {
    return undefined;
  }
  const candidate = command.endsWith("_BEGIN") && command !== "ANIM_ROTATE_BEGIN"
    ? parts[1]
    : parts.at(-1);
  return candidate
    && candidate.toLowerCase() !== "none"
    && candidate.toLowerCase() !== "null"
    && !Number.isFinite(Number(candidate))
    ? candidate
    : undefined;
}

export function parseObj8(path: string, source: string, options: ParseObj8Options = {}): Obj8Model {
  const sourceVertices: Obj8Vertex[] = [];
  const vertices: Obj8Vertex[] = [];
  const transformedVertexIndices = new Map<string, number>();
  const indexTable: number[] = [];
  const triangles: Obj8Triangle[] = [];
  const diagnostics: Diagnostic[] = [];
  let texturePath: string | undefined;
  let litTexturePath: string | undefined;
  let normalTexturePath: string | undefined;
  let doubleSided = false;
  let drawEnabled = true;
  let material = {
    diffuse: [1, 1, 1] as [number, number, number],
    emissive: [0, 0, 0] as [number, number, number],
    shininess: 0,
    alpha: 1,
    blended: false,
    alphaCutoff: 0.5,
  };
  let animationDepth = 0;
  let animationPartNumber = 0;
  let currentAnimationPartId: string | undefined;
  const visibilityStack = [true];
  const transformStack = [new Matrix4()];
  const acfAttachmentMatrix = attachmentMatrix(options);
  const attachmentTransformApplied = hasNonIdentityTransform(acfAttachmentMatrix);
  let pendingTransform: AnimationTransform | null = null;
  const animationParts: Array<{ id: string; datarefs: Set<string> }> = [];
  const usedHierarchyPartIds = new Set<string>();
  let animationWarningAdded = false;
  let lodWarningAdded = false;
  let excludedByVisibility = 0;
  let bakedTransformCount = 0;
  let skippedLiveTransformCount = 0;

  const addTransform = (transform: AnimationTransform) => {
    const matrix = transformMatrix(transform, options.datarefs ?? {});
    if (matrix) {
      transformStack[transformStack.length - 1].multiply(matrix);
      bakedTransformCount += 1;
    } else {
      skippedLiveTransformCount += 1;
    }
  };

  const currentMatrix = () => {
    const matrix = acfAttachmentMatrix.clone();
    for (const local of transformStack) matrix.multiply(local);
    return matrix;
  };

  const transformedVertexIndex = (sourceIndex: number, matrix: Matrix4, normalMatrix: Matrix3, transformKey: string): number => {
    const key = `${sourceIndex}|${transformKey}`;
    const existing = transformedVertexIndices.get(key);
    if (existing !== undefined) return existing;
    const sourceVertex = sourceVertices[sourceIndex];
    const position = new Vector3(...sourceVertex.position).applyMatrix4(matrix);
    const normal = new Vector3(...sourceVertex.normal).applyMatrix3(normalMatrix).normalize();
    const index = vertices.length;
    vertices.push({
      position: [position.x, position.y, position.z],
      normal: [normal.x, normal.y, normal.z],
      uv: [...sourceVertex.uv],
    });
    transformedVertexIndices.set(key, index);
    return index;
  };

  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber].trim();
    if (!raw || raw.startsWith("#")) continue;
    const parts = raw.split(/\s+/);
    const command = parts[0].toUpperCase();

    if (command === "TEXTURE" && parts[1] && parts[1] !== "none") {
      texturePath = parts.slice(1).join(" ");
      continue;
    }
    if (command === "TEXTURE_LIT" && parts[1] && parts[1] !== "none") {
      litTexturePath = parts.slice(1).join(" ");
      continue;
    }
    if (command === "TEXTURE_NORMAL" && parts[1] && parts[1] !== "none") {
      normalTexturePath = parts.slice(1).join(" ");
      continue;
    }
    if (command === "ATTR_NO_CULL") {
      doubleSided = true;
      continue;
    }
    if (command === "ATTR_CULL") {
      doubleSided = false;
      continue;
    }
    if (command === "ATTR_DRAW_ENABLE") {
      drawEnabled = true;
      continue;
    }
    if (command === "ATTR_DRAW_DISABLE") {
      drawEnabled = false;
      continue;
    }
    if (command === "ATTR_DIFFUSE_RGB") {
      const values = finiteNumbers(parts, 1, 3);
      if (values) material = { ...material, diffuse: values as [number, number, number] };
      continue;
    }
    if (command === "ATTR_EMISSION_RGB") {
      const values = finiteNumbers(parts, 1, 3);
      if (values) material = { ...material, emissive: values as [number, number, number] };
      continue;
    }
    if (command === "ATTR_SHINY_RAT") {
      const values = finiteNumbers(parts, 1, 1);
      if (values) material = { ...material, shininess: Math.max(0, Math.min(128, values[0] * 128)) };
      continue;
    }
    if (command === "ATTR_BLEND") {
      material = { ...material, blended: true };
      continue;
    }
    if (command === "ATTR_NO_BLEND") {
      const values = finiteNumbers(parts, 1, 1);
      material = {
        ...material,
        blended: false,
        alphaCutoff: values ? Math.max(0, Math.min(1, values[0])) : 0.5,
      };
      continue;
    }
    if (command === "ANIM_BEGIN") {
      if (animationDepth === 0) {
        animationPartNumber += 1;
        currentAnimationPartId = `anim-${animationPartNumber}`;
        animationParts.push({ id: currentAnimationPartId, datarefs: new Set() });
      }
      animationDepth += 1;
      visibilityStack.push(visibilityStack.at(-1) ?? true);
      transformStack.push(new Matrix4());
      if (!animationWarningAdded) {
        diagnostics.push({
          severity: "warning",
          code: "OBJ8_ANIMATION_BAKED",
          file: path,
          message: "Saved configuration and constant OBJ8 transforms are baked into OpenFlight; unavailable live simulator animations remain in their authored neutral pose.",
        });
        animationWarningAdded = true;
      }
      continue;
    }
    if (command === "ANIM_END") {
      animationDepth = Math.max(0, animationDepth - 1);
      if (visibilityStack.length > 1) visibilityStack.pop();
      if (transformStack.length > 1) transformStack.pop();
      if (animationDepth === 0) currentAnimationPartId = undefined;
      continue;
    }
    const dataref = animationDataref(command, parts);
    if (dataref && currentAnimationPartId) {
      animationParts.find((part) => part.id === currentAnimationPartId)?.datarefs.add(dataref);
    }
    if ((command === "ANIM_SHOW" || command === "ANIM_HIDE") && dataref) {
      const range = finiteNumbers(parts, 1, 2);
      if (range && Object.prototype.hasOwnProperty.call(options.datarefs ?? {}, dataref)) {
        const value = options.datarefs![dataref];
        const inRange = value >= Math.min(range[0], range[1]) && value <= Math.max(range[0], range[1]);
        const ruleVisible = command === "ANIM_SHOW" ? inRange : !inRange;
        visibilityStack[visibilityStack.length - 1] = (visibilityStack.at(-1) ?? true) && ruleVisible;
      }
      continue;
    }
    if (command === "ANIM_ROTATE") {
      const values = finiteNumbers(parts, 1, 7);
      if (values) addTransform({
        type: "rotate",
        axis: [values[0], values[1], values[2]],
        keys: [{ value: values[5], angle: values[3] }, { value: values[6], angle: values[4] }],
        dataref: parts[8] ?? "",
      });
      continue;
    }
    if (command === "ANIM_TRANS") {
      const values = finiteNumbers(parts, 1, 8);
      if (values) addTransform({
        type: "translate",
        keys: [
          { value: values[6], position: [values[0], values[1], values[2]] },
          { value: values[7], position: [values[3], values[4], values[5]] },
        ],
        dataref: parts[9] ?? "",
      });
      continue;
    }
    if (command === "ANIM_ROTATE_BEGIN") {
      const values = finiteNumbers(parts, 1, 3);
      if (values) pendingTransform = {
        type: "rotate",
        axis: [values[0], values[1], values[2]],
        keys: [],
        dataref: parts[4] ?? "",
      };
      continue;
    }
    if (command === "ANIM_TRANS_BEGIN") {
      pendingTransform = { type: "translate", keys: [], dataref: parts[1] ?? "" };
      continue;
    }
    if (command === "ANIM_ROTATE_KEY" && pendingTransform?.type === "rotate") {
      const values = finiteNumbers(parts, 1, 2);
      if (values) pendingTransform.keys.push({ value: values[0], angle: values[1] });
      continue;
    }
    if (command === "ANIM_TRANS_KEY" && pendingTransform?.type === "translate") {
      const values = finiteNumbers(parts, 1, 4);
      if (values) pendingTransform.keys.push({ value: values[0], position: [values[1], values[2], values[3]] });
      continue;
    }
    if ((command === "ANIM_ROTATE_END" || command === "ANIM_TRANS_END") && pendingTransform) {
      addTransform(pendingTransform);
      pendingTransform = null;
      continue;
    }
    if ((command === "ATTR_LOD" || command === "LOD") && !lodWarningAdded) {
      diagnostics.push({
        severity: "warning",
        code: "OBJ8_LOD_FLATTENED",
        file: path,
        message: "LOD ranges are flattened into one OpenFlight object in this version.",
      });
      lodWarningAdded = true;
      continue;
    }
    if (command === "VT") {
      const values = finiteNumbers(parts, 1, 8);
      if (!values) {
        diagnostics.push({
          severity: "warning",
          code: "OBJ8_BAD_VERTEX",
          file: path,
          message: `Skipped malformed VT record at line ${lineNumber + 1}.`,
        });
        continue;
      }
      sourceVertices.push({
        position: [values[0], values[1], values[2]],
        normal: [values[3], values[4], values[5]],
        uv: [values[6], values[7]],
      });
      continue;
    }
    if (command === "IDX" || command === "IDX10") {
      for (const token of parts.slice(1)) {
        const index = Number(token);
        if (Number.isInteger(index) && index >= 0) indexTable.push(index);
      }
      continue;
    }
    if (command === "TRIS") {
      const values = finiteNumbers(parts, 1, 2);
      if (!values) continue;
      const offset = Math.trunc(values[0]);
      const count = Math.trunc(values[1]);
      const end = Math.min(indexTable.length, offset + count);

      if (offset < 0 || count < 3 || offset >= indexTable.length) {
        diagnostics.push({
          severity: "warning",
          code: "OBJ8_BAD_TRIS_RANGE",
          file: path,
          message: `Skipped invalid TRIS range at line ${lineNumber + 1}.`,
        });
        continue;
      }

      if (!(visibilityStack.at(-1) ?? true)) {
        excludedByVisibility += Math.floor(Math.max(0, end - offset) / 3);
        continue;
      }

      const matrix = currentMatrix();
      const normalMatrix = new Matrix3().getNormalMatrix(matrix);
      const transformKey = matrixKey(matrix);

      for (let cursor = offset; cursor + 2 < end; cursor += 3) {
        const a = indexTable[cursor];
        const b = indexTable[cursor + 1];
        const c = indexTable[cursor + 2];
        if (a >= sourceVertices.length || b >= sourceVertices.length || c >= sourceVertices.length) {
          diagnostics.push({
            severity: "warning",
            code: "OBJ8_INDEX_OUT_OF_RANGE",
            file: path,
            message: `Skipped a triangle with an out-of-range vertex index at line ${lineNumber + 1}.`,
          });
          continue;
        }
        triangles.push({
          indices: [
            transformedVertexIndex(a, matrix, normalMatrix, transformKey),
            transformedVertexIndex(b, matrix, normalMatrix, transformKey),
            transformedVertexIndex(c, matrix, normalMatrix, transformKey),
          ],
          doubleSided,
          drawEnabled,
          hierarchyPartId: currentAnimationPartId ?? "static",
          material: {
            ...material,
            diffuse: [...material.diffuse],
            emissive: [...material.emissive],
          },
        });
        usedHierarchyPartIds.add(currentAnimationPartId ?? "static");
      }
    }
  }

  if (animationDepth !== 0) {
    diagnostics.push({
      severity: "warning",
      code: "OBJ8_UNBALANCED_ANIMATION",
      file: path,
      message: "The OBJ contains an unbalanced ANIM_begin/ANIM_end block.",
    });
  }
  if (sourceVertices.length === 0 || triangles.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "OBJ8_NO_GEOMETRY",
      file: path,
      message: "No indexed triangle geometry was found in this OBJ8 file.",
    });
  }
  if (excludedByVisibility > 0) {
    diagnostics.push({
      severity: "info",
      code: "OBJ8_VISIBILITY_FILTERED",
      file: path,
      message: `${excludedByVisibility.toLocaleString()} triangle${excludedByVisibility === 1 ? " was" : "s were"} excluded by saved ANIM_show/ANIM_hide configuration values.`,
    });
  }
  if (bakedTransformCount > 0 || attachmentTransformApplied) {
    diagnostics.push({
      severity: "info",
      code: "OBJ8_CONFIGURATION_POSE_BAKED",
      file: path,
      message: `${bakedTransformCount.toLocaleString()} deterministic OBJ8 transform${bakedTransformCount === 1 ? " was" : "s were"} baked${attachmentTransformApplied ? ` with ACF attachment ${options.attachment!.index} placement` : ""}.`,
    });
  }

  const hierarchyParts: Obj8HierarchyPart[] = [];
  if (usedHierarchyPartIds.has("static")) {
    hierarchyParts.push({ id: "static", name: "STATIC", kind: "static", datarefs: [] });
  }
  for (let index = 0; index < animationParts.length; index += 1) {
    const part = animationParts[index];
    if (!usedHierarchyPartIds.has(part.id)) continue;
    const datarefs = [...part.datarefs];
    hierarchyParts.push({
      id: part.id,
      name: animationPartName(index + 1, datarefs),
      kind: "animation",
      datarefs,
    });
  }

  return {
    path,
    name: basename(path),
    texturePath,
    litTexturePath,
    normalTexturePath,
    vertices,
    triangles,
    hierarchyParts,
    excludedByVisibility,
    bakedTransformCount,
    skippedLiveTransformCount,
    attachmentIndex: options.attachment?.index,
    attachmentTransformApplied,
    diagnostics,
  };
}
