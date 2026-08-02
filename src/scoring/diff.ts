// agent 归因 diff 的派生视图:从落盘事实(DiffWindow[])派生文件级摘要与终态读取。
// 派生物可随时重算、不落盘——符合「聚合在消费方」铁律(docs/feature/record/architecture.md「diff.json」)。

import type { DiffArtifact, DiffData, DiffFileSummary, DiffWindow, WindowChange } from "./types.ts";

/** 从窗口序列派生 DiffData:files 摘要(net / 触及窗口)+ get(最后触及窗口的终态)。 */
export function deriveDiffData(windows: DiffArtifact): DiffData {
  const touched = new Map<
    string,
    { first: WindowChange; last: WindowChange; windows: string[]; elided?: DiffFileSummary["elided"] }
  >();
  for (const window of windows) {
    for (const [path, change] of Object.entries(window.changes)) {
      const entry = touched.get(path);
      const reason = change.elided?.reason;
      if (entry) {
        entry.last = change;
        entry.windows.push(window.window);
        // 任一窗口省略过内容,这个文件的内容视图就不完整;binary 压过 oversized-text——
        // 一个文件不会因为某一窗口恰好小于阈值就变回可内联的文本。
        if (reason !== undefined && (entry.elided === undefined || reason === "binary")) entry.elided = reason;
      } else {
        touched.set(path, { first: change, last: change, windows: [window.window], ...(reason ? { elided: reason } : {}) });
      }
    }
  }

  const files: globalThis.Record<string, DiffFileSummary> = {};
  for (const [path, entry] of touched) {
    files[path] = {
      net: computeNet(entry.first, entry.last),
      windows: entry.windows,
      ...(entry.elided ? { elided: entry.elided } : {}),
    };
  }

  return {
    windows,
    files,
    get(path: string): string | undefined {
      const entry = touched.get(path);
      if (!entry) return undefined;
      if (entry.last.status === "deleted") return undefined;
      return entry.last.after;
    },
  };
}

/** 净效果:首个触及窗口的起点 vs 最后触及窗口的终点。 */
function computeNet(first: WindowChange, last: WindowChange): DiffFileSummary["net"] {
  const existedBefore = first.status !== "added";
  const existsAfter = last.status !== "deleted";
  if (!existedBefore && !existsAfter) return "none"; // 创建又删除
  if (!existedBefore && existsAfter) return "added";
  if (existedBefore && !existsAfter) return "deleted";
  // 改回原样 = none;比较首窗口起点与末窗口终点的内容(内容被省略的条目按字节数近似)。
  const beforeContent = first.before ?? first.elided?.beforeBytes;
  const afterContent = last.after ?? last.elided?.afterBytes;
  if (beforeContent !== undefined && afterContent !== undefined && beforeContent === afterContent) return "none";
  return "modified";
}

/** DiffArtifact 里是否有任何窗口触及过任何文件。 */
export function diffIsEmpty(diff: DiffData): boolean {
  return Object.keys(diff.files).length === 0;
}

/** 正则是否命中任何被触及的路径或任何窗口的 before/after 内容。 */
export function diffMatches(diff: DiffData, re: RegExp): boolean {
  for (const path of Object.keys(diff.files)) {
    if (re.test(path)) return true;
  }
  for (const window of diff.windows) {
    for (const change of Object.values(window.changes)) {
      if (change.after !== undefined && re.test(change.after)) return true;
      if (change.before !== undefined && re.test(change.before)) return true;
    }
  }
  return false;
}

/**
 * 该文件最后一个触及窗口的内容有没有被省略——`get(path)` 返回 undefined 的两个原因
 * (净删除 / 从未触及,与内容被省略)由它区分:内容断言据此如实报证据不可用,
 * 不把「读不到内容」静默折成判过或判败(docs/feature/sandbox/architecture.md「导出往返是常数次」)。
 */
export function elidedContentAt(diff: DiffData, path: string): NonNullable<WindowChange["elided"]> | undefined {
  for (let i = diff.windows.length - 1; i >= 0; i--) {
    const change = diff.windows[i]!.changes[path];
    if (change !== undefined) return change.elided;
  }
  return undefined;
}

/** 全部内容被省略的路径(任一窗口),按路径序;内容扫描类断言用它说明缺口。 */
export function elidedContentPaths(diff: DiffData): string[] {
  const paths = new Set<string>();
  for (const window of diff.windows) {
    for (const [path, change] of Object.entries(window.changes)) {
      if (change.elided) paths.add(path);
    }
  }
  return [...paths].sort();
}

/** 内容被省略的条目怎么向人交代:reason + 已知字节数。 */
export function describeElided(elided: NonNullable<WindowChange["elided"]>): string {
  const bytes = [
    elided.beforeBytes === undefined ? undefined : `before ${elided.beforeBytes} bytes`,
    elided.afterBytes === undefined ? undefined : `after ${elided.afterBytes} bytes`,
  ].filter((part) => part !== undefined);
  return bytes.length > 0 ? `${elided.reason} (${bytes.join(", ")})` : elided.reason;
}

/** 空 diff(remote / skipped attempt)。 */
export function emptyDiffData(): DiffData {
  return deriveDiffData([]);
}

export type { DiffArtifact, DiffData, DiffWindow, WindowChange } from "./types.ts";
