/** Route and download validation is pure so every host target shares one collision set. */

export interface ReportPathInvalid {
  readonly code: "report-path-invalid";
  readonly value: string;
  readonly kind: "route" | "parameter-key" | "download";
  readonly reason: string;
}

export interface ReportStaticPath {
  readonly owner: "route" | "download" | "host";
  readonly source: string;
  readonly segments: readonly string[];
  readonly posix: string;
}

export interface ReportStaticPathConflict {
  readonly kind:
    | "exact"
    | "case-fold"
    | "windows-equivalent"
    | "file-directory-prefix";
  readonly left: ReportStaticPath;
  readonly right: ReportStaticPath;
}

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const encoder = new TextEncoder();

export function validateReportRoute(value: string): ReportPathInvalid | undefined {
  if (value === "/") return undefined;
  if (!value.startsWith("/")) return invalid(value, "route", "a route must be absolute");
  const segments = value.slice(1).split("/");
  return validateSegments(value, "route", segments, { allowMany: true });
}

export function validateParameterKey(value: string): ReportPathInvalid | undefined {
  return validateSegments(value, "parameter-key", [value], { allowMany: false });
}

export function validateDownloadPath(value: string): ReportPathInvalid | undefined {
  if (value.startsWith("/")) return invalid(value, "download", "a download path must be relative");
  return validateSegments(value, "download", value.split("/"), { allowMany: true });
}

export function routeWithParameterKey(path: string, key: string): string {
  return path === "/" ? `/${key}` : `${path}/${key}`;
}

export function staticPathForRoute(route: string): ReportStaticPath {
  const routeSegments = route === "/" ? [] : route.slice(1).split("/");
  const segments = [...routeSegments, "index.html"];
  return Object.freeze({
    owner: "route" as const,
    source: route,
    segments: Object.freeze(segments),
    posix: segments.join("/"),
  });
}

export function staticPathForDownload(path: string): ReportStaticPath {
  const segments = ["downloads", ...path.split("/")];
  return Object.freeze({
    owner: "download" as const,
    source: path,
    segments: Object.freeze(segments),
    posix: segments.join("/"),
  });
}

/** Host-owned files participate in exactly the same collision analysis. */
export function hostStaticPath(path: string): ReportStaticPath {
  const segments = path.split("/");
  return Object.freeze({
    owner: "host" as const,
    source: path,
    segments: Object.freeze(segments),
    posix: path,
  });
}

export function staticPathConflicts(
  paths: readonly ReportStaticPath[],
): readonly ReportStaticPathConflict[] {
  const conflicts: ReportStaticPathConflict[] = [];
  const emitted = new Set<string>();
  const exact = new Map<string, ReportStaticPath>();
  const folded = new Map<string, ReportStaticPath>();
  const windows = new Map<string, ReportStaticPath>();
  const trie = newPathTrie();
  const ordered = [...paths].sort((left, right) => compareUtf8(left.posix, right.posix));
  for (const path of ordered) {
    const exactPath = exact.get(path.posix);
    if (exactPath !== undefined) {
      addConflict(conflicts, emitted, "exact", exactPath, path);
    } else {
      const foldedPath = folded.get(foldedStaticPath(path.segments));
      if (foldedPath !== undefined) {
        addConflict(conflicts, emitted, "case-fold", foldedPath, path);
      } else {
        const windowsPath = windows.get(windowsStaticPath(path.segments));
        if (windowsPath !== undefined) {
          addConflict(conflicts, emitted, "windows-equivalent", windowsPath, path);
        }
      }
    }

    let node = trie;
    for (const segment of path.segments) {
      for (const ancestor of node.terminals.values()) {
        addConflict(conflicts, emitted, "file-directory-prefix", ancestor, path);
      }
      let child = node.children.get(segment);
      if (child === undefined) {
        child = newPathTrie();
        node.children.set(segment, child);
      }
      node = child;
    }
    for (const descendant of descendantTerminals(node)) {
      addConflict(conflicts, emitted, "file-directory-prefix", path, descendant);
    }
    node.terminals.set(pathSourceKey(path), path);
    exact.set(path.posix, exactPath ?? path);
    folded.set(foldedStaticPath(path.segments), folded.get(foldedStaticPath(path.segments)) ?? path);
    windows.set(windowsStaticPath(path.segments), windows.get(windowsStaticPath(path.segments)) ?? path);
  }
  return Object.freeze(conflicts);
}

function validateSegments(
  value: string,
  kind: ReportPathInvalid["kind"],
  segments: readonly string[],
  options: { readonly allowMany: boolean },
): ReportPathInvalid | undefined {
  if (encoder.encode(value).byteLength > 1_024) {
    return invalid(value, kind, "a path may contain at most 1,024 UTF-8 bytes");
  }
  if (value.includes("%") || value.includes("?") || value.includes("#") || value.includes("\\")) {
    return invalid(value, kind, "a path cannot contain percent, query, fragment, or backslash syntax");
  }
  if (segments.length === 0 || (options.allowMany && segments.length > 32)) {
    return invalid(value, kind, "a path needs from one through 32 segments");
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return invalid(value, kind, "a path cannot contain an empty, dot, or dot-dot segment");
    }
    if (encoder.encode(segment).byteLength > 128) {
      return invalid(value, kind, "a path segment may contain at most 128 UTF-8 bytes");
    }
    if (!SEGMENT_PATTERN.test(segment)) {
      return invalid(value, kind, "a path segment must match [a-z0-9][a-z0-9._~-]*");
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      return invalid(value, kind, "a path segment cannot end in dot or space");
    }
    if (WINDOWS_DEVICE.test(segment)) {
      return invalid(value, kind, "a path segment cannot be a Windows device name");
    }
  }
  return undefined;
}

interface PathTrie {
  readonly children: Map<string, PathTrie>;
  readonly terminals: Map<string, ReportStaticPath>;
}

function newPathTrie(): PathTrie {
  return { children: new Map(), terminals: new Map() };
}

function* descendantTerminals(node: PathTrie): Iterable<ReportStaticPath> {
  for (const child of node.children.values()) {
    yield* child.terminals.values();
    yield* descendantTerminals(child);
  }
}

function addConflict(
  conflicts: ReportStaticPathConflict[],
  emitted: Set<string>,
  kind: ReportStaticPathConflict["kind"],
  left: ReportStaticPath,
  right: ReportStaticPath,
): void {
  const leftKey = pathSourceKey(left);
  const rightKey = pathSourceKey(right);
  const pair = compareUtf8(leftKey, rightKey) <= 0 ? `${leftKey}\u0001${rightKey}` : `${rightKey}\u0001${leftKey}`;
  const key = `${kind}\u0000${pair}`;
  if (emitted.has(key)) return;
  emitted.add(key);
  conflicts.push(Object.freeze({ kind, left, right }));
}

function pathSourceKey(path: ReportStaticPath): string {
  return `${path.owner}\u0000${path.source}`;
}

function foldedStaticPath(segments: readonly string[]): string {
  return segments.join("/").toLowerCase();
}

function windowsStaticPath(segments: readonly string[]): string {
  return segments.map((segment) => segment.replace(/[. ]+$/u, "").toLowerCase()).join("/");
}

function invalid(
  value: string,
  kind: ReportPathInvalid["kind"],
  reason: string,
): ReportPathInvalid {
  return Object.freeze({ code: "report-path-invalid" as const, value, kind, reason });
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const delta = leftBytes[index]! - rightBytes[index]!;
    if (delta !== 0) return delta;
  }
  return leftBytes.length - rightBytes.length;
}
