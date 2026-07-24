import type { Diagnostic, Obj8MaterialState, Obj8Model, Obj8Triangle, Obj8Vertex } from "./types";

const HEADER_LENGTH = 324;
const GROUP_LENGTH = 44;
const OBJECT_LENGTH = 28;
const FACE_LENGTH = 80;
const VERTEX_PALETTE_HEADER_LENGTH = 8;
const VERTEX_RECORD_LENGTH = 64;
const VERTEX_LIST_LENGTH = 16;
const MATERIAL_PALETTE_LENGTH = 84;

interface TextureBinding {
  sourcePath: string;
  outputPath: string;
  index: number;
}

interface BuildInput {
  models: Obj8Model[];
  textures: TextureBinding[];
  coordinateMode: "openflight-z-up" | "keep-xplane";
  databaseId?: string;
}

class BigEndianWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  get length(): number { return this.offset; }
  uint8(value: number): void { this.view.setUint8(this.offset, value & 0xff); this.offset += 1; }
  int8(value: number): void { this.uint8(value); }
  uint16(value: number): void { this.view.setUint16(this.offset, value & 0xffff, false); this.offset += 2; }
  int16(value: number): void { this.view.setInt16(this.offset, value, false); this.offset += 2; }
  uint32(value: number): void { this.view.setUint32(this.offset, value >>> 0, false); this.offset += 4; }
  int32(value: number): void { this.view.setInt32(this.offset, value, false); this.offset += 4; }
  float32(value: number): void { this.view.setFloat32(this.offset, value, false); this.offset += 4; }
  float64(value: number): void { this.view.setFloat64(this.offset, value, false); this.offset += 8; }
  ascii(value: string, length: number): void {
    for (let index = 0; index < length; index += 1) this.uint8(index < value.length ? value.charCodeAt(index) & 0x7f : 0);
  }
  zeros(length: number): void { this.offset += length; }
  toUint8Array(): Uint8Array {
    if (this.offset !== this.bytes.byteLength) throw new Error(`Internal error: wrote ${this.offset} of ${this.bytes.byteLength} allocated bytes.`);
    return this.bytes;
  }
}

function recordHeader(writer: BigEndianWriter, opcode: number, length: number): void {
  writer.uint16(opcode);
  writer.uint16(length);
}

function writeHeader(writer: BigEndianWriter, databaseId: string, faceCount: number, objectCount: number): void {
  const start = writer.length;
  recordHeader(writer, 1, HEADER_LENGTH);
  writer.ascii(databaseId.slice(0, 7) || "db", 8);
  writer.int32(1600);
  writer.int32(1);
  writer.ascii(new Date().toISOString().replace("T", " ").replace("Z", " UTC"), 32);
  writer.int16(2);
  writer.int16(1);
  writer.int16(Math.min(32_767, objectCount + 1));
  writer.int16(Math.min(32_767, faceCount + 1));
  writer.int16(1);
  writer.int8(0);
  writer.int8(0);
  writer.int32(0);
  writer.zeros(24);
  writer.int32(0);
  writer.zeros(28);
  writer.int16(1);
  writer.int16(1);
  writer.int32(100);
  writer.zeros(32);
  writer.int16(1);
  writer.int16(1);
  writer.zeros(8);
  writer.int16(1);
  writer.int16(1);
  writer.int16(1);
  writer.int16(1);
  writer.zeros(4);
  writer.zeros(64);
  writer.int16(1);
  writer.int16(1);
  writer.int16(1);
  writer.int16(1);
  writer.zeros(8);
  writer.int32(0);
  writer.int16(1);
  writer.int16(1);
  writer.int16(0);
  writer.zeros(6);
  writer.float64(0);
  writer.float64(0);
  writer.uint16(1);
  writer.uint16(1);
  writer.int32(0);
  writer.float64(6_378_137);
  writer.float64(6_356_752.314245);
  if (writer.length - start !== HEADER_LENGTH) throw new Error(`Internal error: OpenFlight header is ${writer.length - start} bytes, expected ${HEADER_LENGTH}.`);
}

function writeTexturePalette(writer: BigEndianWriter, texture: TextureBinding): void {
  recordHeader(writer, 64, 216);
  writer.ascii(texture.outputPath, 200);
  writer.int32(texture.index);
  writer.int32((texture.index % 16) * 64);
  writer.int32(Math.floor(texture.index / 16) * 64);
}

function normalizedMaterial(triangle: Obj8Triangle): Obj8MaterialState {
  return triangle.material ?? {
    diffuse: [1, 1, 1],
    emissive: [0, 0, 0],
    shininess: 0,
    alpha: 1,
    blended: true,
  };
}

function materialKey(material: Obj8MaterialState): string {
  return [...material.diffuse, ...material.emissive, material.shininess, material.alpha, material.blended ? 1 : 0].join("|");
}

