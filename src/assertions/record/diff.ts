import { Either, Schema } from "effect";

import {
  AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1,
  agentWorkspaceDiffWindowChangeIsCoherentV1,
  type AgentWorkspaceDiffDocumentV1,
  type AgentWorkspaceDiffEndpointV1,
  type AgentWorkspaceDiffHunksV1,
  type AgentWorkspaceDiffPolicyV1,
  type AgentWorkspaceDiffWindowChangeV1,
  type AgentWorkspaceDiffWindowV1,
} from "../diff.ts";
import {
  defineRecordAttachmentFamily,
  makeRecordAttachmentWrite,
  validateRecordAttachmentWrite,
  type RecordAttachmentFamily,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import { defineRecordAttachmentProjector, type RecordAttachmentProjector } from "../../projection/index.ts";

export const AGENT_WORKSPACE_DIFF_ATTACHMENT_NAME_V1 = "niceeval.diff" as const;

const PositiveIntegerV1Schema = Schema.Number.pipe(Schema.int(), Schema.positive());

const DiffEndpointV1Schema: Schema.Schema<AgentWorkspaceDiffEndpointV1> = Schema.Union(
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({ state: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    state: Schema.Literal("elided"),
    reason: Schema.Literal("binary", "oversized-text"),
    bytes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  }),
);

const DiffHunksV1Schema: Schema.Schema<AgentWorkspaceDiffHunksV1> = Schema.Struct({
  added: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
});

const DiffWindowChangeV1Schema: Schema.Schema<AgentWorkspaceDiffWindowChangeV1> = Schema.Struct({
  path: Schema.String.pipe(
    Schema.filter((value) => value.length > 0 && !value.includes("\u0000"), {
      identifier: "AgentWorkspaceDiffPath",
      description: "a non-empty workspace-relative path without NUL",
    }),
  ),
  status: Schema.Literal("added", "modified", "deleted"),
  before: DiffEndpointV1Schema,
  after: DiffEndpointV1Schema,
  hunks: DiffHunksV1Schema,
});

const DiffWindowV1Schema: Schema.Schema<AgentWorkspaceDiffWindowV1> = Schema.Struct({
  identity: Schema.Struct({
    session: Schema.optional(PositiveIntegerV1Schema),
    turn: PositiveIntegerV1Schema,
  }),
  changes: Schema.Array(DiffWindowChangeV1Schema),
});

const DiffPolicyV1Schema: Schema.Schema<AgentWorkspaceDiffPolicyV1> = Schema.Struct({
  defaultPolicy: Schema.Literal("niceeval.sandbox-ledger/default-excludes/v1"),
  include: Schema.Array(Schema.String),
  ignore: Schema.Array(Schema.String),
});

function documentHasUniqueWindowsAndPaths(document: AgentWorkspaceDiffDocumentV1): boolean {
  const windows = new Set<string>();
  for (const window of document.windows) {
    const key = `${window.identity.session ?? "primary"}\u0000${window.identity.turn}`;
    if (windows.has(key)) return false;
    windows.add(key);
    const paths = new Set<string>();
    for (const change of window.changes) {
      if (!agentWorkspaceDiffWindowChangeIsCoherentV1(change) || paths.has(change.path)) return false;
      paths.add(change.path);
    }
  }
  return true;
}

export const AgentWorkspaceDiffDocumentV1Schema: Schema.Schema<AgentWorkspaceDiffDocumentV1> =
  Schema.Struct({
    attribution: Schema.Literal(AGENT_WORKSPACE_DIFF_ATTRIBUTION_V1),
    policy: DiffPolicyV1Schema,
    windows: Schema.Array(DiffWindowV1Schema),
  }).pipe(
    Schema.filter(documentHasUniqueWindowsAndPaths, {
      identifier: "AgentWorkspaceDiffDocument",
      description: "unique agent send windows with one valid endpoint delta per path",
    }),
  );

function requireDefinition<Result, Failure>(
  result: Either.Either<Result, Failure>,
  message: string,
): Result {
  if (Either.isLeft(result)) throw new Error(message);
  return result.right;
}

/** Attempt-owned, exact, agent-attributed send-window endpoint document. */
export const agentWorkspaceDiffAttachmentDefinitionV1 = requireDefinition(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: AGENT_WORKSPACE_DIFF_ATTACHMENT_NAME_V1,
    schemaId: "niceeval.diff/v1",
    schema: AgentWorkspaceDiffDocumentV1Schema,
    blobRefs: () => Object.freeze([]),
  }),
  "Agent workspace diff v1 RecordAttachment definition must be valid",
);

/** v1 has no invented future migration edge; adjacent edges appear only with a real next schema. */
export const agentWorkspaceDiffAttachmentFamilyV1 = requireDefinition(
  defineRecordAttachmentFamily({
    current: agentWorkspaceDiffAttachmentDefinitionV1,
    migrations: [],
  }),
  "Agent workspace diff v1 RecordAttachment family must be valid",
);

const noDiffBlobDraftsV1: readonly [] = Object.freeze([]);

/**
 * Captures the exact frozen semantic object held by post-run evaluators. The
 * no-blob v1 representation is intentionally small enough for normal ledger
 * exports; a future adjacent schema may move endpoint text into this owner's
 * own blobs without changing Assertions' reference shape.
 */
export function createAgentWorkspaceDiffAttachmentWriteV1(
  document: AgentWorkspaceDiffDocumentV1,
): RecordAttachmentWrite<"attempt", never, never> {
  const write = makeRecordAttachmentWrite(
    agentWorkspaceDiffAttachmentFamilyV1,
    () => Object.freeze({ payload: document, blobs: noDiffBlobDraftsV1 }),
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("Agent workspace diff v1 RecordAttachment write was invalid");
  }
  return write;
}

/** A neutral typed projector available to scripts and any Report, with no privileged consumer. */
export const agentWorkspaceDiffProjectorV1: RecordAttachmentProjector<
  "attempt",
  AgentWorkspaceDiffDocumentV1
> = defineRecordAttachmentProjector({
  attachment: agentWorkspaceDiffAttachmentFamilyV1 as RecordAttachmentFamily<
    "attempt",
    AgentWorkspaceDiffDocumentV1
  >,
  project: (value: RecordAttachmentValue<AgentWorkspaceDiffDocumentV1>) => value.payload,
});
