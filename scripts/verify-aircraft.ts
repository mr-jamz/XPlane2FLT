import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { exportAircraftToFlt } from "../src/core/export";
import { loadAircraft } from "../src/core/files";
import { basename, normalizePath } from "../src/core/path";
import type { SourceFile } from "../src/core/types";

const archivePath = process.argv[2];
if (!archivePath) throw new Error("Usage: vite-node scripts/verify-aircraft.ts <aircraft.zip>");

const zip = await JSZip.loadAsync(await readFile(archivePath));
const sources: SourceFile[] = [];
for (const entry of Object.values(zip.files)) {
  if (entry.dir || /(^|\/)__MACOSX\//i.test(entry.name) || /\.DS_Store$/i.test(entry.name)) continue;
  const bytes = await entry.async("uint8array");
  sources.push({
    path: normalizePath(entry.name),
    file: new File([bytes], basename(entry.name), { type: "application/octet-stream" }),
  });
}

const aircraft = await loadAircraft(sources);
const result = await exportAircraftToFlt(aircraft, {
  outputName: aircraft.name,
  coordinateMode: "openflight-z-up",
  visiblePaths: new Set(aircraft.models.map((model) => model.path)),
  datarefs: aircraft.defaultDatarefs,
  lodDistance: 0,
});
const diagnosticsByCode = Object.fromEntries(
  [...new Set(result.diagnostics.map((diagnostic) => diagnostic.code))].map((code) => [
    code,
    result.diagnostics.filter((diagnostic) => diagnostic.code === code).length,
  ]),
);

process.stdout.write(`${JSON.stringify({
  aircraft: aircraft.name,
  sourceFiles: aircraft.files.length,
  obj8Files: aircraft.models.length,
  acfAttachments: aircraft.manifest.attachments.length,
  configuredDatarefs: Object.keys(aircraft.defaultDatarefs).length,
  exportedObjects: result.objectCount,
  vertices: result.vertexCount,
  triangles: result.triangleCount,
  textures: result.textureCount,
  fltBytes: result.flt.byteLength,
  packageBytes: result.packageZip.byteLength,
  errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
  warnings: result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
  diagnosticsByCode,
  diagnosticDetails: result.diagnostics.map(({ code, file, message }) => ({ code, file, message })),
}, null, 2)}\n`);
