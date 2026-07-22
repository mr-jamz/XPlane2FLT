import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { convertArchive, inspectArchive } from "../src/core/archive";

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
});

