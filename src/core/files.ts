import JSZip from "jszip";
import { parseAcf } from "./acf";
import { basename, normalizePath } from "./path";
import { parseObj8 } from "./obj8";
import type { AircraftAttachment, LoadedAircraft, SourceFile } from "./types";

interface FileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}

interface FileSystemFileEntry extends FileSystemEntry {
  file(callback: (file: File) => void, error?: (error: DOMException) => void): void;
}

interface FileSystemDirectoryReader {
  readEntries(callback: (entries: FileSystemEntry[]) => void, error?: (error: DOMException) => void): void;
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  createReader(): FileSystemDirectoryReader;
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<SourceFile> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve({ path: normalizePath(entry.fullPath), file }),
      reject,
    );
  });
}

async function entriesFromReader(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const result: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return result;
    result.push(...batch);
  }
}

async function walkEntry(entry: FileSystemEntry): Promise<SourceFile[]> {
  if (entry.isFile) return [await fileFromEntry(entry as FileSystemFileEntry)];
  if (!entry.isDirectory) return [];
  const children = await entriesFromReader((entry as FileSystemDirectoryEntry).createReader());
  return (await Promise.all(children.map(walkEntry))).flat();
}

function stripSharedRoot(files: SourceFile[]): SourceFile[] {
  const parts = files.map(({ path }) => normalizePath(path).split("/"));
  if (!parts.length || parts.some((value) => value.length < 2)) return files;
  const root = parts[0][0].toLowerCase();
  if (!parts.every((value) => value[0].toLowerCase() === root)) return files;
  return files.map(({ path, file }) => ({ path: normalizePath(path).split("/").slice(1).join("/"), file }));
}

async function unzip(file: File): Promise<SourceFile[]> {
  const zip = await JSZip.loadAsync(file);
  const sources: SourceFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || /(^|\/)__MACOSX\//i.test(entry.name) || /\.DS_Store$/i.test(entry.name)) continue;
    const bytes = await entry.async("uint8array");
    const copy = new Uint8Array(bytes);
    sources.push({
      path: normalizePath(entry.name),
      file: new File([copy.buffer], basename(entry.name), { type: "application/octet-stream" }),
    });
  }
  return stripSharedRoot(sources);
}

export async function filesFromDrop(dataTransfer: DataTransfer): Promise<SourceFile[]> {
  const items = [...dataTransfer.items];
  const entries = items
    .map((item) => {
      const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry;
      return getEntry?.call(item) ?? null;
    })
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (entries.length) {
    const walked = stripSharedRoot((await Promise.all(entries.map(walkEntry))).flat());
    if (walked.length === 1 && /\.zip$/i.test(walked[0].path)) return unzip(walked[0].file);
    return walked;
  }
  return filesFromList(dataTransfer.files);
}

export async function filesFromList(list: FileList | File[]): Promise<SourceFile[]> {
  const sourceFiles = [...list].map((file) => ({
    path: normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
    file,
  }));
  if (sourceFiles.length === 1 && /\.zip$/i.test(sourceFiles[0].path)) return unzip(sourceFiles[0].file);
  return stripSharedRoot(sourceFiles);
}

function guessedRole(path: string): AircraftAttachment["role"] {
  const lower = path.toLowerCase();
  if (/glass|window|windscreen|windshield/.test(lower)) return "glass";
  if (/cockpit/.test(lower)) return "cockpit";
  if (/interior|inside|cabin|panel/.test(lower)) return "interior";
  return "exterior";
}

export function parseOptionDefaults(source: string, prefixes: string[]): Record<string, number> {
  const options = new Map<string, number>();
  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r\n?|\n/)) {
    const match = rawLine.trim().match(/^([a-z0-9_]+)\s*=\s*(-?(?:\d+\.?\d*|\.\d+))\s*$/i);
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) options.set(match[1].toLowerCase(), value);
  }

  const result: Record<string, number> = {};
  for (const prefix of prefixes) {
    for (const [name, value] of options) result[`${prefix}/conf/${name}`] = value;
  }
  return result;
}

export async function loadAircraft(inputFiles: SourceFile[]): Promise<LoadedAircraft> {
  const files = inputFiles.filter(({ path }) => !/(^|\/)\./.test(path));
  const fileMap = new Map(files.map(({ path, file }) => [normalizePath(path).toLowerCase(), file]));
  const acfSource = files.find(({ path }) => /\.acf$/i.test(path));
  const manifest = acfSource
    ? parseAcf(acfSource.path, await acfSource.file.text())
    : { name: "OBJ8 package", attachments: [], warnings: ["No .acf file was found; all OBJ8 files are shown at their authored coordinates."] };

  const objSources = files.filter(({ path }) => /\.obj$/i.test(path));
  const models = await Promise.all(objSources.map(async ({ path, file }) => parseObj8(path, await file.text())));
  if (!models.length) throw new Error("No X-Plane OBJ8 .obj files were found in this folder.");

  if (!manifest.attachments.length) {
    manifest.attachments = models.map((model, index) => ({
      index,
      path: model.path,
      role: guessedRole(model.path),
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }));
  }

  // Third-party aircraft plugins commonly persist their selected airframe
  // configuration in opt_config.ini. The browser cannot execute an XPL plugin,
  // but it can reproduce those saved configuration datarefs.
  const datarefPrefixes = [...new Set(manifest.attachments
    .map(({ hideDataref }) => hideDataref?.match(/^(.+?)\/kill\//i)?.[1])
    .filter((value): value is string => Boolean(value)))];
  const optionSource = files.find(({ path }) => /(^|\/)opt_config\.ini$/i.test(path));
  const defaultDatarefs = optionSource
    ? parseOptionDefaults(await optionSource.file.text(), datarefPrefixes)
    : {};

  if (optionSource) {
    const options = new Map(Object.entries(defaultDatarefs).map(([name, value]) => [
      name.slice(name.lastIndexOf("/") + 1).toLowerCase(),
      value,
    ]));
    for (const attachment of manifest.attachments) {
      if (!attachment.hideDataref) continue;
      const name = attachment.hideDataref.slice(attachment.hideDataref.lastIndexOf("/") + 1).toLowerCase();
      const optionName = name === "ramp" ? "cargo" : name;
      const selected = options.get(optionName);
      if (selected !== undefined && (selected === 0 || selected === 1)) {
        defaultDatarefs[attachment.hideDataref] = selected === 0 ? 1 : 0;
      }
    }
  }

  return {
    name: manifest.name,
    files,
    models,
    manifest,
    fileMap,
    defaultDatarefs,
  };
}
