export function parseOptionDefaults(source: string, prefixes: string[]): Record<string, number> {
  const options = new Map<string, number>();
  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r\n?|\n/)) {
    const match = rawLine.trim().match(/^([a-z0-9_]+)\s*=\s*(-?(?:\d+\.?\d*|\.\d+))\s*$/i);
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) options.set(match[1].toLowerCase(), value);
  }

  const result: Record<string, number> = {};
  for (const prefix of prefixes) {
    for (const [name, value] of options) result[`${prefix}/conf/${name}`] = value;
  }
  return result;
}
