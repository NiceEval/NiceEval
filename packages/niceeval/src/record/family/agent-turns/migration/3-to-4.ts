import { Effect, Result, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  AgentTurnsAttachmentSchema,
  AgentTurnsRevision3AttachmentSchema,
  validateAgentTurnsAttachment,
  validateAgentTurnsRevision3Attachment,
  type AgentTurnsRevision3Attachment,
} from "../schema.ts";

const MISSING_REASON = "Evidence coverage reason was not retained by agent-turns revision 3.";

function invalid(path: readonly string[] = []): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function parseAgentTurnsRevision3(
  document: RecordMigrationDocument,
): Result.Result<AgentTurnsRevision3Attachment, RecordAttachmentIssue> {
  if (document.contents.length !== 0 || document.references.length !== 0) {
    return Result.fail(invalid());
  }
  const decoded = Schema.decodeUnknownResult(
    AgentTurnsRevision3AttachmentSchema,
    RecordExactParseOptions,
  )(document.value);
  if (Result.isFailure(decoded)) return Result.fail(invalid());
  const [issue] = validateAgentTurnsRevision3Attachment(decoded.success);
  return issue === undefined ? Result.succeed(decoded.success) : Result.fail(issue);
}

function migrateCoverageEntry(status: "complete" | "partial" | "unavailable") {
  return status === "complete"
    ? Object.freeze({ status })
    : Object.freeze({ status, reason: MISSING_REASON });
}

function migrateTerminal(
  terminal: AgentTurnsRevision3Attachment["segments"][number]["terminal"],
) {
  if (terminal.state === "unavailable") return terminal;
  return Object.freeze({
    ...terminal,
    evidenceCoverage: Object.freeze({
      events: migrateCoverageEntry(terminal.evidenceCoverage.events),
      actions: migrateCoverageEntry(terminal.evidenceCoverage.actions),
      messages: migrateCoverageEntry(terminal.evidenceCoverage.messages),
      usage: migrateCoverageEntry(terminal.evidenceCoverage.usage),
      status: migrateCoverageEntry(terminal.evidenceCoverage.status),
      data: migrateCoverageEntry(terminal.evidenceCoverage.data),
    }),
  });
}

function lostCoverageReason(value: AgentTurnsRevision3Attachment): boolean {
  return value.segments.some(({ terminal }) => terminal.state === "recorded" &&
    Object.values(terminal.evidenceCoverage).some((status) => status !== "complete"));
}

function migrateCollection(value: AgentTurnsRevision3Attachment) {
  if (!lostCoverageReason(value)) return value.collection;
  const limitation = Object.freeze({
    code: "unsupported-input" as const,
    target: "turn-item" as const,
    omittedAtLeast: 1,
  });
  const limitations = value.collection.limitations.some((candidate) =>
    candidate.code === limitation.code && candidate.target === limitation.target
  )
    ? value.collection.limitations
    : Object.freeze([...value.collection.limitations, limitation].sort((left, right) => {
        const leftKey = JSON.stringify(left);
        const rightKey = JSON.stringify(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }));
  return Object.freeze({ state: "partial" as const, limitations });
}

export const agentTurnsV3ToV4 = defineRecordMigration({
  from: 3,
  to: 4,
  parse: parseAgentTurnsRevision3,
  migrate: ({ value: previous }) => Effect.gen(function* () {
    const value = Object.freeze({
      state: previous.state,
      collection: migrateCollection(previous),
      segments: Object.freeze(previous.segments.map((segment) => Object.freeze({
        ...segment,
        terminal: migrateTerminal(segment.terminal),
      }))),
    });
    const decoded = Schema.decodeUnknownResult(
      Schema.toType(AgentTurnsAttachmentSchema),
      RecordExactParseOptions,
    )(value);
    if (Result.isFailure(decoded)) return yield* Effect.fail(invalid());
    const [issue] = validateAgentTurnsAttachment(decoded.success);
    if (issue !== undefined) return yield* Effect.fail(issue);
    return Object.freeze({
      value: decoded.success,
      references: Object.freeze([]),
      impact: Object.freeze([]),
    });
  }),
});
