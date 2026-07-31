import JSZip from "jszip";
import * as THREE from "three";
import { basename } from "./path";
import { buildOpenFlight, validateOpenFlight } from "./openflight";
import { animationMatrix, attachmentMatrix, attachmentNeedsTwoSidedFaces, modelAttachments, ruleVisible } from "./scene";
import type {
  Diagnostic,
  FltExportOptions,
  FltExportResult,
  FltMaterial,
  FltModel,
  FltTriangle,
  LoadedAircraft,
  MaterialState,
  Obj8Model,
  Obj8Vertex,
} from "./types";
import { findTextureFile } from "../viewer/texture";

interface TextureSource {
  sourcePath: string;
  file: File;
  outputPath: string;
}

function safeStem(value: string): string {
  return value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "aircraft";
}

function materialFromState(state: MaterialState): FltMaterial {
  return {
    diffuse: [...state.diffuse],
    emissive: [...state.emissive],
    shininess: Math.max(0, Math.min(128, state.shinyRatio * 128)),
    alpha: 1,
    blended: state.blend !== "test",
    alphaCutoff: state.alphaCutoff,
  };
}

function transformVertex(
  source: Obj8Vertex,
  matrix: THREE.Matrix4,
  normalMatrix: THREE.Matrix3,
): Obj8Vertex {
  const position = new THREE.Vector3(...source.position).applyMatrix4(matrix);
  const normal = new THREE.Vector3(...source.normal).applyMatrix3(normalMatrix).normalize();
  return {
    position: [position.x, position.y, position.z],
    normal: [normal.x, normal.y, normal.z],
    uv: [...source.uv],
  };
}

function batchMatrix(
  model: Obj8Model,
  animationPath: number[],
  datarefs: Record<string, number>,
  base: THREE.Matrix4,
): { matrix: THREE.Matrix4; visible: boolean } {
  const groups = new Map(model.animations.map((group) => [group.id, group]));
  const matrix = base.clone();
  for (const groupId of animationPath) {
    const group = groups.get(groupId);
    if (!group) continue;
    if (!ruleVisible(group.visibility, datarefs)) return { matrix, visible: false };
    matrix.multiply(animationMatrix(group.transforms, datarefs));
  }
  return { matrix, visible: true };
}

function resolveTexture(
  aircraft: LoadedAircraft,
  model: Obj8Model,
  reference?: string,
): { path: string; file: File } | null {
  return findTextureFile(aircraft.fileMap, model.path, reference);
}

function flattenModelInstance(
  aircraft: LoadedAircraft,
  model: Obj8Model,
  attachmentIndex: number,
  datarefs: Record<string, number>,
  lodDistance: number,
  diagnostics: Diagnostic[],
): FltModel | null {
  const attachment = modelAttachments(aircraft, model)[attachmentIndex];
  if (!attachment) return null;
  if (attachment.hideDataref && (datarefs[attachment.hideDataref] ?? 0) >= 0.5) return null;

  const vertices: Obj8Vertex[] = [];
  const triangles: FltTriangle[] = [];
  const base = attachmentMatrix(attachment);
  const attachmentDoubleSided = attachmentNeedsTwoSidedFaces(attachment);

  for (const batch of model.batches) {
    if (batch.lod && !(lodDistance >= batch.lod[0] && lodDistance < batch.lod[1])) continue;
    const evaluated = batchMatrix(model, batch.animationPath, datarefs, base);
    if (!evaluated.visible) continue;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(evaluated.matrix);
    const remap = new Map<number, number>();
    const mapIndex = (sourceIndex: number): number | null => {
      const existing = remap.get(sourceIndex);
      if (existing !== undefined) return existing;
      const source = model.vertices[sourceIndex];
      if (!source) return null;
      const next = vertices.length;
      vertices.push(transformVertex(source, evaluated.matrix, normalMatrix));
      remap.set(sourceIndex, next);
      return next;
    };

    for (let cursor = 0; cursor + 2 < batch.indices.length; cursor += 3) {
      const a = mapIndex(batch.indices[cursor]);
      const b = mapIndex(batch.indices[cursor + 1]);
      const c = mapIndex(batch.indices[cursor + 2]);
      if (a === null || b === null || c === null) {
        diagnostics.push({
          severity: "warning",
          code: "EXPORT_INDEX_SKIPPED",
          file: model.path,
          message: `A triangle in draw batch ${batch.line} referenced a missing vertex and was skipped.`,
        });
        continue;
      }
      triangles.push({
        indices: [a, b, c],
        doubleSided: batch.material.doubleSided || attachmentDoubleSided,
        material: materialFromState(batch.material),
      });
    }
  }

  if (!triangles.length) return null;
  const diffuse = resolveTexture(aircraft, model, model.texture);
  if (model.texture && !diffuse) {
    diagnostics.push({
      severity: "warning",
      code: "MISSING_DIFFUSE_TEXTURE",
      file: model.path,
      message: `Diffuse texture “${model.texture}” could not be resolved. Geometry will export with its material color.`,
    });
  }

  const suffix = attachment.index >= 0 ? `#${attachment.index}` : "#native";
  return {
    path: `${model.path}${suffix}`,
    name: `${model.name}${suffix}`,
    texturePath: diffuse?.path,
    vertices,
    triangles,
  };
}

