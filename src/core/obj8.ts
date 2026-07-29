import { basename } from "./path";
import type {
  AnimationGroup,
  AnimationTransform,
  MaterialState,
  Obj8Light,
  Obj8Model,
  Obj8Vertex,
  Vec3,
} from "./types";

const defaultMaterial = (): MaterialState => ({
  diffuse: [1, 1, 1],
  emissive: [0, 0, 0],
  shinyRatio: 0,
  doubleSided: false,
  blend: "blend",
  alphaCutoff: 0.5,
  draw: true,
  depthTest: true,
  cockpit: false,
});

function numbers(parts: string[], start = 1): number[] {
  return parts.slice(start).map(Number).filter(Number.isFinite);
}

function vec3(values: number[], offset = 0): Vec3 {
  return [values[offset] ?? 0, values[offset + 1] ?? 0, values[offset + 2] ?? 0];
}

function cloneMaterial(material: MaterialState): MaterialState {
  return {
    ...material,
    diffuse: [...material.diffuse],
    emissive: [...material.emissive],
    lightLevel: material.lightLevel ? { ...material.lightLevel } : undefined,
  };
}

export function parseObj8(path: string, source: string): Obj8Model {
  const vertices: Obj8Vertex[] = [];
  const indexTable: number[] = [];
  const batches: Obj8Model["batches"] = [];
  const animations: AnimationGroup[] = [{ id: 0, parentId: null, transforms: [], visibility: [] }];
  const lights: Obj8Light[] = [];
  const animationStack = [0];
  const datarefs = new Set<string>();
  const warnings: string[] = [];
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n?|\n/);

  let material = defaultMaterial();
  let lod: [number, number] | null = null;
  let texture: string | undefined;
  let textureLit: string | undefined;
  let textureNormal: string | undefined;
  const textureMaps: Obj8Model["textureMaps"] = {};
  let normalMetalness = false;
  let globalSpecular = 0;
  let luminance: number | null = null;
  let pendingTransform:
    | { type: "rotate"; axis: Vec3; dataref: string; keys: Array<{ value: number; angle: number }> }
    | { type: "translate"; dataref: string; keys: Array<{ value: number; position: Vec3 }> }
    | null = null;

  const currentGroup = () => animations[animationStack[animationStack.length - 1]];
  const addDataref = (value?: string) => {
    if (value && value !== "none" && value !== "NULL") datarefs.add(value);
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex].trim();
    if (!raw || raw.startsWith("#")) continue;
    const parts = raw.split(/\s+/);
    const command = parts[0].toUpperCase();
    const values = numbers(parts);

    if (command === "VT" && values.length >= 8) {
      vertices.push({
        position: vec3(values),
        normal: vec3(values, 3),
        uv: [values[6], values[7]],
      });
      continue;
    }
    if (command === "IDX" || command === "IDX10") {
      for (const value of values) if (Number.isInteger(value) && value >= 0) indexTable.push(value);
      continue;
    }
    if (command === "TEXTURE" && parts[1] && parts[1].toLowerCase() !== "none") texture = parts.slice(1).join(" ");
    else if (command === "TEXTURE_LIT" && parts[1] && parts[1].toLowerCase() !== "none") textureLit = parts.slice(1).join(" ");
    else if (command === "TEXTURE_NORMAL" && parts[1]) {
      // OBJ8 accepts both `TEXTURE_NORMAL file` and
      // `TEXTURE_NORMAL normal_ratio file`.
      const firstIsRatio = Number.isFinite(Number(parts[1])) && parts.length >= 3;
      textureNormal = parts.slice(firstIsRatio ? 2 : 1).join(" ");
    }
    else if (command === "TEXTURE_MAP" && /^(normal|material_gloss|gloss)$/i.test(parts[1] ?? "")) {
      textureMaps[parts[1].toLowerCase() as keyof typeof textureMaps] = parts.slice(2).join(" ");
    } else if (command === "NORMAL_METALNESS") normalMetalness = true;
    else if (command === "GLOBAL_SPECULAR") globalSpecular = Math.max(0, Math.min(1, values[0] ?? 0));
    else if (command === "GLOBAL_LUMINANCE") luminance = values[0] ?? null;
    else if (command === "GLOBAL_NO_BLEND") {
      material.blend = "test";
      material.alphaCutoff = values[0] ?? 0.5;
    } else if (command === "ATTR_RESET") material = defaultMaterial();
    else if (command === "ATTR_NO_CULL") material.doubleSided = true;
    else if (command === "ATTR_CULL") material.doubleSided = false;
    else if (command === "ATTR_BLEND") material.blend = "blend";
    else if (command === "ATTR_NO_BLEND") {
      material.blend = "test";
      material.alphaCutoff = values[0] ?? 0.5;
    } else if (command === "ATTR_SHADOW_BLEND") {
      material.blend = "shadow";
      material.alphaCutoff = values[0] ?? 0.5;
    } else if (command === "ATTR_DRAW_ENABLE") material.draw = true;
    else if (command === "ATTR_DRAW_DISABLE") material.draw = false;
    else if (command === "ATTR_NO_DEPTH") material.depthTest = false;
    else if (command === "ATTR_DEPTH") material.depthTest = true;
    else if (command === "ATTR_DIFFUSE_RGB" && values.length >= 3) material.diffuse = vec3(values);
    else if (command === "ATTR_EMISSION_RGB" && values.length >= 3) material.emissive = vec3(values);
    else if (command === "ATTR_SHINY_RAT") material.shinyRatio = Math.max(0, Math.min(1, values[0] ?? 0));
    else if (/^ATTR_COCKPIT(?:_REGION|_LIT_ONLY|_DEVICE)?$/.test(command)) material.cockpit = true;
    else if (command === "ATTR_NO_COCKPIT") material.cockpit = false;
    else if (command === "ATTR_LIGHT_LEVEL" && values.length >= 2 && parts[3]) {
      material.lightLevel = { min: values[0], max: values[1], dataref: parts[3] };
      addDataref(parts[3]);
    } else if (command === "ATTR_LIGHT_LEVEL_RESET") material.lightLevel = undefined;
    else if (command === "ATTR_LOD" && values.length >= 2) lod = [values[0], values[1]];
    else if (command === "ANIM_BEGIN") {
      const id = animations.length;
      animations.push({ id, parentId: currentGroup().id, transforms: [], visibility: [] });
      animationStack.push(id);
    } else if (command === "ANIM_END") {
      if (animationStack.length > 1) animationStack.pop();
      else warnings.push(`Unmatched ANIM_end at line ${lineIndex + 1}.`);
    } else if (command === "ANIM_ROTATE" && values.length >= 7) {
      const dataref = parts[8] ?? "";
      addDataref(dataref);
      currentGroup().transforms.push({
        type: "rotate",
        axis: vec3(values),
        keys: [{ value: values[5], angle: values[3] }, { value: values[6], angle: values[4] }],
        dataref,
      });
    } else if (command === "ANIM_TRANS" && values.length >= 8) {
      const dataref = parts[9] ?? "";
      addDataref(dataref);
      currentGroup().transforms.push({
        type: "translate",
        keys: [{ value: values[6], position: vec3(values) }, { value: values[7], position: vec3(values, 3) }],
        dataref,
      });
    } else if (command === "ANIM_ROTATE_BEGIN" && values.length >= 3) {
      const dataref = parts[4] ?? "";
      addDataref(dataref);
      pendingTransform = { type: "rotate", axis: vec3(values), dataref, keys: [] };
    } else if (command === "ANIM_TRANS_BEGIN") {
      const dataref = parts[1] ?? "";
      addDataref(dataref);
      pendingTransform = { type: "translate", dataref, keys: [] };
    } else if (command === "ANIM_ROTATE_KEY" && pendingTransform?.type === "rotate" && values.length >= 2) {
      pendingTransform.keys.push({ value: values[0], angle: values[1] });
    } else if (command === "ANIM_TRANS_KEY" && pendingTransform?.type === "translate" && values.length >= 4) {
      pendingTransform.keys.push({ value: values[0], position: vec3(values, 1) });
    } else if ((command === "ANIM_ROTATE_END" || command === "ANIM_TRANS_END") && pendingTransform) {
      if (pendingTransform.keys.length >= 2) currentGroup().transforms.push(pendingTransform as AnimationTransform);
      pendingTransform = null;
    } else if ((command === "ANIM_SHOW" || command === "ANIM_HIDE") && values.length >= 2 && parts[3]) {
      addDataref(parts[3]);
      currentGroup().visibility.push({
        mode: command === "ANIM_SHOW" ? "show" : "hide",
        min: values[0],
        max: values[1],
        dataref: parts[3],
      });
    } else if (command === "TRIS" && values.length >= 2) {
      const offset = Math.trunc(values[0]);
      const count = Math.trunc(values[1]);
      const selected = indexTable.slice(Math.max(0, offset), Math.max(0, offset + count));
      const valid = selected.filter((index) => index >= 0 && index < vertices.length);
      if (valid.length !== selected.length) warnings.push(`Out-of-range vertex index in TRIS at line ${lineIndex + 1}.`);
      if (material.draw && valid.length >= 3) {
        batches.push({
          id: `${path}:${lineIndex + 1}`,
          indices: valid.slice(0, valid.length - (valid.length % 3)),
          material: cloneMaterial(material),
          animationPath: [...animationStack],
          lod,
          line: lineIndex + 1,
        });
      }
    } else if (command === "LIGHT_NAMED" && values.length >= 3) {
      lights.push({ kind: "named", name: parts[1], position: vec3(values), animationPath: [...animationStack] });
    } else if (command === "LIGHT_PARAM" && parts[1] && values.length >= 3) {
      lights.push({ kind: "param", name: parts[1], position: vec3(values), animationPath: [...animationStack] });
    } else if (command === "LIGHT_CUSTOM" && values.length >= 7) {
      lights.push({
        kind: "custom",
        name: "custom",
        position: vec3(values),
        color: [values[3], values[4], values[5], values[6]],
        animationPath: [...animationStack],
      });
    }
  }

  if (animationStack.length > 1) warnings.push("The OBJ has one or more unclosed ANIM_begin blocks.");
  if (!vertices.length || !batches.length) warnings.push("No drawable indexed triangle geometry was found.");

  return {
    path,
    name: basename(path),
    vertices,
    batches,
    animations,
    lights,
    texture,
    textureLit,
    textureNormal,
    textureMaps,
    normalMetalness,
    globalSpecular,
    luminance,
    datarefs: [...datarefs].sort(),
    warnings,
  };
}
