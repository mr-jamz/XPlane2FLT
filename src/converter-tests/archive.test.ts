import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { convertArchive, inspectArchive } from "../converter/archive";

async function sampleAircraftZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("Demo Aircraft/demo.acf", "I\n1200 Version\n");
  zip.file(
    "Demo Aircraft/objects/body.obj",
    `I
800
OBJ
TEXTURE body.png
TEXTURE_LIT body_LIT.png
VT 0 0 0 0 1 0 0 0
VT 1 0 0 0 1 0 1 0
VT 0 1 0 0 1 0 0 1
IDX10 0 1 2
TRIS 0 3`,
  );
  zip.file("Demo Aircraft/objects/body.png", new Uint8Array([137, 80, 78, 71]));
  zip.file("Demo Aircraft/objects/body_LIT.png", new Uint8Array([137, 80, 78, 71, 1]));
  zip.file("Demo Aircraft/objects/unused.png", new Uint8Array([137, 80, 78, 71, 2]));
  return zip.generateAsync({ type: "uint8array" });
}

describe("aircraft archive pipeline", () => {
  it("inspects, converts, validates, and packages referenced textures", async () => {
    const source = await sampleAircraftZip();
    const inspection = await inspectArchive(source, "demo.zip");

    expect(inspection.rootName).toBe("Demo Aircraft");
    expect(inspection.aircraftFiles).toHaveLength(1);
    expect(inspection.models).toHaveLength(1);
    expect(inspection.totals.triangles).toBe(1);
    expect(inspection.models[0].texturePath).toBe("Demo Aircraft/objects/body.png");

    const result = await convertArchive(source, inspection, {
      outputName: "demo-aircraft",
      coordinateMode: "openflight-z-up",
      includeUnreferencedTextures: false,
      selectedModelPaths: inspection.models.map((model) => model.path),
      optimization: {
        preset: "original",
        targetTriangles: 1,
        minTrianglesPerPart: 4,
        preserveThinParts: true,
        weldVertices: true,
        removeDegenerateFaces: true,
        removeDuplicateFaces: true,
        textureMaxSize: 0,
      },
    });
    expect(result.fltFileName).toBe("demo-aircraft.flt");
    expect(result.textureCount).toBe(2);
    expect(result.triangleCount).toBe(1);

    const output = await JSZip.loadAsync(result.packageZip);
    expect(output.file("demo-aircraft.flt")).not.toBeNull();
    expect(output.file("textures/body.png")).not.toBeNull();
    expect(output.file("textures/body_LIT.png")).not.toBeNull();
    expect(output.file("textures/unused.png")).toBeNull();
    expect(output.file("conversion-report.json")).not.toBeNull();
  });

  it("reports monotonic conversion progress through completion", async () => {
    const source = await sampleAircraftZip();
    const inspection = await inspectArchive(source, "demo.zip");
    const updates: Array<{ percent: number; stage: string }> = [];

    await convertArchive(source, inspection, {
      outputName: "progress-demo",
      coordinateMode: "openflight-z-up",
      includeUnreferencedTextures: false,
      selectedModelPaths: inspection.models.map((model) => model.path),
      onProgress: (progress) => updates.push(progress),
      optimization: {
        preset: "original", targetTriangles: 1, minTrianglesPerPart: 1,
        preserveThinParts: true, weldVertices: false, removeDegenerateFaces: true,
        removeDuplicateFaces: true, textureMaxSize: 0,
      },
    });

    expect(updates.length).toBeGreaterThan(5);
    expect(updates.at(-1)).toEqual({ percent: 100, stage: "Conversion complete" });
    expect(updates.every((update, index) => index === 0 || update.percent >= updates[index - 1].percent)).toBe(true);
  });

  it("resolves an OBJ PNG texture reference to a same-stem DDS file", async () => {
    const zip = new JSZip();
    zip.file("Aircraft/demo.acf", "I\n1200 Version\n");
    zip.file("Aircraft/objects/fuselage.obj", [
      "I", "800", "OBJ", "TEXTURE exterior.png",
      "VT 0 0 0 0 0 1 0 0", "VT 1 0 0 0 0 1 1 0", "VT 0 1 0 0 0 1 0 1",
      "IDX 0 1 2", "TRIS 0 3",
    ].join("\n"));
    zip.file("Aircraft/objects/exterior.dds", new Uint8Array([68, 68, 83, 32]));
    const source = await zip.generateAsync({ type: "uint8array" });

    const inspection = await inspectArchive(source, "demo.zip");
    expect(inspection.models[0].texturePath).toBe("Aircraft/objects/exterior.dds");
    expect(inspection.diagnostics.some((item) => item.code === "MISSING_TEXTURE")).toBe(false);
  });

  it("derives saved plugin datarefs from the ACF and filters inactive OBJ8 visibility branches", async () => {
    const zip = new JSZip();
    zip.file("Aircraft/uh60m.acf", [
      "I", "1200 Version", "ACF",
      "P _obja/0/_v10_att_file_stl flircam.obj",
      "P _obja/0/_obj_hide_dataref uh60m/kill/flir",
    ].join("\n"));
    zip.file("Aircraft/opt_config.ini", "flir=1\nexterior=1\n");
    zip.file("Aircraft/objects/flircam.obj", [
      "I", "800", "OBJ",
      "VT 0 0 0 0 1 0 0 0", "VT 1 0 0 0 1 0 1 0", "VT 0 1 0 0 1 0 0 1",
      "VT 10 0 0 0 1 0 0 0", "VT 11 0 0 0 1 0 1 0", "VT 10 1 0 0 1 0 0 1",
      "IDX 0 1 2 3 4 5",
      "ANIM_begin", "ANIM_hide 0 0.9 uh60m/conf/flir",
      "ANIM_begin", "ANIM_show 1 1.5 uh60m/conf/exterior", "TRIS 0 3", "ANIM_end",
      "ANIM_begin", "ANIM_hide 1 1.5 uh60m/conf/exterior", "TRIS 3 3", "ANIM_end",
      "ANIM_end",
    ].join("\n"));
    const source = await zip.generateAsync({ type: "uint8array" });

    const inspection = await inspectArchive(source, "uh60m.zip");

    expect(inspection.configurationDatarefs).toMatchObject({
      "uh60m/conf/flir": 1,
      "uh60m/conf/exterior": 1,
    });
    expect(inspection.models[0].triangles).toHaveLength(1);
    expect(inspection.models[0].excludedByVisibility).toBe(1);
  });

  it("warns before exporting geometry without a diffuse texture and supports an explicit bypass", async () => {
    const zip = new JSZip();
    zip.file("Aircraft/demo.acf", "I\n1200 Version\n");
    zip.file("Aircraft/objects/fuselage.obj", [
      "I", "800", "OBJ", "TEXTURE absent.png",
      "VT 0 0 0 0 0 1 0 0", "VT 1 0 0 0 0 1 1 0", "VT 0 1 0 0 0 1 0 1",
      "IDX 0 1 2", "TRIS 0 3",
    ].join("\n"));
    const source = await zip.generateAsync({ type: "uint8array" });
    const inspection = await inspectArchive(source, "demo.zip");

    await expect(convertArchive(source, inspection, {
      outputName: "demo",
      coordinateMode: "openflight-z-up",
      includeUnreferencedTextures: false,
      selectedModelPaths: inspection.models.map((model) => model.path),
      optimization: {
        preset: "original", targetTriangles: 1, minTrianglesPerPart: 1,
        preserveThinParts: true, weldVertices: true, removeDegenerateFaces: true,
        removeDuplicateFaces: true, textureMaxSize: 0,
      },
    })).rejects.toThrow("no resolvable diffuse texture");

    const output = await convertArchive(source, inspection, {
      outputName: "demo",
      coordinateMode: "openflight-z-up",
      includeUnreferencedTextures: false,
      selectedModelPaths: inspection.models.map((model) => model.path),
      allowMissingDiffuseTextures: true,
      optimization: {
        preset: "original", targetTriangles: 1, minTrianglesPerPart: 1,
        preserveThinParts: true, weldVertices: true, removeDegenerateFaces: true,
        removeDuplicateFaces: true, textureMaxSize: 0,
      },
    });
    expect(output.objectCount).toBe(1);
    expect(output.textureCount).toBe(0);
  });
});
