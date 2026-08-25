import { Effect, Either, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  AgentTurnsAttachmentSchema,
  AgentTurnsRevision2AttachmentSchema,
  validateAgentTurnsAttachment,
  validateAgentTurnsRevision2Attachment,
  type AgentTurnsRevision2Attachment,
} from "../schema.ts";

function invalid(path: readonly string[] = []): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function parseAgentTurnsRevision2(
  document: RecordMigrationDocument,
): Either.Either<AgentTurnsRevision2Attachment, RecordAttachmentIssue> {
  if (document.contents.length !== 0 || document.references.length !== 0) {
    return Either.left(invalid());
  }
  const decoded = Schema.decodeUnknownEither(
    AgentTurnsRevision2AttachmentSchema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(decoded)) return Either.left(invalid());
  const [issue] = validateAgentTurnsRevision2Attachment(decoded.right);
  return issue === undefined ? Either.right(decoded.right) : Either.left(issue);
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
    const decoded = Schema.validateEither(
      AgentTurnsAttachmentSchema,
      RecordExactParseOptions,
    )(value);
    if (Either.isLeft(decoded)) return yield* Effect.fail(invalid());
    const [issue] = validateAgentTurnsAttachment(decoded.right);
    if (issue !== undefined) return yield* Effect.fail(issue);
    return Object.freeze({
      value: decoded.right,
      references: Object.freeze([]),
      impact: Object.freeze([]),
    });
  }),
});
