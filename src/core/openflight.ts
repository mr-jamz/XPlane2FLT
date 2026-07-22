import type { Diagnostic, Obj8Model, Obj8Triangle, Obj8Vertex } from "./types";

const HEADER_LENGTH = 324;
const FACE_LENGTH = 80;
const VERTEX_RECORD_LENGTH = 64;

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

interface IndexedVertex {
  vertex: Obj8Vertex;
  paletteOffset: number;
}

class BigEndianWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  get length(): number {
    return this.offset;
  }

  uint8(value: number): void {
    this.view.setUint8(this.offset, value & 0xff); this.offset += 1;
  }

  int8(value: number): void {
    this.uint8(value);
  }

  uint16(value: number): void {
    this.view.setUint16(this.offset, value & 0xffff, false); this.offset += 2;
  }

  int16(value: number): void {
    this.uint16(value & 0xffff);
  }

  uint32(value: number): void {
    this.view.setUint32(this.offset, value >>> 0, false); this.offset += 4;
  }

  int32(value: number): void {
    this.uint32(value >>> 0);
  }

  float32(value: number): void {
    this.view.setFloat32(this.offset, value, false); this.offset += 4;
  }

  float64(value: number): void {
    this.view.setFloat64(this.offset, value, false); this.offset += 8;
  }

  ascii(value: string, length: number): void {
    for (let index = 0; index < length; index += 1) {
      this.uint8(index < value.length ? value.charCodeAt(index) & 0x7f : 0);
    }
  }

  zeros(length: number): void {
    this.offset += length;
  }

  raw(value: Uint8Array): void {
    this.bytes.set(value, this.offset); this.offset += value.byteLength;
  }

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
  writer.int16(2); // next group id
  writer.int16(1); // next LOD id
  writer.int16(objectCount + 1);
  writer.int16(Math.min(32767, faceCount + 1));
  writer.int16(1); // unit multiplier
  writer.int8(0); // meters
  writer.int8(0); // texwhite
  writer.int32(0);
  writer.zeros(24);
  writer.int32(0); // flat earth
  writer.zeros(28);
  writer.int16(1); // next DOF
  writer.int16(1); // double precision vertices
  writer.int32(100); // OpenFlight origin
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
  writer.int32(0); // WGS84
  writer.int16(1);
  writer.int16(1);
  writer.int16(0);
  writer.zeros(6);
  writer.float64(0); // delta z
  writer.float64(0); // radius
  writer.uint16(1); // next mesh
  writer.uint16(1); // next light point system
  writer.int32(0);
  writer.float64(6378137);
  writer.float64(6356752.314245);

  if (writer.length - start !== HEADER_LENGTH) {
    throw new Error(`Internal error: OpenFlight header is ${writer.length - start} bytes, expected ${HEADER_LENGTH}.`);
  }
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

