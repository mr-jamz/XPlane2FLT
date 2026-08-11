import type { Diagnostic, Obj8AnimationNode, Obj8Model, Obj8Triangle, Obj8Vertex } from "./types";
import { basename } from "./path";

function finiteNumbers(parts: string[], start: number, count: number): number[] | null {
  if (parts.length < start + count) return null;
  const values = parts.slice(start, start + count).map(Number);
  return values.every(Number.isFinite) ? values : null;
}

export function parseObj8(path: string, source: string): Obj8Model {
  const vertices: Obj8Vertex[] = [];
  const indexTable: number[] = [];
  const triangles: Obj8Triangle[] = [];
  const diagnostics: Diagnostic[] = [];
  const animationNodes: Obj8AnimationNode[] = [];
  const animationStack: string[] = [];
  let texturePath: string | undefined;
  let litTexturePath: string | undefined;
  let normalTexturePath: string | undefined;
  let doubleSided = false;
  let drawEnabled = true;
  let material = {
    diffuse: [1, 1, 1] as [number, number, number],
    emissive: [0, 0, 0] as [number, number, number],
    shininess: 0,
    alpha: 1,
    blended: false,
    alphaCutoff: 0.5,
  };
  let animationWarningAdded = false;
  let lodWarningAdded = false;

  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber].trim();
    if (!raw || raw.startsWith("#")) continue;
    const parts = raw.split(/\s+/);
    const command = parts[0].toUpperCase();

    if (command === "TEXTURE" && parts[1] && parts[1] !== "none") {
      texturePath = parts.slice(1).join(" ");
      continue;
    }
    if (command === "TEXTURE_LIT" && parts[1] && parts[1] !== "none") {
      litTexturePath = parts.slice(1).join(" ");
      continue;
    }
    if (command === "TEXTURE_NORMAL" && parts[1] && parts[1] !== "none") {
      normalTexturePath = parts.slice(1).join(" ");
      continue;
    }
    if (command === "ATTR_NO_CULL") {
      doubleSided = true;
      continue;
    }
    if (command === "ATTR_CULL") {
      doubleSided = false;
      continue;
    }
    if (command === "ATTR_DRAW_ENABLE") {
      drawEnabled = true;
      continue;
    }
    if (command === "ATTR_DRAW_DISABLE") {
      drawEnabled = false;
      continue;
    }
    if (command === "ATTR_DIFFUSE_RGB") {
      const values = finiteNumbers(parts, 1, 3);
      if (values) material = { ...material, diffuse: values as [number, number, number] };
      continue;
    }
    if (command === "ATTR_EMISSION_RGB") {
      const values = finiteNumbers(parts, 1, 3);
      if (values) material = { ...material, emissive: values as [number, number, number] };
      continue;
    }
    if (command === "ATTR_SHINY_RAT") {
      const values = finiteNumbers(parts, 1, 1);
      if (values) material = { ...material, shininess: Math.max(0, Math.min(128, values[0] * 128)) };
      continue;
    }
    if (command === "ATTR_BLEND") {
      material = { ...material, blended: true };
      continue;
    }
    if (command === "ATTR_NO_BLEND") {
      const values = finiteNumbers(parts, 1, 1);
      material = {
        ...material,
        blended: false,
        alphaCutoff: values ? Math.max(0, Math.min(1, values[0])) : 0.5,
      };
      continue;
    }
    if (command === "ANIM_BEGIN") {
      const id = `anim-${animationNodes.length + 1}`;
      animationNodes.push({
        id,
        parentId: animationStack.at(-1),
        name: `Anim${String(animationNodes.length + 1).padStart(4, "0")}`,
        datarefs: [],
      });
      animationStack.push(id);
      if (!animationWarningAdded) {
        diagnostics.push({
          severity: "warning",
          code: "OBJ8_ANIMATION_BAKED",
          file: path,
          message: "Animated geometry is exported in its authored base pose and retained as separate OpenFlight hierarchy nodes; X-Plane dataref keyframes are not transferred.",
        });
        animationWarningAdded = true;
      }
      continue;
    }
    if (command === "ANIM_END") {
      animationStack.pop();
      continue;
    }
    if (command === "ANIM_ROTATE" || command === "ANIM_ROTATE_BEGIN" || command === "ANIM_TRANS" || command === "ANIM_TRANS_BEGIN" || command === "ANIM_HIDE" || command === "ANIM_SHOW") {
      const currentId = animationStack.at(-1);
      const node = currentId ? animationNodes.find((candidate) => candidate.id === currentId) : undefined;
      if (node) {
        const dataref = parts.at(-1) ?? "";
        if (dataref.includes("/") && !node.datarefs.includes(dataref)) node.datarefs.push(dataref);

        const lower = `${dataref} ${parts.slice(1).join(" ")}`.toLowerCase();
        if (/tail[_ /-]*rotor|rotor[_ /-]*tail/.test(lower)) node.name = "TailRotor";
        else if (/main[_ /-]*rotor|rotor[_ /-]*main/.test(lower)) node.name = "MainRotor";
        else if (/rotor|prop_rotation|prop_angle/.test(lower) && command.startsWith("ANIM_ROTATE")) {
          const axis = finiteNumbers(parts, 1, 3);
          if (axis) {
            const absolute = axis.map(Math.abs);
            node.name = absolute[1] >= absolute[0] && absolute[1] >= absolute[2] ? "MainRotor" : "TailRotor";
          }
        }
      }
      continue;
    }
    if ((command === "ATTR_LOD" || command === "LOD") && !lodWarningAdded) {
      diagnostics.push({
        severity: "warning",
        code: "OBJ8_LOD_FLATTENED",
        file: path,
        message: "LOD ranges are flattened into one OpenFlight object in this version.",
      });
      lodWarningAdded = true;
      continue;
    }
    if (command === "VT") {
      const values = finiteNumbers(parts, 1, 8);
      if (!values) {
        diagnostics.push({
          severity: "warning",
          code: "OBJ8_BAD_VERTEX",
          file: path,
          message: `Skipped malformed VT record at line ${lineNumber + 1}.`,
        });
        continue;
      }
      vertices.push({
        position: [values[0], values[1], values[2]],
        normal: [values[3], values[4], values[5]],
        uv: [values[6], values[7]],
      });
      continue;
    }
    if (command === "IDX" || command === "IDX10") {
      for (const token of parts.slice(1)) {
        const index = Number(token);
        if (Number.isInteger(index) && index >= 0) indexTable.push(index);
      }
      continue;
    }
    if (command === "TRIS") {
      const values = finiteNumbers(parts, 1, 2);
      if (!values) continue;
      const offset = Math.trunc(values[0]);
      const count = Math.trunc(values[1]);
      const end = Math.min(indexTable.length, offset + count);

      if (offset < 0 || count < 3 || offset >= indexTable.length) {
        diagnostics.push({
          severity: "warning",
          code: "OBJ8_BAD_TRIS_RANGE",
          file: path,
          message: `Skipped invalid TRIS range at line ${lineNumber + 1}.`,
        });
        continue;
      }

      for (let cursor = offset; cursor + 2 < end; cursor += 3) {
        const a = indexTable[cursor];
        const b = indexTable[cursor + 1];
        const c = indexTable[cursor + 2];
        if (a >= vertices.length || b >= vertices.length || c >= vertices.length) {
          diagnostics.push({
            severity: "warning",
            code: "OBJ8_INDEX_OUT_OF_RANGE",
            file: path,
            message: `Skipped a triangle with an out-of-range vertex index at line ${lineNumber + 1}.`,
          });
          continue;
        }
        triangles.push({
          indices: [a, b, c],
          doubleSided,
          drawEnabled,
          animationNodeId: animationStack.at(-1),
          material: {
            ...material,
            diffuse: [...material.diffuse],
            emissive: [...material.emissive],
          },
        });
      }
    }
  }

  if (animationStack.length !== 0) {
    diagnostics.push({
      severity: "warning",
      code: "OBJ8_UNBALANCED_ANIMATION",
      file: path,
      message: "The OBJ contains an unbalanced ANIM_begin/ANIM_end block.",
    });
  }
  if (vertices.length === 0 || triangles.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "OBJ8_NO_GEOMETRY",
      file: path,
      message: "No indexed triangle geometry was found in this OBJ8 file.",
    });
  }

  return {
    path,
    name: basename(path),
    texturePath,
    litTexturePath,
    normalTexturePath,
    vertices,
    triangles,
    animationNodes,
    diagnostics,
  };
}
