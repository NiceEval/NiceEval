// renderer 资产收集与按内容哈希物化(docs/feature/reports/architecture.md「组件自带资产」)。

import { createHash } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ReportElement, ReportNode } from "../definition/tree.ts";
import { rendererMetaOf } from "./meta.ts";

function isReportElement(node: unknown): node is ReportElement {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    "type" in node &&
    "props" in node &&
    typeof (node as ReportElement).props === "object"
  );
}
import type { MaterializedRendererAsset, PageRendererAssets, RendererAssetPaths } from "./types.ts";

const ASSET_EXT = {
  style: new Set([".css"]),
  script: new Set([".js", ".mjs"]),
} as const;

function assertLocalAssetPath(src: string, where: string): void {
  const segments = src.split(/[\\/]+/);
  if (src.startsWith("/") || /^[A-Za-z]:/.test(src) || src.startsWith("~") || segments.includes("..")) {
    throw new Error(
      `defineRenderer ${where} "${src}" is not allowed: only plain relative paths (optionally with a ./ prefix) resolve against the renderer file — no ".." segments, absolute paths, or "~". Move the asset next to the renderer file and reference it relatively.`,
    );
  }
  if (/^https?:\/\//i.test(src) || src.startsWith("//")) {
    throw new Error(
      `defineRenderer ${where} "${src}" is an external URL — renderer assets take local files only (the host pipeline vendors them). Declare third-party scripts in the report shell "head" instead.`,
    );
  }
}

function assertAssetPath(src: string, kind: "styles" | "scripts", index: number): void {
  assertLocalAssetPath(src, `assets.${kind}[${index}]`);
  const ext = extname(src).toLowerCase();
  const allowed = kind === "styles" ? ASSET_EXT.style : ASSET_EXT.script;
  if (!allowed.has(ext as ".css")) {
    throw new Error(
      `defineRenderer assets.${kind}[${index}] "${src}" has unsupported extension ${JSON.stringify(ext)} — expected ${[...allowed].join(" or ")}.`,
    );
  }
}

/** 定义期校验 assets 路径纪律。 */
export function assertRendererAssets(assets: RendererAssetPaths | undefined, label: string): void {
  if (assets === undefined) return;
  if (typeof assets !== "object" || assets === null || Array.isArray(assets)) {
    throw new Error(`defineRenderer ${label} assets must be { styles?: string[], scripts?: string[] }.`);
  }
  for (const [field, paths] of Object.entries({ styles: assets.styles, scripts: assets.scripts })) {
    if (paths === undefined) continue;
    if (!Array.isArray(paths)) {
      throw new Error(`defineRenderer ${label} assets.${field} must be an array of relative paths.`);
    }
    paths.forEach((src, index) => {
      if (typeof src !== "string" || src.length === 0) {
        throw new Error(`defineRenderer ${label} assets.${field}[${index}] must be a non-empty relative path.`);
      }
      assertAssetPath(src, field as "styles" | "scripts", index);
    });
  }
}

export interface RendererAssetDeclaration {
  readonly moduleUrl: string;
  readonly styles: readonly string[];
  readonly scripts: readonly string[];
}

function resolveAssetAbs(moduleUrl: string, relativePath: string): string {
  const base = moduleUrl.startsWith("file:") ? dirname(fileURLToPath(moduleUrl)) : dirname(moduleUrl);
  return resolve(base, relativePath);
}

/** 遍历已 resolve 的报告树,按声明顺序收集页面上实际出现的 renderer 资产。 */
export function collectRendererAssetDeclarations(tree: ReportNode): RendererAssetDeclaration[] {
  const out: RendererAssetDeclaration[] = [];
  const visit = (node: ReportNode): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isReportElement(node)) return;
    const meta = rendererMetaOf(node.type);
    if (meta && (meta.styles.length > 0 || meta.scripts.length > 0)) {
      out.push(meta);
    }
    const children = node.props.children;
    if (children !== undefined) visit(children as ReportNode);
  };
  visit(tree);
  return out;
}

function hashContent(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 按内容哈希物化 renderer 资产:同内容同扩展名只保留一份,styles 整体排在 scripts 之前,
 * 同类内按首次出现顺序稳定输出。
 */
export async function materializeRendererAssets(
  declarations: readonly RendererAssetDeclaration[],
  readFile: (absPath: string) => Promise<Uint8Array>,
): Promise<PageRendererAssets> {
  const styles: MaterializedRendererAsset[] = [];
  const scripts: MaterializedRendererAsset[] = [];
  const seen = new Map<string, MaterializedRendererAsset>();
  const fileCache = new Map<string, Uint8Array>();

  const readCached = async (abs: string): Promise<Uint8Array> => {
    const hit = fileCache.get(abs);
    if (hit) return hit;
    const bytes = await readFile(abs);
    fileCache.set(abs, bytes);
    return bytes;
  };

  const ingest = async (
    kind: "style" | "script",
    bucket: MaterializedRendererAsset[],
    moduleUrl: string,
    relativePath: string,
  ): Promise<void> => {
    const abs = resolveAssetAbs(moduleUrl, relativePath);
    const bytes = await readCached(abs);
    const ext = extname(relativePath).toLowerCase() || (kind === "style" ? ".css" : ".js");
    const hash = hashContent(bytes);
    const key = `${hash}:${ext}`;
    let materialized = seen.get(key);
    if (!materialized) {
      materialized = { hash, ext, path: `assets/${hash}${ext}`, kind, content: bytes };
      seen.set(key, materialized);
      bucket.push(materialized);
    }
  };

  for (const decl of declarations) {
    for (const src of decl.styles) await ingest("style", styles, decl.moduleUrl, src);
    for (const src of decl.scripts) await ingest("script", scripts, decl.moduleUrl, src);
  }

  return { styles, scripts };
}
