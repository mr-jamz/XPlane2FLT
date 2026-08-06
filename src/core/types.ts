export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface SourceFile {
  path: string;
  file: File;
}

export interface Obj8Vertex {
  position: Vec3;
  normal: Vec3;
  uv: Vec2;
}

export interface MaterialState {
  diffuse: Vec3;
  emissive: Vec3;
  shinyRatio: number;
  doubleSided: boolean;
  blend: "blend" | "test" | "shadow";
  alphaCutoff: number;
  draw: boolean;
  depthTest: boolean;
  cockpit: boolean;
  lightLevel?: {
    min: number;
    max: number;
    dataref: string;
  };
}

export interface Obj8Batch {
  id: string;
  indices: number[];
  material: MaterialState;
  animationPath: number[];
  lod: [number, number] | null;
  line: number;
}

export type AnimationTransform =
  | {
      type: "rotate";
      axis: Vec3;
      keys: Array<{ value: number; angle: number }>;
      dataref: string;
    }
  | {
      type: "translate";
      keys: Array<{ value: number; position: Vec3 }>;
      dataref: string;
    };

export interface VisibilityRule {
  mode: "show" | "hide";
  min: number;
  max: number;
  dataref: string;
}

export interface AnimationGroup {
  id: number;
  parentId: number | null;
  transforms: AnimationTransform[];
  visibility: VisibilityRule[];
}

export interface Obj8Light {
  kind: "named" | "param" | "custom";
  name: string;
  position: Vec3;
  color?: [number, number, number, number];
  animationPath: number[];
}

export interface Obj8Model {
  path: string;
  name: string;
  vertices: Obj8Vertex[];
  batches: Obj8Batch[];
  animations: AnimationGroup[];
  lights: Obj8Light[];
  texture?: string;
  textureLit?: string;
  textureNormal?: string;
  textureMaps: Partial<Record<"normal" | "material_gloss" | "gloss", string>>;
  normalMetalness: boolean;
  globalSpecular: number;
  luminance: number | null;
  datarefs: string[];
  warnings: string[];
}

export type AttachmentRole = "exterior" | "interior" | "glass" | "cockpit" | "unknown";

export interface AircraftAttachment {
  index: number;
  path: string;
  role: AttachmentRole;
  position: Vec3;
  rotation: Vec3;
  hideDataref?: string;
}

export interface AircraftManifest {
  acfPath?: string;
  name: string;
  attachments: AircraftAttachment[];
  warnings: string[];
}

export interface LoadedAircraft {
  name: string;
  files: SourceFile[];
  models: Obj8Model[];
  manifest: AircraftManifest;
  fileMap: Map<string, File>;
  defaultDatarefs: Record<string, number>;
}
