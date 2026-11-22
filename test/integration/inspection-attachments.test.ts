import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import {
  externalInspectionSource,
  openInspectionSource,
  operationalInspectionSource,
  selectInspectionOperation,
} from "../../packages/niceeval/src/inspection/index.ts";

type ArtifactId = import("../../packages/niceeval/src/inspection/public.ts").InspectionOperationFor<"attempt.artifact">["artifactId"];
type RunId = import("../../packages/niceeval/src/inspection/public.ts").InspectionOperationFor<"run.get">["runId"];

async function runProjectExperiment(cwd: string, experimentSelector: string, rerun?: "all") {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector,
      config: { maxConcurrency: 1 },
      ...(rerun === undefined ? {} : { overrides: { rerun } }),
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan ${experimentSelector}: ${JSON.stringify(planned)}`);
  return Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
}

function expectOperationCode(fn: () => unknown, expectedCode: string) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: expectedCode });
}

function withExternal<A>(
  cwd: string,
  recordPath: string,
  run: (facts: import("../../packages/niceeval/src/inspection/index.ts").InspectionFactSource) => A,
): Promise<A> {
  return Effect.runPromise(Effect.scoped(openInspectionSource(externalInspectionSource(cwd, recordPath)).pipe(Effect.map(run))));
}

function withOperational<A>(
  cwd: string,
  run: (facts: import("../../packages/niceeval/src/inspection/index.ts").InspectionFactSource) => A,
): Promise<A> {
  return Effect.runPromise(Effect.scoped(openInspectionSource(operationalInspectionSource(cwd)).pipe(Effect.map(run))));
}

describe("attachment archive", () => {
  let cwd: string;
  let recordPath: string;
  let originRunId: RunId;
  let carryRunId: RunId;
  let originLocator: string;
  let rerunLocator: string;
  let expectedBinary: Buffer;
  let expectedDigest: string;
  let receiptIds: string[];

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-archive-"));
    await Promise.all(["evals", "experiments", "adapters"].map((dir) => mkdir(join(cwd, dir))));
    expectedBinary = Buffer.from(Array.from({ length: 256 * 1024 + 13 }, (_, index) => index % 251));
    expectedDigest = createHash("sha256").update(expectedBinary).digest("hex");
    await Promise.all([
      writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(cwd, "attachment-input.bin"), expectedBinary),
      writeFile(
        join(cwd, "adapters", "artifacts.ts"),
        `
        import { defineAdapter } from "niceeval";
        import { appendFile, readFile, writeFile } from "node:fs/promises";
        import { resolve } from "node:path";
        const projectFile = (name: string) => resolve(import.meta.dirname, "..", name);
        export const artifactAdapter = defineAdapter({
          name: "artifact-fixture",
          behaviorRevision: "1",
          create(ctx) {
            ctx.onCleanup(async () => {
              const receipt = await ctx.attach({ name: "cleanup.txt", mediaType: "text/plain", body: "cleanup attachment" });
              await appendFile(projectFile("artifact-selectors.txt"), \`\\n\${receipt.artifactId}\`);
            });
            return {
              async produce() {
                const bytes = await readFile(projectFile("attachment-input.bin"));
                const accepted = ctx.attach({ name: "same-label", mediaType: "application/octet-stream", body: bytes });
                bytes.fill(0);
                const first = await accepted;
                await writeFile(projectFile("attachment-input.bin"), "rewritten after acceptance");
                const second = await ctx.attach({ name: "same-label", mediaType: "text/plain", body: "附件 snapshot\\n" });
                const empty = await ctx.attach({ name: "empty", mediaType: "application/octet-stream", body: new Uint8Array() });
                const ids = [first.artifactId, second.artifactId, empty.artifactId];
                let active = 0;
                let peak = 0;
                const firstGroup = Promise.withResolvers();
                const extras = await Promise.all(Array.from({ length: 12 }, () =>
                  ctx.attach({
                    name: "L".repeat(16 * 1024),
                    mediaType: "application/octet-stream",
                    body: {
                      async *stream() {
                        active += 1;
                        peak = Math.max(peak, active);
                        if (active === 4) firstGroup.resolve();
                        try {
                          await firstGroup.promise;
                          yield new Uint8Array();
                        } finally {
                          active -= 1;
                        }
                      },
                    },
                  }),
                ));
                ids.push(...extras.map((extra) => extra.artifactId));
                if (peak !== 4) throw new Error("Expected four active attachment streams");
                await writeFile(projectFile("artifact-selectors.txt"), ids.join("\\n"));
                return first.artifactId !== second.artifactId;
              },
            };
          },
        });
      `,
      ),
      writeFile(
        join(cwd, "evals", "artifacts-portable.eval.ts"),
        `
        import { equals } from "niceeval/expect";
        import { artifactAdapter } from "../adapters/artifacts.ts";
        export default artifactAdapter.defineEval({
          async test(t) { t.check(await t.produce(), equals(true)).label("distinct ids"); },
        });
      `,
      ),
      writeFile(
        join(cwd, "experiments", "artifacts-portable.ts"),
        `
        import { defineExperiment } from "niceeval";
        import { artifactAdapter } from "../adapters/artifacts.ts";
        export default defineExperiment({ adapter: artifactAdapter, evals: ["artifacts-portable"], attempts: 1 });
      `,
      ),
    ]);

    const origin = await runProjectExperiment(cwd, "artifacts-portable", "all");
    expect(origin.receipt.completion).toBe("completed");
    originRunId = origin.receipt.createdRunIds[0]! as RunId;
    receiptIds = (await readFile(join(cwd, "artifact-selectors.txt"), "utf8")).split("\n");
    expect(receiptIds).toHaveLength(16);
    expect(new Set(receiptIds).size).toBe(16);

    const originDetail = await Effect.runPromise(runHost.get({ cwd, runId: originRunId }));
    const originSlot = originDetail.run.slots.find((slot) => slot.evalId === "artifacts-portable");
    if (originSlot?.publication.state !== "published") throw new Error("Expected published origin slot");
    originLocator = originSlot.publication.attemptLocator;

    // Rewrite source input before carry & rerun to prove sealed bytes are self-contained.
    await writeFile(join(cwd, "attachment-input.bin"), expectedBinary);
    const carry = await runProjectExperiment(cwd, "artifacts-portable");
    carryRunId = carry.receipt.createdRunIds[0]! as RunId;
    const rerun = await runProjectExperiment(cwd, "artifacts-portable", "all");
    const rerunDetail = await Effect.runPromise(runHost.get({ cwd, runId: rerun.receipt.createdRunIds[0]! }));
    const rerunSlot = rerunDetail.run.slots.find((slot) => slot.evalId === "artifacts-portable");
    if (rerunSlot?.publication.state !== "published") throw new Error("Expected published rerun slot");
    rerunLocator = rerunSlot.publication.attemptLocator;
    expect(rerunLocator).not.toBe(originLocator);

    recordPath = join(cwd, "portable-archive.sqlite");
    await copyFile(join(cwd, ".niceeval", "record.sqlite"), recordPath);
    await rm(join(cwd, ".niceeval"), { recursive: true, force: true });
    await rm(join(cwd, "attachment-input.bin"), { force: true });
  }, 30_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#attachment-archive
  test("sealed attachments stay paginated and byte-identical after source rewrite and Record relocation", async () => {
    await withExternal(cwd, recordPath, (facts) => {
      const originRun = selectInspectionOperation(facts, { kind: "run.get", runId: originRunId }).run;
      const carryRun = selectInspectionOperation(facts, { kind: "run.get", runId: carryRunId }).run;
      const originMember = originRun.plannedAttempts[0]!;
      const carryMember = carryRun.plannedAttempts[0]!;
      expect(originMember.relation).toBe("origin");
      expect(carryMember.relation).toBe("reference");
      expect(carryMember.publication).toMatchObject({
        state: "published",
        action: "carried",
        originRunId,
        attemptLocator: originLocator,
      });

      const firstPage = selectInspectionOperation(facts, {
        kind: "attempt.artifacts",
        locator: originLocator,
      }).artifacts;
      expect(firstPage.state).toBe("available");
      if (firstPage.state !== "available") throw new Error("Expected artifact listing");
      expect(firstPage.value.collection).toMatchObject({ state: "complete", limitations: [] });
      expect(firstPage.collection).toMatchObject({ state: "bounded-page", hasMore: true, total: 16 });
      expect(firstPage.collection.items).toEqual(firstPage.value.artifacts);
      expect(Buffer.byteLength(JSON.stringify(firstPage.value.artifacts))).toBeLessThanOrEqual(128 * 1024);

      const descriptors = [...firstPage.value.artifacts];
      let nextOffset = firstPage.collection.nextOffset;
      while (nextOffset !== null) {
        const page = selectInspectionOperation(facts, {
          kind: "attempt.artifacts",
          locator: originLocator,
          offset: nextOffset,
        }).artifacts;
        if (page.state !== "available") throw new Error("Expected next artifact listing page");
        descriptors.push(...page.value.artifacts);
        nextOffset = page.collection.nextOffset;
      }
      expect(descriptors.map((item) => item.artifactId).toSorted()).toEqual(receiptIds.toSorted());

      // Exact boundary: offset === total yields an empty final page.
      const tailPage = selectInspectionOperation(facts, {
        kind: "attempt.artifacts",
        locator: originLocator,
        offset: 16,
      }).artifacts;
      expect(tailPage).toMatchObject({
        state: "available",
        collection: { state: "complete-page", items: [], hasMore: false, nextOffset: null, total: 16 },
      });

      const binary = descriptors.find(
        (item) => item.label === "same-label" && item.mediaType === "application/octet-stream",
      )!;
      const text = descriptors.find((item) => item.label === "same-label" && item.mediaType === "text/plain")!;
      const empty = descriptors.find((item) => item.label === "empty")!;
      const cleanup = descriptors.find((item) => item.label === "cleanup.txt")!;
      expect(binary).toMatchObject({ byteLength: expectedBinary.length, sha256: expectedDigest });

      // Full chunked read reconstruction.
      const chunks: Buffer[] = [];
      let offset = 0;
      while (offset < expectedBinary.length) {
        const part = selectInspectionOperation(facts, {
          kind: "attempt.artifact",
          locator: originLocator,
          artifactId: binary.artifactId,
          offset,
        }).artifact;
        expect(part.state).toBe("available");
        if (part.state !== "available") throw new Error("Expected readable artifact chunk");
        const bytes = Buffer.from(part.base64, "base64");
        expect(bytes.length).toBe(Math.min(64 * 1024, expectedBinary.length - offset));
        chunks.push(bytes);
        offset += bytes.length;
        expect(part.nextOffset).toBe(offset === expectedBinary.length ? null : offset);
      }
      expect(Buffer.concat(chunks)).toEqual(expectedBinary);

      // Exact EOF offset === byteLength returns empty base64 and null nextOffset.
      expect(
        selectInspectionOperation(facts, {
          kind: "attempt.artifact",
          locator: originLocator,
          artifactId: binary.artifactId,
          offset: expectedBinary.length,
        }).artifact,
      ).toMatchObject({ state: "available", offset: expectedBinary.length, base64: "", nextOffset: null });

      for (const [artifact, expectedContent] of [
        [text, "附件 snapshot\n"],
        [empty, ""],
        [cleanup, "cleanup attachment"],
      ] as const) {
        expect(
          selectInspectionOperation(facts, {
            kind: "attempt.artifact",
            locator: originLocator,
            artifactId: artifact.artifactId,
          }).artifact,
        ).toMatchObject({
          state: "available",
          name: artifact.label,
          base64: Buffer.from(expectedContent).toString("base64"),
          nextOffset: null,
        });
      }

      // Randomized slice readback and out-of-range / missing rejections via fast-check.
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: expectedBinary.length }),
          fc.integer({ min: 1, max: 256 * 1024 }),
          (sliceOffset, sliceLimit) => {
            const slice = selectInspectionOperation(facts, {
              kind: "attempt.artifact",
              locator: originLocator,
              artifactId: binary.artifactId,
              offset: sliceOffset,
              limit: sliceLimit,
            }).artifact;
            if (slice.state !== "available") throw new Error("Expected available slice");
            const expectedEnd = Math.min(expectedBinary.length, sliceOffset + sliceLimit);
            expect(Buffer.from(slice.base64, "base64")).toEqual(expectedBinary.subarray(sliceOffset, expectedEnd));
            expect(slice.nextOffset).toBe(expectedEnd < expectedBinary.length ? expectedEnd : null);
          },
        ),
        { numRuns: 10, seed: 2026 },
      );

      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1024 }), (over) => {
          expectOperationCode(
            () =>
              selectInspectionOperation(facts, {
                kind: "attempt.artifact",
                locator: originLocator,
                artifactId: binary.artifactId,
                offset: expectedBinary.length + over,
              }),
            "inspection-request-invalid",
          );
          expectOperationCode(
            () =>
              selectInspectionOperation(facts, {
                kind: "attempt.artifacts",
                locator: originLocator,
                offset: 16 + over,
              }),
            "inspection-request-invalid",
          );
        }),
        { numRuns: 5, seed: 2027 },
      );

      expect(
        selectInspectionOperation(facts, {
          kind: "attempt.artifact",
          locator: originLocator,
          artifactId: "art_missing0000000000000000" as ArtifactId,
        }).artifact,
      ).toEqual({ state: "not-found", artifactId: "art_missing0000000000000000" });
    });
  });
});