function collectMaterials(models: Obj8Model[]): { materials: Obj8MaterialState[]; indices: Map<string, number> } {
  const materials: Obj8MaterialState[] = [];
  const indices = new Map<string, number>();
  for (const model of models) for (const triangle of model.triangles) {
    const material = normalizedMaterial(triangle);
    const key = materialKey(material);
    if (!indices.has(key)) {
      indices.set(key, materials.length);
      materials.push(material);
    }
  }
  return { materials, indices };
}

function writeMaterialPalette(writer: BigEndianWriter, material: Obj8MaterialState, index: number): void {
  recordHeader(writer, 113, MATERIAL_PALETTE_LENGTH);
  writer.int32(index);
  writer.ascii(`MAT${String(index).padStart(4, "0")}`, 12);
  writer.uint32(0x80000000);
  const ambient = material.diffuse.map((value) => Math.max(0, Math.min(1, value * 0.2)));
  for (const value of ambient) writer.float32(value);
  for (const value of material.diffuse) writer.float32(Math.max(0, Math.min(1, value)));
  const specular = Math.max(0, Math.min(1, material.shininess / 128));
  for (let axis = 0; axis < 3; axis += 1) writer.float32(specular);
  for (const value of material.emissive) writer.float32(Math.max(0, Math.min(1, value)));
  writer.float32(Math.max(0, Math.min(128, material.shininess)));
  writer.float32(Math.max(0, Math.min(1, material.alpha)));
  writer.uint32(0);
}

function transformVertex(vertex: Obj8Vertex, coordinateMode: BuildInput["coordinateMode"]): Obj8Vertex {
  if (coordinateMode === "keep-xplane") return vertex;
  return {
    position: [vertex.position[0], -vertex.position[2], vertex.position[1]],
    normal: [vertex.normal[0], -vertex.normal[2], vertex.normal[1]],
    uv: vertex.uv,
  };
}

/**
 * X-Plane OBJ8 and OpenFlight/ModelConverterX use opposite front-face winding
 * conventions after the OBJ8 coordinate frame is converted to Z-up. Keep the
 * source indices untouched everywhere else and reverse them exactly once at
 * the OpenFlight vertex-list boundary.
 */
export function openFlightTriangleIndices(
  triangle: Obj8Triangle,
  coordinateMode: BuildInput["coordinateMode"],
): [number, number, number] {
  const [a, b, c] = triangle.indices;
  return coordinateMode === "openflight-z-up" ? [a, c, b] : [a, b, c];
}

function writeVertexPalette(writer: BigEndianWriter, models: Obj8Model[], coordinateMode: BuildInput["coordinateMode"], vertexCount: number): void {
  recordHeader(writer, 67, VERTEX_PALETTE_HEADER_LENGTH);
  writer.int32(VERTEX_PALETTE_HEADER_LENGTH + vertexCount * VERTEX_RECORD_LENGTH);
  for (const model of models) {
    for (const sourceVertex of model.vertices) {
      const vertex = transformVertex(sourceVertex, coordinateMode);
      recordHeader(writer, 70, VERTEX_RECORD_LENGTH);
      writer.uint16(0);
      writer.uint16(0x3000);
      writer.float64(vertex.position[0]);
      writer.float64(vertex.position[1]);
      writer.float64(vertex.position[2]);
      writer.float32(vertex.normal[0]);
      writer.float32(vertex.normal[1]);
      writer.float32(vertex.normal[2]);
      writer.float32(vertex.uv[0]);
      writer.float32(vertex.uv[1]);
      writer.uint32(0xffffffff);
      writer.uint32(0);
      writer.int32(0);
    }
  }
}

function writeGroup(writer: BigEndianWriter, id: string): void {
  recordHeader(writer, 2, GROUP_LENGTH);
  writer.ascii(id, 8);
  writer.int16(0); writer.int16(0); writer.int32(0); writer.int16(0); writer.int16(0); writer.int16(0);
  writer.int8(0); writer.int8(0); writer.int32(0); writer.int32(0); writer.float32(0); writer.float32(0);
}

function writeObject(writer: BigEndianWriter, id: string): void {
  recordHeader(writer, 4, OBJECT_LENGTH);
  writer.ascii(id, 8);
  writer.int32(0);
  writer.int16(0);
  writer.uint16(0);
  writer.int16(0); writer.int16(0); writer.int16(0); writer.int16(0);
}

