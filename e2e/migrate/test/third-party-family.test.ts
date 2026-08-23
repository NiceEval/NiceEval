// owner: docs/engineering/testing/e2e/migrate.md#third-party-attachment-family-composition

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Either, Schema } from "effect";
import {
  defineRecordAttachment,
  makeRecordAttachmentCatalog,
  makeRecordHost,
  makeRecordRoot,
  NodeRecordLive,
  recordAttachmentVersion,
} from "niceeval/record";
import { expect, test } from "vitest";

const valueLimits = Object.freeze({
  maximumJsonBytes: 4_096,
  maximumDepth: 4,
  maximumNodes: 64,
  maximumObjectKeys: 16,
  maximumArrayItems: 16,
  maximumKeyUtf8Bytes: 128,
  maximumStringUtf8Bytes: 1_024,
});

const noContent = Object.freeze({
  select: () => Object.freeze([]),
  valueLimits,
  budget: Object.freeze({
    maximumBlobs: 1,
    maximumBlobBytes: 1,
    maximumTotalBytes: 1,
  }),
});

function family<const Name extends string>(name: Name) {
  const version = recordAttachmentVersion({
    version: 1,
    schema: Schema.Struct({ value: Schema.String }),
    invariants: () => Object.freeze([]),
    contents: noContent,
    references: Object.freeze({
      select: () => Object.freeze([]),
      maximumReferences: 0,
    }),
  });
  return defineRecordAttachment({
    owner: "run",
    family: name,
    current: version,
    versions: [version],
    migrations: [],
  });
}

function catalog(definitions: Parameters<typeof makeRecordAttachmentCatalog>[0]) {
  const made = makeRecordAttachmentCatalog(definitions);
  if (Either.isLeft(made)) throw new Error("catalog invalid");
  return made.right;
}

test("第三方 family 显式组合后可局部读取，完整读取对未贡献 family fail closed", async () => {
  const visible = family("acme.visible-fact");
  const hidden = family("acme.hidden-fact");
  const writerHost = makeRecordHost({ attachments: catalog([visible, hidden]) });
  const readerHost = makeRecordHost({ attachments: catalog([visible]) });
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
        const visibleWrite = visible.prepare({ value: "visible" }, []);
        const hiddenWrite = hidden.prepare({ value: "hidden" }, []);
        if (Either.isLeft(visibleWrite) || Either.isLeft(hiddenWrite)) {
          return yield* Effect.die("third-party write preparation failed");
        }
        yield* run.attach(visible, visibleWrite.right);
        yield* run.attach(hidden, hiddenWrite.right);
        yield* run.seal({ completedAt: 2 as never });
        return run.runId;
      }));

      return yield* Effect.scoped(Effect.gen(function* () {
        const reader = yield* readerHost.current.openRead({ root });
        const selection = yield* reader.selectRuns({ runIds: [runId] });
        const run = yield* reader.readRun(selection.runRefs[0]!);
        if (run.state !== "available") return yield* Effect.die("sealed Run unavailable");

        const visibleRead = yield* reader.read(run.value.owner, visible);
        const hiddenRead = yield* Effect.either(reader.read(run.value.owner, hidden));
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
