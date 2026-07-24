import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DDSLoader } from "three/examples/jsm/loaders/DDSLoader.js";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import type { Obj8MaterialState, Obj8Model } from "./core/types";

interface Obj8PreviewProps {
  sourceFile: File;
  models: Obj8Model[];
  onToggleModel: (path: string) => void;
}

interface PreviewStatus {
  visibleTriangles: number;
  sourceTriangles: number;
  sampled: boolean;
}

function materialKey(material: Obj8MaterialState | undefined, doubleSided: boolean): string {
  const state = material ?? {
    diffuse: [1, 1, 1],
    emissive: [0, 0, 0],
    shininess: 0,
    alpha: 1,
    blended: false,
    alphaCutoff: 0.5,
  };
  return [
    ...state.diffuse,
    ...state.emissive,
    state.shininess,
    state.alpha,
    state.blended ? 1 : 0,
    state.alphaCutoff ?? 0.5,
    doubleSided ? 1 : 0,
  ].join("|");
}

export function selectTriangleIndices(models: Obj8Model[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const model of models) {
    result.set(
      model.path,
      model.triangles
        .map((triangle, index) => triangle.drawEnabled === false ? -1 : index)
        .filter((index) => index >= 0),
    );
  }
  return result;
}

/**
 * OBJ8 front faces use the opposite winding convention from Three.js.
 * Convert only at the preview boundary so the parsed/export geometry remains
 * unchanged and the exterior side is visible with FrontSide culling enabled.
 */
export function previewTriangleIndices(indices: [number, number, number]): [number, number, number] {
  return [indices[0], indices[2], indices[1]];
}

