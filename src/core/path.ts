export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/")
    .split("/")
    .reduce<string[]>((parts, part) => {
      if (!part || part === ".") return parts;
      if (part === "..") parts.pop();
      else parts.push(part);
      return parts;
    }, [])
    .join("/");
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

export function basename(path: string): string {
  return normalizePath(path).split("/").pop() ?? path;
}

export function resolveRelative(ownerPath: string, referencedPath: string): string {
  return normalizePath(`${dirname(ownerPath)}/${referencedPath}`);
}

export function withoutExtension(path: string): string {
  return path.replace(/\.[^.\/]+$/, "");
}
