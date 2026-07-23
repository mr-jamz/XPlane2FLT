import type { Diagnostic, Obj8Model, Obj8Triangle, Obj8Vertex } from "./types";

const HEADER_LENGTH = 324;
const GROUP_LENGTH = 44;
const MESH_LENGTH = 84;
const LOCAL_VERTEX_POOL_HEADER_LENGTH = 12;
const LOCAL_VERTEX_BYTES = 44; // position (3 doubles), normal (3 floats), base UV (2 floats)
const MAX_RECORD_LENGTH = 65_535;
const MAX_LOCAL_VERTICES = Math.floor((MAX_RECORD_LENGTH - LOCAL_VERTEX_POOL_HEADER_LENGTH) / LOCAL_VERTEX_BYTES);
const LOCAL_VERTEX_ATTRIBUTE_MASK = 0x98000000; // position, normal, base UV (bits are MSB-first)

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

interface MeshBatch {
  vertices: Obj8Vertex[];
  triangles: [number, number, number][];
  doubleSided: boolean;
  textureIndex: number;
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

function writeHeader(writer: BigEndianWriter, databaseId: string, meshCount: number): void {
  const start = writer.length;
  recordHeader(writer, 1, HEADER_LENGTH);
  writer.ascii(databaseId.slice(0, 7) || "db", 8);
  writer.int32(1600);
  writer.int32(1);
  writer.ascii(new Date().toISOString().replace("T", " ").replace("Z", " UTC"), 32);
  writer.int16(2);
  writer.int16(1);
  writer.int16(1);
  writer.int16(1);
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
  writer.uint16(Math.min(65_535, meshCount + 1));
  writer.uint16(1);
  writer.int32(0);
  writer.float64(6378137);
  writer.float64(6356752.314245);
  if (writer.length - start !== HEADER_LENGTH) throw new Error(`Internal error: OpenFlight header is ${writer.length - start} bytes, expected ${HEADER_LENGTH}.`);
}

function writeTexturePalette(writer: BigEndianWriter, texture: TextureBinding): void {
  recordHeader(writer, 64, 216);
  writer.ascii(texture.outputPath, 200);
  writer.int32(texture.index);
  writer.int32((texture.index % 16) * 64);
  writer.int32(Math.floor(texture.index / 16) * 64);
}

function transformVertex(vertex: Obj8Vertex, coordinateMode: BuildInput["coordinateMode"]): Obj8Vertex {
  if (coordinateMode === "keep-xplane") return vertex;
  return {
    position: [vertex.position[0], -vertex.position[2], vertex.position[1]],
    normal: [vertex.normal[0], -vertex.normal[2], vertex.normal[1]],
    uv: vertex.uv,
  };
}

function writeGroup(writer: BigEndianWriter, id: string): void {
  recordHeader(writer, 2, GROUP_LENGTH);
  writer.ascii(id, 8);
  writer.int16(0); writer.int16(0); writer.int32(0); writer.int16(0); writer.int16(0); writer.int16(0);
  writer.int8(0); writer.int8(0); writer.int32(0); writer.int32(0); writer.float32(0); writer.float32(0);
}

function writeMesh(writer: BigEndianWriter, id: string, textureIndex: number, doubleSided: boolean): void {
  const start = writer.length;
  recordHeader(writer, 84, MESH_LENGTH);
  writer.ascii(id, 8);
  writer.int32(0); // reserved
  writer.int32(0); // IR color code
  writer.int16(0); // relative priority
  writer.int8(doubleSided ? 1 : 0); // draw type
  writer.int8(textureIndex >= 0 ? 1 : 0); // texture white
  writer.uint16(0); writer.uint16(0); writer.uint8(0); writer.uint8(0);
  writer.int16(-1); // detail texture
  writer.int16(textureIndex);
  writer.int16(-1); // material
  writer.int16(0); writer.int16(0); writer.int32(0);
  writer.uint16(0); writer.uint8(0); writer.uint8(0);
  writer.uint32(0x10000000); // packed-color flag
  writer.uint8(2); // mesh color + vertex normals
  writer.zeros(7);
  writer.uint32(0xffffffff); writer.uint32(0xffffffff);
  writer.int16(-1); writer.int16(0);
  writer.uint32(0); writer.uint32(0);
  writer.int16(0); writer.int16(-1);
  if (writer.length - start !== MESH_LENGTH) throw new Error(`Internal error: OpenFlight mesh is ${writer.length - start} bytes, expected ${MESH_LENGTH}.`);
}

function writeLocalVertexPool(writer: BigEndianWriter, vertices: Obj8Vertex[]): void {
  const length = LOCAL_VERTEX_POOL_HEADER_LENGTH + vertices.length * LOCAL_VERTEX_BYTES;
  if (length > MAX_RECORD_LENGTH) throw new Error("Internal error: local vertex pool exceeds the OpenFlight record-size limit.");
  recordHeader(writer, 85, length);
  writer.uint32(vertices.length);
  writer.uint32(LOCAL_VERTEX_ATTRIBUTE_MASK);
  for (const vertex of vertices) {
    writer.float64(vertex.position[0]); writer.float64(vertex.position[1]); writer.float64(vertex.position[2]);
    writer.float32(vertex.normal[0]); writer.float32(vertex.normal[1]); writer.float32(vertex.normal[2]);
    writer.float32(vertex.uv[0]); writer.float32(vertex.uv[1]);
  }
}

function triangleStripIndices(triangles: [number, number, number][]): number[] {
  if (triangles.length === 0) return [];
  const indices = [...triangles[0]];
  for (let index = 1; index < triangles.length; index += 1) {
    const source = triangles[index];
    const realTriangleStart = indices.length + 2;
    const order = realTriangleStart % 2 === 0 ? source : [source[1], source[0], source[2]] as [number, number, number];
    indices.push(indices[indices.length - 1], order[0], order[0], order[1], order[2]);
  }
  return indices;
}

function writeMeshPrimitive(writer: BigEndianWriter, triangles: [number, number, number][]): void {
  const indices = triangleStripIndices(triangles);
  const indexSize = 2;
  const length = 12 + indices.length * indexSize;
  if (length > MAX_RECORD_LENGTH) throw new Error("Internal error: mesh primitive exceeds the OpenFlight record-size limit.");
  recordHeader(writer, 86, length);
  writer.int16(1); // triangle strip
  writer.uint16(indexSize);
  writer.uint32(indices.length);
  for (const index of indices) writer.uint16(index);
}

function push(writer: BigEndianWriter): void { recordHeader(writer, 10, 4); }
function pop(writer: BigEndianWriter): void { recordHeader(writer, 11, 4); }

function buildMeshBatches(models: Obj8Model[], textureBySource: Map<string, number>, coordinateMode: BuildInput["coordinateMode"]): MeshBatch[] {
  const batches: MeshBatch[] = [];
  for (const model of models) {
    const textureIndex = model.texturePath ? textureBySource.get(model.texturePath.toLowerCase()) ?? -1 : -1;
    let batch: MeshBatch | undefined;
    let remap = new Map<number, number>();

    const beginBatch = (triangle: Obj8Triangle): MeshBatch => {
      remap = new Map<number, number>();
      const next = { vertices: [], triangles: [], doubleSided: triangle.doubleSided, textureIndex } as MeshBatch;
      batches.push(next);
      return next;
    };

    for (const triangle of model.triangles) {
      const needed = triangle.indices.reduce((count, sourceIndex) => count + (remap.has(sourceIndex) ? 0 : 1), 0);
      if (!batch || batch.doubleSided !== triangle.doubleSided || batch.vertices.length + needed > MAX_LOCAL_VERTICES) batch = beginBatch(triangle);
      const local = triangle.indices.map((sourceIndex) => {
        let localIndex = remap.get(sourceIndex);
        if (localIndex === undefined) {
          localIndex = batch!.vertices.length;
          remap.set(sourceIndex, localIndex);
          batch!.vertices.push(transformVertex(model.vertices[sourceIndex], coordinateMode));
        }
        return localIndex;
      }) as [number, number, number];
      batch.triangles.push(local);
    }
  }
  return batches;
}

function batchByteLength(batch: MeshBatch): number {
  const stripIndexCount = batch.triangles.length === 0 ? 0 : 3 + (batch.triangles.length - 1) * 5;
  return MESH_LENGTH + LOCAL_VERTEX_POOL_HEADER_LENGTH + batch.vertices.length * LOCAL_VERTEX_BYTES + 4 + 12 + stripIndexCount * 2 + 4;
}

export function buildOpenFlight(input: BuildInput): Uint8Array {
  const textureBySource = new Map(input.textures.map((texture) => [texture.sourcePath.toLowerCase(), texture.index]));
  const batches = buildMeshBatches(input.models, textureBySource, input.coordinateMode);
  const outputSize = HEADER_LENGTH + input.textures.length * 216 + GROUP_LENGTH + 4 + batches.reduce((sum, batch) => sum + batchByteLength(batch), 0) + 4;
  if (!Number.isSafeInteger(outputSize) || outputSize > 1_500_000_000) throw new Error("The selected objects exceed the safe browser export size. Select fewer OBJ8 meshes and try again.");

  const writer = new BigEndianWriter(outputSize);
  writeHeader(writer, input.databaseId ?? "db", batches.length);
  for (const texture of input.textures) writeTexturePalette(writer, texture);
  writeGroup(writer, "AIRCRFT");
  push(writer);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    writeMesh(writer, `M${String(index + 1).padStart(6, "0")}`.slice(0, 7), batch.textureIndex, batch.doubleSided);
    writeLocalVertexPool(writer, batch.vertices);
    push(writer);
    writeMeshPrimitive(writer, batch.triangles);
    pop(writer);
  }
  pop(writer);
  return writer.toUint8Array();
}

