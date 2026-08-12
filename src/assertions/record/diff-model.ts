import {
  type AgentSendWindowIdentity,
  type AgentWorkspaceDiff,
  type AgentWorkspaceDiffEndpoint,
  type AgentWorkspaceDiffHunks,
  type AgentWorkspaceDiffPolicy,
  type AgentWorkspaceDiffWindow,
  type AgentWorkspaceDiffWindowChange,
} from "../workspace-diff.ts";

export const AGENT_WORKSPACE_DIFF_SCHEMA_ID_V1 = "niceeval.diff/v1" as const;
export const AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1 =
  "agent-send-window-endpoints/v1" as const;

export interface AgentWorkspaceDiffPolicyV1 {
  readonly defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1";
  readonly include: readonly string[];
  readonly ignore: readonly string[];
}

export interface AgentSendWindowIdentityV1 {
  readonly session?: number;
  readonly turn: number;
}

export type AgentWorkspaceDiffEndpointV1 =
  | { readonly state: "absent" }
  | { readonly state: "text"; readonly text: string }
  | {
      readonly state: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly bytes?: number;
    };

export interface AgentWorkspaceDiffHunksV1 {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface AgentWorkspaceDiffWindowChangeV1 {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  readonly before: AgentWorkspaceDiffEndpointV1;
  readonly after: AgentWorkspaceDiffEndpointV1;
  readonly hunks: AgentWorkspaceDiffHunksV1;
}

export interface AgentWorkspaceDiffWindowV1 {
  readonly identity: AgentSendWindowIdentityV1;
  readonly changes: readonly AgentWorkspaceDiffWindowChangeV1[];
}

/** The exact semantic payload persisted by the Attempt-owned diff Attachment. */
export interface AgentWorkspaceDiffDocumentV1 {
  readonly attribution: typeof AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1;
  readonly policy: AgentWorkspaceDiffPolicyV1;
  readonly windows: readonly AgentWorkspaceDiffWindowV1[];
}

function encodeEndpoint(
  endpoint: AgentWorkspaceDiffEndpoint,
): AgentWorkspaceDiffEndpointV1 {
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
  endpoint: AgentWorkspaceDiffEndpointV1,
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
): AgentSendWindowIdentityV1 {
  return Object.freeze({
    ...(identity.session === undefined ? {} : { session: identity.session }),
    turn: identity.turn,
  });
}

function decodeIdentity(
  identity: AgentSendWindowIdentityV1,
): AgentSendWindowIdentity {
  return Object.freeze({
    ...(identity.session === undefined ? {} : { session: identity.session }),
    turn: identity.turn,
  });
}

function encodeHunks(hunks: AgentWorkspaceDiffHunks): AgentWorkspaceDiffHunksV1 {
  return Object.freeze({
    added: Object.freeze([...hunks.added]),
    removed: Object.freeze([...hunks.removed]),
  });
}

function decodeHunks(hunks: AgentWorkspaceDiffHunksV1): AgentWorkspaceDiffHunks {
  return Object.freeze({
    added: Object.freeze([...hunks.added]),
    removed: Object.freeze([...hunks.removed]),
  });
}

function encodeChange(
  change: AgentWorkspaceDiffWindowChange,
): AgentWorkspaceDiffWindowChangeV1 {
  return Object.freeze({
    path: change.path,
    status: change.status,
    before: encodeEndpoint(change.before),
    after: encodeEndpoint(change.after),
    hunks: encodeHunks(change.hunks),
  });
}

function decodeChange(
  change: AgentWorkspaceDiffWindowChangeV1,
): AgentWorkspaceDiffWindowChange {
  return Object.freeze({
    path: change.path,
    status: change.status,
    before: decodeEndpoint(change.before),
    after: decodeEndpoint(change.after),
    hunks: decodeHunks(change.hunks),
  });
}

function encodeWindow(window: AgentWorkspaceDiffWindow): AgentWorkspaceDiffWindowV1 {
  return Object.freeze({
    identity: encodeIdentity(window.identity),
    changes: Object.freeze(window.changes.map(encodeChange)),
  });
}

function decodeWindow(window: AgentWorkspaceDiffWindowV1): AgentWorkspaceDiffWindow {
  return Object.freeze({
    identity: decodeIdentity(window.identity),
    changes: Object.freeze(window.changes.map(decodeChange)),
  });
}

function encodePolicy(policy: AgentWorkspaceDiffPolicy): AgentWorkspaceDiffPolicyV1 {
  return Object.freeze({
    defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1" as const,
    include: Object.freeze([...policy.include]),
    ignore: Object.freeze([...policy.ignore]),
  });
}

function decodePolicy(policy: AgentWorkspaceDiffPolicyV1): AgentWorkspaceDiffPolicy {
  return Object.freeze({
    defaultPolicy: "niceeval-default-excludes" as const,
    include: Object.freeze([...policy.include]),
    ignore: Object.freeze([...policy.ignore]),
  });
}

/** The private producer adapter adds only durable schema identities. */
export function encodeAgentWorkspaceDiffDocumentV1(
  value: AgentWorkspaceDiff,
): AgentWorkspaceDiffDocumentV1 {
  return Object.freeze({
    attribution: AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1,
    policy: encodePolicy(value.policy),
    windows: Object.freeze(value.windows.map(encodeWindow)),
  });
}

/** The reader adapter returns a fresh schema-independent runtime value. */
export function decodeAgentWorkspaceDiffDocumentV1(
  value: AgentWorkspaceDiffDocumentV1,
): AgentWorkspaceDiff {
  return Object.freeze({
    attribution: "agent-send-window-endpoints" as const,
    policy: decodePolicy(value.policy),
    windows: Object.freeze(value.windows.map(decodeWindow)),
  });
}