function makeGeometry(model: Obj8Model, triangleIndices: number[]): Map<string, THREE.BufferGeometry> {
  const batches = new Map<string, { positions: number[]; normals: number[]; uvs: number[] }>();
  for (const triangleIndex of triangleIndices) {
    const triangle = model.triangles[triangleIndex];
    if (!triangle) continue;
    const key = materialKey(triangle.material, triangle.doubleSided);
    const batch = batches.get(key) ?? { positions: [], normals: [], uvs: [] };
    for (const index of previewTriangleIndices(triangle.indices)) {
      const vertex = model.vertices[index];
      if (!vertex) continue;
      batch.positions.push(...vertex.position);
      batch.normals.push(...vertex.normal);
      batch.uvs.push(...vertex.uv);
    }
    batches.set(key, batch);
  }
  const geometries = new Map<string, THREE.BufferGeometry>();
  for (const [key, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.computeBoundingSphere();
    geometries.set(key, geometry);
  }
  return geometries;
}

function stateFromKey(key: string): { material: Obj8MaterialState; doubleSided: boolean } {
  const values = key.split("|").map(Number);
  return {
    material: {
      diffuse: [values[0], values[1], values[2]],
      emissive: [values[3], values[4], values[5]],
      shininess: values[6],
      alpha: values[7],
      blended: values[8] === 1,
      alphaCutoff: Number.isFinite(values[9]) ? values[9] : 0.5,
    },
    doubleSided: values[10] === 1,
  };
}

async function loadTexture(zip: JSZip, path: string): Promise<THREE.Texture | null> {
  const entry = Object.values(zip.files).find((candidate) => !candidate.dir && candidate.name.toLowerCase() === path.toLowerCase());
  if (!entry) return null;
  const bytes = await entry.async("uint8array");
  const extension = path.split(".").pop()?.toLowerCase();
  const mime = extension === "png" ? "image/png"
    : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
      : extension === "bmp" ? "image/bmp"
        : "application/octet-stream";
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const url = URL.createObjectURL(new Blob([blobBytes.buffer], { type: mime }));
  try {
    const texture = extension === "dds"
      ? await new DDSLoader().loadAsync(url)
      : extension === "tga"
        ? await new TGALoader().loadAsync(url)
        : await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.flipY = false;
    texture.anisotropy = 4;
    return texture;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Obj8Preview({ sourceFile, models, onToggleModel }: Obj8PreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>({ visibleTriangles: 0, sourceTriangles: 0, sampled: false });
  const [cameraAction, setCameraAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    setSelectedName(null);

    const width = Math.max(320, host.clientWidth);
    const height = Math.max(360, host.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x07110f, 1);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07110f, 500, 4_000);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 100_000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;

    const root = new THREE.Group();
    root.name = "Selected OBJ8 files";
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xd8f3ed, 0x14211e, 2.3));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(4, 8, 6);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x8fe8d1, 1.7);
    rimLight.position.set(-6, 2, -4);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(2_000, 100, 0x38534a, 0x14241f);
    grid.material.transparent = true;
    grid.material.opacity = 0.42;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(12));

    const triangleSelection = selectTriangleIndices(models);
    const sourceTriangles = models.reduce((sum, model) => sum + model.triangles.length, 0);
    const visibleTriangles = [...triangleSelection.values()].reduce((sum, indices) => sum + indices.length, 0);
    setStatus({ visibleTriangles, sourceTriangles, sampled: visibleTriangles < sourceTriangles });

    let disposed = false;
    let frame = 0;
    const textures: THREE.Texture[] = [];
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];

    const fitCamera = () => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) {
        camera.position.set(10, 8, 10);
        controls.target.set(0, 0, 0);
        controls.update();
        return;
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.1);
      const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.16;
      camera.near = Math.max(0.01, distance / 10_000);
      camera.far = Math.max(10_000, distance * 25);
      camera.updateProjectionMatrix();
      camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.62, 1).normalize().multiplyScalar(distance));
      controls.target.copy(sphere.center);
      controls.maxDistance = distance * 8;
      controls.update();
    };
    setCameraAction(() => fitCamera);

    const build = async () => {
      const zip = await JSZip.loadAsync(sourceFile);
      const textureCache = new Map<string, Promise<THREE.Texture | null>>();
      for (const model of models) {
        const group = new THREE.Group();
        group.name = model.name;
        group.userData.modelPath = model.path;
        const diffuseTexture = model.texturePath
          ? await (textureCache.get(model.texturePath)
            ?? (() => {
              const pending = loadTexture(zip, model.texturePath!);
              textureCache.set(model.texturePath!, pending);
              return pending;
            })())
          : null;
        if (diffuseTexture && !textures.includes(diffuseTexture)) textures.push(diffuseTexture);
        const geometryBatches = makeGeometry(model, triangleSelection.get(model.path) ?? []);
        for (const [key, geometry] of geometryBatches) {
          const state = stateFromKey(key);
          const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(...state.material.diffuse),
            emissive: new THREE.Color(...state.material.emissive),
            emissiveIntensity: 1,
            map: diffuseTexture,
            roughness: 1 - Math.min(1, state.material.shininess / 128),
            metalness: 0,
            side: state.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
            transparent: state.material.blended,
            opacity: state.material.alpha,
            alphaTest: state.material.blended ? 0 : state.material.alphaCutoff,
            depthWrite: !state.material.blended,
          });
          materials.push(material);
          geometries.push(geometry);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData.modelPath = model.path;
          mesh.userData.modelName = model.name;
          group.add(mesh);
        }
        root.add(group);
      }
      if (!disposed) fitCamera();
    };
    void build();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerUp = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(root.children, true)[0];
      setSelectedName(hit?.object.userData.modelName ?? null);
    };
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(320, host.clientWidth);
      const nextHeight = Math.max(360, host.clientHeight);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(host);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      host.replaceChildren();
      setCameraAction(null);
    };
  }, [sourceFile, models]);

  return (
    <section className="panel preview-panel">
      <div className="panel__heading preview-panel__heading">
        <div>
          <p className="section-kicker">Selected OBJ8 preview</p>
          <h3>{models.length} visible part{models.length === 1 ? "" : "s"}</h3>
        </div>
        <div className="selection-actions">
          <button type="button" onClick={() => cameraAction?.()}>Frame selection</button>
        </div>
      </div>
      <div className="preview-stage" ref={hostRef} aria-label="Interactive 3D preview of selected OBJ8 files" />
      <div className="preview-toolbar">
        <span>Drag to orbit · wheel to zoom · right-drag to pan</span>
        <span>
          {status.sampled
            ? `${status.visibleTriangles.toLocaleString()} of ${status.sourceTriangles.toLocaleString()} drawable triangles`
            : `${status.visibleTriangles.toLocaleString()} source triangles`}
        </span>
      </div>
      {selectedName && (
        <div className="preview-selection">
          <span><strong>{selectedName}</strong> selected in the viewport</span>
          <button type="button" onClick={() => {
            const model = models.find((candidate) => candidate.name === selectedName);
            if (model) onToggleModel(model.path);
          }}>Remove from package</button>
        </div>
      )}
    </section>
  );
}
