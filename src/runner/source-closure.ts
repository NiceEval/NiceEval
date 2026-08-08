import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

async function resolveModule(from: string, specifier: string): Promise<string | undefined> {
  const raw = resolve(from, specifier);
  const candidates = extname(raw) ? [raw] : [raw, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"].map((ext) => `${raw}${ext}`), ...["index.ts", "index.tsx", "index.js"].map((name) => resolve(raw, name))];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // 尝试下一个扩展名。
    }
  }
  return undefined;
}

/** Capture a project-local static import closure, optionally stopping before owned entry modules. */
export async function captureSourceClosure(
  entryPath: string,
  options: {
    readonly root?: string;
    readonly stopPaths?: ReadonlySet<string>;
    readonly cache?: Map<string, Promise<string>>;
  } = {},
): Promise<Array<[string, string]>> {
  const root = resolve(options.root ?? process.cwd());
  const stops = new Set([...options.stopPaths ?? []].map((path) => resolve(path)));
  const visited = new Set<string>();
  const files: Array<[string, string]> = [];
  const visit = async (path: string, entry = false): Promise<void> => {
    const absolute = resolve(path);
    if ((!entry && stops.has(absolute)) || visited.has(absolute) || !absolute.startsWith(`${root}/`) && absolute !== root) return;
    visited.add(absolute);
    let pending = options.cache?.get(absolute);
    if (pending === undefined) {
      pending = readFile(absolute, "utf-8");
      options.cache?.set(absolute, pending);
    }
    const content = await pending;
    files.push([relative(root, absolute), content]);
    const specs = [...content.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)]
      .flatMap((match) => match[1] === undefined ? [] : [match[1]]);
    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const resolved = await resolveModule(dirname(absolute), spec);
      if (resolved !== undefined) await visit(resolved);
    }
  };
  await visit(entryPath, true);
  return files.sort(([a], [b]) => a.localeCompare(b));
}
