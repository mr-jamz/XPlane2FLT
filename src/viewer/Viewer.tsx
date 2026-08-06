import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AircraftAttachment, AnimationTransform, LoadedAircraft, Obj8Model, VisibilityRule } from "../core/types";
import { normalizePath } from "../core/path";
import { loadTexture } from "./texture";

export type ViewMode = "all" | "external" | "cockpit";

interface ViewerProps {
  aircraft: LoadedAircraft;
  visiblePaths: Set<string>;
  viewMode: ViewMode;
  datarefs: Record<string, number>;
  night: number;
  lodDistance: number;
  wireframe: boolean;
  lightsEnabled: boolean;
  unlit: boolean;
  selectedPath: string | null;
  highlightColor: string;
  onSelect: (path: string | null) => void;
}

interface RuntimeGroup {
  object: THREE.Group;
  transforms: AnimationTransform[];
  visibility: VisibilityRule[];
}

interface RuntimeModel {
  object: THREE.Group;
  path: string;
}

interface RuntimeAttachment {
  object: THREE.Group;
  hideDataref?: string;
}

interface RuntimeMesh {
  mesh: THREE.Mesh;
  lit: THREE.MeshStandardMaterial;
  unlit: THREE.MeshBasicMaterial;
}

interface RuntimeHighlight {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  path: string;
}

// Some aircraft omit ATTR_no_cull on interior shell batches even though those
// surfaces must remain visible from cabin and cockpit camera positions.
export function previewMaterialSide(_authoredDoubleSided: boolean): THREE.Side {
  return THREE.DoubleSide;
}

interface LoadProgress {
  geometryBuilt: number;
  geometryTotal: number;
  texturesLoaded: number;
  texturesTotal: number;
  geometryReady: boolean;
}

function interpolation<T>(keys: Array<{ value: number } & T>, value: number): [{ value: number } & T, { value: number } & T, number] {
  const sorted = [...keys].sort((a, b) => a.value - b.value);
  if (sorted.length === 1) return [sorted[0], sorted[0], 0];
  if (value <= sorted[0].value) return [sorted[0], sorted[0], 0];
  if (value >= sorted.at(-1)!.value) return [sorted.at(-1)!, sorted.at(-1)!, 0];
  let left = sorted[0];
  let right = sorted[1];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (value >= sorted[i].value) {
      left = sorted[i];
      right = sorted[i + 1];
    }
  }
  const span = right.value - left.value;
  return [left, right, span === 0 ? 0 : (value - left.value) / span];
}

export function animationMatrix(transforms: AnimationTransform[], datarefs: Record<string, number>): THREE.Matrix4 {
  const result = new THREE.Matrix4();
  for (const transform of transforms) {
    // `none` is OBJ8's constant-transform sentinel and must still be applied
    // (it is commonly used for the translate/rotate/translate-back pivot
    // pattern). Custom datarefs, however, may be created and initialized by an
    // aircraft plugin that cannot run in this static viewer. Treating every
    // unavailable dataref as zero actively folds, opens, or displaces authored
    // geometry. Leave those transforms at identity until the user supplies an
    // explicit value through the dataref controls.
    const isConstant = !transform.dataref || transform.dataref.toLowerCase() === "none";
    const explicitValue = Object.prototype.hasOwnProperty.call(datarefs, transform.dataref);
    if (!isConstant && !explicitValue) continue;
    const value = isConstant ? 0 : datarefs[transform.dataref];
    if (transform.type === "rotate") {
      const [a, b, t] = interpolation(transform.keys, value);
      const angle = THREE.MathUtils.lerp(a.angle, b.angle, t);
      const axis = new THREE.Vector3(...transform.axis).normalize();
      result.multiply(new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(angle)));
    } else {
      const [a, b, t] = interpolation(transform.keys, value);
      const position = new THREE.Vector3(...a.position).lerp(new THREE.Vector3(...b.position), t);
      result.multiply(new THREE.Matrix4().makeTranslation(position.x, position.y, position.z));
    }
  }
  return result;
}

