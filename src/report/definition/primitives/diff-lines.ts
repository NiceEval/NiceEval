// 文件差异的值形状与纯文本渲染:DiffView 两面、show 的 --diff 与 --diff=<path> 共用这一份
// (契约 docs/feature/reports/components/primitives/diff-view.md)。这个模块不含 JSX,所以
// src/show 能直接从源码引它,web 面走 dist/report 的编译产物,两条路径消费同一份实现。

import { renderAlignedRows } from "../../model/text-layout.ts";

export type DiffChange = "added" | "modified" | "deleted";

/** 一个 send 窗口内这个文件的改动;`patch` 省略即这一段没有内联内容。 */
export interface DiffFileWindow {
  window: string;
  patch?: string;
}

export interface DiffFile {
  /** workdir 根起的相对路径,`/` 分隔。 */
  path: string;
  change: DiffChange;
  /** 净行数变化:公共前后缀修剪后的上界近似。 */
  added: number;
  removed: number;
  /** 内容被省略的文件只报字节数与原因(二进制 / 超过单文件阈值的文本),`windows` 里不带 patch。 */
  elided?: { reason: "binary" | "oversized-text"; beforeBytes?: number; afterBytes?: number };
  /** 触碰过该文件的窗口,按时序,至少一条。 */
  windows: readonly DiffFileWindow[];
}

export type DiffContent = readonly DiffFile[];

/** 与 diff.json 的 net 同一套词:两面都打印 A / M / D。 */
export function diffChangeLetter(change: DiffChange): string {
  return change === "added" ? "A" : change === "deleted" ? "D" : "M";
}

export function diffWindowLabels(file: DiffFile): string {
  return file.windows.map((w) => w.window).join(", ");
}

/** 省略原因在两面共用的一枚词:行上标注它,人才知道为什么没有 patch。 */
export function diffElidedLabel(reason: NonNullable<DiffFile["elided"]>["reason"]): string {
  return reason === "binary" ? "binary" : "oversized text";
}

/** 摘要行的增删格:内容被省略的文件报原因 + 字节数,净零报 `±0`。 */
export function diffDeltaCell(file: DiffFile): string {
  if (file.elided) {
    return `${diffElidedLabel(file.elided.reason)} ${file.elided.beforeBytes ?? 0} → ${file.elided.afterBytes ?? 0} bytes`;
  }
  const parts = [file.added > 0 ? `+${file.added}` : "", file.removed > 0 ? `-${file.removed}` : ""];
  return parts.filter(Boolean).join(" ") || "±0";
}

export function sortDiffFiles(files: DiffContent): DiffFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 文件级摘要清单:`niceeval show --diff` 与组件 text 面同一份输出。
 * `drillDown` 追在头行后面(attempt 首页的紧凑摘要用),`singleFileHint` 追一行单文件命令。
 */
export function diffSummaryText(
  files: DiffContent,
  opts: { drillDown?: string; singleFileHint?: boolean } = {},
): string {
  if (files.length === 0) return "";
  const sorted = sortDiffFiles(files);
  const rows = sorted.map((file) => [
    diffChangeLetter(file.change),
    file.path,
    diffDeltaCell(file),
    diffWindowLabels(file),
  ]);
  const head = `${files.length} ${files.length === 1 ? "file" : "files"} changed by agent`;
  const lines = [opts.drillDown ? `${head} · ${opts.drillDown}` : head];
  lines.push(
    renderAlignedRows(rows)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  );
  if (opts.singleFileHint) {
    lines.push("", `single file: niceeval show @… --diff=${sorted[0]!.path}`);
  }
  return lines.join("\n");
}

/** 单文件的逐窗口分段:`--diff=<path>` 与 web 面折叠区同一批段落,不合成跨窗口 patch。 */
export function diffFilePatchText(file: DiffFile): string {
  const head = `${diffChangeLetter(file.change)} ${file.path} · touched in ${diffWindowLabels(file)}`;
  const sections = file.windows.map((w) => `── window ${w.window}\n${windowBody(file, w)}`);
  return [head, ...sections].join("\n\n");
}

