import JSZip, { type JSZipObject } from "jszip";
import { buildOpenFlight, validateOpenFlight } from "./openflight";
import { parseObj8 } from "./obj8";
import {
  basename,
  dirname,
  extension,
  normalizeArchivePath,
  removeExtension,
  resolveRelativePath,
  safeFileStem,
} from "./path";
import type {
  ArchiveEntrySummary,
  ArchiveInspection,
  ConversionOptions,
  ConversionResult,
  Diagnostic,
  Obj8Model,
} from "./types";

type ArchiveSource = Blob | ArrayBuffer | Uint8Array;

const TEXTURE_EXTENSIONS = new Set(["png", "dds", "bmp", "jpg", "jpeg", "tga", "tif", "tiff", "rgb", "rgba"]);
const SUPPORT_EXTENSIONS = new Set(["attr", "txt", "ini", "json", "cfg", "lua", "wav"]);

function entrySize(entry: JSZipObject): number {
  const internal = entry as JSZipObject & { _data?: { uncompressedSize?: number } };
  return internal._data?.uncompressedSize ?? 0;
}

function classify(path: string): ArchiveEntrySummary["kind"] {
  const ext = extension(path);
  if (ext === "acf") return "aircraft";
  if (ext === "obj") return "object";
  if (TEXTURE_EXTENSIONS.has(ext)) return "texture";
  if (SUPPORT_EXTENSIONS.has(ext)) return "support";
  return "other";
}

function sourceByteLength(source: ArchiveSource): number {
  if (source instanceof Blob) return source.size;
  if (source instanceof Uint8Array) return source.byteLength;
  return source.byteLength;
}

function findActualPath(pathLookup: Map<string, string>, requested: string, fromFile: string): string | undefined {
  const resolved = resolveRelativePath(fromFile, requested);
  const exact = pathLookup.get(resolved.toLowerCase());
  if (exact) return exact;

  const requestedBase = basename(requested).toLowerCase();
  const objectDirectory = dirname(fromFile).toLowerCase();
  const candidates = [...pathLookup.values()].filter((candidate) => basename(candidate).toLowerCase() === requestedBase);
  return candidates.find((candidate) => dirname(candidate).toLowerCase() === objectDirectory) ?? candidates[0];
}

function resolveModelTextures(model: Obj8Model, lookup: Map<string, string>, diagnostics: Diagnostic[]): Obj8Model {
  const resolve = (requested: string | undefined, kind: string): string | undefined => {
    if (!requested) return undefined;
    const actual = findActualPath(lookup, requested, model.path);
    if (!actual) {
      diagnostics.push({
        severity: "warning",
        code: "MISSING_TEXTURE",
        file: model.path,
        message: `${kind} texture “${requested}” was not found in the aircraft archive.`,
      });
    }
    return actual;
  };

  return {
    ...model,
    texturePath: resolve(model.texturePath, "Diffuse"),
    litTexturePath: resolve(model.litTexturePath, "Lit"),
    normalTexturePath: resolve(model.normalTexturePath, "Normal"),
  };
}

