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
  selectedModelPaths: string[];
  optimization: GeometryOptimizationOptions;
}

export type OptimizationPreset = "original" | "balanced" | "performance" | "aggressive" | "custom";
export type TextureMaxSize = 0 | 4096 | 2048 | 1024;

export interface GeometryOptimizationOptions {
  preset: OptimizationPreset;
  targetTriangles: number;
  minTrianglesPerPart: number;
  preserveThinParts: boolean;
  weldVertices: boolean;
  removeDegenerateFaces: boolean;
  removeDuplicateFaces: boolean;
  textureMaxSize: TextureMaxSize;
}

export interface OptimizationStats {
  originalTriangles: number;
  cleanedTriangles: number;
  optimizedTriangles: number;
  originalVertices: number;
  optimizedVertices: number;
  parts: Array<{ path: string; originalTriangles: number; optimizedTriangles: number }>;
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
  optimization: OptimizationStats;
}