function writeFace(writer: BigEndianWriter, id: string, textureIndex: number, materialIndex: number, triangle: Obj8Triangle): void {
  const material = normalizedMaterial(triangle);
  const start = writer.length;
  recordHeader(writer, 5, FACE_LENGTH);
  writer.ascii(id, 8);
  writer.int32(0);
  writer.int16(0);
  writer.int8(triangle.doubleSided ? 1 : 0);
  writer.int8(textureIndex >= 0 ? 1 : 0);
  writer.uint16(0); writer.uint16(0); writer.int8(0); writer.int8(0);
  writer.int16(-1);
  writer.int16(textureIndex);
  writer.int16(materialIndex);
  writer.int16(0); writer.int16(0); writer.int32(0);
  writer.uint16(Math.round((1 - Math.max(0, Math.min(1, material.alpha))) * 65_535)); writer.uint8(0); writer.uint8(0);
  writer.uint32(0x10000000);
  writer.uint8(2);
  writer.zeros(7);
  writer.uint32(0xffffffff); writer.uint32(0xffffffff);
  writer.int16(-1); writer.int16(0);
  writer.uint32(0); writer.uint32(0);
  writer.int16(0); writer.int16(-1);
  if (writer.length - start !== FACE_LENGTH) throw new Error(`Internal error: OpenFlight face is ${writer.length - start} bytes, expected ${FACE_LENGTH}.`);
}

function writeVertexList(writer: BigEndianWriter, offsets: [number, number, number]): void {
  recordHeader(writer, 72, VERTEX_LIST_LENGTH);
  writer.int32(offsets[0]);
  writer.int32(offsets[1]);
  writer.int32(offsets[2]);
}

function push(writer: BigEndianWriter): void { recordHeader(writer, 10, 4); }
function pop(writer: BigEndianWriter): void { recordHeader(writer, 11, 4); }

export function buildOpenFlight(input: BuildInput): Uint8Array {
  const vertexCount = input.models.reduce((sum, model) => sum + model.vertices.length, 0);
  const triangleCount = input.models.reduce((sum, model) => sum + model.triangles.length, 0);
  const populatedObjectCount = input.models.filter((model) => model.triangles.length > 0).length;
  const materialPalette = collectMaterials(input.models);
  const vertexPaletteLength = VERTEX_PALETTE_HEADER_LENGTH + vertexCount * VERTEX_RECORD_LENGTH;
  const outputSize = HEADER_LENGTH + input.textures.length * 216 + materialPalette.materials.length * MATERIAL_PALETTE_LENGTH + vertexPaletteLength
    + 4 + GROUP_LENGTH + 4
    + populatedObjectCount * (OBJECT_LENGTH + 4 + 4)
    + triangleCount * (FACE_LENGTH + 4 + VERTEX_LIST_LENGTH + 4)
    + 4 + 4;
  if (!Number.isSafeInteger(outputSize) || outputSize > 1_500_000_000) throw new Error("The selected objects exceed the safe browser export size. Select fewer OBJ8 meshes and try again.");

  const writer = new BigEndianWriter(outputSize);
  const textureBySource = new Map(input.textures.map((texture) => [texture.sourcePath.toLowerCase(), texture.index]));
  const modelVertexBaseOffsets: number[] = [];
  let cumulativeVertices = 0;
  for (const model of input.models) {
    modelVertexBaseOffsets.push(VERTEX_PALETTE_HEADER_LENGTH + cumulativeVertices * VERTEX_RECORD_LENGTH);
    cumulativeVertices += model.vertices.length;
  }

  writeHeader(writer, input.databaseId ?? "db", triangleCount, populatedObjectCount);
  for (const texture of input.textures) writeTexturePalette(writer, texture);
  materialPalette.materials.forEach((material, index) => writeMaterialPalette(writer, material, index));
  writeVertexPalette(writer, input.models, input.coordinateMode, vertexCount);

  // The Header is a primary node. Its child level must be open before the
  // first Group or ModelConverterX's FltReader evaluates an empty mask stack.
  push(writer);
  writeGroup(writer, "AIRCRFT");
  push(writer);

  let faceNumber = 1;
  for (let objectIndex = 0; objectIndex < input.models.length; objectIndex += 1) {
    const model = input.models[objectIndex];
    if (model.triangles.length === 0) continue;
    const textureIndex = model.texturePath ? textureBySource.get(model.texturePath.toLowerCase()) ?? -1 : -1;
    writeObject(writer, `OBJ${String(objectIndex + 1).padStart(4, "0")}`.slice(0, 7));
    push(writer);
    for (const triangle of model.triangles) {
      const materialIndex = materialPalette.indices.get(materialKey(normalizedMaterial(triangle))) ?? -1;
      writeFace(writer, `F${String(faceNumber).padStart(6, "0")}`.slice(0, 7), textureIndex, materialIndex, triangle);
      push(writer);
      const base = modelVertexBaseOffsets[objectIndex];
      const indices = openFlightTriangleIndices(triangle, input.coordinateMode);
      writeVertexList(writer, [
        base + indices[0] * VERTEX_RECORD_LENGTH,
        base + indices[1] * VERTEX_RECORD_LENGTH,
        base + indices[2] * VERTEX_RECORD_LENGTH,
      ]);
      pop(writer);
      faceNumber += 1;
    }
    pop(writer);
  }

  pop(writer);
  pop(writer);
  return writer.toUint8Array();
}

