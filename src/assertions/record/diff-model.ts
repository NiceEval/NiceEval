import {
  type AgentWorkspaceDiff,
  type AgentWorkspaceDiffPolicy as RuntimeAgentWorkspaceDiffPolicy,
} from "../workspace-diff.ts";

export const AGENT_WORKSPACE_DIFF_ATTRIBUTION =
  "agent-send-window-endpoints/v1" as const;

export interface AgentWorkspaceDiffPolicy {
  readonly defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1";
  readonly include: readonly string[];
  readonly ignore: readonly string[];
}

export interface AgentSendWindowIdentity {
  readonly session?: number;
  readonly turn: number;
}

export type AgentWorkspaceDiffEndpoint =
  | { readonly state: "absent" }
  | { readonly state: "text"; readonly text: string }
  | {
      readonly state: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly bytes?: number;
    };

export interface AgentWorkspaceDiffHunks {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface AgentWorkspaceDiffWindowChange {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  readonly before: AgentWorkspaceDiffEndpoint;
  readonly after: AgentWorkspaceDiffEndpoint;
  readonly hunks: AgentWorkspaceDiffHunks;
}

export interface AgentWorkspaceDiffWindow {
  readonly identity: AgentSendWindowIdentity;
  readonly changes: readonly AgentWorkspaceDiffWindowChange[];
}

/** The exact semantic payload persisted by the Attempt-owned diff Attachment. */
export interface AgentWorkspaceDiffDocument {
  readonly attribution: typeof AGENT_WORKSPACE_DIFF_ATTRIBUTION;
  readonly policy: AgentWorkspaceDiffPolicy;
  readonly windows: readonly AgentWorkspaceDiffWindow[];
}

function encodeEndpoint(
  endpoint: AgentWorkspaceDiffEndpoint,
): AgentWorkspaceDiffEndpoint {
  switch (endpoint.state) {
    case "absent":
      return Object.freeze({ state: "absent" as const });
    case "text":
      return Object.freeze({ state: "text" as const, text: endpoint.text });
    case "elided":
      return Object.freeze({
        state: "elided" as const,
        reason: endpoint.reason,
        ...(endpoint.bytes === undefined ? {} : { bytes: endpoint.bytes }),
      });
  }
}

function decodeEndpoint(
  endpoint: AgentWorkspaceDiffEndpoint,
): AgentWorkspaceDiffEndpoint {
  switch (endpoint.state) {
    case "absent":
      return Object.freeze({ state: "absent" as const });
    case "text":
      return Object.freeze({ state: "text" as const, text: endpoint.text });
    case "elided":
      return Object.freeze({
        state: "elided" as const,
        reason: endpoint.reason,
        ...(endpoint.bytes === undefined ? {} : { bytes: endpoint.bytes }),
      });
  }
}

function encodeIdentity(
  identity: AgentSendWindowIdentity,
): AgentSendWindowIdentity {
  return Object.freeze({
    ...(identity.session === undefined ? {} : { session: identity.session }),
    turn: identity.turn,
  });
}

function decodeIdentity(
  identity: AgentSendWindowIdentity,
): AgentSendWindowIdentity {
  return Object.freeze({
    ...(identity.session === undefined ? {} : { session: identity.session }),
    turn: identity.turn,
  });
}

function encodeHunks(hunks: AgentWorkspaceDiffHunks): AgentWorkspaceDiffHunks {
  return Object.freeze({
    added: Object.freeze([...hunks.added]),
    removed: Object.freeze([...hunks.removed]),
  });
}

function decodeHunks(hunks: AgentWorkspaceDiffHunks): AgentWorkspaceDiffHunks {
  return Object.freeze({
    added: Object.freeze([...hunks.added]),
    removed: Object.freeze([...hunks.removed]),
  });
}

function encodeChange(
  change: AgentWorkspaceDiffWindowChange,
): AgentWorkspaceDiffWindowChange {
  return Object.freeze({
    path: change.path,
    status: change.status,
    before: encodeEndpoint(change.before),
    after: encodeEndpoint(change.after),
    hunks: encodeHunks(change.hunks),
  });
}

function decodeChange(
  change: AgentWorkspaceDiffWindowChange,
): AgentWorkspaceDiffWindowChange {
  return Object.freeze({
    path: change.path,
    status: change.status,
    before: decodeEndpoint(change.before),
    after: decodeEndpoint(change.after),
    hunks: decodeHunks(change.hunks),
  });
}

function encodeWindow(window: AgentWorkspaceDiffWindow): AgentWorkspaceDiffWindow {
  return Object.freeze({
    identity: encodeIdentity(window.identity),
    changes: Object.freeze(window.changes.map(encodeChange)),
  });
}

function decodeWindow(window: AgentWorkspaceDiffWindow): AgentWorkspaceDiffWindow {
  return Object.freeze({
    identity: decodeIdentity(window.identity),
    changes: Object.freeze(window.changes.map(decodeChange)),
  });
}

function encodePolicy(policy: RuntimeAgentWorkspaceDiffPolicy): AgentWorkspaceDiffPolicy {
  return Object.freeze({
    defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1" as const,
    include: Object.freeze([...policy.include]),
    ignore: Object.freeze([...policy.ignore]),
  });
}

function decodePolicy(policy: AgentWorkspaceDiffPolicy): RuntimeAgentWorkspaceDiffPolicy {
  return Object.freeze({
    defaultPolicy: "niceeval-default-excludes" as const,
    include: Object.freeze([...policy.include]),
    ignore: Object.freeze([...policy.ignore]),
  });
}

/** The private producer adapter adds only durable schema identities. */
export function encodeAgentWorkspaceDiffDocument(
  value: AgentWorkspaceDiff,
): AgentWorkspaceDiffDocument {
  return Object.freeze({
    attribution: AGENT_WORKSPACE_DIFF_ATTRIBUTION,
    policy: encodePolicy(value.policy),
    windows: Object.freeze(value.windows.map(encodeWindow)),
  });
}

/** The reader adapter returns a fresh schema-independent runtime value. */
export function decodeAgentWorkspaceDiffDocument(
  value: AgentWorkspaceDiffDocument,
): AgentWorkspaceDiff {
  return Object.freeze({
    attribution: "agent-send-window-endpoints" as const,
    policy: decodePolicy(value.policy),
    windows: Object.freeze(value.windows.map(decodeWindow)),
  });
}
