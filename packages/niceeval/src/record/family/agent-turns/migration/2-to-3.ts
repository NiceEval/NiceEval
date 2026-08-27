import { Effect, Result, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  AgentTurnsRevision2AttachmentSchema,
  AgentTurnsRevision3AttachmentSchema,
  validateAgentTurnsRevision2Attachment,
  validateAgentTurnsRevision3Attachment,
  type AgentTurnsRevision2Attachment,
} from "../schema.ts";

function invalid(path: readonly string[] = []): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function parseAgentTurnsRevision2(
  document: RecordMigrationDocument,
): Result.Result<AgentTurnsRevision2Attachment, RecordAttachmentIssue> {
  if (document.contents.length !== 0 || document.references.length !== 0) {
    return Result.fail(invalid());
  }
  const decoded = Schema.decodeUnknownResult(
    AgentTurnsRevision2AttachmentSchema,
    RecordExactParseOptions,
  )(document.value);
  if (Result.isFailure(decoded)) return Result.fail(invalid());
  const [issue] = validateAgentTurnsRevision2Attachment(decoded.success);
  return issue === undefined ? Result.succeed(decoded.success) : Result.fail(issue);
}

function migrateCollection(collection: AgentTurnsRevision2Attachment["collection"]) {
  const limitation = Object.freeze({
    code: "unsupported-input" as const,
    target: "turn-item" as const,
    omittedAtLeast: 1,
  });
  const limitations = collection.limitations.some((candidate) =>
    candidate.code === limitation.code && candidate.target === limitation.target
  )
    ? collection.limitations
    : Object.freeze([...collection.limitations, limitation].sort((left, right) => {
        const leftKey = JSON.stringify(left);
        const rightKey = JSON.stringify(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }));
  return Object.freeze({
    state: "partial" as const,
    limitations,
  });
}

export const agentTurnsV2ToV3 = defineRecordMigration({
  from: 2,
  to: 3,
  parse: parseAgentTurnsRevision2,
  migrate: ({ value: previous }) => Effect.gen(function* () {
    const value = Object.freeze({
      state: "legacy" as const,
      collection: migrateCollection(previous.collection),
      segments: previous.segments,
    });
    const decoded = Schema.decodeUnknownResult(
      Schema.toType(AgentTurnsRevision3AttachmentSchema),
      RecordExactParseOptions,
    )(value);
    if (Result.isFailure(decoded)) return yield* Effect.fail(invalid());
    const [issue] = validateAgentTurnsRevision3Attachment(decoded.success);
    if (issue !== undefined) return yield* Effect.fail(issue);
    return Object.freeze({
      value: decoded.success,
      references: Object.freeze([]),
      impact: Object.freeze([]),
    });
  }),
});
