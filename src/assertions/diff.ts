// agent 归因 diff 的派生视图:从落盘事实(DiffWindow[])派生文件级摘要与终态读取。
// 派生物可随时重算、不落盘——符合「聚合在消费方」铁律(docs/feature/record/architecture.md「diff.json」)。
// 本文件同时承载 Sandbox 事实(docs/roadmap/assertion-authoring/architecture.md「Sandbox diff collector」)
// 的纯证据解析:exact touched-path set、noChanges 同源、同一 change entry 的 before/after 候选。
// 这里只做证据解析与候选分类,不消费 BooleanMatch——matcher 应用留在接线层,避免复制 Match 内核。

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

// ── Sandbox 事实的纯证据解析 ──
//
// changedPaths() / noChanges() / fileChanged() 共用这里的能力,不复制第二套路径集合或
// change entry 逻辑。这些函数是纯 evaluator / 证据解析:输入落盘事实,输出三值结果或
// 候选分类,不登记判定用途、不触碰 collector、不产生公共 Fact。

/**
 * 校验 `changedPaths()` 的 expected 路径列表。
 * 每条 expected path 必须已经是 Sandbox workdir 相对的 canonical POSIX 路径；空数组
 * 合法——`noChanges()` 就是空 exact set 的同源形态，path 顺序无意义。
 */
/** Canonical Sandbox workdir-relative path shared by registration and storage. */
export function isCanonicalWorkspaceRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\u0000")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:\//.test(value)
  ) {
    return false;
  }
  return value.split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}

export function assertCanonicalWorkspaceRelativePath(
  value: unknown,
  owner: string,
): asserts value is string {
  if (!isCanonicalWorkspaceRelativePath(value)) {
    throw new TypeError(
      `${owner} must be a canonical portable workspace-relative path without absolute, ., .., empty, NUL, or backslash segments`,
    );
  }
}

export function validateExpectedTouchedPaths(expected: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of expected) {
    assertCanonicalWorkspaceRelativePath(path, "changedPaths() path");
    if (seen.has(path)) {
      throw new Error(`changedPaths(): duplicate expected path ${JSON.stringify(path)}`);
    }
    seen.add(path);
  }
}

/** 被 agent 触及的 exact path set(diff.files 的 keys),按路径序;added / modified / deleted 与净改回原样都保留。 */
export function touchedPaths(diff: DiffData): string[] {
  return Object.keys(diff.files).sort();
}

/** 该 path 的净效果;从未被触及返回 undefined。 */
export function netChangeOf(diff: DiffData, path: string): DiffFileSummary["net"] | undefined {
  return diff.files[path]?.net;
}

/** 触及该 path 的窗口标签(按时序);从未被触及返回 undefined。 */
export function touchedWindowsOf(diff: DiffData, path: string): string[] | undefined {
  return diff.files[path]?.windows;
}

export type TouchedPathsOutcome =
  | { readonly outcome: "passed" }
  | {
      readonly outcome: "failed";
      /** expected 之外的确定触及 path。 */
      readonly unexpected: readonly string[];
      /** expected 中未被触及的 path。 */
      readonly missing: readonly string[];
    }
  | { readonly outcome: "unavailable"; readonly reason: string };

/**
 * exact touched-path set 的三值求值(docs/roadmap/assertion-authoring/architecture.md
 * 「Sandbox diff collector」):
 * - 已观察到 expected 外的确定 path,立即 failed(partial 也如此,不会被后续窗口推翻);
 * - collector complete 时,集合相等 passed,不等 failed;
 * - collector partial 且尚无矛盾(observed ⊆ expected)时 unavailable。
 * `noChanges()` 是 expected 为空集的同源调用。
 */
export function evaluateTouchedPaths(
  diff: DiffData,
  expected: readonly string[],
  complete = true,
): TouchedPathsOutcome {
  validateExpectedTouchedPaths(expected);
  const expectedSet = new Set(expected);
  const observed = touchedPaths(diff);
  const observedSet = new Set(observed);
  const unexpected = observed.filter((path) => !expectedSet.has(path));
  if (unexpected.length > 0) {
    return {
      outcome: "failed",
      unexpected,
      missing: [...expectedSet].filter((path) => !observedSet.has(path)).sort(),
    };
  }
  if (!complete) return { outcome: "unavailable", reason: "evidence-coverage:diff=partial" };
  const missing = [...expectedSet].filter((path) => !observedSet.has(path)).sort();
  if (missing.length > 0) return { outcome: "failed", unexpected: [], missing };
  return { outcome: "passed" };
}

/** `noChanges()` 的纯求值:expected 固定为空集,与 changedPaths([]) 同一能力。 */
export function evaluateNoChanges(
  diff: DiffData,
  complete = true,
): TouchedPathsOutcome {
  return evaluateTouchedPaths(diff, [], complete);
}

/** 一条 change entry 的某一侧(before / after)内容证据状态。 */
export type ChangeContentState =
  | { readonly state: "available"; readonly text: string }
  | {
      /** 确定性缺失:added 无 before、deleted 无 after。matcher 要求该侧即确定不满足。 */
      readonly state: "absent";
    }
  | {
      /** 内容被省略(binary / oversized-text),字节数只知部分时省略 bytes。 */
      readonly state: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly bytes?: number;
    }
  | {
      /** 内容证据不在(如 provider 不支持内容导出);与「缺失」相反,不能确定该侧不成立。 */
      readonly state: "unavailable";
      readonly reason: string;
    };

/** 同一 change entry 的 before / after 证据候选:接线层在此之上应用 BooleanMatch。 */
export interface ChangeEntryCandidate {
  readonly window: string;
  readonly status: WindowChange["status"];
  readonly before: ChangeContentState;
  readonly after: ChangeContentState;
}

function contentStateOf(change: WindowChange, side: "before" | "after"): ChangeContentState {
  if (side === "before" && change.status === "added") return { state: "absent" };
  if (side === "after" && change.status === "deleted") return { state: "absent" };
  const elided = change.elided;
  if (elided) {
    const bytes = side === "before" ? elided.beforeBytes : elided.afterBytes;
    return { state: "elided", reason: elided.reason, ...(bytes !== undefined ? { bytes } : {}) };
  }
  const text = side === "before" ? change.before : change.after;
  if (text === undefined) return { state: "unavailable", reason: "content-evidence-missing" };
  return { state: "available", text };
}

/**
 * 解析某 path 在全部窗口中的 change entry 候选,按时序。
 * before / after matcher 必须由**同一条** entry 满足;返回 undefined 表示从未被触及
 * (无候选即确定不满足,不存在「两个 matcher 分别由不同窗口满足」的路径)。
 */
export function changeEntryCandidatesFor(diff: DiffData, path: string): ChangeEntryCandidate[] | undefined {
  const candidates: ChangeEntryCandidate[] = [];
  for (const window of diff.windows) {
    const change = window.changes[path];
    if (change === undefined) continue;
    candidates.push({
      window: window.window,
      status: change.status,
      before: contentStateOf(change, "before"),
      after: contentStateOf(change, "after"),
    });
  }
  return candidates.length > 0 ? candidates : undefined;
}

export type { DiffArtifact, DiffData, DiffWindow, WindowChange } from "./types.ts";