async function loadArchive(source: ArchiveSource): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(source, { checkCRC32: false, createFolders: false });
  } catch (error) {
    throw new Error(`The selected file is not a readable ZIP archive: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function inspectArchive(source: ArchiveSource, archiveName = "aircraft.zip"): Promise<ArchiveInspection> {
  const zip = await loadArchive(source);
  const diagnostics: Diagnostic[] = [];
  const entries: ArchiveEntrySummary[] = [];
  const entryObjects = new Map<string, JSZipObject>();
  const pathLookup = new Map<string, string>();

  for (const [zipPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normalized = normalizeArchivePath(zipPath);
    if (!normalized) continue;
    if (normalized !== zipPath.replace(/\\/g, "/").replace(/^\/+/, "")) {
      diagnostics.push({
        severity: "warning",
        code: "PATH_NORMALIZED",
        file: zipPath,
        message: "An unsafe or non-canonical archive path was normalized before processing.",
      });
    }
    const key = normalized.toLowerCase();
    if (pathLookup.has(key)) {
      diagnostics.push({
        severity: "warning",
        code: "DUPLICATE_PATH",
        file: normalized,
        message: "A duplicate case-insensitive archive path was ignored.",
      });
      continue;
    }
    pathLookup.set(key, normalized);
    entryObjects.set(normalized, entry);
    entries.push({ path: normalized, size: entrySize(entry), kind: classify(normalized) });
  }

  const aircraftFiles = entries.filter((entry) => entry.kind === "aircraft").map((entry) => entry.path);
  const objectFiles = entries.filter((entry) => entry.kind === "object").map((entry) => entry.path);
  const textureFiles = entries.filter((entry) => entry.kind === "texture").map((entry) => entry.path);
  const parsedModels: Obj8Model[] = [];

  for (const path of objectFiles) {
    const sourceText = await entryObjects.get(path)!.async("string");
    const model = parseObj8(path, sourceText);
    diagnostics.push(...model.diagnostics);
    parsedModels.push(resolveModelTextures(model, pathLookup, diagnostics));
  }

  if (aircraftFiles.length === 0) {
    diagnostics.push({ severity: "warning", code: "NO_ACF", message: "No .acf aircraft definition was found; OBJ8 files can still be converted directly." });
  }
  if (objectFiles.length === 0) {
    diagnostics.push({ severity: "error", code: "NO_OBJ8", message: "No X-Plane .obj geometry files were found in the archive." });
  }
  if (aircraftFiles.length > 0 && objectFiles.length > 0) {
    diagnostics.push({
      severity: "info",
      code: "ACF_PLACEMENT_BASE_POSE",
      message: "This initial converter combines OBJ8 files at their authored coordinates. ACF attachment offsets and dataref animations remain in their base pose.",
    });
  }

  const commonRoot = entries.length > 0 && entries.every((entry) => entry.path.includes("/"))
    ? entries[0].path.split("/")[0]
    : safeFileStem(archiveName);

  return {
    archiveName,
    rootName: commonRoot,
    entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    aircraftFiles,
    objectFiles,
    textureFiles,
    models: parsedModels,
    diagnostics,
    totals: {
      files: entries.length,
      vertices: parsedModels.reduce((sum, model) => sum + model.vertices.length, 0),
      triangles: parsedModels.reduce((sum, model) => sum + model.triangles.length, 0),
      sourceBytes: sourceByteLength(source),
    },
  };
}

function makeOutputPath(sourcePath: string, used: Set<string>): string {
  const objectPrefix = safeFileStem(dirname(sourcePath).split("/").pop() || "asset");
  const fileName = basename(sourcePath).replace(/[^a-zA-Z0-9._-]+/g, "-");
  let candidate = `textures/${fileName}`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `textures/${objectPrefix}-${suffix}-${fileName}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function convertArchive(
  source: ArchiveSource,
  inspection: ArchiveInspection,
  options: ConversionOptions,
): Promise<ConversionResult> {
  if (inspection.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("The archive contains blocking errors. Resolve them before converting.");
  }
  const zip = await loadArchive(source);
  const selectedPathSet = new Set(options.selectedModelPaths.map((path) => path.toLowerCase()));
  const selectedModels = inspection.models.filter((model) => selectedPathSet.has(model.path.toLowerCase()));
  if (selectedModels.length === 0) throw new Error("Select at least one OBJ8 mesh before converting.");
  const normalizedEntries = new Map<string, JSZipObject>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir) normalizedEntries.set(normalizeArchivePath(path).toLowerCase(), entry);
  }

  const diffuseSources = [...new Set(selectedModels.map((model) => model.texturePath).filter((value): value is string => Boolean(value)))];
  const auxiliarySources = selectedModels.flatMap((model) => [model.litTexturePath, model.normalTexturePath]).filter((value): value is string => Boolean(value));
  const selectedTextures = options.includeUnreferencedTextures
    ? inspection.textureFiles
    : [...new Set([...diffuseSources, ...auxiliarySources])];

  const usedOutputPaths = new Set<string>();
  const outputPathBySource = new Map<string, string>();
  for (const sourcePath of selectedTextures) {
    outputPathBySource.set(sourcePath.toLowerCase(), makeOutputPath(sourcePath, usedOutputPaths));
  }

  const diffuseBindings = diffuseSources.map((sourcePath, index) => ({
    sourcePath,
    outputPath: outputPathBySource.get(sourcePath.toLowerCase())!,
    index,
  }));

  const outputStem = safeFileStem(options.outputName || inspection.rootName || removeExtension(inspection.archiveName));
  const fltFileName = `${outputStem}.flt`;
  const packageFileName = `${outputStem}-openflight.zip`;
  const flt = buildOpenFlight({
    models: selectedModels,
    textures: diffuseBindings,
    coordinateMode: options.coordinateMode,
    databaseId: outputStem,
  });
  const validationDiagnostics = validateOpenFlight(flt);
  if (validationDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(validationDiagnostics.map((diagnostic) => diagnostic.message).join(" "));
  }

  const outputZip = new JSZip();
  outputZip.file(fltFileName, flt);
  for (const sourcePath of selectedTextures) {
    const entry = normalizedEntries.get(sourcePath.toLowerCase());
    const outputPath = outputPathBySource.get(sourcePath.toLowerCase());
    if (entry && outputPath) outputZip.file(outputPath, await entry.async("uint8array"));
  }

  outputZip.file(
    "conversion-report.json",
    JSON.stringify(
      {
        generator: "XPlane2FLT",
        openFlightVersion: "16.0",
        sourceArchive: inspection.archiveName,
        coordinateMode: options.coordinateMode,
        objects: selectedModels.map((model) => ({
          source: model.path,
          vertices: model.vertices.length,
          triangles: model.triangles.length,
          diffuseTexture: model.texturePath ?? null,
        })),
        copiedTextures: selectedTextures.map((sourcePath) => ({
          source: sourcePath,
          output: outputPathBySource.get(sourcePath.toLowerCase()),
        })),
        diagnostics: inspection.diagnostics,
      },
      null,
      2,
    ),
  );

  const packageZip = await outputZip.generateAsync({
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
    diagnostics: [...inspection.diagnostics, ...validationDiagnostics],
    textureCount: selectedTextures.length,
    objectCount: selectedModels.filter((model) => model.triangles.length > 0).length,
    triangleCount: selectedModels.reduce((sum, model) => sum + model.triangles.length, 0),
  };
}
