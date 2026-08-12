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
export function isCanonicalWorkspaceRelativePathV1(value: unknown): value is string {
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

export function assertCanonicalWorkspaceRelativePathV1(
  value: unknown,
  owner: string,
): asserts value is string {
  if (!isCanonicalWorkspaceRelativePathV1(value)) {
    throw new TypeError(
      `${owner} must be a canonical portable workspace-relative path without absolute, ., .., empty, NUL, or backslash segments`,
    );
  }
}

export function validateExpectedTouchedPaths(expected: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of expected) {
    assertCanonicalWorkspaceRelativePathV1(path, "changedPaths() path");
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

// ── Frozen Attempt-owned workspace diff v1 ──
//
// Assert-first sandbox Assertions use only the exact document below. It is
// exported once after the author settles and then shared by the Attachment
// writer and every post-run evaluator; no consumer rebuilds it from a
// workspace.

export const AGENT_WORKSPACE_DIFF_SCHEMA_ID_V1 = "niceeval.diff/v1" as const;
export const AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1 =
  "agent-send-window-endpoints/v1" as const;

export interface AgentWorkspaceDiffPolicyV1 {
  /** Frozen identity for NiceEval's built-in ledger exclusion policy. */
  readonly defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1";
  /** Effective user include rules after definition normalization. */
  readonly include: readonly string[];
  /** Effective user ignore rules; the named default policy supplies defaults. */
  readonly ignore: readonly string[];
}

export interface AgentSendWindowIdentityV1 {
  /** Primary-session labels omit this field instead of pretending session zero. */
  readonly session?: number;
  readonly turn: number;
}

/** Endpoint states are explicit so an empty Available diff is never confused with failed collection. */
export type AgentWorkspaceDiffEndpointV1 =
  | { readonly state: "absent" }
  | { readonly state: "text"; readonly text: string }
  | {
      readonly state: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly bytes?: number;
    };

/** A no-context, directional changed-text corpus. It never stores unchanged context. */
export interface AgentWorkspaceDiffHunksV1 {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface AgentWorkspaceDiffWindowChangeV1 {
  readonly path: string;
  readonly status: WindowChange["status"];
  readonly before: AgentWorkspaceDiffEndpointV1;
  readonly after: AgentWorkspaceDiffEndpointV1;
  readonly hunks: AgentWorkspaceDiffHunksV1;
}

export interface AgentWorkspaceDiffWindowV1 {
  readonly identity: AgentSendWindowIdentityV1;
  /** Every agent send is present, including a zero-change window. */
  readonly changes: readonly AgentWorkspaceDiffWindowChangeV1[];
}

/** The exact semantic payload persisted by the Attempt-owned diff Attachment. */
export interface AgentWorkspaceDiffDocumentV1 {
  readonly attribution: typeof AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1;
  readonly policy: AgentWorkspaceDiffPolicyV1;
  readonly windows: readonly AgentWorkspaceDiffWindowV1[];
}

/** Runtime state deliberately distinguishes an empty successful export from failed collection. */
export type PostRunWorkspaceDiffStateV1 =
  | { readonly state: "pending" }
  | { readonly state: "available"; readonly document: AgentWorkspaceDiffDocumentV1 }
  | {
      readonly state: "unavailable";
      readonly reason: "producer-failed" | "producer-interrupted" | "sandbox-unavailable";
    };

export interface WorkspaceDiffNotInOptionsV1 {
  readonly content?: "added" | "removed" | "both";
}

export type WorkspaceDiffNotInOutcomeV1 =
  | { readonly state: "matched" }
  | { readonly state: "mismatched" }
  | {
      readonly state: "unavailable";
      readonly reason: "content-elided";
    };

function frozenArray<Value>(items: readonly Value[]): readonly Value[] {
  return Object.freeze([...items]);
}

function parseAgentSendWindowIdentityV1(label: string): AgentSendWindowIdentityV1 {
  const primary = /^turn([1-9][0-9]*)$/.exec(label);
  if (primary !== null) return Object.freeze({ turn: Number(primary[1]) });
  const session = /^session([1-9][0-9]*)\/turn([1-9][0-9]*)$/.exec(label);
  if (session !== null) {
    return Object.freeze({ session: Number(session[1]), turn: Number(session[2]) });
  }
  throw new Error(`Workspace diff received an invalid agent send window label ${JSON.stringify(label)}`);
}

function endpointFor(
  change: WindowChange,
  side: "before" | "after",
): AgentWorkspaceDiffEndpointV1 {
  if ((side === "before" && change.status === "added") || (side === "after" && change.status === "deleted")) {
    return Object.freeze({ state: "absent" as const });
  }
  if (change.elided !== undefined) {
    const bytes = side === "before" ? change.elided.beforeBytes : change.elided.afterBytes;
    return Object.freeze({
      state: "elided" as const,
      reason: change.elided.reason,
      ...(bytes === undefined ? {} : { bytes }),
    });
  }
  const text = side === "before" ? change.before : change.after;
  if (text === undefined) {
    throw new Error(`Workspace diff ${side} endpoint is missing for ${change.status} change`);
  }
  return Object.freeze({ state: "text" as const, text });
}

function linesForHunks(text: string): readonly string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

const MAX_HUNK_LCS_CELLS_V1 = 1_000_000;

function hunkCellsFit(left: readonly string[], right: readonly string[]): boolean {
  return left.length + 1 <= Math.floor(MAX_HUNK_LCS_CELLS_V1 / (right.length + 1));
}

type LineDiffOperationV1 =
  | { readonly kind: "unchanged" }
  | { readonly kind: "added"; readonly line: string }
  | { readonly kind: "removed"; readonly line: string };

/**
 * Computes one line-level LCS edit script. The bound keeps the Attempt's
 * post-run producer predictable; callers turn an over-bound text pair into
 * explicit endpoint elision rather than treating unchanged text as a hunk.
 */
function lineDiffOperations(
  left: readonly string[],
  right: readonly string[],
): readonly LineDiffOperationV1[] | undefined {
  if (!hunkCellsFit(left, right)) return undefined;
  const width = right.length + 1;
  const lengths = new Uint32Array((left.length + 1) * width);
  const at = (row: number, column: number): number => row * width + column;
  for (let row = 1; row <= left.length; row += 1) {
    const leftLine = left[row - 1]!;
    for (let column = 1; column <= right.length; column += 1) {
      if (leftLine === right[column - 1]) {
        lengths[at(row, column)] = lengths[at(row - 1, column - 1)]! + 1;
      } else {
        lengths[at(row, column)] = Math.max(
          lengths[at(row - 1, column)]!,
          lengths[at(row, column - 1)]!,
        );
      }
    }
  }

  const reversed: LineDiffOperationV1[] = [];
  let row = left.length;
  let column = right.length;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0 && left[row - 1] === right[column - 1]) {
      reversed.push(Object.freeze({ kind: "unchanged" as const }));
      row -= 1;
      column -= 1;
    } else if (
      row > 0
      && (column === 0 || lengths[at(row - 1, column)]! >= lengths[at(row, column - 1)]!)
    ) {
      reversed.push(Object.freeze({ kind: "removed" as const, line: left[row - 1]! }));
      row -= 1;
    } else {
      reversed.push(Object.freeze({ kind: "added" as const, line: right[column - 1]! }));
      column -= 1;
    }
  }
  reversed.reverse();
  return frozenArray(reversed);
}

function hunkStrings(
  operations: readonly LineDiffOperationV1[],
  kind: "added" | "removed",
): readonly string[] {
  const hunks: string[] = [];
  let lines: string[] = [];
  const flush = (): void => {
    if (lines.length > 0) hunks.push(lines.join(""));
    lines = [];
  };
  for (const operation of operations) {
    if (operation.kind === kind) {
      lines.push(operation.line);
    } else {
      flush();
    }
  }
  flush();
  return frozenArray(hunks);
}

/**
 * Produces directional, no-context hunks. A line belongs to a hunk only when
 * it is absent from the selected LCS; unchanged lines therefore never enter
 * `notInDiff()`'s searchable corpus.
 */
function changedHunks(
  before: string,
  after: string,
): AgentWorkspaceDiffHunksV1 | undefined {
  const left = linesForHunks(before);
  const right = linesForHunks(after);
  const operations = lineDiffOperations(left, right);
  if (operations === undefined) return undefined;
  return Object.freeze({
    added: hunkStrings(operations, "added"),
    removed: hunkStrings(operations, "removed"),
  });
}

function hunksFor(
  before: AgentWorkspaceDiffEndpointV1,
  after: AgentWorkspaceDiffEndpointV1,
): AgentWorkspaceDiffHunksV1 | undefined {
  if (before.state === "text" && after.state === "text") {
    return changedHunks(before.text, after.text);
  }
  if (before.state === "absent" && after.state === "text") {
    return Object.freeze({ added: frozenArray([after.text]), removed: frozenArray([]) });
  }
  if (before.state === "text" && after.state === "absent") {
    return Object.freeze({ added: frozenArray([]), removed: frozenArray([before.text]) });
  }
  return Object.freeze({ added: frozenArray([]), removed: frozenArray([]) });
}

function sameHunkStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Validates status-shaped endpoints and the no-context hunk corpus persisted by v1. */
export function agentWorkspaceDiffWindowChangeIsCoherentV1(
  change: AgentWorkspaceDiffWindowChangeV1,
): boolean {
  const beforePresent = change.before.state === "text" || change.before.state === "elided";
  const afterPresent = change.after.state === "text" || change.after.state === "elided";
  if (
    (change.status === "added" && (change.before.state !== "absent" || !afterPresent))
    || (change.status === "deleted" && (!beforePresent || change.after.state !== "absent"))
    || (change.status === "modified" && (!beforePresent || !afterPresent))
  ) {
    return false;
  }
  const expected = hunksFor(change.before, change.after);
  return expected !== undefined
    && sameHunkStrings(expected.added, change.hunks.added)
    && sameHunkStrings(expected.removed, change.hunks.removed);
}

function elidedEndpointForBoundedHunks(
  endpoint: AgentWorkspaceDiffEndpointV1,
): AgentWorkspaceDiffEndpointV1 {
  if (endpoint.state !== "text") return endpoint;
  return Object.freeze({
    state: "elided" as const,
    reason: "oversized-text" as const,
    bytes: new TextEncoder().encode(endpoint.text).byteLength,
  });
}

function stablePolicy(input: AgentWorkspaceDiffPolicyV1): AgentWorkspaceDiffPolicyV1 {
  return Object.freeze({
    defaultPolicy: input.defaultPolicy,
    include: frozenArray(input.include),
    ignore: frozenArray(input.ignore),
  });
}

/** Converts the one raw ledger export into the single frozen v1 semantic document. */
export function createAgentWorkspaceDiffDocumentV1(input: {
  readonly windows: DiffArtifact;
  readonly policy: AgentWorkspaceDiffPolicyV1;
}): AgentWorkspaceDiffDocumentV1 {
  const windows = input.windows.map((window) => {
    const changes = Object.entries(window.changes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, change]) => {
        assertCanonicalWorkspaceRelativePathV1(path, "workspace diff ledger path");
        let before = endpointFor(change, "before");
        let after = endpointFor(change, "after");
        let hunks = hunksFor(before, after);
        // A bounded producer must never retain a pseudo-hunk containing
        // unproven unchanged context. Preserve the known path/status delta,
        // but make content predicates explicitly unavailable instead.
        if (
          before.state === "text"
          && after.state === "text"
          && hunks === undefined
        ) {
          before = elidedEndpointForBoundedHunks(before);
          after = elidedEndpointForBoundedHunks(after);
          hunks = hunksFor(before, after);
        }
        return Object.freeze({
          path,
          status: change.status,
          before,
          after,
          hunks: hunks ?? Object.freeze({ added: frozenArray([]), removed: frozenArray([]) }),
        });
      });
    return Object.freeze({
      identity: parseAgentSendWindowIdentityV1(window.window),
      changes: frozenArray(changes),
    });
  });
  return Object.freeze({
    attribution: AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1,
    policy: stablePolicy(input.policy),
    windows: frozenArray(windows),
  });
}