export function ruleVisible(rules: VisibilityRule[], datarefs: Record<string, number>): boolean {
  return rules.every((rule) => {
    // A missing plugin-owned dataref must not make every mutually-exclusive
    // SHOW/HIDE branch visible. X-Plane datarefs initialize numerically, so use
    // zero only for visibility selection. Animation transforms deliberately
    // keep their separate identity fallback until an explicit value exists.
    const value = Object.prototype.hasOwnProperty.call(datarefs, rule.dataref)
      ? datarefs[rule.dataref]
      : 0;
    const inRange = value >= Math.min(rule.min, rule.max) && value <= Math.max(rule.min, rule.max);
    return rule.mode === "show" ? inRange : !inRange;
  });
}

function attachmentVisible(attachment: AircraftAttachment, mode: ViewMode): boolean {
  if (mode === "all") return true;
  if (mode === "external") return attachment.role !== "interior" && attachment.role !== "cockpit";
  return attachment.role !== "exterior";
}

function makeGeometry(model: Obj8Model, indices: number[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let cursor = 0; cursor + 2 < indices.length; cursor += 3) {
    // OBJ8 front faces are clockwise; Three.js front faces are counter-clockwise.
    for (const index of [indices[cursor], indices[cursor + 2], indices[cursor + 1]]) {
      const vertex = model.vertices[index];
      if (!vertex) continue;
      positions.push(...vertex.position);
      normals.push(...vertex.normal);
      uvs.push(...vertex.uv);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function modelAttachments(aircraft: LoadedAircraft, model: Obj8Model): AircraftAttachment[] {
  const target = normalizePath(model.path).toLowerCase();
  const exact = aircraft.manifest.attachments.filter(({ path }) => {
    const normalized = normalizePath(path).toLowerCase();
    return normalized === target || target.endsWith(`/${normalized}`);
  });
  return exact.length
    ? exact
    : [{ index: -1, path: model.path, role: "unknown", position: [0, 0, 0], rotation: [0, 0, 0] }];
}

export function Viewer(props: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const frameCameraRef = useRef<(() => void) | null>(null);
  const [stats, setStats] = useState({ triangles: 0, drawCalls: 0 });
  const [progress, setProgress] = useState<LoadProgress>({
    geometryBuilt: 0,
    geometryTotal: 0,
    texturesLoaded: 0,
    texturesTotal: 0,
    geometryReady: false,
  });
  latest.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07100f);
    scene.fog = new THREE.FogExp2(0x07100f, 0.0007);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100_000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;

    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xb9d9d4, 0x19221f, 1.75));
    const sun = new THREE.DirectionalLight(0xfff2d6, 4.2);
    sun.position.set(-35, 55, 28);
    sun.castShadow = true;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7fc8c0, 1.2);
    fill.position.set(28, 12, -38);
    scene.add(fill);
    const ground = new THREE.GridHelper(2_000, 100, 0x4c685f, 0x182723);
    (ground.material as THREE.Material).transparent = true;
    (ground.material as THREE.Material).opacity = 0.34;
    scene.add(ground);

    let disposed = false;
    let frame = 0;
    let triangleCount = 0;
    let drawCalls = 0;
    let textureSettled = 0;
    const resources: Array<{ dispose: () => void }> = [];
    const runtimeGroups: RuntimeGroup[] = [];
    const runtimeModels: RuntimeModel[] = [];
    const runtimeAttachments: RuntimeAttachment[] = [];
    const runtimeMeshes: RuntimeMesh[] = [];
    const runtimeHighlights: RuntimeHighlight[] = [];
    const litMaterials: Array<{ material: THREE.MeshStandardMaterial; base: number; lightLevel?: { min: number; max: number; dataref: string } }> = [];

    const fitCamera = () => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) {
        camera.position.set(12, 8, 12);
        controls.target.set(0, 0, 0);
      } else {
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const distance = Math.max(2, sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2);
        camera.position.copy(sphere.center).add(new THREE.Vector3(1.35, 0.65, 1).normalize().multiplyScalar(distance));
        controls.target.copy(sphere.center);
        camera.near = Math.max(0.01, distance / 10_000);
        camera.far = Math.max(10_000, distance * 30);
        controls.maxDistance = distance * 10;
        camera.updateProjectionMatrix();
      }
      controls.update();
    };
    frameCameraRef.current = fitCamera;

    const build = async () => {
      const textureCache = new Map<string, Promise<THREE.Texture | null>>();
      const getTexture = (model: Obj8Model, reference: string | undefined, color: boolean) => {
        const key = `${model.path}|${reference}|${color}`;
        const existing = textureCache.get(key);
        if (existing) return existing;
        const pending = loadTexture(props.aircraft.fileMap, model.path, reference, color);
        textureCache.set(key, pending);
        return pending;
      };

      setStats({ triangles: 0, drawCalls: 0 });
      setProgress({
        geometryBuilt: 0,
        geometryTotal: props.aircraft.models.length,
        texturesLoaded: 0,
        texturesTotal: props.aircraft.models.length,
        geometryReady: props.aircraft.models.length === 0,
      });

      for (const [modelIndex, model] of props.aircraft.models.entries()) {
        const modelMaterials: THREE.MeshStandardMaterial[] = [];
        const modelUnlitMaterials: THREE.MeshBasicMaterial[] = [];
        const modelRoot = new THREE.Group();
        modelRoot.name = model.name;
        modelRoot.userData.modelPath = model.path;
        modelRoot.visible = latest.current.visiblePaths.has(model.path);
        root.add(modelRoot);
        runtimeModels.push({ object: modelRoot, path: model.path });
        const textureTask = Promise.all([
          getTexture(model, model.texture, true),
          getTexture(model, model.textureLit, true),
          getTexture(model, model.textureNormal, false),
          getTexture(model, model.textureMaps.normal, false),
          getTexture(model, model.textureMaps.material_gloss ?? model.textureMaps.gloss, false),
        ]);

        for (const attachment of modelAttachments(props.aircraft, model)) {
          if (!attachmentVisible(attachment, props.viewMode)) continue;
          const instance = new THREE.Group();
          instance.name = `${model.name} attachment ${attachment.index}`;
          instance.userData.modelPath = model.path;
          instance.position.set(...attachment.position);
          instance.rotation.set(
            THREE.MathUtils.degToRad(attachment.rotation[0]),
            THREE.MathUtils.degToRad(attachment.rotation[1]),
            THREE.MathUtils.degToRad(attachment.rotation[2]),
            // Plane Maker applies heading, pitch, then roll to attached
            // objects. Three's default XYZ order applies those in a
            // different local-axis sequence once more than one is non-zero.
            "YXZ",
          );
          modelRoot.add(instance);
          runtimeAttachments.push({ object: instance, hideDataref: attachment.hideDataref });

          const groups = new Map<number, THREE.Group>();
          for (const group of model.animations) {
            const object = new THREE.Group();
            object.name = `ANIM ${group.id}`;
            object.matrixAutoUpdate = false;
            groups.set(group.id, object);
            const parent = group.parentId === null ? instance : groups.get(group.parentId) ?? instance;
            parent.add(object);
            runtimeGroups.push({ object, transforms: group.transforms, visibility: group.visibility });
          }

          for (const batch of model.batches) {
            if (batch.lod && !(props.lodDistance >= batch.lod[0] && props.lodDistance < batch.lod[1])) continue;
            const geometry = makeGeometry(model, batch.indices);
            resources.push(geometry);
            const state = batch.material;
            const shiny = Math.max(model.globalSpecular, state.shinyRatio);
            const material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(...state.diffuse),
              emissive: new THREE.Color(...state.emissive),
              emissiveIntensity: props.night,
              roughness: Math.max(0.05, 1 - shiny),
              metalness: model.normalMetalness ? 0.55 : 0,
              side: previewMaterialSide(state.doubleSided),
              transparent: state.blend !== "test",
              alphaTest: state.blend === "test" ? state.alphaCutoff : 0,
              // Plane Maker glass objects are explicitly drawn last. Ordinary
              // blended aircraft batches still write depth in authored order.
              depthWrite: attachment.role !== "glass",
              depthTest: state.depthTest,
              wireframe: props.wireframe,
            });
            const unlitMaterial = new THREE.MeshBasicMaterial({
              color: new THREE.Color(...state.diffuse),
              side: previewMaterialSide(state.doubleSided),
              transparent: state.blend !== "test",
              alphaTest: state.blend === "test" ? state.alphaCutoff : 0,
              depthWrite: attachment.role !== "glass",
              depthTest: state.depthTest,
              wireframe: props.wireframe,
            });
            if (model.textureMaps.material_gloss || model.textureMaps.gloss) {
              material.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                  "roughnessFactor *= texelRoughness.g;",
                  "roughnessFactor *= (1.0 - texelRoughness.g);",
                );
              };
              material.customProgramCacheKey = () => "xplane-gloss-inversion-v1";
            }
            material.normalScale.set(1, -1);
            material.userData.modelPath = model.path;
            unlitMaterial.userData.modelPath = model.path;
            resources.push(material);
            resources.push(unlitMaterial);
            modelMaterials.push(material);
            modelUnlitMaterials.push(unlitMaterial);
            litMaterials.push({ material, base: model.luminance ? Math.max(0.1, model.luminance / 1000) : 1, lightLevel: state.lightLevel });

            const mesh = new THREE.Mesh(geometry, latest.current.unlit ? unlitMaterial : material);
            mesh.name = model.name;
            mesh.userData.modelPath = model.path;
            mesh.castShadow = attachment.role !== "glass";
            mesh.receiveShadow = attachment.role !== "glass";
            mesh.renderOrder = attachment.role === "glass" ? 1000 + attachment.index : batch.line;
            runtimeMeshes.push({ mesh, lit: material, unlit: unlitMaterial });
            const highlightMaterial = new THREE.MeshBasicMaterial({
              color: latest.current.highlightColor,
              side: previewMaterialSide(state.doubleSided),
              transparent: true,
              opacity: 0.28,
              depthWrite: false,
              depthTest: true,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
            });
            const highlight = new THREE.Mesh(geometry, highlightMaterial);
            highlight.name = `${model.name} selection highlight`;
            highlight.visible = false;
            highlight.renderOrder = mesh.renderOrder + 10_000;
            highlight.raycast = () => undefined;
            mesh.add(highlight);
            resources.push(highlightMaterial);
            runtimeHighlights.push({ mesh: highlight, material: highlightMaterial, path: model.path });
            groups.get(batch.animationPath.at(-1) ?? 0)?.add(mesh);
            triangleCount += Math.floor(batch.indices.length / 3);
            drawCalls += 1;
          }

          if (props.lightsEnabled) {
            for (const light of model.lights) {
              const color = light.color
                ? new THREE.Color(light.color[0], light.color[1], light.color[2])
                : /red|beacon/i.test(light.name) ? new THREE.Color(1, 0.08, 0.03)
                  : /green/i.test(light.name) ? new THREE.Color(0.08, 1, 0.3)
                    : new THREE.Color(1, 0.85, 0.52);
              const spriteMaterial = new THREE.SpriteMaterial({ color, transparent: true, opacity: light.color?.[3] ?? 0.9, depthWrite: false });
              const sprite = new THREE.Sprite(spriteMaterial);
              sprite.position.set(...light.position);
              sprite.scale.setScalar(0.32);
              sprite.userData.modelPath = model.path;
              resources.push(spriteMaterial);
              groups.get(light.animationPath.at(-1) ?? 0)?.add(sprite);
            }
          }
        }

        // Geometry is usable immediately. Texture hydration continues in the
        // background and cannot block the next OBJ8 object from being assembled.
        void textureTask.then(([map, emissiveMap, normalMap, xp12NormalMap, glossMap]) => {
          const textures = [map, emissiveMap, normalMap, xp12NormalMap, glossMap];
          if (disposed) {
            textures.forEach((texture) => texture?.dispose());
            return;
          }
          textures.forEach((texture) => {
            if (texture && !resources.includes(texture)) resources.push(texture);
          });
          for (const material of modelMaterials) {
            material.map = map;
            material.emissiveMap = emissiveMap;
            if (emissiveMap) material.emissive.setRGB(1, 1, 1);
            material.normalMap = xp12NormalMap ?? normalMap;
            material.roughnessMap = glossMap;
            material.metalnessMap = model.normalMetalness ? (normalMap ?? glossMap) : null;
            material.needsUpdate = true;
          }
          for (const material of modelUnlitMaterials) {
            material.map = map;
            material.needsUpdate = true;
          }
        }).finally(() => {
          if (disposed) return;
          textureSettled += 1;
          setProgress((current) => ({ ...current, texturesLoaded: textureSettled }));
        });

        if (!disposed) {
          setStats({ triangles: triangleCount, drawCalls });
          setProgress((current) => ({ ...current, geometryBuilt: modelIndex + 1 }));
        }
        // Yield once per object so large aircraft show honest incremental stats
        // and the UI remains responsive while geometry is constructed.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!disposed) {
        setStats({ triangles: triangleCount, drawCalls });
        setProgress((current) => ({ ...current, geometryReady: true }));
        fitCamera();
      }
    };
    void build();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerUp = (event: PointerEvent) => {
      if (Math.abs(event.movementX) > 3 || Math.abs(event.movementY) > 3) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(root, true)[0];
      let target: THREE.Object3D | null = hit?.object ?? null;
      while (target && !target.userData.modelPath) target = target.parent;
      latest.current.onSelect(target?.userData.modelPath ?? null);
    };
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = Math.max(360, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const animate = () => {
      const current = latest.current;
      for (const model of runtimeModels) {
        model.object.visible = current.visiblePaths.has(model.path);
      }
      for (const group of runtimeGroups) {
        group.object.matrix.copy(animationMatrix(group.transforms, current.datarefs));
        group.object.visible = ruleVisible(group.visibility, current.datarefs);
        group.object.matrixWorldNeedsUpdate = true;
      }
      for (const attachment of runtimeAttachments) {
        attachment.object.visible = !attachment.hideDataref
          || (current.datarefs[attachment.hideDataref] ?? 0) < 0.5;
      }
      for (const entry of runtimeMeshes) {
        entry.mesh.material = current.unlit ? entry.unlit : entry.lit;
        entry.mesh.castShadow = !current.unlit;
        entry.mesh.receiveShadow = !current.unlit;
      }
      for (const entry of runtimeHighlights) {
        entry.mesh.visible = current.selectedPath === entry.path && current.visiblePaths.has(entry.path);
        entry.material.color.set(current.highlightColor);
      }
      for (const entry of litMaterials) {
        let level = current.night;
        if (entry.lightLevel) {
          const value = current.datarefs[entry.lightLevel.dataref] ?? 0;
          const span = entry.lightLevel.max - entry.lightLevel.min;
          level = span === 0 ? 0 : THREE.MathUtils.clamp((value - entry.lightLevel.min) / span, 0, 1);
        }
        entry.material.emissiveIntensity = entry.base * level;
      }
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      resources.forEach((resource) => resource.dispose());
      renderer.dispose();
      frameCameraRef.current = null;
      host.replaceChildren();
    };
  }, [props.aircraft, props.viewMode, props.lodDistance, props.wireframe, props.lightsEnabled]);

  return (
    <div className="viewer-shell">
      <div className="viewport" ref={hostRef} aria-label="Interactive X-Plane OBJ8 viewport" />
      <div className="viewport-topbar">
        <span className="live-dot" />
        <span>OBJ8 render</span>
        <span className="viewport-stat">{stats.triangles.toLocaleString()} tris</span>
        <span className="viewport-stat">{stats.drawCalls.toLocaleString()} batches</span>
        {!progress.geometryReady && (
          <span className="viewport-stat">building {progress.geometryBuilt}/{progress.geometryTotal}</span>
        )}
        {progress.geometryReady && progress.texturesLoaded < progress.texturesTotal && (
          <span className="viewport-stat">textures {progress.texturesLoaded}/{progress.texturesTotal}</span>
        )}
      </div>
      <button
        className="frame-button"
        type="button"
        disabled={!progress.geometryReady}
        title={progress.geometryReady ? "Frame the complete aircraft" : "Waiting for all aircraft geometry"}
        onClick={() => frameCameraRef.current?.()}
      >
        {progress.geometryReady ? "Frame aircraft" : `Building ${progress.geometryBuilt}/${progress.geometryTotal}`}
      </button>
      <div className="viewport-help">Left drag orbit · wheel zoom · right drag pan · click part to inspect</div>
    </div>
  );
}
