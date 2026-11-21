import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { judgeUsageChatResponse, startJudgeUsageEmulator } from "../integration/fixtures/inspection-core/judge-http.ts";
import { startModelEmulator } from "../integration/fixtures/model-emulator.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");
const { runCliInProcess } =
  require("./src/cli/in-process.ts") as typeof import("../../packages/niceeval/src/cli/in-process.ts");
const { decodeInspectionDocument } =
  require("niceeval/inspection") as typeof import("../../packages/niceeval/src/inspection/public.ts");

const SANDBOX_FIXTURE = fileURLToPath(
  new URL("../integration/fixtures/inspection-core/sandbox.ts.txt", import.meta.url),
);

async function writeSandboxFixture(cwd: string) {
  const dependencies = join(cwd, "node_modules");
  await mkdir(dependencies, { recursive: true });
  await symlink(dirname(require.resolve("effect/package.json")), join(dependencies, "effect"), "junction");
  await writeFile(join(cwd, "sandbox.ts"), await readFile(SANDBOX_FIXTURE, "utf8"));
}

async function runCli(cwd: string, argv: readonly string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
  stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
  const code = await runCliInProcess({
    argv: [...argv],
    cwd,
    env: { NO_COLOR: "1" },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  stdout.end();
  stderr.end();
  return {
    code,
    stdout: Buffer.concat(outChunks).toString("utf8"),
    stderr: Buffer.concat(errChunks).toString("utf8"),
  };
}

function decodeNdjson(stdout: string) {
  const lines = stdout.split("\n");
  expect(lines.pop()).toBe("");
  return lines.map((line) => {
    const decoded = decodeInspectionDocument(JSON.parse(line));
    if (!decoded.success) throw new Error(decoded.reason);
    return decoded.value;
  });
}

async function runProjectExperiment(cwd: string, experimentSelector: string) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector,
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan ${experimentSelector}: ${JSON.stringify(planned)}`);
  return Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
}

async function publishedSlotLocators(cwd: string, runId: string) {
  const detail = await Effect.runPromise(runHost.get({ cwd, runId }));
  return new Map(
    detail.run.slots.flatMap((slot) =>
      slot.publication.state === "published" ? ([[slot.evalId, slot.publication.attemptLocator]] as const) : [],
    ),
  );
}

describe("CLI show aspects, JSON lines, links, compare, and diagnostics", () => {
  let cwd: string;
  let mainRunId: string;
  let altRunId: string;
  let erroredLocator: string;
  let populatedLocator: string;
  let rolesLocator: string;
  let traceLocator: string;
  let displayLocator: string;
  let partialTraceLocator: string;
  let diffLocator: string;
  let imageLocator: string;
  let imageEntryId: string;
  let imageId: string;
  let judgeQaLocator: string;
  let judgeQaEntryId: string;
  let judgeCausesLocator: string;
  let judgeEmptyLocator: string;
  let stoppedLocator: string;
  let unsealedLocator: string;
  let pricingFile: string;
  let artifactId: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-cli-"));
    await Promise.all(["evals", "experiments", "adapters"].map((dir) => mkdir(join(cwd, dir))));
    const fixture = await startJudgeUsageEmulator([
      {
        status: 200,
        body: judgeUsageChatResponse({
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 20 },
        }),
      },
      {
        status: 200,
        body: judgeUsageChatResponse({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, { screenshot: true }),
      },
    ]);
    const verdictCausesFixture = await startModelEmulator([
      {
        id: "offline-judge",
        match: { model: "offline" },
        error: { status: 502, message: "Offline Judge unavailable", headers: { "Retry-After": "0" } },
      },
    ]);
    const { baseUrl } = fixture;
    const { baseUrl: verdictCausesUrl } = verdictCausesFixture;
    try {
      await Promise.all([
        writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
        writeSandboxFixture(cwd),
        writeFile(
          join(cwd, "niceeval.config.ts"),
          `import { defineConfig } from "niceeval";
           export default defineConfig({ timeoutMs: 60_000, maxConcurrency: 1, pricing: { "inspection-fixture-v1": { inputPerMTok: 1, outputPerMTok: 2 } } });`,
        ),
        writeFile(
          join(cwd, "adapters", "show.ts"),
          `
          import { defineAdapter } from "niceeval";
          import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
          import { defineMaterialMatch, defineValueMatch, equals } from "niceeval/expect";
          import { shell } from "niceeval/sandbox";
          export const plainAdapter = defineAdapter({
            name: "show-fixture",
            behaviorRevision: "1",
            create: (ctx) => ({
              attachSmall: () => ctx.attach({ name: "note.txt", mediaType: "text/plain", body: "hello-artifact" }),
              noteValue: (label: string, val: number) => undefined,
            }),
            assertions: ({ check }) => ({ ready: () => check(1, equals(1)) }),
          });
          export const unsealedAdapter = defineAdapter({ name: "unsealed", behaviorRevision: "1", create: () => ({}) });
          export const partialTraceAdapter = defineAdapter({
            name: "partial-trace",
            behaviorRevision: "1",
            create(ctx) {
              return {
                async archive() {
                  await ctx.recordTrace({
                    traceId: "partial-journal",
                    schema: { id: "example.telemetry" },
                    collection: { state: "partial", limitations: [{ code: "producer-stream-interrupted", message: "Upstream journal ended before final acknowledgement." }] },
                    scopes: [],
                    events: [{ key: "0", type: "observation.recorded", source: { id: "journal", sequence: 0 }, actor: { id: "observer", label: "Observer" }, summary: "Retained observation 0" }],
                  });
                  return true;
                },
              };
            },
          });
          export const displayAdapter = defineAdapter({
            name: "display",
            behaviorRevision: "1",
            create(ctx) {
              return {
                async archive() {
                  await ctx.recordTrace({
                    traceId: "app-display",
                    schema: { id: "example.app/v1" },
                    collection: { state: "complete", limitations: [] },
                    scopes: [],
                    events: [
                      {
                        key: "npc", type: "npc.said", source: { id: "game" },
                        actor: { id: "npc:guard", label: "\\u001bGuard\\u202e" },
                        summary: "\\u001bNPC dialogue\\u202e",
                        display: [{ kind: "message", role: "other", speaker: "Guard", text: "Halt!" }],
                      },
                      {
                        key: "long", type: "log.created", source: { id: "logger" },
                        summary: "Long Unicode display",
                        display: [
                          { kind: "text", text: "界".repeat(400) },
                          { kind: "code", language: "shell", text: \`printf '\${"x".repeat(100)}'\` },
                        ],
                      },
                    ],
                  });
                  return true;
                },
              };
            },
          });
          export const judgeAppAdapter = defineAdapter({
            name: "judge-app",
            behaviorRevision: "1",
            create(ctx) {
              ctx.diagnostic({ code: "inspection-advisory", level: "warning", message: "Optional telemetry unavailable" });
              return {
                history() { return [{ id: "answer-1", value: "Paris is the capital of France." }]; },
                recordAppUsage() {
                  ctx.recordUsage({
                    callId: "application-1", provider: "offline-application", model: "application-model", status: "succeeded",
                    inputTokens: 4, inputTotalTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
                    cost: { amount: "0.25", currency: "USD", source: { kind: "reported", id: "offline-application.response" } },
                  });
                  ctx.sealUsage({ state: "complete" });
                },
              };
            },
          });
          const answer = defineValueMatch<string>({ name: "answer-present", evaluate: (text) => text.length > 0 });
          type HistoryCtx = { history(): readonly { id: string; value: string }[] };
          export const historyMatch = defineMaterialMatch<HistoryCtx, string>({
            name: "answer-history", read: (ctx) => ({ state: "complete", items: ctx.history() }), match: answer,
          });
          export const emptyHistoryMatch = defineMaterialMatch<HistoryCtx, string>({
            name: "empty-history", read: () => ({ state: "complete", items: [] }), match: answer,
          });
          export const toolAgent = defineSandboxAgent({
            name: "tool-agent",
            evidenceCoverage: completeEvidenceCoverage,
            install: { identity: { agent: "tool-agent", version: "1", revision: "1" }, probe: shell("true") },
            async send(_input, ctx) {
              await ctx.sandbox.writeText("small.txt", "after\\n");
              ctx.recordUsage?.({
                callId: "agent-1", provider: "fixture", model: "fixture/model", status: "succeeded",
                inputTokens: 10, inputTotalTokens: 10, outputTokens: 5,
              });
              return {
                status: "completed",
                events: [
                  { type: "operation.started", operationId: "op-1", operation: { kind: "tool", name: "inspection_fixture", input: { content: "x" } } },
                  { type: "operation.finished", operationId: "op-1", kind: "tool", output: { content: "工具输出".repeat(9000) }, status: "completed" },
                  { type: "message", role: "assistant", text: "Done." },
                ],
              };
            },
          });
          export const passAgent = defineAgent({ name: "pass-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
        `,
        ),
        writeFile(
          join(cwd, "evals", "errored.eval.ts"),
          `import { plainAdapter } from "../adapters/show.ts";
           export default plainAdapter.defineEval({ test() { throw new Error("Fixture failed in eval.run"); } });`,
        ),
        writeFile(
          join(cwd, "evals", "populated.eval.ts"),
          `import { plainAdapter } from "../adapters/show.ts";
           export default plainAdapter.defineEval({ async test(t) {
             await t.attachSmall();
             t.ready().label("First");
             t.ready().label("Second");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "notes-unitless.eval.ts"),
          `import { plainAdapter } from "../adapters/show.ts";
           export default plainAdapter.defineEval({ test(t) {
             t.note("latency", 42);
             t.ready().label("Unitless note");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "roles.eval.ts"),
          `import { defineScoreEval } from "niceeval"; import { equals } from "niceeval/expect";
           export default defineScoreEval({ async test(t) {
             t.check(true, equals(true)).gate().label("installed");
             t.check(true, equals(true)).score(1).label("created");
             t.check(false, equals(true)).score(2).label("docs");
             t.check(false, equals(true)).gate().score(1).label("lockfile");
             t.check(true, equals(true)).label("used cli");
             await t.check(false, equals(true)).label("stop only").orStop();
             t.check(false, equals(true)).gate().label("skipped after stop");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "stopped.eval.ts"),
          `import { defineScoreEval } from "niceeval"; import { equals } from "niceeval/expect";
           export default defineScoreEval({ async test(t) {
             t.score(1).label("earned");
             await t.check(false, equals(true)).label("stop only").orStop();
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "trace.eval.ts"),
          `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
           export default defineEval({ async test(t) {
             await t.sandbox.writeText("small.txt", "before\\n");
             await t.sandbox.runShell("printf 'cmd-output\\n'");
             await t.send("run tool");
             t.check(true, equals(true)).label("ok");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "display.eval.ts"),
          `import { equals } from "niceeval/expect"; import { displayAdapter } from "../adapters/show.ts";
           export default displayAdapter.defineEval({ async test(t) { t.check(await t.archive(), equals(true)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "partial-trace.eval.ts"),
          `import { equals } from "niceeval/expect"; import { partialTraceAdapter } from "../adapters/show.ts";
           export default partialTraceAdapter.defineEval({ async test(t) { t.check(await t.archive(), equals(true)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "judge-qa.eval.ts"),
          `import { judgeAppAdapter, historyMatch } from "../adapters/show.ts";
           export default judgeAppAdapter.defineEval({ test(t) {
             t.recordAppUsage();
             t.closeQA(historyMatch, "Does the answer name the capital of France?").gate(1).label("Answer QA");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "judge-image.eval.ts"),
          `import { defineJudge } from "niceeval/expect"; import { judgeImage } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/show.ts";
           const quality = defineJudge({ rubric: "Assess screenshot." });
           export default judgeAppAdapter.defineScoreEval({ test(t) {
             t.judge({ screenshot: judgeImage({
               body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"),
               mediaType: "image/png",
             }) }, quality).score(1).label("Screenshot");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "verdict-causes.eval.ts"),
          `import { judgeAppAdapter, historyMatch } from "../adapters/show.ts";
           export default judgeAppAdapter.defineScoreEval({ test(t) {
             t.closeQA(historyMatch, "First?").score(1).label("First required review");
             t.closeQA(historyMatch, "Second?").score(1).label("Second required review");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "judge-empty.eval.ts"),
          `import { judgeAppAdapter, emptyHistoryMatch } from "../adapters/show.ts";
           export default judgeAppAdapter.defineEval({ test(t) {
             t.recordAppUsage();
             t.closeQA(emptyHistoryMatch, "Question?").label("Empty QA");
           } });`,
        ),
        writeFile(
          join(cwd, "evals", "unsealed.eval.ts"),
          `import { equals } from "niceeval/expect"; import { unsealedAdapter } from "../adapters/show.ts";
           export default unsealedAdapter.defineEval({ test(t) { t.check(1, equals(1)); } });`,
        ),
        writeFile(
          join(cwd, "evals", "cmp-pass.eval.ts"),
          `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
           export default defineEval({ test(t) { t.check(true, equals(true)).label("cmp"); } });`,
        ),
        writeFile(
          join(cwd, "experiments", "show.ts"),
          `import { defineExperiment } from "niceeval"; import { plainAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: plainAdapter, evals: ["errored", "populated"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "roles.ts"),
          `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/show.ts";
           export default defineExperiment({ adapter: passAgent, evals: ["roles"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "stopped.ts"),
          `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/show.ts";
           export default defineExperiment({ adapter: passAgent, evals: ["stopped"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "trace.ts"),
          `import { defineExperiment } from "niceeval"; import sandbox from "../sandbox.ts"; import { toolAgent } from "../adapters/show.ts";
           export default defineExperiment({ adapter: toolAgent, sandbox, evals: ["trace"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "display.ts"),
          `import { defineExperiment } from "niceeval"; import { displayAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: displayAdapter, evals: ["display"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "partial-trace.ts"),
          `import { defineExperiment } from "niceeval"; import { partialTraceAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: partialTraceAdapter, evals: ["partial-trace"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-qa.ts"),
          `import { defineExperiment } from "niceeval"; import { VercelProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-qa"], judge: VercelProvider({ model: "inspection-fixture-v1", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-image.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-image"], judge: OpenRouterProvider({ model: "inspection-fixture-v1", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "verdict-causes.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["verdict-causes"], judge: OpenRouterProvider({ model: "offline", apiKey: "offline", baseUrl: ${JSON.stringify(verdictCausesUrl)}, timeoutMs: 1_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "judge-empty.ts"),
          `import { defineExperiment } from "niceeval"; import { OpenRouterProvider } from "niceeval/judge"; import { judgeAppAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: judgeAppAdapter, evals: ["judge-empty"], judge: OpenRouterProvider({ model: "inspection-fixture-v1", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }) });`,
        ),
        writeFile(
          join(cwd, "experiments", "unsealed.ts"),
          `import { defineExperiment } from "niceeval"; import { unsealedAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: unsealedAdapter, evals: ["unsealed"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "notes-unitless.ts"),
          `import { defineExperiment } from "niceeval"; import { plainAdapter } from "../adapters/show.ts";
           export default defineExperiment({ adapter: plainAdapter, evals: ["notes-unitless"] });`,
        ),
        writeFile(
          join(cwd, "experiments", "cmp-exp.ts"),
          `import { defineExperiment } from "niceeval"; import { passAgent } from "../adapters/show.ts";
           export default defineExperiment({ adapter: passAgent, evals: ["cmp-pass"] });`,
        ),
      ]);

      const showRes = await runProjectExperiment(cwd, "show");
      mainRunId = showRes.receipt.createdRunIds[0]!;
      const showLocators = await publishedSlotLocators(cwd, mainRunId);
      erroredLocator = showLocators.get("errored")!;
      populatedLocator = showLocators.get("populated")!;

      const rolesRun = await runProjectExperiment(cwd, "roles");
      rolesLocator = (await publishedSlotLocators(cwd, rolesRun.receipt.createdRunIds[0]!)).get("roles")!;

      const stoppedRun = await runProjectExperiment(cwd, "stopped");
      stoppedLocator = (await publishedSlotLocators(cwd, stoppedRun.receipt.createdRunIds[0]!)).get("stopped")!;

      const traceRun = await runProjectExperiment(cwd, "trace");
      traceLocator = (await publishedSlotLocators(cwd, traceRun.receipt.createdRunIds[0]!)).get("trace")!;
      diffLocator = traceLocator;

      const displayRun = await runProjectExperiment(cwd, "display");
      displayLocator = (await publishedSlotLocators(cwd, displayRun.receipt.createdRunIds[0]!)).get("display")!;

      const partialRun = await runProjectExperiment(cwd, "partial-trace");
      partialTraceLocator = (await publishedSlotLocators(cwd, partialRun.receipt.createdRunIds[0]!)).get(
        "partial-trace",
      )!;

      const judgeQaRun = await runProjectExperiment(cwd, "judge-qa");
      judgeQaLocator = (await publishedSlotLocators(cwd, judgeQaRun.receipt.createdRunIds[0]!)).get("judge-qa")!;

      const judgeImgRun = await runProjectExperiment(cwd, "judge-image");
      imageLocator = (await publishedSlotLocators(cwd, judgeImgRun.receipt.createdRunIds[0]!)).get("judge-image")!;

      const causesRun = await runProjectExperiment(cwd, "verdict-causes");
      judgeCausesLocator = (await publishedSlotLocators(cwd, causesRun.receipt.createdRunIds[0]!)).get(
        "verdict-causes",
      )!;

      const judgeEmptyRun = await runProjectExperiment(cwd, "judge-empty");
      judgeEmptyLocator = (await publishedSlotLocators(cwd, judgeEmptyRun.receipt.createdRunIds[0]!)).get(
        "judge-empty",
      )!;

      const unsealedRun = await runProjectExperiment(cwd, "unsealed");
      unsealedLocator = (await publishedSlotLocators(cwd, unsealedRun.receipt.createdRunIds[0]!)).get("unsealed")!;

      await runProjectExperiment(cwd, "notes-unitless");
      await runProjectExperiment(cwd, "cmp-exp");
      await writeFile(
        join(cwd, "evals", "cmp-pass.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ test(t) { t.check(false, equals(true)).label("cmp"); } });`,
      );
      altRunId = (await runProjectExperiment(cwd, "cmp-exp")).receipt.createdRunIds[0]!;

      pricingFile = join(cwd, "pricing.json");
      await writeFile(
        pricingFile,
        JSON.stringify({
          "application-model": { inputPerMTok: 2, outputPerMTok: 8, source: { id: "v1" } },
          "inspection-fixture-v1": { inputPerMTok: 2, outputPerMTok: 8, source: { id: "v1" } },
        }),
      );

      const artList = await runCli(cwd, ["show", populatedLocator, "artifacts", "--json"]);
      const artDoc = decodeNdjson(artList.stdout)[0]!;
      if (artDoc.outcome !== "success" || artDoc.operation !== "attempt.artifacts" || artDoc.artifacts.state !== "available") {
        throw new Error("Expected artifact list");
      }
      artifactId = artDoc.artifacts.value.artifacts[0]!.artifactId;

      const qaDoc = decodeNdjson((await runCli(cwd, ["show", judgeQaLocator, "--json"])).stdout)[0]!;
      if (qaDoc.outcome !== "success" || qaDoc.operation !== "attempt.get") throw new Error("Expected judgeQa attempt");
      judgeQaEntryId = qaDoc.attempt.assertions.entries[0]!.entryId;

      const imgDoc = decodeNdjson((await runCli(cwd, ["show", imageLocator, "--json"])).stdout)[0]!;
      if (imgDoc.outcome !== "success" || imgDoc.operation !== "attempt.get") throw new Error("Expected image attempt");
      imageEntryId = imgDoc.attempt.assertions.entries[0]!.entryId;
      const imgDetail = decodeNdjson((await runCli(cwd, ["show", imageLocator, imageEntryId, "--full", "--json"])).stdout)[0]!;
      if (
        imgDetail.outcome !== "success" ||
        imgDetail.operation !== "attempt.assertion.detail" ||
        !("entry" in imgDetail.assertion) ||
        !("scoreMatchAudit" in imgDetail.assertion.entry) ||
        imgDetail.assertion.entry.scoreMatchAudit?.state !== "available" ||
        imgDetail.assertion.entry.scoreMatchAudit.audit.kind !== "images"
      ) {
        throw new Error("Expected image detail");
      }
      imageId = imgDetail.assertion.entry.scoreMatchAudit.audit.images[0]!.imageId;
    } finally {
      await Promise.all([fixture.close(), verdictCausesFixture.close()]);
      await expect(fetch(baseUrl)).rejects.toThrow();
      await expect(fetch(verdictCausesUrl)).rejects.toThrow();
    }
  }, 60_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  const aspectOperations = {
    execution: "attempt.trace",
    timing: "attempt.timing",
    usage: "attempt.usage",
    diff: "attempt.diff",
    source: "attempt.sources",
    artifacts: "attempt.artifacts",
    assertions: "attempt.assertions",
  } as const;

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("each show aspect emits one machine document for an errored Attempt", async () => {
    const aspects = Object.keys(aspectOperations) as (keyof typeof aspectOperations)[];
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...aspects), { minLength: 1, maxLength: 3 }), async (queries) => {
        for (const aspect of queries) {
          const result = await runCli(cwd, ["show", erroredLocator, aspect, "--json"]);
          expect(result.code, result.stderr).toBe(0);
          const documents = decodeNdjson(result.stdout);
          expect(documents.map(({ operation, outcome }) => ({ operation, outcome }))).toEqual([
            { operation: aspectOperations[aspect], outcome: "success" },
          ]);
          if (aspect === "assertions") {
            expect(documents[0]).toMatchObject({
              assertions: [],
              links: [{ rel: "execution", command: `niceeval show ${erroredLocator} execution` }],
            });
          }
        }
      }),
      { seed: 42, numRuns: 12, examples: aspects.map((aspect) => [[aspect]]) },
    );
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  // @use-case docs/feature/inspection/use-case/inspection-show-as-json.md#attempt-assertions
  test("show lists populated assertions in Attempt order and links to exact details", async () => {
    const listRes = await runCli(cwd, ["show", populatedLocator, "assertions", "--json"]);
    expect(listRes.code, listRes.stderr).toBe(0);
    const [list] = decodeNdjson(listRes.stdout);
    if (list?.outcome !== "success" || list.operation !== "attempt.assertions") {
      throw new Error(`Expected assertion list, got ${JSON.stringify(list)}`);
    }
    expect(list.assertions).toMatchObject([
      { projection: "compact", display: { label: "First" } },
      { projection: "compact", display: { label: "Second" } },
    ]);
    expect(list.links).toEqual(
      list.assertions.map(({ entryId }) => ({
        rel: "assertion",
        command: `niceeval show ${populatedLocator} ${entryId} --full`,
      })),
    );
    const [entry] = list.assertions;
    const detailRes = await runCli(cwd, ["show", populatedLocator, entry!.entryId, "--json"]);
    expect(detailRes.code, detailRes.stderr).toBe(0);
    const [detail] = decodeNdjson(detailRes.stdout);
    expect(detail).toMatchObject({
      outcome: "success",
      operation: "attempt.assertion.detail",
      assertion: entry,
      publicationCutoff: list.publicationCutoff,
    });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("show explains the empty assertion list and links to execution in text mode", async () => {
    const result = await runCli(cwd, ["show", erroredLocator, "assertions"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("No Assertion entries recorded");
    expect(result.stdout).toContain(`Next\n  niceeval show ${erroredLocator} execution\n`);
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("show --json covers operational resource operations, --explain, and reprice", async () => {
    const cases: readonly { readonly argv: readonly string[]; readonly ops: readonly string[] }[] = [
      { argv: ["runs"], ops: ["run.list"] },
      { argv: [`run:${mainRunId}`], ops: ["run.get"] },
      { argv: ["exp:show"], ops: ["experiment.get"] },
      { argv: ["exp:show", "assertions"], ops: ["experiments.assertions"] },
      { argv: [populatedLocator], ops: ["attempt.get", "attempt.usage"] },
      { argv: [populatedLocator, artifactId], ops: ["attempt.artifact"] },
      { argv: [judgeQaLocator, "usage", "--reprice", pricingFile], ops: ["attempt.reprice"] },
    ];
    for (const { argv, ops } of cases) {
      const res = await runCli(cwd, ["show", ...argv, "--json"]);
      expect(res.code, res.stderr).toBe(0);
      expect(decodeNdjson(res.stdout).map((doc) => doc.operation)).toEqual(ops);
    }
    const explained = await runCli(cwd, ["show", `run:${mainRunId}`, "--explain", "--json"]);
    expect(explained.code, explained.stderr).toBe(0);
    expect(decodeNdjson(explained.stdout)[0]).toMatchObject({ outcome: "explanation", operation: "run.get" });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("show text renders assertion roles, stoppedAt, verdictCauses, advisories, and entry count label", async () => {
    const rolesRes = await runCli(cwd, ["show", rolesLocator, "assertions"]);
    expect(rolesRes.code, rolesRes.stderr).toBe(0);
    expect(rolesRes.stdout).toMatch(/Verdict failed · Score 1\/4/u);
    expect(rolesRes.stdout).toMatch(/Gates 1 pass, 1 fail · Scored 3 · Notes 1 met, 1 unmet/u);
    expect(rolesRes.stdout).toMatch(/GATE\s+pass\s+.+installed/u);
    expect(rolesRes.stdout).toMatch(/SCORE\s+0\/2\s+.+docs/u);
    expect(rolesRes.stdout).toMatch(/GATE\s+fail\s+SCORE\s+0\/1\s+.+lockfile/u);
    expect(rolesRes.stdout).toMatch(/NOTE\s+unmet\s+.+stop only/u);
    expect(rolesRes.stdout).not.toMatch(/\[(?:PASS|FAIL)\]|Passed \d+, Failed \d+, Total/u);

    const stoppedRes = await runCli(cwd, ["show", stoppedLocator]);
    expect(stoppedRes.code, stoppedRes.stderr).toBe(0);
    expect(stoppedRes.stdout).toContain("Stopped at stop only; later steps did not run");

    const causesRes = await runCli(cwd, ["show", judgeCausesLocator]);
    expect(causesRes.code, causesRes.stderr).toBe(0);
    expect(causesRes.stdout.replace(/\s+/gu, " ")).toContain(
      "Errored because 2 required assertions are unavailable: judge call failed ×2",
    );
    expect(causesRes.stdout).toContain("Advisories");
    expect(causesRes.stdout.split("Advisories")[1]).toContain("inspection advisory");

    const countRes = await runCli(cwd, ["show", populatedLocator]);
    expect(countRes.code, countRes.stderr).toBe(0);
    expect(countRes.stdout).toMatch(/Summary\s+[^\n]*entries: 2/u);
    expect(countRes.stdout).not.toContain("entrys");
    expect(countRes.stdout).toContain(`Open: niceeval view ${populatedLocator}`);
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("show renders Judge rationale, cost coverage states, assertion image file, and read-deadline diagnostic", async () => {
    const qaList = await runCli(cwd, ["show", judgeQaLocator, "assertions"]);
    expect(qaList.code, qaList.stderr).toBe(0);
    expect(qaList.stdout).toContain("The answer names Paris.");

    const qaFull = await runCli(cwd, ["show", judgeQaLocator, judgeQaEntryId, "--full"]);
    expect(qaFull.code, qaFull.stderr).toBe(0);
    expect(qaFull.stdout).toContain("The answer names Paris.");

    const emptyUsage = await runCli(cwd, ["show", judgeEmptyLocator, "usage"]);
    expect(emptyUsage.code, emptyUsage.stderr).toBe(0);
    expect(emptyUsage.stdout).toContain("No Judge calls");

    const emptyAttempt = await runCli(cwd, ["show", judgeEmptyLocator]);
    expect(emptyAttempt.code, emptyAttempt.stderr).toBe(0);
    expect(emptyAttempt.stdout).toContain("Total costs");
    expect(emptyAttempt.stdout).toMatch(/Cost coverage[^\n]*Complete/u);

    const unsealedAttempt = await runCli(cwd, ["show", unsealedLocator]);
    expect(unsealedAttempt.code, unsealedAttempt.stderr).toBe(0);
    expect(unsealedAttempt.stdout).toContain("Known subtotal");
    expect(unsealedAttempt.stdout).toMatch(/Missing sources[^\n]*application/u);

    const pngOut = join(cwd, "screenshot.png");
    const imgSaved = await runCli(cwd, ["show", imageLocator, imageEntryId, "image", imageId, "--output", pngOut]);
    expect(imgSaved.code, imgSaved.stderr).toBe(0);
    expect((await readFile(pngOut)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    const imgRejected = await runCli(cwd, [
      "show",
      imageLocator,
      imageEntryId,
      "image",
      imageId,
      "--output",
      pngOut,
      "--json",
    ]);
    expect(imgRejected.code).toBe(1);
    expect(imgRejected.stdout).toBe("");

    const realNow = Date.now;
    let withinCalls = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => {
      if (new Error().stack?.includes("withinReadDeadline")) {
        withinCalls += 1;
        if (withinCalls >= 2) return realNow() + 35_000;
      }
      return realNow();
    });
    try {
      const expired = await runCli(cwd, ["show", judgeQaLocator, judgeQaEntryId, "--full"]);
      expect(expired.code).toBe(1);
      expect(expired.stdout).toBe("");
      expect(expired.stderr).toContain("inspection-read-deadline-exceeded");
      expect(expired.stderr).toContain(`niceeval show ${judgeQaLocator} ${judgeQaEntryId}`);
    } finally {
      spy.mockRestore();
    }
  });

  // @feature docs/feature/inspection/README.md#portable-trace
  test("show execution, diff, and partial trace text sanitize control chars and preserve truncation markers", async () => {
    const dispRes = await runCli(cwd, ["show", displayLocator, "execution"]);
    expect(dispRes.code, dispRes.stderr).toBe(0);
    expect(dispRes.stdout).not.toContain("\u001b");
    expect(dispRes.stdout).not.toContain("\u202e");
    expect(dispRes.stdout).toContain("Guard: Halt!");
    expect(dispRes.stdout).toMatch(/printf 'x+…\n/u);

    const traceJson = await runCli(cwd, ["show", traceLocator, "execution", "--json"]);
    const traceDoc = decodeNdjson(traceJson.stdout)[0]!;
    if (traceDoc.outcome !== "success" || traceDoc.operation !== "attempt.trace") throw new Error("Expected trace");
    const toolId = traceDoc.trace.identityIndex.toolOccurrenceIds.ids[0]!;
    const toolText = await runCli(cwd, ["show", traceLocator, toolId]);
    expect(toolText.code, toolText.stderr).toBe(0);
    expect(toolText.stdout).toMatch(/truncated/i);

    const partialRes = await runCli(cwd, ["show", partialTraceLocator, "execution"]);
    expect(partialRes.code, partialRes.stderr).toBe(0);
    expect(partialRes.stdout).toContain("Upstream journal ended before final");

    const diffList = await runCli(cwd, ["show", diffLocator, "diff", "--json"]);
    const diffDoc = decodeNdjson(diffList.stdout)[0]!;
    if (diffDoc.outcome !== "success" || diffDoc.operation !== "attempt.diff" || diffDoc.diff.state !== "complete") {
      throw new Error("Expected diff");
    }
    const changeId = diffDoc.diff.windows.flatMap((w) => w.changes).find((c) => c.path === "small.txt")!.changeId;
    const diffText = await runCli(cwd, ["show", diffLocator, changeId]);
    expect(diffText.code, diffText.stderr).toBe(0);
    expect(diffText.stdout).toContain("-before\n+after\n");
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("compare enforces comparison modes and --max-regressions gate exit codes", async () => {
    const cmpRuns = (await Effect.runPromise(runHost.list({ cwd }))).runs
      .filter((run) => run.experimentId === "cmp-exp")
      .map((run) => run.runId);
    const baseRunId = cmpRuns.find((id) => id !== altRunId)!;

    const passGate = await runCli(cwd, ["compare", baseRunId, "--", altRunId, "--mode", "paired", "--max-regressions", "1"]);
    expect(passGate.code, passGate.stderr).toBe(0);
    expect(passGate.stdout).toContain("Regressed");

    const failGate = await runCli(cwd, ["compare", baseRunId, "--", altRunId, "--mode", "paired", "--max-regressions", "0"]);
    expect(failGate.code).toBe(1);
    expect(failGate.stderr).toContain("Regression gate failed");

    const sideBySide = await runCli(cwd, ["compare", baseRunId, "--", altRunId, "--mode", "side-by-side", "--json"]);
    expect(sideBySide.code, sideBySide.stderr).toBe(0);
    const doc = decodeNdjson(sideBySide.stdout)[0]!;
    if (doc.outcome !== "success" || doc.operation !== "runs.compare") throw new Error("Expected compare doc");
    expect(doc.comparison.pairs).toEqual([]);
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("show exp:<id> --json omits unit when Experiment aggregates a unitless numeric note", async () => {
    const res = await runCli(cwd, ["show", "exp:notes-unitless", "--json"]);
    expect(res.code, res.stderr).toBe(0);
    const doc = decodeNdjson(res.stdout)[0];
    expect(doc).toMatchObject({
      outcome: "success",
      operation: "experiment.get",
      experiment: { notes: [{ label: "latency", count: 1, min: 42, median: 42, p90: 42, max: 42 }] },
    });
    if (doc?.outcome === "success" && doc.operation === "experiment.get") {
      expect("unit" in doc.experiment.notes[0]!).toBe(false);
    }
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("invalid show options and conflicting address prefixes fail before opening any source", async () => {
    const invalidCases: readonly (readonly string[])[] = [
      ["--all", "--json"],
      ["--all", "-o", "json"],
      ["-o", "csv"],
      ["--json", "-o", "text"],
      [populatedLocator, "source", "execution"],
      [populatedLocator, `run:${mainRunId}`],
      [populatedLocator, "exp:show"],
      [populatedLocator, "--all"],
      [populatedLocator, "--full"],
      [populatedLocator, "t1.c1"],
      [populatedLocator, "cmd1"],
      [populatedLocator, "usage", "--actor", "actor-a"],
      ["--eval", "populated"],
      ["--output", "out.png"],
      ["@does-not-exist"],
    ];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...invalidCases), async (argv) => {
        const res = await runCli(cwd, ["show", ...argv]);
        expect(res.code, JSON.stringify(argv)).toBe(1);
        expect(res.stdout, JSON.stringify(argv)).toBe("");
        expect(res.stderr.trim().length, JSON.stringify(argv)).toBeGreaterThan(0);
      }),
      { numRuns: invalidCases.length, seed: 2050 },
    );
  });
});

describe("CLI show failed equality", () => {
  let cwd: string;
  let locator: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-show-equals-"));
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      writeSandboxFixture(cwd),
      writeFile(join(cwd, "package.json"), '{"type":"module"}'),
      writeFile(join(cwd, "evals", "equals.eval.ts"), `
        import { defineEval } from "niceeval";
        import { equals } from "niceeval/expect";
        export default defineEval({ async test(t) {
          t.check(["changed.ts"], equals([])).label("paths");
          t.check(["長".repeat(5000)], equals(["expected"])).label("long");
          const secret = "fixture-key-%\\\\-390";
          t.check([secret + " actual"], equals([secret + " expected"])).label("sensitive");
          await t.sandbox.runCommand("true", [], { sensitiveValues: [secret] });
        } });`),
      writeFile(join(cwd, "experiments", "equals.ts"), `
        import { defineExperiment } from "niceeval";
        import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
        import sandbox from "../sandbox.ts";
        import { shell } from "niceeval/sandbox";
        const agent = defineSandboxAgent({ name: "equals-fixture", evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "equals-fixture", version: "1", revision: "1" }, probe: shell("true") },
          send: async () => ({ status: "completed", events: [] }) });
        export default defineExperiment({ adapter: agent, sandbox, evals: ["equals"] });`),
    ]);
    const run = await runProjectExperiment(cwd, "equals");
    locator = (await publishedSlotLocators(cwd, run.receipt.createdRunIds[0]!)).get("equals")!;
  }, 30_000);

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  // @use-case docs/feature/inspection/use-case/inspection-explain-verdict.md#drill
  // @issue docs/issues/check-actual-value-hidden.md
  test("show exposes bounded operands for failed equals checks", async () => {
    const [list] = decodeNdjson((await runCli(cwd, ["show", locator, "assertions", "--json"])).stdout);
    if (list?.outcome !== "success" || list.operation !== "attempt.assertions") throw new Error("Missing assertions");
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("paths", "long", "sensitive"), async (label) => {
        const row = list.assertions.find((row) => "display" in row && row.display.label === label)!;
        const args = ["show", locator, row.entryId, "--full"];
        const json = await runCli(cwd, [...args, "--json"]);
        expect(json.code, json.stderr).toBe(0);
        const [detail] = decodeNdjson(json.stdout);
        if (detail?.outcome !== "success" || detail.operation !== "attempt.assertion.detail" || !("entry" in detail.assertion))
          throw new Error("Missing Assertion detail");
        const explanation = detail.assertion.entry.explanationRetention;
        if (explanation.state !== "retained" || explanation.value.kind !== "fields") throw new Error("Missing explanation");
        const field = (name: string) => explanation.value.kind === "fields"
          ? explanation.value.fields.find(({ label }) => label === name)?.value
          : undefined;
        expect(field("expected")).toEqual({ kind: "value", value: ({ paths: "[]", long: '["expected"]', sensitive: '["<redacted> expected"]' })[label] });
        expect(field("received")).toEqual({ kind: "value", value: ({ paths: '["changed.ts"]', long: expect.stringContaining("[truncated]"), sensitive: '["<redacted> actual"]' })[label] });
        const human = await runCli(cwd, args);
        expect(human.code, human.stderr).toBe(0);
        if (label === "sensitive") {
          expect(json.stdout).not.toContain("fixture-key");
          expect(human.stdout).not.toContain("fixture-key");
        }
        expect(human.stdout).toMatch(/Actual\s+\[/u);
        expect(human.stdout).toMatch(/Expected\s+\[/u);
        expect(human.stdout).toContain(({ paths: "changed.ts", long: "[truncated]", sensitive: "<redacted> actual" })[label]);
      }),
      { examples: [["paths"], ["long"], ["sensitive"]], numRuns: 3 },
    );
  });
});

describe("CLI show cache usage from reported Turns", () => {
  let cwd: string;
  let locators: ReadonlyMap<string, string>;
  const cases = {
    complete: ["small", "large"],
    partial: ["small", "cached-only", "input-only"],
    "only-incomplete": ["cached-only"],
    missing: ["output-only"],
    zero: ["zero"],
  };

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-show-turn-usage-"));
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      writeFile(join(cwd, "package.json"), '{"type":"module"}'),
      ...Object.entries(cases).map(([id, turns]) => writeFile(join(cwd, "evals", `${id}.eval.ts`), `
        import { defineEval } from "niceeval";
        export default defineEval({ async test(t) {
          for (const name of ${JSON.stringify(turns)}) await t.send(name);
        } });`)),
      writeFile(join(cwd, "experiments", "turn-usage.ts"), `
        import { defineExperiment } from "niceeval";
        import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
        const usage = {
          small: { inputTokens: 1, cacheReadTokens: 3, requests: 2 },
          large: { inputTokens: 5, cacheReadTokens: 1 },
          "cached-only": { cacheReadTokens: 100 },
          "input-only": { inputTokens: 200 },
          "output-only": { outputTokens: 1 },
          zero: { inputTokens: 0, cacheReadTokens: 0 },
        };
        const agent = defineAgent({ name: "turn-buckets", evidenceCoverage: completeEvidenceCoverage,
          send: async (input) => ({ status: "completed", events: [], usage: usage[input.text] }) });
        export default defineExperiment({ adapter: agent, evals: ${JSON.stringify(Object.keys(cases))} });`),
    ]);
    const run = await runProjectExperiment(cwd, "turn-usage");
    locators = await publishedSlotLocators(cwd, run.receipt.createdRunIds[0]!);
  }, 30_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  // @use-case docs/feature/inspection/use-case/inspection-show-as-json.md#same-command-json
  test("show reports a token-weighted observed share and names the incomplete Turns", async () => {
    const ids = ["complete", "partial", "only-incomplete", "missing", "zero"] as const;
    await fc.assert(fc.asyncProperty(fc.constantFrom(...ids), async (id) => {
      const args = ["show", locators.get(id)!, "usage"];
      const json = await runCli(cwd, [...args, "--json"]);
      expect(json.code, json.stderr).toBe(0);
      const [document] = decodeNdjson(json.stdout);
      if (document?.outcome !== "success" || document.operation !== "attempt.usage") throw new Error("Missing usage");
      const { usage } = document;
      expect(usage.cacheRead.total.rate).toEqual({ state: "unavailable", reason: "adapter-usage-required" });
      const secondTurn = usage.turns[1]?.turnId;
      const thirdTurn = usage.turns[2]?.turnId;
      const expected = {
        complete: { state: "complete", value: 0.4, coveredTurns: 2, missingTurns: [] },
        partial: { state: "partial", value: 0.75, coveredTurns: 1, missingTurns: [
          { turnId: secondTurn, buckets: ["input"] }, { turnId: thirdTurn, buckets: ["cache-read"] },
        ] },
        "only-incomplete": { state: "partial", value: null, coveredTurns: 0, missingTurns: [
          { turnId: usage.turns[0]?.turnId, buckets: ["input"] },
        ] },
        missing: { state: "unavailable", value: null, reason: "no-token-buckets" },
        zero: { state: "unavailable", value: null, reason: "zero-observed-input" },
      }[id];
      expect(Reflect.get(usage, "turnCacheRead")).toMatchObject({ basis: "turn-observed", ...expected });
      const human = await runCli(cwd, args);
      expect(human.code, human.stderr).toBe(0);
      expect(human.stdout).toContain("turn-observed");
      if (id === "complete") expect(human.stdout).toContain("40.00%");
      if (id === "partial") {
        expect(human.stdout).toContain("75.00%");
        expect(human.stdout).toContain(secondTurn!);
        expect(human.stdout).toContain(thirdTurn!);
      }
    }), { examples: ids.map((id) => [id]), numRuns: ids.length });
  });
});

describe("CLI show current project and historical deltas", () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-inspection-cli-current-"));
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(join(cwd, "niceeval.config.ts"), "export default {};\n"),
      writeFile(
        join(cwd, "adapter.ts"),
        `import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
         export const agent = defineAgent({ name: "cli-cur", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });`,
      ),
      writeFile(
        join(cwd, "evals", "pass.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ test(t) { t.check(true, equals(true)); } });`,
      ),
      writeFile(
        join(cwd, "evals", "fail.eval.ts"),
        `import { defineEval } from "niceeval"; import { equals } from "niceeval/expect";
         export default defineEval({ test(t) { t.check(false, equals(true)); } });`,
      ),
      writeFile(
        join(cwd, "experiments", "group-a.ts"),
        `import { defineExperiment } from "niceeval"; import { agent } from "../adapter.ts";
         export default defineExperiment({ adapter: agent, evals: ["pass", "fail"], flags: { alpha: "before", beta: "before", removed: "gone" } });`,
      ),
    ]);
    await runProjectExperiment(cwd, "group-a");
    const expPath = join(cwd, "experiments", "group-a.ts");
    await writeFile(
      expPath,
      (await readFile(expPath, "utf8")).replace(
        'alpha: "before", beta: "before", removed: "gone"',
        'added: "new", alpha: "after", beta: "after"',
      ),
    );
  }, 30_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("show renders Current results with Earlier results summary and merged Experiment deltas", async () => {
    const overview = await runCli(cwd, ["show"]);
    expect(overview.code, overview.stderr).toBe(0);
    expect(overview.stdout).toContain("Current results");
    expect(overview.stdout).toContain("Earlier results for these");
    expect(overview.stdout).not.toMatch(/\bgaps?\b/iu);

    const expView = await runCli(cwd, ["show", "exp:group-a"]);
    expect(expView.code, expView.stderr).toBe(0);
    expect(expView.stdout).toMatch(/Changed\s+config:flags.added \(new; added\) · all 2 attempts/u);
    expect(expView.stdout).toContain("Previous result @");
  });
});
