/** Renderer asset declarations and Host-owned materialization helpers. */

import { createHash } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Fragment,
  type ReportElement,
  type ReportNode,
} from "../definition/tree.ts";
import { rendererMetaOf } from "./meta.ts";
import type {
  MaterializedRendererAsset,
  PageRendererAssets,
  RendererAssetPaths,
} from "./types.ts";

const ASSET_EXTENSIONS = {
  styles: new Set([".css"]),
  scripts: new Set([".js", ".mjs"]),
} as const;

function assertLocalAssetPath(path: string, where: string): void {
  const segments = path.split(/[\\/]+/u);
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.startsWith("~") || segments.includes("..")) {
    throw new TypeError(
      `defineRenderer ${where} ${JSON.stringify(path)} must be a local relative path without "..", an absolute path, or "~".`,
    );
  }
  if (/^https?:\/\//iu.test(path) || path.startsWith("//")) {
    throw new TypeError(
      `defineRenderer ${where} ${JSON.stringify(path)} cannot be an external URL; declare third-party scripts in Report head instead.`,
    );
  }
}

function assertAssetPath(path: string, field: "styles" | "scripts", index: number): void {
  assertLocalAssetPath(path, `assets.${field}[${index}]`);
  const extension = extname(path).toLowerCase();
  if (!ASSET_EXTENSIONS[field].has(extension as never)) {
    throw new TypeError(
      `defineRenderer assets.${field}[${index}] ${JSON.stringify(path)} has unsupported extension ${JSON.stringify(extension)}.`,
    );
  }
}

/** Validates closed local asset paths at renderer-definition time. */
export function assertRendererAssets(assets: RendererAssetPaths | undefined, label = "defineRenderer"): void {
  if (assets === undefined) return;
  if (typeof assets !== "object" || assets === null || Array.isArray(assets)) {
    throw new TypeError(`${label} assets must be { styles?: string[], scripts?: string[] }`);
  }
  for (const field of ["styles", "scripts"] as const) {
    const paths = assets[field];
    if (paths === undefined) continue;
    if (!Array.isArray(paths)) throw new TypeError(`${label} assets.${field} must be an array of local paths`);
    paths.forEach((path, index) => {
      if (typeof path !== "string" || path.length === 0) {
        throw new TypeError(`${label} assets.${field}[${index}] must be a non-empty local path`);
      }
      assertAssetPath(path, field, index);
    });
  }
}

export interface RendererAssetDeclaration {
  readonly moduleUrl: string;
  readonly styles: readonly string[];
  readonly scripts: readonly string[];
}

const REACT_ELEMENT_MARKERS = new Set<symbol>([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
]);

function isReportElement(value: unknown): value is ReportElement {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const element = value as Partial<ReportElement>;
  return typeof element.$$typeof === "symbol" && REACT_ELEMENT_MARKERS.has(element.$$typeof) &&
    typeof element.props === "object" && element.props !== null;
}

/** Collects assets from the resolved standard React tree in declaration order. */
export function collectRendererAssetDeclarations(tree: ReportNode): readonly RendererAssetDeclaration[] {
  const declarations: RendererAssetDeclaration[] = [];
  const visit = (node: ReportNode): void => {
    if (node === null || node === undefined || typeof node === "boolean" ||
      typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isReportElement(node)) return;
    const meta = rendererMetaOf(node.type);
    if (meta !== undefined && (meta.styles.length > 0 || meta.scripts.length > 0)) {
      declarations.push(meta);
    }
    if (node.type === Fragment || node.props.children !== undefined) {
      visit(node.props.children as ReportNode);
    }
  };
  visit(tree);
  return Object.freeze(declarations);
}

function resolveAssetPath(moduleUrl: string, relativePath: string): string {
  const base = moduleUrl.startsWith("file:") ? dirname(fileURLToPath(moduleUrl)) : dirname(moduleUrl);
  return resolve(base, relativePath);
}

function contentHash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Materializes closed renderer asset declarations.  The Host supplies file IO
 * so author code never gains a filesystem capability or executable callback.
 */
export async function materializeRendererAssets(
  declarations: readonly RendererAssetDeclaration[],
  readFile: (absolutePath: string) => Promise<Uint8Array>,
): Promise<PageRendererAssets> {
  const styles: MaterializedRendererAsset[] = [];
  const scripts: MaterializedRendererAsset[] = [];
  const assetsByHash = new Map<string, MaterializedRendererAsset>();
  const contentsByPath = new Map<string, Uint8Array>();

  const readCached = async (absolutePath: string): Promise<Uint8Array> => {
    const cached = contentsByPath.get(absolutePath);
    if (cached !== undefined) return cached;
    const content = await readFile(absolutePath);
    contentsByPath.set(absolutePath, content);
    return content;
  };

  const materialize = async (
    kind: "style" | "script",
    bucket: MaterializedRendererAsset[],
    moduleUrl: string,
    relativePath: string,
  ): Promise<void> => {
    const absolutePath = resolveAssetPath(moduleUrl, relativePath);
    const content = await readCached(absolutePath);
    const extension = extname(relativePath).toLowerCase() || (kind === "style" ? ".css" : ".js");
    const hash = contentHash(content);
    const key = `${kind}:${hash}:${extension}`;
    let asset = assetsByHash.get(key);
    if (asset === undefined) {
      asset = Object.freeze({
        hash,
        ext: extension,
        path: `assets/${hash}${extension}`,
        kind,
        content,
      });
      assetsByHash.set(key, asset);
      bucket.push(asset);
    }
  };

  for (const declaration of declarations) {
    for (const relativePath of declaration.styles) {
      await materialize("style", styles, declaration.moduleUrl, relativePath);
    }
    for (const relativePath of declaration.scripts) {
      await materialize("script", scripts, declaration.moduleUrl, relativePath);
    }
  }
  return Object.freeze({ styles: Object.freeze(styles), scripts: Object.freeze(scripts) });
}
