import {
  assertCanonicalWorkspaceRelativePath,
  type DiffArtifact,
  type WindowChange,
} from "./diff.ts";

export interface AgentWorkspaceDiffPolicy {
  readonly defaultPolicy: "niceeval-default-excludes";
  readonly include: readonly string[];
  readonly ignore: readonly string[];
}

export interface AgentSendWindowIdentity {
  readonly session?: number;
  readonly turn: number;
}

/** Endpoint states distinguish a known absence from omitted textual evidence. */
export type AgentWorkspaceDiffEndpoint =
  | { readonly state: "absent" }
  | { readonly state: "text"; readonly text: string }
  | {
      readonly state: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly bytes?: number;
    };

/** A no-context directional changed-text corpus. */
export interface AgentWorkspaceDiffHunks {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface AgentWorkspaceDiffWindowChange {
  readonly path: string;
  readonly status: WindowChange["status"];
  readonly before: AgentWorkspaceDiffEndpoint;
  readonly after: AgentWorkspaceDiffEndpoint;
  readonly hunks: AgentWorkspaceDiffHunks;
}

export interface AgentWorkspaceDiffWindow {
  readonly identity: AgentSendWindowIdentity;
  readonly changes: readonly AgentWorkspaceDiffWindowChange[];
}

/**
 * The frozen runtime meaning shared by post-run Assertions and the durable
 * Record adapter. It intentionally carries no attachment schema identifier.
 */
export interface AgentWorkspaceDiff {
  readonly attribution: "agent-send-window-endpoints";
  readonly policy: AgentWorkspaceDiffPolicy;
  readonly windows: readonly AgentWorkspaceDiffWindow[];
}

/** The only post-run diff state visible to Assert-first adapters. */
export type PostRunWorkspaceDiffState =
  | { readonly state: "pending" }
  | { readonly state: "available"; readonly document: AgentWorkspaceDiff }
  | {
      readonly state: "unavailable";
      readonly reason: "producer-failed" | "producer-interrupted" | "sandbox-unavailable";
    };

export interface WorkspaceDiffNotInOptions {
  readonly content?: "added" | "removed" | "both";
}

export type WorkspaceDiffNotInOutcome =
  | { readonly state: "matched" }
  | { readonly state: "mismatched" }
  | { readonly state: "unavailable"; readonly reason: "content-elided" };

function frozenArray<Value>(items: readonly Value[]): readonly Value[] {
  return Object.freeze([...items]);
}

function parseAgentSendWindowIdentity(label: string): AgentSendWindowIdentity {
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
): AgentWorkspaceDiffEndpoint {
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

const MAX_HUNK_LCS_CELLS = 1_000_000;

function hunkCellsFit(left: readonly string[], right: readonly string[]): boolean {
  return left.length + 1 <= Math.floor(MAX_HUNK_LCS_CELLS / (right.length + 1));
}

type LineDiffOperation =
  | { readonly kind: "unchanged" }
  | { readonly kind: "added"; readonly line: string }
  | { readonly kind: "removed"; readonly line: string };

function lineDiffOperations(
  left: readonly string[],
  right: readonly string[],
): readonly LineDiffOperation[] | undefined {
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

  const reversed: LineDiffOperation[] = [];
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
  operations: readonly LineDiffOperation[],
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

function changedHunks(
  before: string,
  after: string,
): AgentWorkspaceDiffHunks | undefined {
  const operations = lineDiffOperations(linesForHunks(before), linesForHunks(after));
  if (operations === undefined) return undefined;
  return Object.freeze({
    added: hunkStrings(operations, "added"),
    removed: hunkStrings(operations, "removed"),
  });
}

function hunksFor(
  before: AgentWorkspaceDiffEndpoint,
  after: AgentWorkspaceDiffEndpoint,
): AgentWorkspaceDiffHunks | undefined {
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

export function agentWorkspaceDiffChangeIsCoherent(
  change: AgentWorkspaceDiffWindowChange,
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
  endpoint: AgentWorkspaceDiffEndpoint,
): AgentWorkspaceDiffEndpoint {
  if (endpoint.state !== "text") return endpoint;
  return Object.freeze({
    state: "elided" as const,
    reason: "oversized-text" as const,
    bytes: new TextEncoder().encode(endpoint.text).byteLength,
  });
}

function freezePolicy(policy: AgentWorkspaceDiffPolicy): AgentWorkspaceDiffPolicy {
  return Object.freeze({
    defaultPolicy: policy.defaultPolicy,
    include: frozenArray(policy.include),
    ignore: frozenArray(policy.ignore),
  });
}

/** Freezes one ledger export into the runtime value shared by all consumers. */
export function createAgentWorkspaceDiff(input: {
  readonly windows: DiffArtifact;
  readonly policy: AgentWorkspaceDiffPolicy;
}): AgentWorkspaceDiff {
  const windows = input.windows.map((window) => {
    const changes = Object.entries(window.changes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, change]) => {
        assertCanonicalWorkspaceRelativePath(path, "workspace diff ledger path");
        let before = endpointFor(change, "before");
        let after = endpointFor(change, "after");
        let hunks = hunksFor(before, after);
        if (before.state === "text" && after.state === "text" && hunks === undefined) {
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
      identity: parseAgentSendWindowIdentity(window.window),
      changes: frozenArray(changes),
    });
  });
  return Object.freeze({
    attribution: "agent-send-window-endpoints" as const,
    policy: freezePolicy(input.policy),
    windows: frozenArray(windows),
  });
}

export function agentWorkspaceDiffPaths(
  document: AgentWorkspaceDiff,
): readonly string[] {
  return frozenArray(
    [...new Set(document.windows.flatMap((window) => window.changes.map((change) => change.path)))].sort(),
  );
}

export function agentWorkspaceDiffPathsMatch(
  document: AgentWorkspaceDiff,
  expected: readonly string[],
): boolean {
  const actual = agentWorkspaceDiffPaths(document);
  if (actual.length !== expected.length) return false;
  const wanted = new Set(expected);
  return actual.every((path) => wanted.has(path));
}

export function agentWorkspaceDiffChangesForPath(
  document: AgentWorkspaceDiff,
  path: string,
): readonly AgentWorkspaceDiffWindowChange[] {
  assertCanonicalWorkspaceRelativePath(path, "workspace diff path");
  return frozenArray(
    document.windows.flatMap((window) => window.changes.filter((change) => change.path === path)),
  );
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function selectedSides(
  options: WorkspaceDiffNotInOptions | undefined,
): readonly ("added" | "removed")[] {
  const content = options?.content ?? "both";
  return content === "both" ? ["added", "removed"] : [content];
}

export function evaluateWorkspaceDiffNotIn(
  document: AgentWorkspaceDiff,
  pattern: RegExp,
  options?: WorkspaceDiffNotInOptions,
): WorkspaceDiffNotInOutcome {
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
