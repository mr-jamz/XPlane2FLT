import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildExportModels, exportAircraftToFlt } from "./export";
import type { LoadedAircraft, MaterialState, Obj8Model } from "./types";

const material: MaterialState = {
  diffuse: [1, 1, 1],
  emissive: [0, 0, 0],
  shinyRatio: 0,
  doubleSided: false,
  blend: "test",
  alphaCutoff: 0.5,
  draw: true,
  depthTest: true,
  cockpit: false,
};

function sourceModel(path = "objects/body.obj"): Obj8Model {
  return {
    path,
    name: path.split("/").pop()!,
    vertices: [
      { position: [1, 2, 3], normal: [0, 1, 0], uv: [0.125, 0.875] },
      { position: [2, 2, 3], normal: [0, 1, 0], uv: [1, 0] },
      { position: [1, 3, 3], normal: [0, 1, 0], uv: [0, 1] },
    ],
    batches: [{
      id: `${path}:1`,
      indices: [0, 1, 2],
      material,
      animationPath: [0, 1],
      lod: null,
      line: 1,
    }],
    animations: [
      { id: 0, parentId: null, transforms: [], visibility: [] },
      {
        id: 1,
        parentId: 0,
        transforms: [{
          type: "translate",
          keys: [
            { value: 0, position: [4, 5, 6] },
            { value: 0, position: [4, 5, 6] },
          ],
          dataref: "none",
        }],
        visibility: [],
      },
    ],
    lights: [],
    texture: "body.png",
    textureMaps: {},
    normalMetalness: false,
    globalSpecular: 0,
    luminance: null,
    datarefs: [],
    warnings: [],
  };
}

function aircraft(models = [sourceModel()]): LoadedAircraft {
  const texture = new File([new Uint8Array([137, 80, 78, 71])], "body.png", { type: "image/png" });
  return {
    name: "Test Aircraft",
    files: [{ path: "objects/body.png", file: texture }],
    models,
    manifest: {
      name: "Test Aircraft",
      warnings: [],
      attachments: models.map((model, index) => ({
        index,
        path: model.path,
        role: "exterior" as const,
        position: [10, 20, 30] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      })),
    },
    fileMap: new Map([["objects/body.png", texture]]),
    defaultDatarefs: {},
  };
}

describe("viewer-to-FLT scene baking", () => {
  it("bakes ACF and nested OBJ8 transforms while preserving every UV coordinate", () => {
    const loaded = aircraft();
    const result = buildExportModels(loaded, {
      visiblePaths: new Set(["objects/body.obj"]),
      datarefs: {},
      lodDistance: 0,
    });

    expect(result.models).toHaveLength(1);
    expect(result.models[0].vertices[0].position).toEqual([15, 27, 39]);
    expect(result.models[0].vertices[0].uv).toEqual([0.125, 0.875]);
    expect(result.models[0].triangles[0].indices).toEqual([0, 1, 2]);
  });

  it("uses object toggles and ACF hide datarefs before building the combined file", () => {
    const body = sourceModel();
    const rotor = sourceModel("objects/rotor.obj");
    const loaded = aircraft([body, rotor]);
    loaded.manifest.attachments[1].hideDataref = "test/kill/rotor";

    expect(buildExportModels(loaded, {
      visiblePaths: new Set([body.path, rotor.path]),
      datarefs: { "test/kill/rotor": 1 },
      lodDistance: 0,
    }).models.map((model) => model.path)).toEqual(["objects/body.obj#0"]);

    expect(buildExportModels(loaded, {
      visiblePaths: new Set([rotor.path]),
      datarefs: { "test/kill/rotor": 0 },
      lodDistance: 0,
    }).models.map((model) => model.path)).toEqual(["objects/rotor.obj#1"]);
  });

  it("exports thin cockpit and interior shells as two-sided OpenFlight faces", () => {
    const interior = sourceModel("objects/interior2.obj");
    const loaded = aircraft([interior]);
    loaded.manifest.attachments[0].role = "interior";

    const result = buildExportModels(loaded, {
      visiblePaths: new Set([interior.path]),
      datarefs: {},
      lodDistance: 0,
    });

    expect(result.models[0].triangles[0].doubleSided).toBe(true);
  });

  it("packages one validated FLT together with the exact resolved texture bytes", async () => {
    const loaded = aircraft();
    const result = await exportAircraftToFlt(loaded, {
      outputName: "test-aircraft",
      coordinateMode: "openflight-z-up",
      visiblePaths: new Set(["objects/body.obj"]),
      datarefs: {},
      lodDistance: 0,
    });
    const zip = await JSZip.loadAsync(result.packageZip);

    expect(result.objectCount).toBe(1);
    expect(result.triangleCount).toBe(1);
    expect(result.textureCount).toBe(1);
    expect(zip.file("test-aircraft.flt")).not.toBeNull();
    expect(zip.file("textures/body.png")).not.toBeNull();
    expect(zip.file("conversion-report.json")).not.toBeNull();
    expect(await zip.file("textures/body.png")!.async("uint8array")).toEqual(new Uint8Array([137, 80, 78, 71]));
  });
});
