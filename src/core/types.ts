export type Severity = "info" | "warning" | "error";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
}

export interface Obj8Vertex {
  position: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
}

export interface Obj8Triangle {
  indices: [number, number, number];
  doubleSided: boolean;
}

export interface Obj8Model {
  path: string;
  name: string;
  texturePath?: string;
  litTexturePath?: string;
  normalTexturePath?: string;
  vertices: Obj8Vertex[];
  triangles: Obj8Triangle[];
  diagnostics: Diagnostic[];
}

export interface ArchiveEntrySummary {
  path: string;
  size: number;
  kind: "aircraft" | "object" | "texture" | "support" | "other";
}

export interface ArchiveInspection {
  archiveName: string;
  rootName: string;
  entries: ArchiveEntrySummary[];
  aircraftFiles: string[];
  objectFiles: string[];
  textureFiles: string[];
  models: Obj8Model[];
  diagnostics: Diagnostic[];
  totals: {
    files: number;
    vertices: number;
    triangles: number;
    sourceBytes: number;
  };
}

export interface ConversionOptions {
  outputName: string;
  coordinateMode: "openflight-z-up" | "keep-xplane";
  includeUnreferencedTextures: boolean;
}

export interface ConversionResult {
  flt: Uint8Array;
  packageZip: Uint8Array;
  fltFileName: string;
  packageFileName: string;
  diagnostics: Diagnostic[];
  textureCount: number;
  objectCount: number;
  triangleCount: number;
}