function writeVertexPalette(writer: BigEndianWriter, vertices: IndexedVertex[]): void {
  const paletteLength = 8 + vertices.length * VERTEX_RECORD_LENGTH;
  recordHeader(writer, 67, 8);
  writer.int32(paletteLength);

  for (const { vertex } of vertices) {
    recordHeader(writer, 70, VERTEX_RECORD_LENGTH);
    writer.uint16(0); // color name index
    writer.uint16(0x3000); // no color + packed color flag
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

function writeGroup(writer: BigEndianWriter, id: string): void {
  recordHeader(writer, 2, 44);
  writer.ascii(id, 8);
  writer.int16(0);
  writer.int16(0);
  writer.int32(0);
  writer.int16(0);
  writer.int16(0);
  writer.int16(0);
  writer.int8(0);
  writer.int8(0);
  writer.int32(0);
  writer.int32(0);
  writer.float32(0);
  writer.float32(0);
}

function writeObject(writer: BigEndianWriter, id: string): void {
  recordHeader(writer, 4, 28);
  writer.ascii(id, 8);
  writer.int32(0);
  writer.int16(0);
  writer.uint16(0);
  writer.int16(0);
  writer.int16(0);
  writer.int16(0);
  writer.int16(0);
}

function writeFace(writer: BigEndianWriter, id: string, textureIndex: number, doubleSided: boolean): void {
  const start = writer.length;
  recordHeader(writer, 5, FACE_LENGTH);
  writer.ascii(id, 8);
  writer.int32(0);
  writer.int16(0);
  writer.int8(doubleSided ? 1 : 0);
  writer.int8(textureIndex >= 0 ? 1 : 0);
  writer.uint16(0);
  writer.uint16(0);
  writer.int8(0);
  writer.int8(0);
  writer.int16(-1);
  writer.int16(textureIndex);
  writer.int16(-1);
  writer.int16(0);
  writer.int16(0);
  writer.int32(0);
  writer.uint16(0);
  writer.uint8(0);
  writer.uint8(0);
  writer.uint32(0x10000000); // packed primary color
  writer.uint8(2); // use face color and vertex normals
  writer.zeros(7);
  writer.uint32(0xffffffff);
  writer.uint32(0xffffffff);
  writer.int16(-1);
  writer.int16(0);
  writer.uint32(0);
  writer.uint32(0);
  writer.int16(0);
  writer.int16(-1);

  if (writer.length - start !== FACE_LENGTH) {
    throw new Error(`Internal error: OpenFlight face is ${writer.length - start} bytes, expected ${FACE_LENGTH}.`);
  }
}

function writeVertexList(writer: BigEndianWriter, offsets: [number, number, number]): void {
  recordHeader(writer, 72, 16);
  writer.int32(offsets[0]);
  writer.int32(offsets[1]);
  writer.int32(offsets[2]);
}

function push(writer: BigEndianWriter): void {
  recordHeader(writer, 10, 4);
}

function pop(writer: BigEndianWriter): void {
  recordHeader(writer, 11, 4);
}

export function buildOpenFlight(input: BuildInput): Uint8Array {
  const vertexCount = input.models.reduce((sum, model) => sum + model.vertices.length, 0);
  const triangleCount = input.models.reduce((sum, model) => sum + model.triangles.length, 0);
  const populatedObjectCount = input.models.filter((model) => model.triangles.length > 0).length;
  const outputSize = HEADER_LENGTH + input.textures.length * 216 + 8 + vertexCount * VERTEX_RECORD_LENGTH
    + 44 + 4 + populatedObjectCount * (28 + 4 + 4) + triangleCount * (FACE_LENGTH + 4 + 16 + 4) + 4;
  if (!Number.isSafeInteger(outputSize) || outputSize > 1_500_000_000) {
    throw new Error("The selected objects exceed the safe browser export size. Select fewer OBJ8 meshes and try again.");
  }
  const writer = new BigEndianWriter(outputSize);
  const textureBySource = new Map(input.textures.map((texture) => [texture.sourcePath.toLowerCase(), texture.index]));
  const uniqueVertices: IndexedVertex[] = [];
  const modelVertexOffsets: number[][] = [];

  for (let objectIndex = 0; objectIndex < input.models.length; objectIndex += 1) {
    const model = input.models[objectIndex];
    const offsets: number[] = [];
    for (const sourceVertex of model.vertices) {
      const vertex = transformVertex(sourceVertex, input.coordinateMode);
      const paletteOffset = 8 + uniqueVertices.length * VERTEX_RECORD_LENGTH;
      uniqueVertices.push({ vertex, paletteOffset });
      offsets.push(paletteOffset);
    }
    modelVertexOffsets.push(offsets);
  }

  writeHeader(writer, input.databaseId ?? "db", triangleCount, input.models.length);
  for (const texture of input.textures) writeTexturePalette(writer, texture);
  writeVertexPalette(writer, uniqueVertices);
  writeGroup(writer, "AIRCRFT");
  push(writer);

  let faceNumber = 1;
  for (let objectIndex = 0; objectIndex < input.models.length; objectIndex += 1) {
    const objectTriangles = input.models[objectIndex].triangles;
    if (objectTriangles.length === 0) continue;
    const textureIndex = input.models[objectIndex].texturePath ? textureBySource.get(input.models[objectIndex].texturePath!.toLowerCase()) ?? -1 : -1;
    writeObject(writer, `OBJ${String(objectIndex + 1).padStart(4, "0")}`.slice(0, 7));
    push(writer);
    for (const triangle of objectTriangles) {
      writeFace(writer, `F${String(faceNumber).padStart(6, "0")}`.slice(0, 7), textureIndex, triangle.doubleSided);
      push(writer);
      const offsets = modelVertexOffsets[objectIndex];
      writeVertexList(writer, [
        offsets[triangle.indices[0]],
        offsets[triangle.indices[1]],
        offsets[triangle.indices[2]],
      ]);
      pop(writer);
      faceNumber += 1;
    }
    pop(writer);
  }

  pop(writer);
  return writer.toUint8Array();
}

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function int32(view: DataView, offset: number): number {
  return view.getInt32(offset, false);
}

export function validateOpenFlight(bytes: Uint8Array): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let recordCount = 0;
  let hierarchyDepth = 0;
  let vertexPaletteStart = -1;
  let vertexPaletteLength = 0;

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
    if (opcode === 67) {
      vertexPaletteStart = offset;
      vertexPaletteLength = int32(view, offset + 4);
      if (vertexPaletteLength < 8 || offset + vertexPaletteLength > bytes.byteLength) {
        diagnostics.push({ severity: "error", code: "FLT_BAD_VERTEX_PALETTE", message: "The vertex palette length is invalid." });
        break;
      }
      offset += vertexPaletteLength;
      continue;
    }
    if (opcode === 72 && vertexPaletteStart >= 0) {
      for (let cursor = offset + 4; cursor + 4 <= offset + length; cursor += 4) {
        const vertexOffset = int32(view, cursor);
        if (vertexOffset < 8 || vertexOffset + VERTEX_RECORD_LENGTH > vertexPaletteLength) {
          diagnostics.push({ severity: "error", code: "FLT_BAD_VERTEX_REFERENCE", message: "A face references a vertex outside the vertex palette." });
          break;
        }
      }
    }
    offset += length;
  }

  if (offset !== bytes.byteLength) {
    diagnostics.push({ severity: "error", code: "FLT_TRAILING_OR_TRUNCATED_DATA", message: "The OpenFlight record stream did not end at the file boundary." });
  }
  if (hierarchyDepth !== 0) {
    diagnostics.push({ severity: "error", code: "FLT_UNBALANCED_HIERARCHY", message: "The OpenFlight hierarchy contains unmatched push/pop records." });
  }
  if (recordCount === 0) {
    diagnostics.push({ severity: "error", code: "FLT_EMPTY", message: "The generated OpenFlight file is empty." });
  }
  return diagnostics;
}