export function buildExportModels(
  aircraft: LoadedAircraft,
  options: Pick<FltExportOptions, "visiblePaths" | "datarefs" | "lodDistance">,
): { models: FltModel[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const models: FltModel[] = [];
  for (const model of aircraft.models) {
    if (!options.visiblePaths.has(model.path)) continue;
    const attachments = modelAttachments(aircraft, model);
    for (let index = 0; index < attachments.length; index += 1) {
      const flattened = flattenModelInstance(
        aircraft,
        model,
        index,
        options.datarefs,
        options.lodDistance,
        diagnostics,
      );
      if (flattened) models.push(flattened);
    }
  }
  return { models, diagnostics };
}

function collectTextureSources(
  aircraft: LoadedAircraft,
  includedPaths: Set<string>,
  diagnostics: Diagnostic[],
): TextureSource[] {
  const byPath = new Map<string, { sourcePath: string; file: File }>();
  for (const model of aircraft.models) {
    if (!includedPaths.has(model.path.toLowerCase())) continue;
    const references = [
      model.texture,
      model.textureLit,
      model.textureNormal,
      model.textureMaps.normal,
      model.textureMaps.material_gloss,
      model.textureMaps.gloss,
    ];
    for (const reference of references) {
      if (!reference) continue;
      const resolved = resolveTexture(aircraft, model, reference);
      if (resolved) byPath.set(resolved.path.toLowerCase(), { sourcePath: resolved.path, file: resolved.file });
      else {
        diagnostics.push({
          severity: "warning",
          code: "MISSING_AUXILIARY_TEXTURE",
          file: model.path,
          message: `Texture “${reference}” could not be copied into the export package.`,
        });
      }
    }
  }

  const used = new Set<string>();
  return [...byPath.values()].map((source, index) => {
    const cleanName = basename(source.sourcePath).replace(/[^a-z0-9._-]+/gi, "-") || `texture-${index + 1}.png`;
    let outputPath = `textures/${cleanName}`;
    let suffix = 2;
    while (used.has(outputPath.toLowerCase())) {
      const dot = cleanName.lastIndexOf(".");
      const stem = dot >= 0 ? cleanName.slice(0, dot) : cleanName;
      const extension = dot >= 0 ? cleanName.slice(dot) : "";
      outputPath = `textures/${stem}-${suffix}${extension}`;
      suffix += 1;
    }
    used.add(outputPath.toLowerCase());
    return { ...source, outputPath };
  });
}

export async function exportAircraftToFlt(
  aircraft: LoadedAircraft,
  options: FltExportOptions,
): Promise<FltExportResult> {
  const flattened = buildExportModels(aircraft, options);
  if (!flattened.models.length) {
    throw new Error("No drawable aircraft geometry is enabled for export.");
  }

  const includedPaths = new Set(
    flattened.models.map((model) => model.path.replace(/#(?:native|\d+)$/, "").toLowerCase()),
  );
  const textures = collectTextureSources(aircraft, includedPaths, flattened.diagnostics);
  const textureBySource = new Map(textures.map((texture) => [texture.sourcePath.toLowerCase(), texture]));
  const diffuseSources = [...new Set(
    flattened.models.map((model) => model.texturePath).filter((path): path is string => Boolean(path)),
  )];
  const bindings = diffuseSources.map((sourcePath, index) => ({
    sourcePath,
    outputPath: textureBySource.get(sourcePath.toLowerCase())?.outputPath ?? `textures/${basename(sourcePath)}`,
    index,
  }));

  const outputStem = safeStem(options.outputName || aircraft.name);
  const flt = buildOpenFlight({
    models: flattened.models,
    textures: bindings,
    coordinateMode: options.coordinateMode,
    databaseId: outputStem,
  });
  const validation = validateOpenFlight(flt);
  const blocking = validation.filter((diagnostic) => diagnostic.severity === "error");
  if (blocking.length) throw new Error(blocking.map(({ message }) => message).join(" "));

  const archive = new JSZip();
  const fltFileName = `${outputStem}.flt`;
  const packageFileName = `${outputStem}-openflight.zip`;
  archive.file(fltFileName, flt);
  for (const texture of textures) {
    archive.file(texture.outputPath, new Uint8Array(await texture.file.arrayBuffer()));
  }
  archive.file("conversion-report.json", JSON.stringify({
    generator: "XPlane2FLT merged viewer/export build",
    openFlightVersion: "16.0",
    geometryEncoding: "modelconverterx-compatible-face-5-vertex-palette-67-vertex-list-72",
    sourceAircraft: aircraft.name,
    coordinateMode: options.coordinateMode,
    lodDistance: options.lodDistance,
    datarefs: options.datarefs,
    objects: flattened.models.map((model) => ({
      source: model.path,
      vertices: model.vertices.length,
      triangles: model.triangles.length,
      diffuseTexture: model.texturePath ?? null,
    })),
    copiedTextures: textures.map(({ sourcePath, outputPath }) => ({ source: sourcePath, output: outputPath })),
    diagnostics: [...flattened.diagnostics, ...validation],
  }, null, 2));
  const packageZip = await archive.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });

  return {
    flt,
    packageZip,
    fltFileName,
    packageFileName,
    objectCount: flattened.models.length,
    triangleCount: flattened.models.reduce((sum, model) => sum + model.triangles.length, 0),
    vertexCount: flattened.models.reduce((sum, model) => sum + model.vertices.length, 0),
    textureCount: textures.length,
    diagnostics: [...flattened.diagnostics, ...validation],
  };
}
