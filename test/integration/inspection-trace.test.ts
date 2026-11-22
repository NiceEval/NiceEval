import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect, Exit, Scope } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");
const {
  externalInspectionSource,
  openInspectionSource,
  selectInspectionOperation,
} = require("./src/inspection/index.ts") as typeof import("../../packages/niceeval/src/inspection/index.ts");

const SANDBOX_FIXTURE = fileURLToPath(new URL("fixtures/inspection-core/sandbox.ts.txt", import.meta.url));

type ArtifactId = import("../../packages/niceeval/src/inspection/public.ts").InspectionOperationFor<"attempt.artifact">["artifactId"];

async function runProjectExperiments(cwd: string, experimentIds: string[]) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentIds,
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan ${experimentIds.join(", ")}: ${JSON.stringify(planned)}`);
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

type InspectionFacts = import("../../packages/niceeval/src/inspection/index.ts").InspectionFactSource;

describe("portable trace", () => {
  let cwd: string;
  let facts: InspectionFacts;
  const recordScope = Scope.makeUnsafe();
  let executionLocator: string;
  let eventIdOutsideIndex: string;
  let evidenceId: string;
  let missingNativeEventId: string;
  let conversationLocator: string;
  let displayLocator: string;
  let partialEmptyLocator: string;
  let partialSingleLocator: string;
  let partialPagedLocator: string;
  let timingLocator: string;
  let otherTimingLocator: string;
  let toolAgentLocator: string;
  let expectedImageBytes: Buffer;
  let expectedImageSha256: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-trace-"));
    await Promise.all(["evals", "experiments", "adapters", "node_modules"].map((dir) => mkdir(join(cwd, dir))));
    expectedImageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI1sAAAAASUVORK5CYII=",
      "base64",
    );
    expectedImageSha256 = createHash("sha256").update(expectedImageBytes).digest("hex");
    await Promise.all([
      symlink(dirname(require.resolve("effect/package.json")), join(cwd, "node_modules", "effect"), "dir"),
      writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(cwd, "sandbox.ts"), await readFile(SANDBOX_FIXTURE, "utf8")),
      writeFile(
        join(cwd, "adapters", "trace.ts"),
        `
        import { defineAdapter, type ExecutionTraceInput } from "niceeval";
        import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        import { writeFile } from "node:fs/promises";
        import { resolve } from "node:path";
        const projectFile = (name: string) => resolve(import.meta.dirname, "..", name);

        export const executionTraceAdapter = defineAdapter({
          name: "execution-trace-fixture",
          behaviorRevision: "1",
          create(ctx) {
            return {
              async archive() {
                const originals = Array.from({ length: 1_003 }, (_, index) => ({
                  ...(index === 1_001 ? {} : { eventId: \`source-\${index}\` }),
                  origin: index % 2 === 0 ? "server" : "client",
                  type: index === 0 ? "model.request" : index === 1_002 ? "operation.completed" : "position.observed",
                  data:
                    index === 0
                      ? { context: "request-evidence-sentinel", input: "large input ".repeat(25_000) }
                      : { x: index, result: index === 1_002 ? "actual-movement-sentinel" : "observed" },
                }));
                const artifact = await ctx.attach({
                  name: "sealed-events.json",
                  mediaType: "application/json",
                  body: JSON.stringify({ events: originals }),
                });
                const snapshot: ExecutionTraceInput = {
                  traceId: "sealed-session",
                  schema: { id: "example.simulation" },
                  collection: { state: "complete", limitations: [] },
                  scopes: [{ scopeId: "measurement", label: "Measured interval", boundary: { throughSequence: 1_000, gameTime: 20 } }],
                  events: originals.map((event, index) => ({
                    key: String(index),
                    type: event.type,
                    source: {
                      id: event.origin,
                      ...(event.eventId === undefined ? {} : { eventId: event.eventId }),
                      ...(event.origin === "client" ? { sequence: index } : {}),
                    },
                    actor: { id: index % 2 === 0 ? "actor-a" : "actor-b", label: index % 2 === 0 ? "Courier" : "Guide" },
                    time: { clockId: "simulation", value: index / 100, unit: "seconds" },
                    summary: index === 1_002 ? "Movement completed after measurement" : \`Observed event \${index}\`,
                    payload:
                      index === 1_001
                        ? { code: "inspection-result-invalid", reason: "domain-value", ["__proto__"]: { domain: "preserved" } }
                        : { x: index },
                    links: index === 1_002 ? [{ relation: "model-request", targetKey: "0" }] : [],
                    evidence: [
                      { key: "original", label: "Original event", artifactId: artifact.artifactId, pointer: \`/events/\${index}\` },
                      ...(index === 1_002
                        ? [{ key: "request", label: "Referenced request", artifactId: artifact.artifactId, pointer: "/events/0" }]
                        : []),
                    ],
                    scopeMemberships: [
                      { scopeId: "measurement", state: index > 1_000 ? "excluded" : event.origin === "server" ? "unknown" : "included" },
                    ],
                  })),
                };
                const receipt = await ctx.recordTrace(snapshot);
                const again = await ctx.recordTrace(snapshot);
                if (JSON.stringify(receipt) !== JSON.stringify(again)) throw new Error("Duplicate archive changed stable identities");
                const last = receipt.events.find((event) => event.key === "1002")!;
                const missingNative = receipt.events.find((event) => event.key === "1001")!;
                await writeFile(
                  projectFile("execution-selectors.txt"),
                  [last.eventId, last.evidence.find((item) => item.key === "request")!.evidenceId, missingNative.eventId].join("\\n"),
                );
                return true;
              },
            };
          },
        });

        export const displayAdapter = defineAdapter({
          name: "execution-display-fixture",
          behaviorRevision: "1",
          create(ctx) {
            return {
              async archive() {
                const image = await ctx.attach({
                  name: "gate.png",
                  mediaType: "image/png",
                  body: Buffer.from("${expectedImageBytes.toString("base64")}", "base64"),
                });
                await ctx.recordTrace({
                  traceId: "application-display",
                  schema: { id: "example.application/v1" },
                  collection: {
                    state: "partial",
                    limitations: [{ code: "external-trace", message: "Full trace is stored by the RPG server." }],
                  },
                  scopes: [],
                  events: [
                    {
                      key: "npc",
                      type: "npc.said",
                      source: { id: "game-server" },
                      actor: { id: "npc:guard", label: "\\u001bGuard\\u202e" },
                      summary: "\\u001bNPC dialogue\\u202e",
                      payload: { npcId: "guard", mood: "alert" },
                      display: [{ kind: "message", role: "other", speaker: "Guard", text: "Halt! Who goes there?" }],
                    },
                    {
                      key: "http",
                      type: "http.request",
                      source: { id: "api" },
                      summary: "Created an order",
                      display: [{
                        kind: "fields",
                        fields: [
                          { label: "method", value: "POST" },
                          { label: "status", value: 201 },
                          { label: "cached", value: false },
                          { label: "error", value: null },
                        ],
                      }],
                    },
                    {
                      key: "image",
                      type: "frame.rendered",
                      source: { id: "renderer" },
                      summary: "Rendered the gate",
                      display: [{ kind: "image", artifactId: image.artifactId, alt: "Guard blocks the gate at dusk" }],
                    },
                    {
                      key: "long",
                      type: "log.created",
                      source: { id: "logger" },
                      summary: "Long Unicode display",
                      display: [
                        { kind: "text", text: "界".repeat(400) },
                        { kind: "code", language: "shell", text: \`printf '\${"x".repeat(100)}'\\n\\tprintf 'tail-sentinel'  \` },
                        { kind: "fields", fields: [{ label: "body", value: "😀".repeat(300) }] },
                      ],
                    },
                  ],
                });
                return true;
              },
            };
          },
        });

        export const partialTraceAdapter = defineAdapter({
          name: "partial-trace-fixture",
          behaviorRevision: "1",
          create(ctx) {
            return {
              async archive(eventCount: number) {
                await ctx.recordTrace({
                  traceId: "partial-journal",
                  schema: { id: "example.telemetry" },
                  collection: {
                    state: "partial",
                    limitations: [{ code: "producer-stream-interrupted", message: "Upstream journal ended before final acknowledgement." }],
                  },
                  scopes: [],
                  events: Array.from({ length: eventCount }, (_, index) => ({
                    key: String(index),
                    type: "observation.recorded",
                    source: { id: "telemetry-journal", sequence: index },
                    actor: { id: "observer", label: "Observer" },
                    summary: \`Retained observation \${index}\`,
                  })),
                });
                return true;
              },
            };
          },
        });

        export const conversationAgent = defineAgent({
          name: "conversation-trace",
          evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({
            status: "completed",
            events: Array.from({ length: 20 }, (_, index) => ({
              type: "message" as const,
              role: "assistant" as const,
              text: \`Assistant turn \${index}\`,
            })),
          }),
        });

        export const truncatedToolAgent = defineSandboxAgent({
          name: "truncated-tool",
          evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "truncated-tool", version: "1", revision: "1" }, probe: shell("true") },
          send: async () => ({
            status: "completed",
            events: [
              {
                type: "operation.started",
                operationId: "tool-1",
                operation: { kind: "tool", name: "inspection_fixture", input: { content: "工具输入".repeat(9000) } },
              },
              {
                type: "operation.finished",
                operationId: "tool-1",
                kind: "tool",
                output: { content: "工具输出".repeat(9000) },
                status: "completed",
              },
              { type: "message", role: "assistant", text: "Done." },
            ],
          }),
        });
      `,
      ),
      writeFile(
        join(cwd, "evals", "execution-trace.eval.ts"),
        `import { equals } from "niceeval/expect"; import { executionTraceAdapter } from "../adapters/trace.ts";
         export default executionTraceAdapter.defineEval({ async test(t) { t.check(await t.archive(), equals(true)); } });`,
      ),
      writeFile(
        join(cwd, "evals", "execution-display.eval.ts"),
        `import { equals } from "niceeval/expect"; import { displayAdapter } from "../adapters/trace.ts";
         export default displayAdapter.defineEval({ async test(t) { t.check(await t.archive(), equals(true)); } });`,
      ),
      writeFile(
        join(cwd, "evals", "conversation.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ async test(t) {
           for (let i = 0; i < 2; i += 1) await t.send(\`turn \${i}\`);
           t.check(true, equals(true));
         } });`,
      ),
      forEachPartialEval(0),
      forEachPartialEval(1),
      forEachPartialEval(33),
      writeFile(
        join(cwd, "evals", "timing-pages.eval.ts"),
        `import { defineEval } from "niceeval";
         export default defineEval({ async test(t) {
           for (let index = 0; index < 140; index += 1) await t.sandbox.runCommand("printf", [\`t\${index}\`]);
         } });`,
      ),
      writeFile(
        join(cwd, "evals", "truncated-tool.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ async test(t) {
           await t.sandbox.runShell("printf 'cmd-output\\n'");
           await t.send("run tool");
           t.check(true, equals(true));
         } });`,
      ),
      writeFile(
        join(cwd, "experiments", "execution-trace.ts"),
        `import { defineExperiment } from "niceeval"; import { executionTraceAdapter } from "../adapters/trace.ts";
         export default defineExperiment({ adapter: executionTraceAdapter, evals: ["execution-trace"] });`,
      ),
      writeFile(
        join(cwd, "experiments", "execution-display.ts"),
        `import { defineExperiment } from "niceeval"; import { displayAdapter } from "../adapters/trace.ts";
         export default defineExperiment({ adapter: displayAdapter, evals: ["execution-display"] });`,
      ),
      writeFile(
        join(cwd, "experiments", "conversation.ts"),
        `import { defineExperiment } from "niceeval"; import { conversationAgent } from "../adapters/trace.ts";
         export default defineExperiment({ adapter: conversationAgent, evals: ["conversation"] });`,
      ),
      writeFile(
        join(cwd, "experiments", "partial-trace.ts"),
        `import { defineExperiment } from "niceeval"; import { partialTraceAdapter } from "../adapters/trace.ts";
         export default defineExperiment({ adapter: partialTraceAdapter, evals: ["partial-0", "partial-1", "partial-33"] });`,
      ),
      writeFile(
        join(cwd, "experiments", "timing-pages.ts"),
        `import { defineExperiment } from "niceeval"; import sandbox from "../sandbox.ts"; import { truncatedToolAgent } from "../adapters/trace.ts";
         export default defineExperiment({ adapter: truncatedToolAgent, sandbox, evals: ["timing-pages"], attempts: 2 });`,
      ),
      writeFile(
        join(cwd, "experiments", "truncated-tool.ts"),
        `import { defineExperiment } from "niceeval"; import sandbox from "../sandbox.ts"; import { truncatedToolAgent } from "../adapters/trace.ts";
         export default defineExperiment({ adapter: truncatedToolAgent, sandbox, evals: ["truncated-tool"] });`,
      ),
    ]);

    function forEachPartialEval(count: number) {
      return writeFile(
        join(cwd, "evals", `partial-${count}.eval.ts`),
        `import { equals } from "niceeval/expect"; import { partialTraceAdapter } from "../adapters/trace.ts";
         export default partialTraceAdapter.defineEval({ async test(t) { t.check(await t.archive(${count}), equals(true)); } });`,
      );
    }

    const experimentIds = ["execution-trace", "execution-display", "conversation", "partial-trace", "timing-pages", "truncated-tool"];
    const result = await runProjectExperiments(cwd, experimentIds);
    const runs = await Promise.all(result.receipt.createdRunIds.map(async (runId) =>
      (await Effect.runPromise(runHost.get({ cwd, runId }))).run,
    ));
    const slots = new Map(runs.map((run) => [run.experimentId, run.slots]));
    function publishedLocator(experimentId: string, evalId = experimentId, index = 0) {
      const slot = slots.get(experimentId)?.filter((item) => item.evalId === evalId)[index];
      if (slot?.publication.state !== "published") throw new Error(`Expected published slot for ${experimentId}/${evalId}`);
      return slot.publication.attemptLocator;
    }

    executionLocator = publishedLocator("execution-trace");
    [eventIdOutsideIndex, evidenceId, missingNativeEventId] = (
      await readFile(join(cwd, "execution-selectors.txt"), "utf8")
    ).split("\n") as [string, string, string];
    displayLocator = publishedLocator("execution-display");
    conversationLocator = publishedLocator("conversation");
    partialEmptyLocator = publishedLocator("partial-trace", "partial-0");
    partialSingleLocator = publishedLocator("partial-trace", "partial-1");
    partialPagedLocator = publishedLocator("partial-trace", "partial-33");

    timingLocator = publishedLocator("timing-pages");
    otherTimingLocator = publishedLocator("timing-pages", "timing-pages", 1);
    toolAgentLocator = publishedLocator("truncated-tool");

    const portableRecord = join(cwd, "portable-trace.sqlite");
    await copyFile(join(cwd, ".niceeval", "record.sqlite"), portableRecord);
    await rm(join(cwd, ".niceeval"), { recursive: true, force: true });
    // Every rule reads the same immutable relocated Record. Validate and pin it once.
    facts = await Effect.runPromise(openInspectionSource(externalInspectionSource(cwd, portableRecord)).pipe(Scope.provide(recordScope)));
  }, 60_000);

  afterAll(async () => {
    try {
      await Effect.runPromise(Scope.close(recordScope, Exit.void));
    } finally {
      if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
    }
  });

  // @feature docs/feature/inspection/README.md#portable-trace
  test("relocated trace outlines remain bounded and page through events", () => {
    const outline = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: executionLocator,
    }).trace.execution;
    expect(outline.state).toBe("complete");
    expect(outline.events).toHaveLength(32);
    expect(outline.omittedEventCount).toBe(971);
    expect(outline.hasMore).toBe(true);
    expect(outline.identityIndex.eventIds).not.toContain(eventIdOutsideIndex);
    expect(Buffer.byteLength(JSON.stringify(outline))).toBeLessThan(128 * 1024);

    const page2 = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: executionLocator,
      continuation: outline.continuation,
    }).trace.execution;
    expect(page2.events[0]).toMatchObject({ ordinal: 32, summary: "Observed event 32" });

  });

  // @feature docs/feature/inspection/README.md#portable-trace
  test("relocated event pages keep exact filters across continuations", () => {
    const filtered = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: executionLocator,
      actorId: "actor-a",
      eventType: "position.observed",
    }).trace.execution;
    expect(filtered.events.map((event) => event.ordinal)).toEqual(
      Array.from({ length: 32 }, (_, index) => 2 + index * 2),
    );
    expect(filtered.hasMore).toBe(true);

    const filteredPage2 = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: executionLocator,
      actorId: "actor-a",
      eventType: "position.observed",
      continuation: filtered.continuation,
    }).trace.execution;
    expect(filteredPage2.events.map((event) => event.ordinal)).toEqual(
      Array.from({ length: 32 }, (_, index) => 66 + index * 2),
    );

    // Changing filter while keeping continuation must fail with restart-required.
    expectOperationCode(
      () =>
        selectInspectionOperation(facts, {
          kind: "attempt.trace",
          locator: executionLocator,
          actorId: "actor-a",
          eventType: "operation.completed",
          continuation: filtered.continuation,
        }),
      "restart-required",
    );

  });

  // @feature docs/feature/inspection/README.md#portable-trace
  test("relocated conversation pages preserve unique events across Turns", () => {
    const convPage = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: conversationLocator,
      actorId: "assistant",
    }).trace.execution;
    expect(convPage.events).toHaveLength(32);
    expect(convPage.hasMore).toBe(true);
    const convNext = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: conversationLocator,
      actorId: "assistant",
      continuation: convPage.continuation,
    }).trace.execution;
    const allIds = [...convPage.events, ...convNext.events].map((event) => event.eventId);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  // @feature docs/feature/inspection/README.md#portable-trace
  test("relocated evidence chunks and out-of-index event details resolve accurately", () => {
    // Exact detail lookup outside identityIndex preserves __proto__ domain keys.
    const domainDetail = selectInspectionOperation(facts, {
      kind: "attempt.trace.detail",
      locator: executionLocator,
      selector: { kind: "execution-event", eventId: missingNativeEventId },
    }).detail;
    expect(domainDetail).toMatchObject({
      kind: "execution-event",
      event: { key: "1001", payload: { code: "inspection-result-invalid", reason: "domain-value" } },
    });
    expect(JSON.stringify(domainDetail)).toContain('"__proto__":{"domain":"preserved"}');

    // Evidence chunk pagination with fast-check offsets.
    const firstRange = selectInspectionOperation(facts, {
      kind: "attempt.trace.detail",
      locator: executionLocator,
      selector: { kind: "execution-evidence", evidenceId, offset: 0, limit: 256 * 1024 },
    }).detail;
    if (firstRange.kind !== "execution-evidence") throw new Error("Expected execution-evidence");
    expect(firstRange.nextOffset).toBe(256 * 1024);

    fc.assert(
      fc.property(fc.integer({ min: 0, max: firstRange.targetByteLength - 1 }), (offset) => {
        const slice = selectInspectionOperation(facts, {
          kind: "attempt.trace.detail",
          locator: executionLocator,
          selector: { kind: "execution-evidence", evidenceId, offset, limit: 1024 },
        }).detail;
        if (slice.kind !== "execution-evidence") throw new Error("Expected execution-evidence");
        expect(slice.targetSha256).toBe(firstRange.targetSha256);
        expect(Buffer.from(slice.base64, "base64").byteLength).toBe(
          Math.min(1024, firstRange.targetByteLength - offset),
        );
      }),
      { numRuns: 3, seed: 2030 },
    );
  });

  // @feature docs/feature/inspection/README.md#portable-trace
  test("display previews stay bounded at codepoint boundaries and expand to full blocks and artifacts", () => {
    const execution = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: displayLocator,
    }).trace.execution;
    expect(execution.events).toHaveLength(4);
    for (const event of execution.events) {
      expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThanOrEqual(8 * 1024);
    }

    const long = execution.events.find((event) => event.type === "log.created")!;
    expect(long.display).toMatchObject({
      state: "present",
      blocks: [
        { kind: "text", text: { preview: "界".repeat(341), omittedBytes: 177 } },
        { kind: "code", language: "shell", text: { omittedBytes: 0 } },
        { kind: "fields", fields: [{ label: "body", value: { preview: "😀".repeat(256), omittedBytes: 176 } }] },
      ],
    });

    const fullDetail = selectInspectionOperation(facts, {
      kind: "attempt.trace.detail",
      locator: displayLocator,
      selector: { kind: "execution-event", eventId: long.eventId },
    }).detail;
    expect(fullDetail).toMatchObject({
      kind: "execution-event",
      event: {
        display: [
          { kind: "text", text: "界".repeat(400) },
          { kind: "code", language: "shell", text: `printf '${"x".repeat(100)}'\n\tprintf 'tail-sentinel'  ` },
          { kind: "fields", fields: [{ label: "body", value: "😀".repeat(300) }] },
        ],
      },
    });

    const imageEvent = execution.events.find((event) => event.type === "frame.rendered")!;
    if (imageEvent.display.state !== "present") throw new Error("Expected image display");
    const imageBlock = imageEvent.display.blocks[0]!;
    if (imageBlock.kind !== "image") throw new Error("Expected image block");
    expect(imageBlock).toMatchObject({
      alt: "Guard blocks the gate at dusk",
      mediaType: "image/png",
      byteLength: expectedImageBytes.byteLength,
      sha256: expectedImageSha256,
    });

    const artifact = selectInspectionOperation(facts, {
      kind: "attempt.artifact",
      locator: displayLocator,
      artifactId: imageBlock.artifactId as ArtifactId,
    }).artifact;
    expect(artifact.state).toBe("available");
    if (artifact.state === "available") {
      expect(Buffer.from(artifact.base64, "base64")).toEqual(expectedImageBytes);
    }
  });

  // @feature docs/feature/inspection/README.md#portable-trace
  test("producer partial collections, tool truncation, and timing pages survive Record relocation", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { locator: partialEmptyLocator, firstCount: 0, omitted: 0 },
          { locator: partialSingleLocator, firstCount: 1, omitted: 0 },
          { locator: partialPagedLocator, firstCount: 32, omitted: 1 },
        ),
        ({ locator, firstCount, omitted }) => {
          const page = selectInspectionOperation(facts, { kind: "attempt.trace", locator }).trace.execution;
          expect(page.state).toBe("complete");
          expect(page.events).toHaveLength(firstCount);
          expect(page.omittedEventCount).toBe(omitted);
          expect(page.traces[0]?.collection).toEqual({
            state: "partial",
            limitations: [
              {
                code: "producer-stream-interrupted",
                message: "Upstream journal ended before final acknowledgement.",
              },
            ],
          });
          if (omitted > 0) {
            const last = selectInspectionOperation(facts, {
              kind: "attempt.trace",
              locator,
              continuation: page.continuation,
            }).trace.execution;
            expect(last.events).toHaveLength(1);
            expect(last.hasMore).toBe(false);
            expect(last.traces[0]?.collection.state).toBe("partial");
          }
        },
      ),
      { numRuns: 3, seed: 2031 },
    );

    // Zero-match filter on partial trace still preserves producer partial collection limitations.
    const zeroMatch = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: partialSingleLocator,
      actorId: "absent-actor",
      eventType: "observation.recorded",
    }).trace.execution;
    expect(zeroMatch.events).toEqual([]);
    expect(zeroMatch.traces[0]?.collection.state).toBe("partial");

    // Tool payload exceeds the Record inline threshold and remains readable from both detail locators.
    const toolTrace = selectInspectionOperation(facts, {
      kind: "attempt.trace",
      locator: toolAgentLocator,
    }).trace;
    const toolOccurrenceId = toolTrace.identityIndex.toolOccurrenceIds.ids[0]!;
    const toolDetail = selectInspectionOperation(facts, {
      kind: "attempt.trace.detail",
      locator: toolAgentLocator,
      selector: { kind: "tool-occurrence", toolOccurrenceId },
    }).detail;
    if (toolDetail.kind !== "tool-occurrence") throw new Error("Expected tool-occurrence");
    if (toolDetail.result?.kind !== "tool-result") throw new Error("Expected tool-result");
    const expectedOutput = JSON.stringify({ content: "工具输出".repeat(9000) });
    expect(Buffer.byteLength(expectedOutput)).toBeGreaterThan(64 * 1024);
    expect(toolDetail.result.output).toBe(expectedOutput);
    expect(toolDetail.result.outputTruncation).toBeUndefined();
    const itemDetail = selectInspectionOperation(facts, {
      kind: "attempt.trace.detail",
      locator: toolAgentLocator,
      selector: { kind: "item", itemId: toolDetail.result.itemId },
    }).detail;
    expect(itemDetail).toMatchObject({
      kind: "item",
      item: { output: expectedOutput },
    });
    const commandId = toolTrace.commands.items[0]!.commandId;
    const commandDetail = selectInspectionOperation(facts, {
      kind: "attempt.trace.detail",
      locator: toolAgentLocator,
      selector: { kind: "command", commandId },
    }).detail;
    expect(commandDetail).toMatchObject({ kind: "command" });

    // Timing pagination across all pages and cross-attempt continuation rejection.
    const timingFirst = selectInspectionOperation(facts, {
      kind: "attempt.timing",
      locator: timingLocator,
    }).timing;
    expect(timingFirst.hasMore).toBe(true);
    const activities = [...timingFirst.activities];
    let page = timingFirst;
    while (page.hasMore) {
      page = selectInspectionOperation(facts, {
        kind: "attempt.timing",
        locator: timingLocator,
        continuation: page.continuation,
      }).timing;
      activities.push(...page.activities);
    }
    expect(page.omittedActivityCount).toBe(0);
    expect(new Set(activities.map((item) => item.activityId)).size).toBe(activities.length);
    expectOperationCode(
      () =>
        selectInspectionOperation(facts, {
          kind: "attempt.timing",
          locator: otherTimingLocator,
          continuation: timingFirst.continuation,
        }),
      "restart-required",
    );
  });
});