function windowBody(file: DiffFile, w: DiffFileWindow): string {
  if (file.elided) {
    return `${diffElidedLabel(file.elided.reason)} · ${file.elided.beforeBytes ?? 0} → ${file.elided.afterBytes ?? 0} bytes`;
  }
  return w.patch === undefined || w.patch.length === 0 ? "(patch unavailable)" : w.patch;
}

// ───────────────────────── web 面的内联预算 ─────────────────────────

/** 单个文件全部窗口 patch 的合计上限。 */
export const DIFF_FILE_PATCH_BUDGET_BYTES = 64 * 1024;

/** 一个 DiffView 实例内联 patch 的合计上限。 */
export const DIFF_VIEW_PATCH_BUDGET_BYTES = 512 * 1024;

const encoder = new TextEncoder();

export function diffFilePatchBytes(file: DiffFile): number {
  let bytes = 0;
  for (const w of file.windows) {
    if (w.patch !== undefined) bytes += encoder.encode(w.patch).length;
  }
  return bytes;
}

/**
 * 决定哪些文件的 patch 内联进 HTML:按路径序累加,所以同一份输入每次产出同一个站点。
 * 内容被省略的文件不参与(它们没有 patch)。
 */
export function planInlinePatches(files: DiffContent): Set<string> {
  const inlined = new Set<string>();
  let spent = 0;
  for (const file of sortDiffFiles(files)) {
    if (file.elided) continue;
    const bytes = diffFilePatchBytes(file);
    if (bytes === 0 || bytes > DIFF_FILE_PATCH_BUDGET_BYTES) continue;
    if (spent + bytes > DIFF_VIEW_PATCH_BUDGET_BYTES) continue;
    spent += bytes;
    inlined.add(file.path);
  }
  return inlined;
}

// ───────────────────────── web 面的路径树 ─────────────────────────

export interface DiffTreeNode {
  /** 显示名:单子目录链压缩后可能是 `report/model`。 */
  name: string;
  /** 目录完整路径,用作 key。 */
  path: string;
  dirs: DiffTreeNode[];
  files: DiffFile[];
  /** 子树汇总。 */
  fileCount: number;
  added: number;
  removed: number;
}

interface MutableNode {
  name: string;
  path: string;
  dirs: Map<string, MutableNode>;
  files: DiffFile[];
}

function emptyNode(name: string, path: string): MutableNode {
  return { name, path, dirs: new Map(), files: [] };
}

/**
 * 按路径分层:`change` 只落在文件行上,不参与分组。
 * 只有一个子目录、自己没有文件的目录链压成一行。
 */
export function buildDiffTree(files: DiffContent): DiffTreeNode {
  const root = emptyNode("", "");
  for (const file of sortDiffFiles(files)) {
    const segments = file.path.split("/");
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      const path = node.path === "" ? name : `${node.path}/${name}`;
      let next = node.dirs.get(name);
      if (next === undefined) {
        next = emptyNode(name, path);
        node.dirs.set(name, next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return finalize(root);
}

function finalize(node: MutableNode): DiffTreeNode {
  let current = node;
  // 单子目录链压缩:`src/` 下只有 `report/` 且自己没有文件时显示成 `src/report`。
  while (current.files.length === 0 && current.dirs.size === 1 && current.path !== "") {
    const only = [...current.dirs.values()][0]!;
    current = { name: `${current.name}/${only.name}`, path: only.path, dirs: only.dirs, files: only.files };
  }
  const dirs = [...current.dirs.values()]
    .map(finalize)
    .sort((a, b) => a.path.localeCompare(b.path));
  const files = current.files;
  let fileCount = files.length;
  let added = 0;
  let removed = 0;
  for (const file of files) {
    added += file.added;
    removed += file.removed;
  }
  for (const dir of dirs) {
    fileCount += dir.fileCount;
    added += dir.added;
    removed += dir.removed;
  }
  return { name: current.name, path: current.path, dirs, files, fileCount, added, removed };
}
