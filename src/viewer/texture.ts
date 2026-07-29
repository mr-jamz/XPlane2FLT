import * as THREE from "three";
import { DDSLoader } from "three/examples/jsm/loaders/DDSLoader.js";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { resolveRelative, withoutExtension } from "../core/path";

const TEXTURE_TIMEOUT_MS = 15_000;

export function findTextureFile(fileMap: Map<string, File>, ownerPath: string, reference?: string): { path: string; file: File } | null {
  if (!reference || reference.toLowerCase() === "none") return null;
  const resolved = resolveRelative(ownerPath, reference);
  const stem = withoutExtension(resolved);
  const slash = stem.lastIndexOf("/");
  const directory = slash >= 0 ? stem.slice(0, slash + 1) : "";
  const fileStem = slash >= 0 ? stem.slice(slash + 1) : stem;
  const underscore = fileStem.indexOf("_");
  const leadingWord = underscore >= 0 ? fileStem.slice(0, underscore) : fileStem;
  const remainder = underscore >= 0 ? fileStem.slice(underscore) : "";
  const alternateStem = `${directory}${leadingWord.endsWith("s") ? leadingWord.slice(0, -1) : `${leadingWord}s`}${remainder}`;
  const extensions = ["png", "dds", "tga", "jpg", "jpeg", "bmp"];
  const candidates = [
    resolved,
    ...extensions.map((extension) => `${stem}.${extension}`),
    // Some aircraft packages use pilot/pilots (and equivalent singular/plural
    // pairs) interchangeably between OBJ declarations and texture filenames.
    ...extensions.map((extension) => `${alternateStem}.${extension}`),
  ];
  for (const candidate of candidates) {
    const file = fileMap.get(candidate.toLowerCase());
    if (file) return { path: candidate, file };
  }
  return null;
}

export async function loadTexture(
  fileMap: Map<string, File>,
  ownerPath: string,
  reference?: string,
  color = false,
): Promise<THREE.Texture | null> {
  const source = findTextureFile(fileMap, ownerPath, reference);
  if (!source) return null;
  const url = URL.createObjectURL(source.file);
  const extension = source.path.split(".").pop()?.toLowerCase();
  try {
    const loader = extension === "dds"
      ? new DDSLoader()
      : extension === "tga"
        ? new TGALoader()
        : new THREE.TextureLoader();
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error(`Texture load timed out: ${source.path}`)),
        TEXTURE_TIMEOUT_MS,
      );
      loader.load(
        url,
        (loaded) => {
          window.clearTimeout(timeout);
          resolve(loaded);
        },
        undefined,
        (reason) => {
          window.clearTimeout(timeout);
          reject(reason);
        },
      );
    });
    // OBJ8 UVs use OpenGL's lower-left texture origin. Browser-decoded
    // PNG/JPEG/TGA images have an upper-left origin and therefore need the
    // WebGL upload flip. DDS data is already stored in GPU/OpenGL order and
    // compressed textures cannot be flipped during upload.
    texture.flipY = extension !== "dds";
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