/** Exact unordered endpoint-delta path set, retaining cross-send restoration. */
export function agentWorkspaceDiffPathsV1(document: AgentWorkspaceDiffDocumentV1): readonly string[] {
  return frozenArray(
    [...new Set(document.windows.flatMap((window) => window.changes.map((change) => change.path)))].sort(),
  );
}

export function agentWorkspaceDiffPathsMatchV1(
  document: AgentWorkspaceDiffDocumentV1,
  expected: readonly string[],
): boolean {
  validateExpectedTouchedPaths(expected);
  const actual = agentWorkspaceDiffPathsV1(document);
  if (actual.length !== expected.length) return false;
  const wanted = new Set(expected);
  return actual.every((path) => wanted.has(path));
}

export function agentWorkspaceDiffChangesForPathV1(
  document: AgentWorkspaceDiffDocumentV1,
  path: string,
): readonly AgentWorkspaceDiffWindowChangeV1[] {
  assertCanonicalWorkspaceRelativePathV1(path, "workspace diff path");
  return frozenArray(
    document.windows.flatMap((window) => window.changes.filter((change) => change.path === path)),
  );
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function selectedSides(options: WorkspaceDiffNotInOptionsV1 | undefined): readonly ("added" | "removed")[] {
  const content = options?.content ?? "both";
  return content === "both" ? ["added", "removed"] : [content];
}

/**
 * Searches only changed paths and directional changed hunks. A matching path
 * is enough to prove mismatch even when a requested text side was elided; a
 * clean search with an elided requested side is unavailable rather than pass.
 */
export function evaluateWorkspaceDiffNotInV1(
  document: AgentWorkspaceDiffDocumentV1,
  pattern: RegExp,
  options?: WorkspaceDiffNotInOptionsV1,
): WorkspaceDiffNotInOutcomeV1 {
  const sides = selectedSides(options);
  let elided = false;
  for (const window of document.windows) {
    for (const change of window.changes) {
      if (matchesPattern(pattern, change.path)) return Object.freeze({ state: "mismatched" as const });
      for (const side of sides) {
        const endpoint = side === "added" ? change.after : change.before;
        if (endpoint.state === "elided") elided = true;
        for (const hunk of change.hunks[side]) {
          if (matchesPattern(pattern, hunk)) return Object.freeze({ state: "mismatched" as const });
        }
      }
    }
  }
  return elided
    ? Object.freeze({ state: "unavailable" as const, reason: "content-elided" as const })
    : Object.freeze({ state: "matched" as const });
}

export type { DiffArtifact, DiffData, DiffWindow, WindowChange } from "./types.ts";
