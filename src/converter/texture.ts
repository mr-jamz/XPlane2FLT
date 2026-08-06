import type { TextureMaxSize } from "./types";

export async function resizeTexture(bytes: Uint8Array, fileName: string, maxSize: TextureMaxSize) {
  if (maxSize === 0 || !/\.(png|jpe?g)$/i.test(fileName) || typeof createImageBitmap !== "function") return { bytes, resized: false };
  const mime = /\.jpe?g$/i.test(fileName) ? "image/jpeg" : "image/png";
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer], { type: mime }));
    const sourceWidth = bitmap.width; const sourceHeight = bitmap.height;
    if (sourceWidth <= maxSize && sourceHeight <= maxSize) { bitmap.close(); return { bytes, resized: false, width: sourceWidth, height: sourceHeight }; }
    const scale = Math.min(maxSize / sourceWidth, maxSize / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) { bitmap.close(); return { bytes, resized: false }; }
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, mime === "image/jpeg" ? .9 : undefined));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), resized: true, width, height } : { bytes, resized: false };
  } catch { return { bytes, resized: false }; }
}