describe("attachment failure", () => {
  let cwd: string;
  let invalidAttachment: { locator: string; artifactId: ArtifactId; code: string };
  let streamFailureLocator: string;
  let streamFailureRetainedId: ArtifactId;
  let streamFailureCleanupId: ArtifactId;
  let streamTimeoutLocator: string;
  let streamTimeoutCleanupId: ArtifactId;

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-attach-fail-"));
    await Promise.all(["evals", "experiments", "adapters"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(cwd, "small.txt"), "retained bytes"),
      writeFile(
        join(cwd, "adapters", "failure.ts"),
        `
        import { defineAdapter } from "niceeval";
        import { createReadStream } from "node:fs";
        import { writeFile } from "node:fs/promises";
        import { resolve } from "node:path";
        const projectFile = (name: string) => resolve(import.meta.dirname, "..", name);
        export const failureAdapter = defineAdapter({
          name: "attach-failure-fixture",
          behaviorRevision: "1",
          create(ctx) {
            ctx.onCleanup(async ({ signal }) => {
              if (ctx.flags.withCleanup !== true) return;
              const receipt = await ctx.attach({
                name: "cleanup",
                mediaType: "text/plain",
                body: { stream: (transferSignal) => createReadStream(projectFile("small.txt"), { signal: transferSignal }) },
                signal,
              });
              await writeFile(projectFile("cleanup-id.txt"), receipt.artifactId);
            });
            return {
              async rejectInvalid() {
                const bytes = new Uint8Array([1, 2, 3]);
                const accepted = ctx.attach({ name: "retained", mediaType: "application/octet-stream", body: bytes });
                bytes.fill(255);
                const receipt = await accepted;
                await writeFile(projectFile("accepted-artifact-id.txt"), receipt.artifactId);
                try {
                  await ctx.attach({
                    name: "invalid\\u0000label",
                    mediaType: "application/octet-stream",
                    body: new Uint8Array([1]),
                  });
                  return false;
                } catch (cause) {
                  await writeFile(projectFile("attachment-rejection.txt"), cause instanceof Error ? String(Reflect.get(cause, "code")) : "non-error");
                  return true;
                }
              },
              async rejectStreams() {
                const retained = await ctx.attach({
                  name: "retained",
                  mediaType: "text/plain",
                  body: { stream: (signal) => createReadStream(projectFile("small.txt"), { signal }) },
                });
                await writeFile(projectFile("retained-id.txt"), retained.artifactId);
                const failures: string[] = [];
                let released = 0;
                const sources = [
                  () => (async function* () { try { yield new Uint8Array([1]); throw new Error("source failed"); } finally { released++; } })(),
                  () => (async function* () { try { yield "not bytes" as unknown as Uint8Array; } finally { released++; } })(),
                  () => (async function* () { try { yield new Uint8Array(1024 * 1024 + 1); } finally { released++; } })(),
                ];
                for (const stream of sources) {
                  try { await ctx.attach({ name: "rejected", mediaType: "application/octet-stream", body: { stream } }); }
                  catch (error) { failures.push(String(Reflect.get(error as object, "code"))); }
                }
                const controller = new AbortController();
                let returned = false;
                let transferSignal: AbortSignal | undefined;
                try {
                  await ctx.attach({
                    name: "cancelled",
                    mediaType: "application/octet-stream",
                    signal: controller.signal,
                    body: {
                      stream: (signal) => {
                        transferSignal = signal;
                        return {
                          [Symbol.asyncIterator]() {
                            return {
                              next() { queueMicrotask(() => controller.abort()); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
                              return() { returned = true; return new Promise<IteratorResult<Uint8Array>>(() => {}); },
                            };
                          },
                        };
                      },
                    },
                  });
                } catch (error) {
                  failures.push(String(Reflect.get(error as object, "code")));
                }
                await writeFile(projectFile("failures.txt"), failures.join("\\n"));
                await writeFile(projectFile("source-cleanup.txt"), \`\${released},\${returned},\${transferSignal?.aborted}\`);
                return failures.length;
              },
              async waitForCancellation() {
                await ctx.attach({
                  name: "interrupted",
                  mediaType: "application/octet-stream",
                  signal: ctx.signal,
                  body: {
                    stream: (signal) => ({
                      [Symbol.asyncIterator]() {
                        return {
                          next() {
                            return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
                              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                            });
                          },
                          async return() {
                            await writeFile(projectFile("cancel-source-closed.txt"), "closed");
                            return { done: true as const, value: undefined };
                          },
                        };
                      },
                    }),
                  },
                });
              },
            };
          },
        });
      `,
      ),
      writeFile(
        join(cwd, "evals", "limits.eval.ts"),
        `import { equals } from "niceeval/expect"; import { failureAdapter } from "../adapters/failure.ts";
         export default failureAdapter.defineEval({ async test(t) { t.check(await t.rejectInvalid(), equals(true)); } });`,
      ),
      writeFile(
        join(cwd, "evals", "stream-failure.eval.ts"),
        `import { equals } from "niceeval/expect"; import { failureAdapter } from "../adapters/failure.ts";
         export default failureAdapter.defineEval({ async test(t) { t.check(await t.rejectStreams(), equals(4)); } });`,
      ),
      writeFile(
        join(cwd, "evals", "stream-timeout.eval.ts"),
        `import { failureAdapter } from "../adapters/failure.ts";
         export default failureAdapter.defineEval({ timeoutMs: 250, async test(t) { await t.waitForCancellation(); } });`,
      ),
      writeFile(
        join(cwd, "experiments", "stream-failure.ts"),
        `import { defineExperiment } from "niceeval"; import { failureAdapter } from "../adapters/failure.ts";
         export default defineExperiment({ adapter: failureAdapter, evals: ["stream-failure"], flags: { withCleanup: true } });`,
      ),
      writeFile(
        join(cwd, "experiments", "stream-timeout.ts"),
        `import { defineExperiment } from "niceeval"; import { failureAdapter } from "../adapters/failure.ts";
         export default defineExperiment({ adapter: failureAdapter, evals: ["stream-timeout"], flags: { withCleanup: true } });`,
      ),
    ]);

    await writeFile(
      join(cwd, "experiments", "invalid-attachment.ts"),
      `import { defineExperiment } from "niceeval"; import { failureAdapter } from "../adapters/failure.ts";
       export default defineExperiment({ adapter: failureAdapter, evals: ["limits"], flags: { withCleanup: false } });`,
    );
    const invalidRun = await runProjectExperiment(cwd, "invalid-attachment", "all");
    const invalidDetail = await Effect.runPromise(runHost.get({ cwd, runId: invalidRun.receipt.createdRunIds[0]! }));
    const invalidSlot = invalidDetail.run.slots[0]!;
    if (invalidSlot.publication.state !== "published") throw new Error("Expected published slot for invalid attachment");
    invalidAttachment = {
      locator: invalidSlot.publication.attemptLocator,
      artifactId: (await readFile(join(cwd, "accepted-artifact-id.txt"), "utf8")) as ArtifactId,
      code: await readFile(join(cwd, "attachment-rejection.txt"), "utf8"),
    };

    const streamRun = await runProjectExperiment(cwd, "stream-failure", "all");
    const streamDetail = await Effect.runPromise(runHost.get({ cwd, runId: streamRun.receipt.createdRunIds[0]! }));
    const streamSlot = streamDetail.run.slots[0]!;
    if (streamSlot.publication.state !== "published") throw new Error("Expected stream-failure slot");
    streamFailureLocator = streamSlot.publication.attemptLocator;
    streamFailureRetainedId = (await readFile(join(cwd, "retained-id.txt"), "utf8")) as ArtifactId;
    streamFailureCleanupId = (await readFile(join(cwd, "cleanup-id.txt"), "utf8")) as ArtifactId;
    expect(await readFile(join(cwd, "failures.txt"), "utf8")).toBe(
      "adapter-attachment-failed\nadapter-attachment-invalid\nadapter-attachment-limit\nadapter-attachment-failed",
    );
    expect(await readFile(join(cwd, "source-cleanup.txt"), "utf8")).toBe("3,true,true");

    const timeoutRun = await runProjectExperiment(cwd, "stream-timeout", "all");
    const timeoutDetail = await Effect.runPromise(runHost.get({ cwd, runId: timeoutRun.receipt.createdRunIds[0]! }));
    const timeoutSlot = timeoutDetail.run.slots[0]!;
    if (timeoutSlot.publication.state !== "published") throw new Error("Expected stream-timeout slot");
    streamTimeoutLocator = timeoutSlot.publication.attemptLocator;
    streamTimeoutCleanupId = (await readFile(join(cwd, "cleanup-id.txt"), "utf8")) as ArtifactId;
    expect(await readFile(join(cwd, "cancel-source-closed.txt"), "utf8")).toBe("closed");
    expect(await readdir(join(cwd, ".niceeval", "attachment-staging"))).toEqual([]);
  }, 60_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#attachment-failure
  test("invalid input retains accepted attachments in an errored Attempt", async () => {
    await withOperational(cwd, (facts) => {
      const { locator, artifactId, code } = invalidAttachment;
      expect(code).toBe("adapter-attachment-invalid");
      const attempt = selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt;
      expect(attempt.verdict).toBe("errored");
      const read = selectInspectionOperation(facts, { kind: "attempt.artifact", locator, artifactId }).artifact;
      expect(read).toMatchObject({
        state: "available",
        name: "retained",
        byteLength: 3,
        base64: "AQID",
        nextOffset: null,
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      });
    });
  });

  // @feature docs/feature/inspection/README.md#attachment-failure
  test("stream failures, cancellation, and timeout preserve partial collections and cleanup diagnostics", async () => {
    await withOperational(cwd, (facts) => {
      const attempt = selectInspectionOperation(facts, { kind: "attempt.get", locator: streamFailureLocator }).attempt;
      expect(attempt.verdict).toBe("errored");
      const listed = selectInspectionOperation(facts, {
        kind: "attempt.artifacts",
        locator: streamFailureLocator,
      }).artifacts;
      expect(listed.state).toBe("available");
      if (listed.state !== "available") throw new Error("Expected partial artifact listing");
      expect(listed.value.collection.state).toBe("partial");
      expect(listed.value.artifacts.map((item) => item.label).sort()).toEqual(["cleanup", "retained"]);

      fc.assert(
        fc.property(
          fc.constantFrom(
            { locator: streamFailureLocator, artifactId: streamFailureRetainedId, expected: "retained bytes" },
            { locator: streamFailureLocator, artifactId: streamFailureCleanupId, expected: "retained bytes" },
            { locator: streamTimeoutLocator, artifactId: streamTimeoutCleanupId, expected: "retained bytes" },
          ),
          ({ locator, artifactId, expected }) => {
            const timeoutAttempt = selectInspectionOperation(facts, {
              kind: "attempt.get",
              locator,
            }).attempt;
            expect(timeoutAttempt.verdict).toBe("errored");
            const read = selectInspectionOperation(facts, {
              kind: "attempt.artifact",
              locator,
              artifactId,
            }).artifact;
            expect(read).toMatchObject({
              state: "available",
              base64: Buffer.from(expected).toString("base64"),
            });
          },
        ),
        { numRuns: 6, seed: 2029 },
      );
    });
  });
});