function uint16(view: DataView, offset: number): number { return view.getUint16(offset, false); }
function int32(view: DataView, offset: number): number { return view.getInt32(offset, false); }

export function validateOpenFlight(bytes: Uint8Array): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let recordCount = 0;
  let hierarchyDepth = 0;
  let vertexPaletteLength = 0;
  let faces = 0;
  let vertexLists = 0;

  while (offset + 4 <= bytes.byteLength) {
    const opcode = uint16(view, offset);
    const length = uint16(view, offset + 2);
    recordCount += 1;
    if (recordCount === 1 && (opcode !== 1 || length !== HEADER_LENGTH)) {
      diagnostics.push({ severity: "error", code: "FLT_BAD_HEADER", message: "The file does not begin with a valid OpenFlight 16.0 header." });
      break;
    }
    if (length < 4 || offset + length > bytes.byteLength) {
      diagnostics.push({ severity: "error", code: "FLT_TRUNCATED_RECORD", message: `Record ${recordCount} is truncated or has an invalid length.` });
      break;
    }
    if (opcode === 10) hierarchyDepth += 1;
    if (opcode === 11) hierarchyDepth -= 1;
    if (hierarchyDepth < 0) {
      diagnostics.push({ severity: "error", code: "FLT_UNBALANCED_HIERARCHY", message: "A pop record appears without a matching push record." });
      break;
    }
    if (opcode === 2 && hierarchyDepth < 1) diagnostics.push({ severity: "error", code: "FLT_MISSING_HEADER_LEVEL", message: "The first group is not nested beneath the OpenFlight header." });
    if (opcode === 4 && hierarchyDepth < 2) diagnostics.push({ severity: "error", code: "FLT_BAD_OBJECT_HIERARCHY", message: "An object is not nested beneath a group." });
    if (opcode === 5) {
      faces += 1;
      if (hierarchyDepth < 3) diagnostics.push({ severity: "error", code: "FLT_BAD_FACE_HIERARCHY", message: "A face is not nested beneath an object." });
    }
    if (opcode === 67) {
      vertexPaletteLength = int32(view, offset + 4);
      if (length !== VERTEX_PALETTE_HEADER_LENGTH || vertexPaletteLength < VERTEX_PALETTE_HEADER_LENGTH || offset + vertexPaletteLength > bytes.byteLength) {
        diagnostics.push({ severity: "error", code: "FLT_BAD_VERTEX_PALETTE", message: "The vertex palette length is invalid." });
        break;
      }
      offset += vertexPaletteLength;
      continue;
    }
    if (opcode === 72) {
      vertexLists += 1;
      if (hierarchyDepth < 4) diagnostics.push({ severity: "error", code: "FLT_BAD_VERTEX_LIST_HIERARCHY", message: "A vertex list is not nested beneath a face." });
      if (length !== VERTEX_LIST_LENGTH) diagnostics.push({ severity: "error", code: "FLT_BAD_VERTEX_LIST", message: "A vertex list has an invalid length." });
      for (let cursor = offset + 4; cursor + 4 <= offset + length; cursor += 4) {
        const vertexOffset = int32(view, cursor);
        if (vertexOffset < VERTEX_PALETTE_HEADER_LENGTH || vertexOffset + VERTEX_RECORD_LENGTH > vertexPaletteLength || (vertexOffset - VERTEX_PALETTE_HEADER_LENGTH) % VERTEX_RECORD_LENGTH !== 0) {
          diagnostics.push({ severity: "error", code: "FLT_BAD_VERTEX_REFERENCE", message: "A face references a vertex outside the vertex palette." });
          break;
        }
      }
    }
    offset += length;
  }

  if (offset !== bytes.byteLength) diagnostics.push({ severity: "error", code: "FLT_TRAILING_OR_TRUNCATED_DATA", message: "The OpenFlight record stream did not end at the file boundary." });
  if (hierarchyDepth !== 0) diagnostics.push({ severity: "error", code: "FLT_UNBALANCED_HIERARCHY", message: "The OpenFlight hierarchy contains unmatched push/pop records." });
  if (recordCount === 0) diagnostics.push({ severity: "error", code: "FLT_EMPTY", message: "The generated OpenFlight file is empty." });
  if (faces === 0 || vertexLists !== faces) diagnostics.push({ severity: "error", code: "FLT_INCOMPLETE_FACE_GEOMETRY", message: "Every face must contain exactly one vertex list." });
  return diagnostics;
}
