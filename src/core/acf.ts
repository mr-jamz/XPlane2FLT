import { basename, normalizePath } from "./path";
import type { AircraftAttachment, AircraftManifest, AttachmentRole } from "./types";

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function roleFromProperties(properties: Map<string, string>): AttachmentRole {
  const joined = [...properties.entries()].map(([key, value]) => `${key} ${value}`).join(" ").toLowerCase();
  if (/cockpit/.test(joined) && /(?:^|\s)1(?:\s|$)/.test(joined)) return "cockpit";
  if (/glass/.test(joined) || /_lighting\s+2/.test(joined)) return "glass";
  if (/interior|inside|_lighting\s+1/.test(joined)) return "interior";
  if (/exterior|outside|_lighting\s+0/.test(joined)) return "exterior";
  return "unknown";
}

function firstVector(properties: Map<string, string>, patterns: RegExp[]): number[] | null {
  for (const [key, raw] of properties) {
    if (!patterns.some((pattern) => pattern.test(key))) continue;
    const values = raw.split(/\s+/).map(Number).filter(Number.isFinite);
    if (values.length >= 3) return values;
  }
  return null;
}

function scalar(properties: Map<string, string>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = properties.get(key);
    if (raw === undefined) continue;
    const value = Number(raw.trim().split(/\s+/)[0]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function parseAcf(path: string, source: string): AircraftManifest {
  const records = new Map<number, Map<string, string>>();
  const warnings: string[] = [];

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r\n?|\n/)) {
    const line = rawLine.trim();
    // Plane Maker files are found with both `acf/_obja/...` and `_obja/...`
    // record roots, depending on the X-Plane version that last saved them.
    const match = line.match(/^(?:P\s+)?(?:acf\/)?_obja\/(\d+)\/([^\s]+)\s*(.*)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    const properties = records.get(index) ?? new Map<string, string>();
    properties.set(match[2].toLowerCase(), unquote(match[3]));
    records.set(index, properties);
  }

  const attachments: AircraftAttachment[] = [];
  for (const [index, properties] of [...records.entries()].sort(([a], [b]) => a - b)) {
    const pathEntry = [...properties.entries()].find(([key, value]) =>
      /(?:obj_path|file_stl|file|path)$/.test(key) && /\.obj(?:\s|$)/i.test(value)
    );
    if (!pathEntry || !/\.obj(?:\s|$)/i.test(pathEntry[1])) continue;

    // Some third-party exporters use a packed vector, but Plane Maker writes
    // attachment position and orientation as individual scalar properties.
    const packedTransform = firstVector(properties, [
      /_v10_att_file_stl$/,
      /_att_file_stl$/,
      /_position$/,
      /_xyz$/,
    ]);
    const position: [number, number, number] = [
      scalar(properties, ["_v10_att_x_acf_prt_ref", "_att_x_acf_prt_ref"]) ?? packedTransform?.[0] ?? 0,
      scalar(properties, ["_v10_att_y_acf_prt_ref", "_att_y_acf_prt_ref"]) ?? packedTransform?.[1] ?? 0,
      scalar(properties, ["_v10_att_z_acf_prt_ref", "_att_z_acf_prt_ref"]) ?? packedTransform?.[2] ?? 0,
    ];
    // OBJ8 uses X right, Y up, Z aft. Plane Maker's theta (pitch) therefore
    // rotates around X, psi (heading) around Y, and phi (roll) around Z.
    const rotation: [number, number, number] = [
      scalar(properties, ["_v10_att_the_ref", "_att_the_ref"]) ?? packedTransform?.[3] ?? 0,
      scalar(properties, ["_v10_att_psi_ref", "_att_psi_ref"]) ?? packedTransform?.[4] ?? 0,
      scalar(properties, ["_v10_att_phi_ref", "_att_phi_ref"]) ?? packedTransform?.[5] ?? 0,
    ];

    attachments.push({
      index,
      path: normalizePath(pathEntry[1]),
      role: roleFromProperties(properties),
      position,
      rotation,
      hideDataref: properties.get("_obj_hide_dataref") || undefined,
    });
  }

  if (records.size > 0 && attachments.length === 0) {
    warnings.push("The ACF contains object records, but their paths use an unrecognized Plane Maker field.");
  }

  return {
    acfPath: path,
    name: basename(path).replace(/\.acf$/i, ""),
    attachments,
    warnings,
  };
}
