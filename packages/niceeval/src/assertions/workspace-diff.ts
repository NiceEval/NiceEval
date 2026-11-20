import { assertCanonicalWorkspaceRelativePath, type DiffArtifact, type WindowChange } from "./diff.ts";

/** Records default exclusions and explicit include and ignore patterns for a workspace diff; excluded paths are outside the captured evidence. */
export interface AgentWorkspaceDiffPolicy {
  readonly defaultPolicy: string;
  readonly include: readonly string[];
  readonly ignore: readonly string[];
}

/** Identifies one physical send window by turn and optional session; it is not a cross-Attempt identity. */
export interface AgentSendWindowIdentity {
  readonly session: number | undefined;
  readonly turn: number;
}

/** Endpoint states distinguish a known absence from omitted textual evidence. */
export type AgentWorkspaceDiffEndpoint =
  | { readonly state: "absent" }
  | { readonly state: "text"; readonly text: string }
  | {
      readonly state: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly bytes: number | undefined;
    };

/** A no-context directional changed-text corpus. */
export interface AgentWorkspaceDiffHunks {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** Describes one path's before and after states and available hunks within a send window; unavailable hunks are not an empty diff. */
export interface AgentWorkspaceDiffWindowChange {
  readonly path: string;
  readonly status: WindowChange["status"];
  readonly before: AgentWorkspaceDiffEndpoint;
  readonly after: AgentWorkspaceDiffEndpoint;
  readonly hunks: AgentWorkspaceDiffHunks;
}

/** Groups frozen workspace changes for one physical send window; it must not be replaced by the current live workspace. */
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
      readonly reason: "producer-failed" | "producer-interrupted" | "sandbox-unavailable" | "send-window-missing";
    };

export interface WorkspaceDiffNotInOptions {
  /** Select changed content sides, or none to compare only paths regardless of content elision. */
  readonly content?: "added" | "removed" | "both" | "none" | undefined;
}

export type WorkspaceDiffNotInOutcome =
  | { readonly state: "matched" }
  | { readonly state: "mismatched" }
  | { readonly state: "unavailable"; readonly reason: "content-elided" };

/** Durable ordering is ASCII code-unit ordering; locale collation is never evidence ordering. */
function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalPolicyEntries(entries: readonly string[]): readonly string[] {
  return [...new Set(entries)].sort(compareAscii);
}

function parseAgentSendWindowIdentity(label: string): AgentSendWindowIdentity {
  const primary = /^turn([1-9][0-9]*)$/.exec(label);
  if (primary !== null) {
    return {
      turn: Number(primary[1]),
      session: undefined,
    };
  }
  const session = /^session([1-9][0-9]*)\/turn([1-9][0-9]*)$/.exec(label);
  if (session !== null) {
    return { session: Number(session[1]), turn: Number(session[2]) };
  }
  throw new Error(`Workspace diff received an invalid agent send window label ${JSON.stringify(label)}`);
}

const turnSendWindows = new WeakMap<object, string>();

/** @internal SessionManager records which send window produced a returned Turn. */
export function bindSendWindowToTurn(turn: object, windowId: string): void {
  turnSendWindows.set(turn, windowId);
}

/** The send window id (`turn2`, `session2/turn1`) of a Turn returned by a send; undefined for unbound objects. */
export function sendWindowForTurn(turn: object): string | undefined {
  return turnSendWindows.get(turn);
}

/** The durable window id preserves the send identity independently of its attachment sequence. */
export function agentSendWindowId(identity: AgentSendWindowIdentity): string {
  return identity.session === undefined ? `turn${identity.turn}` : `session${identity.session}/turn${identity.turn}`;
}

function endpointFor(change: WindowChange, side: "before" | "after"): AgentWorkspaceDiffEndpoint {
  if ((side === "before" && change.status === "added") || (side === "after" && change.status === "deleted")) {
    return { state: "absent" as const };
  }
  if (change.elided !== undefined) {
    const bytes = side === "before" ? change.elided.beforeBytes : change.elided.afterBytes;
    return {
      state: "elided" as const,
      reason: change.elided.reason,
      bytes,
    };
  }
  const text = side === "before" ? change.before : change.after;
  if (text === undefined) {
    throw new Error(`Workspace diff ${side} endpoint is missing for ${change.status} change`);
  }
  return { state: "text" as const, text };
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
        lengths[at(row, column)] = Math.max(lengths[at(row - 1, column)]!, lengths[at(row, column - 1)]!);
      }
    }
  }

  const reversed: LineDiffOperation[] = [];
  let row = left.length;
  let column = right.length;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0 && left[row - 1] === right[column - 1]) {
      reversed.push({ kind: "unchanged" as const });
      row -= 1;
      column -= 1;
    } else if (row > 0 && (column === 0 || lengths[at(row - 1, column)]! >= lengths[at(row, column - 1)]!)) {
      reversed.push({ kind: "removed" as const, line: left[row - 1]! });
      row -= 1;
    } else {
      reversed.push({ kind: "added" as const, line: right[column - 1]! });
      column -= 1;
    }
  }
  reversed.reverse();
  return reversed;
}

function hunkStrings(operations: readonly LineDiffOperation[], kind: "added" | "removed"): readonly string[] {
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
  return hunks;
}

function changedHunks(before: string, after: string): AgentWorkspaceDiffHunks | undefined {
  const operations = lineDiffOperations(linesForHunks(before), linesForHunks(after));
  if (operations === undefined) return undefined;
  return {
    added: hunkStrings(operations, "added"),
    removed: hunkStrings(operations, "removed"),
  };
}

