import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const [, , mcxZipPath, fltPath] = process.argv;
if (!mcxZipPath || !fltPath) throw new Error("Usage: node scripts/verify-mcx-compat.mjs <ModelConverterX.zip> <model.flt>");
const mcx = await JSZip.loadAsync(await readFile(mcxZipPath));
const readerEntry = mcx.file("ASToFra.Object.Reader.dll");
if (!readerEntry) throw new Error("The supplied MCX archive does not contain ASToFra.Object.Reader.dll.");
const readerText = new TextDecoder("latin1").decode(await readerEntry.async("uint8array"));
for (const symbol of ["FltReader", "NodeActive", "ReadVertexPaletteRecord", "ReadVertexListRecord"]) {
  if (!readerText.includes(symbol)) throw new Error(`The MCX reader signature is missing ${symbol}.`);
}

const bytes = new Uint8Array(await readFile(fltPath));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const supported = new Set([1, 2, 4, 5, 10, 11, 64, 67, 72, 113]);
let offset = 0; let record = 0; let currentParent = 0; let headerOpen = false;
let groups = 0; let objects = 0; let faces = 0; let vertices = 0; let materials = 0;
const materialIndices = new Set();
const stack = [];
while (offset + 4 <= bytes.byteLength) {
  const opcode = view.getUint16(offset, false); const length = view.getUint16(offset + 2, false); record += 1;
  if (record === 1 && (opcode !== 1 || length !== 324)) throw new Error("Invalid OpenFlight 16 header.");
  if (!supported.has(opcode)) throw new Error(`MCX-unsupported opcode ${opcode} at record ${record}.`);
  if (length < 4 || offset + length > bytes.byteLength) throw new Error(`Invalid record length at record ${record}.`);
  if (opcode === 10) {
    if (!currentParent) throw new Error(`Push record ${record} has no primary parent.`);
    stack.push(currentParent); if (currentParent === 1) headerOpen = true; currentParent = 0;
  } else if (opcode === 11) {
    if (!stack.length) throw new Error(`Pop record ${record} would trigger MCX's empty hierarchy stack.`);
    currentParent = stack.pop();
  } else {
    if (opcode === 2 && !headerOpen) throw new Error("The first Group is outside the Header child level.");
    if (opcode === 2) groups += 1; if (opcode === 4) objects += 1;
    if (opcode === 113) {
      if (length !== 84) throw new Error(`Material palette record ${record} has invalid length ${length}.`);
      materialIndices.add(view.getInt32(offset + 4, false)); materials += 1;
    }
    if (opcode === 5) {
      faces += 1;
      const textureIndex = view.getInt16(offset + 28, false);
      const materialIndex = view.getInt16(offset + 30, false);
      const primaryColor = view.getUint32(offset + 56, false);
      if (textureIndex < 0) throw new Error(`Face ${faces} has no diffuse texture assignment.`);
      if (materialIndex < 0) throw new Error(`Face ${faces} has no material assignment.`);
      if (primaryColor !== 0xffffffff) throw new Error(`Face ${faces} modulates its texture with a non-white primary color.`);
    }
    if ([1, 2, 4, 5].includes(opcode)) currentParent = opcode;
  }
  if (opcode === 67) {
    const paletteLength = view.getInt32(offset + 4, false);
    if (paletteLength < 8 || offset + paletteLength > bytes.byteLength) throw new Error("Invalid vertex palette.");
    vertices = (paletteLength - 8) / 64; offset += paletteLength;
  } else offset += length;
}
if (offset !== bytes.byteLength || stack.length) throw new Error("The OpenFlight stream ends with an invalid MCX hierarchy state.");
if (!groups || !objects || !faces || vertices < 3) throw new Error("The FLT contains no usable MCX geometry.");
if (!materials || [...materialIndices].some((index) => index < 0 || index >= materials)) throw new Error("The FLT material palette is incomplete.");
console.log(JSON.stringify({ mcxReaderVerified: true, records: record, groups, objects, faces, vertices, materials }, null, 2));
