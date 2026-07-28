// agent 归因 diff 的派生视图:从落盘事实(DiffWindow[])派生文件级摘要与终态读取。
// 派生物可随时重算、不落盘——符合「聚合在消费方」铁律(docs/feature/record/architecture.md「diff.json」)。

import type { DiffArtifact, DiffData, DiffFileSummary, DiffWindow, WindowChange } from "./types.ts";

/** 从窗口序列派生 DiffData:files 摘要(net / 触及窗口)+ get(最后触及窗口的终态)。 */
export function deriveDiffData(windows: DiffArtifact): DiffData {
  const touched = new Map<string, { first: WindowChange; last: WindowChange; windows: string[]; binary: boolean }>();
  for (const window of windows) {
    for (const [path, change] of Object.entries(window.changes)) {
      const entry = touched.get(path);
      if (entry) {
        entry.last = change;
        entry.windows.push(window.window);
        if (change.binary) entry.binary = true;
      } else {
        touched.set(path, { first: change, last: change, windows: [window.window], binary: change.binary !== undefined });
      }
    }
  }

  const files: globalThis.Record<string, DiffFileSummary> = {};
  for (const [path, entry] of touched) {
    files[path] = {
      net: computeNet(entry.first, entry.last),
      windows: entry.windows,
      ...(entry.binary ? { binary: true as const } : {}),
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
  // 改回原样 = none;比较首窗口起点与末窗口终点的内容(二进制按字节数近似)。
  const beforeContent = first.before ?? first.binary?.beforeBytes;
  const afterContent = last.after ?? last.binary?.afterBytes;
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

/** 空 diff(remote / unreadable attempt)。 */
export function emptyDiffData(): DiffData {
  return deriveDiffData([]);
}

export type { DiffArtifact, DiffData, DiffWindow, WindowChange } from "./types.ts";