function uint16(view: DataView, offset: number): number { return view.getUint16(offset, false); }
function uint32(view: DataView, offset: number): number { return view.getUint32(offset, false); }

export function validateOpenFlight(bytes: Uint8Array): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let recordCount = 0;
  let hierarchyDepth = 0;
  let pendingMeshVertices: number | null = null;
  let meshes = 0;
  let pools = 0;
  let primitives = 0;

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
    if (opcode === 84) {
      meshes += 1;
      pendingMeshVertices = null;
      if (length !== MESH_LENGTH) diagnostics.push({ severity: "error", code: "FLT_BAD_MESH", message: "A mesh record has an invalid length." });
    } else if (opcode === 85) {
      pools += 1;
      pendingMeshVertices = uint32(view, offset + 4);
      const mask = uint32(view, offset + 8);
      const expected = LOCAL_VERTEX_POOL_HEADER_LENGTH + pendingMeshVertices * LOCAL_VERTEX_BYTES;
      if (mask !== LOCAL_VERTEX_ATTRIBUTE_MASK || length !== expected) diagnostics.push({ severity: "error", code: "FLT_BAD_LOCAL_VERTEX_POOL", message: "A local vertex pool has an invalid mask or byte length." });
    } else if (opcode === 86) {
      primitives += 1;
      const primitiveType = uint16(view, offset + 4);
      const indexSize = uint16(view, offset + 6);
      const vertexCount = uint32(view, offset + 8);
      if (pendingMeshVertices === null) diagnostics.push({ severity: "error", code: "FLT_ORPHAN_MESH_PRIMITIVE", message: "A mesh primitive appears without a local vertex pool." });
      if (primitiveType !== 1 || indexSize !== 2 || length !== 12 + vertexCount * indexSize) diagnostics.push({ severity: "error", code: "FLT_BAD_MESH_PRIMITIVE", message: "A mesh primitive has invalid type, index size, or byte length." });
      for (let cursor = offset + 12; cursor + indexSize <= offset + length; cursor += indexSize) {
        if (pendingMeshVertices !== null && uint16(view, cursor) >= pendingMeshVertices) {
          diagnostics.push({ severity: "error", code: "FLT_BAD_MESH_INDEX", message: "A mesh primitive references a vertex outside its local vertex pool." });
          break;
        }
      }
    }
    offset += length;
  }
  if (offset !== bytes.byteLength) diagnostics.push({ severity: "error", code: "FLT_TRAILING_OR_TRUNCATED_DATA", message: "The OpenFlight record stream did not end at the file boundary." });
  if (hierarchyDepth !== 0) diagnostics.push({ severity: "error", code: "FLT_UNBALANCED_HIERARCHY", message: "The OpenFlight hierarchy contains unmatched push/pop records." });
  if (recordCount === 0) diagnostics.push({ severity: "error", code: "FLT_EMPTY", message: "The generated OpenFlight file is empty." });
  if (meshes === 0 || pools !== meshes || primitives !== meshes) diagnostics.push({ severity: "error", code: "FLT_INCOMPLETE_MESH", message: "Every mesh must contain exactly one local vertex pool and one mesh primitive." });
  return diagnostics;
}