function hunksFor(
  before: AgentWorkspaceDiffEndpoint,
  after: AgentWorkspaceDiffEndpoint,
): AgentWorkspaceDiffHunks | undefined {
  if (before.state === "text" && after.state === "text") {
    return changedHunks(before.text, after.text);
  }
  if (before.state === "absent" && after.state === "text") {
    return { added: [after.text], removed: [] };
  }
  if (before.state === "text" && after.state === "absent") {
    return { added: [], removed: [before.text] };
  }
  return { added: [], removed: [] };
}

function sameHunkStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function agentWorkspaceDiffChangeIsCoherent(change: AgentWorkspaceDiffWindowChange): boolean {
  const beforePresent = change.before.state === "text" || change.before.state === "elided";
  const afterPresent = change.after.state === "text" || change.after.state === "elided";
  if (
    (change.status === "added" && (change.before.state !== "absent" || !afterPresent)) ||
    (change.status === "deleted" && (!beforePresent || change.after.state !== "absent")) ||
    (change.status === "modified" && (!beforePresent || !afterPresent))
  ) {
    return false;
  }
  const expected = hunksFor(change.before, change.after);
  return (
    expected !== undefined &&
    sameHunkStrings(expected.added, change.hunks.added) &&
    sameHunkStrings(expected.removed, change.hunks.removed)
  );
}

function elidedEndpointForBoundedHunks(endpoint: AgentWorkspaceDiffEndpoint): AgentWorkspaceDiffEndpoint {
  if (endpoint.state !== "text") return endpoint;
  return {
    state: "elided" as const,
    reason: "oversized-text" as const,
    bytes: new TextEncoder().encode(endpoint.text).byteLength,
  };
}

function canonicalPolicy(policy: AgentWorkspaceDiffPolicy): AgentWorkspaceDiffPolicy {
  return {
    defaultPolicy: policy.defaultPolicy,
    include: canonicalPolicyEntries(policy.include),
    ignore: canonicalPolicyEntries(policy.ignore),
  };
}

/** Freezes one ledger export into the runtime value shared by all consumers. */
export function createAgentWorkspaceDiff(input: {
  readonly windows: DiffArtifact;
  readonly policy: AgentWorkspaceDiffPolicy;
}): AgentWorkspaceDiff {
  const windows = input.windows.map((window) => {
    const changes = Object.entries(window.changes)
      .sort(([left], [right]) => compareAscii(left, right))
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
        return {
          path,
          status: change.status,
          before,
          after,
          hunks: hunks ?? { added: [], removed: [] },
        };
      });
    return {
      identity: parseAgentSendWindowIdentity(window.window),
      changes,
    };
  });
  return {
    attribution: "agent-send-window-endpoints" as const,
    policy: canonicalPolicy(input.policy),
    windows,
  };
}

export function agentWorkspaceDiffPaths(document: AgentWorkspaceDiff): readonly string[] {
  return [...new Set(document.windows.flatMap((window) => window.changes.map((change) => change.path)))].sort(
    compareAscii,
  );
}

export function agentWorkspaceDiffPathsMatch(document: AgentWorkspaceDiff, expected: readonly string[]): boolean {
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
  return document.windows.flatMap((window) => window.changes.filter((change) => change.path === path));
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function selectedSides(options: WorkspaceDiffNotInOptions | undefined): readonly ("added" | "removed")[] {
  const content = options?.content ?? "both";
  if (content === "none") return [];
  if (content === "both") return ["added", "removed"];
  return [content];
}

type DiffSearchOutcome =
  | { readonly state: "matched"; readonly path: string; readonly preview: string }
  | { readonly state: "mismatched" }
  | { readonly state: "unavailable"; readonly reason: "content-elided" };

/** Search only changed paths and selected changed hunks, retaining the first witness. */
export function evaluateWorkspaceDiffIn(
  document: AgentWorkspaceDiff,
  pattern: RegExp,
  options?: WorkspaceDiffNotInOptions,
): DiffSearchOutcome {
  const sides = selectedSides(options);
  let elided = false;
  const witness = (path: string, text: string): DiffSearchOutcome | undefined => {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match === null) return undefined;
    // Keep the decisive match in the preview even when it occurs late in a hunk.
    const start = Math.max(0, match.index - 128);
    return {
      state: "matched",
      path,
      preview: Array.from(text.slice(start, start + 2048))
        .slice(0, 1024)
        .join(""),
    };
  };
  for (const window of document.windows) {
    for (const change of window.changes) {
      const pathWitness = witness(change.path, change.path);
      if (pathWitness !== undefined) return pathWitness;
      for (const side of sides) {
        const endpoint = side === "added" ? change.after : change.before;
        if (endpoint.state === "elided") elided = true;
        for (const hunk of change.hunks[side]) {
          const hunkWitness = witness(change.path, hunk);
          if (hunkWitness !== undefined) return hunkWitness;
        }
      }
    }
  }
  return elided ? { state: "unavailable", reason: "content-elided" } : { state: "mismatched" };
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
      if (matchesPattern(pattern, change.path)) return { state: "mismatched" as const };
      for (const side of sides) {
        const endpoint = side === "added" ? change.after : change.before;
        if (endpoint.state === "elided") elided = true;
        for (const hunk of change.hunks[side]) {
          if (matchesPattern(pattern, hunk)) return { state: "mismatched" as const };
        }
      }
    }
  }
  return elided ? { state: "unavailable" as const, reason: "content-elided" as const } : { state: "matched" as const };
}
