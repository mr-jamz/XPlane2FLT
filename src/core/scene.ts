import * as THREE from "three";
import { normalizePath } from "./path";
import type {
  AircraftAttachment,
  AnimationTransform,
  LoadedAircraft,
  Obj8Model,
  VisibilityRule,
} from "./types";

function interpolation<T>(
  keys: Array<{ value: number } & T>,
  value: number,
): [{ value: number } & T, { value: number } & T, number] {
  const sorted = [...keys].sort((a, b) => a.value - b.value);
  if (sorted.length === 1) return [sorted[0], sorted[0], 0];
  if (value <= sorted[0].value) return [sorted[0], sorted[0], 0];
  if (value >= sorted.at(-1)!.value) return [sorted.at(-1)!, sorted.at(-1)!, 0];
  let left = sorted[0];
  let right = sorted[1];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (value >= sorted[index].value) {
      left = sorted[index];
      right = sorted[index + 1];
    }
  }
  const span = right.value - left.value;
  return [left, right, span === 0 ? 0 : (value - left.value) / span];
}

export function animationMatrix(
  transforms: AnimationTransform[],
  datarefs: Record<string, number>,
): THREE.Matrix4 {
  const result = new THREE.Matrix4();
  for (const transform of transforms) {
    const isConstant = !transform.dataref || transform.dataref.toLowerCase() === "none";
    const explicitValue = Object.prototype.hasOwnProperty.call(datarefs, transform.dataref);
    if (!isConstant && !explicitValue) continue;
    const value = isConstant ? 0 : datarefs[transform.dataref];
    if (transform.type === "rotate") {
      const [left, right, mix] = interpolation(transform.keys, value);
      const angle = THREE.MathUtils.lerp(left.angle, right.angle, mix);
      const axis = new THREE.Vector3(...transform.axis).normalize();
      result.multiply(new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(angle)));
    } else {
      const [left, right, mix] = interpolation(transform.keys, value);
      const position = new THREE.Vector3(...left.position).lerp(
        new THREE.Vector3(...right.position),
        mix,
      );
      result.multiply(new THREE.Matrix4().makeTranslation(position.x, position.y, position.z));
    }
  }
  return result;
}

export function ruleVisible(
  rules: VisibilityRule[],
  datarefs: Record<string, number>,
): boolean {
  return rules.every((rule) => {
    const value = Object.prototype.hasOwnProperty.call(datarefs, rule.dataref)
      ? datarefs[rule.dataref]
      : 0;
    const inRange = value >= Math.min(rule.min, rule.max) && value <= Math.max(rule.min, rule.max);
    return rule.mode === "show" ? inRange : !inRange;
  });
}

export function attachmentMatrix(attachment: AircraftAttachment): THREE.Matrix4 {
  const position = new THREE.Vector3(...attachment.position);
  const rotation = new THREE.Euler(
    THREE.MathUtils.degToRad(attachment.rotation[0]),
    THREE.MathUtils.degToRad(attachment.rotation[1]),
    THREE.MathUtils.degToRad(attachment.rotation[2]),
    "YXZ",
  );
  return new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromEuler(rotation),
    new THREE.Vector3(1, 1, 1),
  );
}

/**
 * Aircraft OBJ8 packages frequently split a single visible shell across
 * exterior, door, glass, cockpit and interior attachments.  When the camera
 * crosses that shell, a filename/role-only fallback leaves holes because the
 * reverse-facing surface may live in an attachment named `fuselage` or
 * `doors`, not `interior`.
 *
 * The viewer and flattened FLT are inspection assets whose cameras may move
 * freely through the aircraft, so every aircraft face must be drawable from
 * either direction.  This changes only the culling flag: vertex order, UVs,
 * normals, transforms and texture bindings remain untouched.
 */
export function attachmentNeedsTwoSidedFaces(_attachment: AircraftAttachment): boolean {
  return true;
}

export function modelAttachments(
  aircraft: LoadedAircraft,
  model: Obj8Model,
): AircraftAttachment[] {
  const target = normalizePath(model.path).toLowerCase();
  const exact = aircraft.manifest.attachments.filter(({ path }) => {
    const normalized = normalizePath(path).toLowerCase();
    return normalized === target || target.endsWith(`/${normalized}`);
  });
  return exact.length
    ? exact
    : [{
        index: -1,
        path: model.path,
        role: "unknown",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }];
}
