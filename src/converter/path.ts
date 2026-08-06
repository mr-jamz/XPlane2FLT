export function normalizeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts: string[] = [];

  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function removeExtension(path: string): string {
  return path.replace(/\.[^.\/]+$/, "");
}

export function resolveRelativePath(fromFile: string, relativePath: string): string {
  const base = dirname(fromFile);
  return normalizeArchivePath(base ? `${base}/${relativePath}` : relativePath);
}

export function safeFileStem(value: string): string {
  const stem = removeExtension(basename(value))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem || "aircraft";
}

export function extension(path: string): string {
  const match = path.toLowerCase().match(/\.([^.\/]+)$/);
  return match?.[1] ?? "";
}

