// owner: docs/engineering/testing/e2e/migrate.md#third-party-attachment-family-composition

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Either, Schema } from "effect";
import {
  defineRecordAttachment,
  defineRecordAttachmentPersistence,
  makeRecordHost,
  makeRecordRoot,
  NodeRecordLive,
  recordContributionFromAttachmentPersistence,
} from "niceeval/record";
import { expect, test } from "vitest";

function family<const Name extends string>(name: Name) {
  const attachment = defineRecordAttachment({
    owner: "run",
    family: name,
    schema: Schema.Struct({ value: Schema.String }),
  });
  const persistence = defineRecordAttachmentPersistence({
    attachment,
    revision: 1,
    migrations: [],
  });
  return Object.freeze({ attachment, persistence });
}

test("第三方 family 显式组合后可局部读取，完整读取对未贡献 family fail closed", async () => {
  const visible = family("acme.visible-fact");
  const hidden = family("acme.hidden-fact");
  const writerHost = makeRecordHost({
    records: [
      recordContributionFromAttachmentPersistence(visible.persistence),
      recordContributionFromAttachmentPersistence(hidden.persistence),
    ],
  });
  const readerHost = makeRecordHost({
    records: [recordContributionFromAttachmentPersistence(visible.persistence)],
  });
  const directory = mkdtempSync(join(tmpdir(), "niceeval-third-party-record-"));

  try {
    const rootResult = makeRecordRoot(join(directory, "record"));
    if (Either.isLeft(rootResult)) throw new Error("root invalid");
    const root = rootResult.right;

    const result = await Effect.runPromise(Effect.gen(function* () {
      const runId = yield* Effect.scoped(Effect.gen(function* () {
        const run = yield* writerHost.current.createRun({
          root,
          experimentId: "third-party-composition" as never,
          context: {
            experimentId: "third-party-composition" as never,
            execution: {
              agentId: "fixture",
              model: null,
              reasoningEffort: null,
              flags: {},
            },
            labels: {},
          },
          startedAt: 1 as never,
          expectedSlots: [],
        });
        yield* run.attach(visible.attachment, { value: "visible" });
        yield* run.attach(hidden.attachment, { value: "hidden" });
        yield* run.seal({ completedAt: 2 as never });
        return run.runId;
      }));

      return yield* Effect.scoped(Effect.gen(function* () {
        const reader = yield* readerHost.current.openRead({ root });
        const selection = yield* reader.selectRuns({ runIds: [runId] });
        const run = yield* reader.readRun(selection.runRefs[0]!);
        if (run.state !== "available") return yield* Effect.die("sealed Run unavailable");

        const visibleRead = yield* reader.read(run.value.owner, visible.attachment);
        const hiddenRead = yield* Effect.either(reader.read(run.value.owner, hidden.attachment));
        const complete = yield* Effect.either(reader.requireComplete(selection));
        return { visibleRead, hiddenRead, complete };
      }));
    }).pipe(Effect.provide(NodeRecordLive)));

    expect(result.visibleRead).toMatchObject({
      state: "available",
      value: { value: "visible" },
    });
    expect(Either.isLeft(result.hiddenRead)).toBe(true);
    if (Either.isLeft(result.hiddenRead)) {
      expect(result.hiddenRead.left).toMatchObject({ code: "family-definition-required" });
    }
    expect(Either.isLeft(result.complete)).toBe(true);
    if (Either.isLeft(result.complete)) {
      expect(result.complete.left).toMatchObject({ code: "family-definition-required" });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
