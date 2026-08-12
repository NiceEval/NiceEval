// owner: docs/engineering/testing/e2e/record.md#record-public-api-roundtrip
//
// 只从候选包公开 niceeval/record export 写入、发布并读回；测试不读取或拼接
// 私有 Run 布局。

import { join } from "node:path";
import { withTempDir } from "@niceeval/testkit";
import { Effect, Either, Schema } from "effect";
import {
  defineJsonRecordAttachment,
  defineRecordAttachmentFamily,
  makeRecordAttachmentWrite,
  makeRecordRoot,
  NodeRecordLive,
  openRecordReader,
  openRecordWriteSession,
  SlotIdSchema,
  UtcMillisSchema,
} from "niceeval/record";
import { expect, it } from "vitest";

function rightOrThrow<Value>(value: Either.Either<Value, unknown>): Value {
  if (Either.isLeft(value)) {
    throw new Error("Record public constructor rejected the E2E fixture");
  }
  return value.right;
}

const attachmentDefinition = rightOrThrow(
  defineJsonRecordAttachment({
    owner: "run",
    name: "com.example.record-e2e",
    schemaId: "com.example.record-e2e/v1",
    schema: Schema.Struct({
      state: Schema.Literal("published"),
      producer: Schema.Literal("record-e2e"),
    }),
    blobRefs: () => [],
  }),
);

const attachmentFamily = rightOrThrow(
  defineRecordAttachmentFamily({
    current: attachmentDefinition,
    migrations: [],
  }),
);

const slotId = rightOrThrow(
  Schema.decodeUnknownEither(SlotIdSchema)("record-e2e-slot"),
);
const startedAt = rightOrThrow(
  Schema.decodeUnknownEither(UtcMillisSchema)(1_754_582_400_000),
);
const completedAt = rightOrThrow(
  Schema.decodeUnknownEither(UtcMillisSchema)(1_754_582_401_000),
);

it("公开写入的 Run、origin Attempt 与 typed Run attachment 在发布后可读回", async () => {
  await withTempDir("niceeval-record-e2e-", async (root) => {
    const recordPath = join(root, "record");
    const recordRoot = rightOrThrow(makeRecordRoot(recordPath));

    const published = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openRecordWriteSession({ root: recordRoot });
          const draft = yield* session.createRun({
            startedAt,
            expectedSlots: [slotId],
          });
          const attempt = yield* draft.createAttempt({ slotId });
          yield* draft.record(
            makeRecordAttachmentWrite(attachmentFamily, () => ({
              payload: { state: "published", producer: "record-e2e" },
              blobs: [],
            })),
          );
          const receipt = yield* draft.publish({ completedAt });
          return { attemptId: attempt.attemptId, receipt };
        }),
      ).pipe(Effect.provide(NodeRecordLive)),
    );

    const readBack = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reader = yield* openRecordReader({ root: recordRoot });
          const run = yield* reader.run(published.receipt.runId);
          if (run.state !== "available") {
            throw new Error(`published Run read back as ${run.state}`);
          }
          const attempt = yield* reader.attempt(published.receipt.attempts[0]!.ref);
          if (attempt.state !== "available") {
            throw new Error(`published Attempt read back as ${attempt.state}`);
          }
          const attachment = yield* reader.readRunAttachment(run.value, attachmentFamily);
          if (attachment.state !== "available") {
            throw new Error(`published RecordAttachment read back as ${attachment.state}`);
          }
          return { attachment, attempt, run };
        }),
      ).pipe(Effect.provide(NodeRecordLive)),
    );

    expect(published.receipt.attempts).toHaveLength(1);
    expect(readBack.run.value.runId).toBe(published.receipt.runId);
    expect(readBack.attempt.value.attemptId).toBe(published.attemptId);
    expect(readBack.attachment.value.payload).toEqual({
      state: "published",
      producer: "record-e2e",
    });
  });
});
