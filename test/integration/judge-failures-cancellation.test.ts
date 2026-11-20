import { rm } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  HOST_SANDBOX_SOURCE,
  OpenAIProvider,
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readAssertionDetail,
  readAssertionsList,
  readFullAssertionEntry,
  readPaginatedTrace,
  showJsonDocuments,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";

describe("Ordinary Judge failures and cancellation", () => {
  const ordinaryModes = fc.sample(
    fc.constantFrom("http400", "malformed", "missing-call", "invalid-choice", "oversized", "http503", "disconnect"),
    { numRuns: 7, seed: 202611 },
  );
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let cwd: string;
  const locators = new Map<string, string>();
  const recordedRequests: string[] = [];

  beforeAll(async () => {
    server = await startHttpServer((req, body, res) => {
      recordedRequests.push(req.url ?? "");
      const payload = JSON.parse(body);
      const userContent = JSON.stringify(payload.messages);
      const mode = ordinaryModes.find((m) => userContent.includes(`mode:${m}`)) ?? "http400";
      if (mode === "http400") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad request" } }));
        return;
      }
      if (mode === "http503") {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("upstream unavailable");
        return;
      }
      if (mode === "disconnect") {
        req.socket.destroy();
        return;
      }
      if (mode === "malformed") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{not-json");
        return;
      }
      if (mode === "oversized") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ pad: "x".repeat(32_768) }));
        return;
      }
      if (mode === "missing-call") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "r1",
            object: "chat.completion",
            model: payload.model,
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "no tool" } }],
          }),
        );
        return;
      }
      // invalid-choice
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "r1",
          object: "chat.completion",
          model: payload.model,
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: {
                      name: payload.tool_choice.function.name,
                      arguments: JSON.stringify({ choice: "not-a-valid-choice", rationale: "bad" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    });

    const evals: Record<string, string> = {};
    for (const mode of ordinaryModes) {
      evals[`${mode}.eval.ts`] = `
        import { defineScoreEval } from "niceeval";
        import { binaryJudge } from "niceeval/expect";
        export default defineScoreEval({
          async test(t) {
            await t.send("ok");
            t.judge({ marker: ${JSON.stringify(`mode:${mode}`)} }, binaryJudge({ rubric: "Check" })).score(2).label(${JSON.stringify(mode)});
          },
        });
      `;
    }
    cwd = await createJudgeProject("niceeval-judge-ordinary-fail-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: OpenAIProvider({
            model: "fail-model",
            baseUrl: ${JSON.stringify(server.baseUrl)},
            apiKey: "fixture-key",
            maxResponseBytes: 4096,
            timeoutMs: 5000,
          }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({
          name: "fail-agent",
          evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({ status: "completed", events: [] }),
        });
      `,
      evals,
      experiments: {
        "ordinary-fail.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          export default defineExperiment({ adapter: agent, evals: "*", attempts: 1 });
        `,
      },
    });
    const res = await planAndRunExperiment(cwd, "ordinary-fail", {
      config: {
        judgeProvider: OpenAIProvider({
          model: "fail-model",
          baseUrl: server.baseUrl,
          apiKey: "fixture-key",
          maxResponseBytes: 4096,
          timeoutMs: 5000,
        }),
      },
      rerun: "all",
    });
    for (const slot of res.run?.slots ?? []) {
      if (slot.publication.state === "published") locators.set(slot.evalId, slot.publication.attemptLocator);
    }
  }, 30_000);

  afterAll(async () => {
    await server.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test.each(ordinaryModes)("ordinary Judge failure mode %s produces diagnosable error and preserves sealed input", async (mode) => {
    const locator = locators.get(mode)!;
    expect(locator).toBeDefined();
    const [attemptDoc] = await showJsonDocuments(cwd, [locator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const assertions = await readAssertionsList(cwd, locator);
    const entry = assertions[0]!;
    if (!("entry" in entry)) throw new Error("Expected compact assertion entry");
    const expectedResult = ["http503", "disconnect"].includes(mode) ? "unavailable" : "errored";
    expect(entry.entry.decision.result).toBe(expectedResult);
    expect(attempt.value.attempt.score).toMatchObject({ state: "unavailable" });
    const detail = await readAssertionDetail(cwd, locator, entry.entryId);
    expect(JSON.stringify(detail)).toContain(`mode:${mode}`);
    const [usageDoc] = await showJsonDocuments(cwd, [locator, "usage"]);
    const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
    if (!usage.success) throw new Error(usage.reason);
    expect(usage.value.usage.judgeUsage.state).toBe("complete");
    if (usage.value.usage.judgeUsage.state === "complete") {
      expect(usage.value.usage.judgeUsage.calls).toHaveLength(mode === "http503" ? 2 : 1);
      expect(usage.value.usage.judgeUsage.calls[0]?.status).toBe(
        ["malformed", "missing-call", "invalid-choice"].includes(mode) ? "succeeded" : "failed",
      );
    }
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test("aborting an ordinary Judge during in-flight HTTP terminates request and preserves sealed facts", async () => {
    const abort = new AbortController();
    let requestSeen!: () => void;
    const seenPromise = new Promise<void>((r) => {
      requestSeen = r;
    });
    let serverCount = 0;
    const cancelServer = await startHttpServer((_req, _body, _res) => {
      serverCount++;
      requestSeen();
      // Hold response open until aborted
    });
    const cancelCwd = await createJudgeProject("niceeval-judge-ordinary-cancel-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: OpenAIProvider({ model: "cancel-model", baseUrl: ${JSON.stringify(cancelServer.baseUrl)}, apiKey: "k", timeoutMs: 20_000 }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({ name: "c-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
      `,
      evals: {
        "c.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { binaryJudge } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) {
              await t.send("go");
              t.judge({ frozen: "SEALED_INPUT" }, binaryJudge({ rubric: "Check" })).score(1);
            },
          });
        `,
      },
      experiments: {
        "c.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["c"], attempts: 1 });`,
      },
    });
    try {
      const running = planAndRunExperiment(cancelCwd, "c", {
        config: {
          judgeProvider: OpenAIProvider({ model: "cancel-model", baseUrl: cancelServer.baseUrl, apiKey: "k", timeoutMs: 20_000 }),
        },
        rerun: "all",
        signal: abort.signal,
      });
      await seenPromise;
      abort.abort();
      const res = await running;
      expect(res.receipt?.completion).toBe("interrupted");
      expect(serverCount).toBe(1);
      const slot = res.run?.slots[0];
      if (slot?.publication.state === "published") {
        const [timingDoc] = await showJsonDocuments(cancelCwd, [slot.publication.attemptLocator, "timing"]);
        const timing = narrowInspectionSuccess(timingDoc!, "attempt.timing");
        if (!timing.success) throw new Error(timing.reason);
        expect(timing.value.timing.activities).toEqual(
          expect.arrayContaining([expect.objectContaining({ label: "judge.request", outcome: "cancelled" })]),
        );
        const [usageDoc] = await showJsonDocuments(cancelCwd, [slot.publication.attemptLocator, "usage"]);
        const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
        if (!usage.success) throw new Error(usage.reason);
        expect(usage.value.usage.judgeUsage.state).toBe("complete");
        if (usage.value.usage.judgeUsage.state === "complete") {
          expect(usage.value.usage.judgeUsage.calls[0]?.status).toBe("cancelled");
        }
      } else {
        expect(slot?.publication).toMatchObject({ state: "absent", reason: "interrupted-before-publication" });
      }
    } finally {
      await cancelServer.close();
      await rm(cancelCwd, { recursive: true, force: true });
    }
  });
});

describe("Agent Judge failure modes, compaction, and pi SDK cleanup", () => {
  const agentModes = [
    "http400",
    "malformed",
    "transport",
    "no-submit",
    "turns",
    "timeout",
    "response-limit",
    "command-timeout",
    "compact-continue",
    "compact-overflow",
  ] as const;

  let server: Awaited<ReturnType<typeof startHttpServer>>;
  const projects: string[] = [];
  const modeResults = new Map<string, { cwd: string; locator: string; bodies: string[] }>();

  beforeAll(async () => {
    const modeBodies = new Map<string, string[]>();
    const overflowed = new Set<string>();
    let ordinal = 0;

    server = await startHttpServer((req, body, res) => {
      const mode = new URL(req.url ?? "/", "http://127.0.0.1").pathname.split("/")[2] ?? "unknown";
      const bodies = modeBodies.get(mode) ?? [];
      modeBodies.set(mode, bodies);
      const payload = JSON.parse(body);
      const summary = payload.messages[0]?.content?.includes("context summarization assistant") === true;
      bodies.push(body);
      ordinal++;

      if (mode === "timeout") return;
      if (mode === "http400") {
        res.writeHead(400);
        res.end("invalid request");
        return;
      }
      if (mode === "malformed") {
        res.end('{"choices":[]}');
        return;
      }
      if (mode === "transport") {
        res.writeHead(503);
        res.end("unavailable");
        return;
      }
      const send = (text: string | null, calls: unknown[] = []) => {
        const finish_reason = calls.length > 0 ? "tool_calls" : "stop";
        const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
        if (payload.stream) {
          res.setHeader("Content-Type", "text/event-stream");
          const delta = {
            role: "assistant",
            content: text,
            ...(calls.length > 0 ? { tool_calls: calls.map((call, index) => ({ ...(call as object), index })) } : {}),
          };
          res.end(
            `data: ${JSON.stringify({ id: `gen-${ordinal}`, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta, finish_reason }], usage })}\n\ndata: [DONE]\n\n`,
          );
        } else {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: `gen-${ordinal}`,
              object: "chat.completion",
              model: payload.model,
              created: 0,
              usage,
              choices: [
                {
                  index: 0,
                  finish_reason,
                  message: { role: "assistant", content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}) },
                },
              ],
            }),
          );
        }
      };
      if (mode === "response-limit") {
        send("x".repeat(512 * 1024));
        return;
      }
      if (summary) {
        send("The reviewer inspected application.txt. First question was submitted. Continue with Second question.");
        return;
      }
      const lastUser = payload.messages.findLast((m: { role: string }) => m.role === "user");
      const step = JSON.parse(
        typeof lastUser.content === "string"
          ? lastUser.content
          : lastUser.content
              .filter((p: { type: string }) => p.type === "text")
              .map((p: { text: string }) => p.text)
              .join("\n"),
      );
      const last = payload.messages.at(-1);
      if (
        mode.startsWith("compact-") &&
        step.message === "Second question" &&
        (!overflowed.has(mode) || mode === "compact-overflow")
      ) {
        overflowed.add(mode);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "maximum context length exceeded",
              type: "invalid_request_error",
              code: "context_length_exceeded",
            },
          }),
        );
        return;
      }
      const call = (name: string, args: unknown) => ({
        id: `call-${ordinal}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
      const submit = call("submit_evaluation", {
        ...(step.kind === "judge" ? { satisfied: true } : { measurement: 1 }),
        rationale: "Observed Sandbox evidence",
        evidence: [{ kind: "file", ref: "application.txt", note: "Read file" }],
      });
      let calls: unknown[] = [];
      let text: string | null = null;
      if (step.kind === "chat") text = "Ready.";
      else if (mode === "no-submit") text = "I decline to grade.";
      else if (mode === "turns" && step.message === "First question") calls = [call("read", { path: "application.txt" })];
      else if (mode === "command-timeout" && step.message === "First question" && last.role === "user") {
        calls = [call("bash", { command: "sleep 10", timeout: 0.1 })];
      } else {
        calls = [submit];
      }
      send(text, calls);
    });

    await Promise.all(
      agentModes.map(async (mode) => {
        const cwd = await createJudgeProject(`niceeval-aj-fail-${mode}-`, {
          config: `
            import { defineConfig } from "niceeval";
            import { OpenAIProvider } from "niceeval/judge";
            export default defineConfig({
              timeoutMs: 30_000,
              judgeProvider: OpenAIProvider({
                model: "aj-fail-model",
                baseUrl: ${JSON.stringify(`${server.baseUrl}/${mode}/v1`)},
                apiKey: "fixture-key",
                maxResponseBytes: 16_384,
                maxOutputTokens: 1024,
              }),
            });
          `,
          agent: `
            import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
            import { shell } from "niceeval/sandbox";
            export default defineSandboxAgent({
              name: "aj-fail-agent",
              evidenceCoverage: completeEvidenceCoverage,
              install: { identity: { agent: "aj-fail-agent", version: "1", revision: "1" }, probe: shell("true") },
              send: async (_input, ctx) => {
                await ctx.sandbox.writeText("application.txt", "application evidence");
                return { status: "completed", events: [{ type: "message", role: "assistant", text: "done" }] };
              },
            });
          `,
          sandbox: HOST_SANDBOX_SOURCE,
          evals: {
            "aj.eval.ts": `
              import { defineScoreEval } from "niceeval";
              import { defineAgentJudge } from "niceeval/expect";
              const reviewer = defineAgentJudge({
                maxTurns: ${mode === "turns" ? 1 : 4},
                timeoutMs: ${mode === "timeout" ? 150 : 10_000},
              });
              export default defineScoreEval({
                async test(t) {
                  await t.send("Write evidence.");
                  const review = t.agentJudge(reviewer, { mode: ${JSON.stringify(mode)} });
                  review.chat(${JSON.stringify(mode.startsWith("compact-") ? "Earlier evidence. ".repeat(5000) : "Inspect.")});
                  review.judge("First question").score(2).label("First review");
                  review.grade("Second question", {
                    anchors: [
                      { measurement: 0, description: "None" },
                      { measurement: 1, description: "Full" },
                    ],
                  }).score(3).label("Second review");
                },
              });
            `,
          },
          experiments: {
            "aj.ts": `
              import { defineExperiment } from "niceeval";
              import agent from "../agent.ts";
              import sandbox from "../sandbox.ts";
              export default defineExperiment({ adapter: agent, sandbox, evals: ["aj"], attempts: 1 });
            `,
          },
        });
        projects.push(cwd);
        const res = await planAndRunExperiment(cwd, "aj", {
          config: {
            timeoutMs: 30_000,
            judgeProvider: OpenAIProvider({
              model: "aj-fail-model",
              baseUrl: `${server.baseUrl}/${mode}/v1`,
              apiKey: "fixture-key",
              maxResponseBytes: 16_384,
              maxOutputTokens: 1024,
            }),
          },
          rerun: "all",
        });
        const slot = res.run?.slots[0];
        if (slot?.publication.state !== "published") throw new Error(`Missing slot for ${mode}`);
        modeResults.set(mode, { cwd, locator: slot.publication.attemptLocator, bodies: modeBodies.get(mode) ?? [] });
      }),
    );
  }, 45_000);

  afterAll(async () => {
    await server.close();
    await Promise.all(projects.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test.each(agentModes)("Agent Judge failure mode %s classifies outcomes and preserves trace/usage", async (mode) => {
    const { cwd, locator } = modeResults.get(mode)!;
    const [attemptDoc] = await showJsonDocuments(cwd, [locator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const entries = attempt.value.attempt.assertions.entries;
    expect(entries).toHaveLength(2);

    const results: string[] = [];
    for (const [index, entry] of entries.entries()) {
      const { entry: fullEntry } = await readFullAssertionEntry(cwd, locator, entry.entryId);
      const audit = fullEntry.agentJudgeAudit;
      if (audit?.state !== "available") throw new Error(`Missing audit for ${mode}/${index}`);
      results.push(audit.audit.result.state);
      if (mode === "compact-overflow" && index === 1) {
        expect(audit.audit.result).toMatchObject({ code: "agent-judge-context-overflow" });
      }
      if (mode === "command-timeout" && index === 0) {
        const traceBytes = (await readPaginatedTrace(cwd, locator, audit.audit.trace.id)).bytes;
        const trace = JSON.parse(traceBytes.toString("utf8"));
        expect(trace.tools.some((t: { name: string; result: string | null }) => t.name === "bash" && t.result?.includes("timed out"))).toBe(true);
      }
    }
    const expected =
      mode === "command-timeout" || mode === "compact-continue"
        ? ["measured", "measured"]
        : mode === "turns" || mode === "compact-overflow"
          ? [mode === "turns" ? "unavailable" : "measured", mode === "turns" ? "measured" : "unavailable"]
          : ["unavailable", "unavailable"];
    expect(results).toEqual(expected);

    if (mode.startsWith("compact-")) {
      const [timingDoc] = await showJsonDocuments(cwd, [locator, "timing"]);
      const timing = narrowInspectionSuccess(timingDoc!, "attempt.timing");
      if (!timing.success) throw new Error(timing.reason);
      const compaction = timing.value.timing.activities.find((a) => a.label === "agent-judge.compaction");
      expect(compaction?.outcome).toBe("completed");
    }

    const [usageDoc] = await showJsonDocuments(cwd, [locator, "usage"]);
    const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
    if (!usage.success) throw new Error(usage.reason);
    expect(usage.value.usage.judgeUsage.state).toBe("complete");
    if (usage.value.usage.judgeUsage.state === "complete") {
      expect(usage.value.usage.judgeUsage.calls.every((c) => c.operation === "agent")).toBe(true);
      if (["http400", "transport"].includes(mode)) {
        expect(usage.value.usage.judgeUsage.calls.every((c) => c.status === "failed")).toBe(true);
      }
    }
  });
});

describe("Agent Judge pi SDK failure layers and session cleanup", () => {
  const sdkFaultModes = [
    { mode: "json", expectedState: "unavailable", expectedCode: "judge-call-failed" },
    { mode: "unexpected", expectedState: "unavailable", expectedCode: "judge-call-failed" },
    { mode: "prompt", expectedState: "errored", expectedCode: "agent-judge-defect" },
    { mode: "usage", expectedState: "errored", expectedCode: "agent-judge-defect" },
    { mode: "overflow", expectedState: "unavailable", expectedCode: "agent-judge-context-overflow" },
    { mode: "aborted", expectedState: "unavailable", expectedCode: "judge-call-failed" },
  ] as const;

  const cleanupFaults = ["context", "hook", "append", "refresh", "subscribe", "capture"] as const;
  let cwd: string;
  const sdkResults = new Map<string, { state: string; code: string }>();
  const cleanupResults = new Map<
    string,
    { verdict: string | null; size: number; disposed: number; subscriptions: number; isIdle: boolean; isStreaming: boolean }
  >();

  beforeAll(async () => {
    cwd = await createJudgeProject("niceeval-pi-layers-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          timeoutMs: 30_000,
          judgeProvider: OpenAIProvider({ model: "pi-fault", baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", contextWindow: 128000, maxOutputTokens: 128 }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export default defineSandboxAgent({
          name: "pi-fault-agent",
          evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "pi-fault-agent", version: "1", revision: "1" }, probe: shell("true") },
          send: async () => ({ status: "completed", events: [] }),
        });
      `,
      sandbox: HOST_SANDBOX_SOURCE,
      evals: {
        "fault.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineAgentJudge } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) {
              await t.send("go");
              t.agentJudge(defineAgentJudge({ timeoutMs: 5000 }), { fact: "supplied" }).judge("Inspect").gate(1);
            },
          });
        `,
      },
      experiments: {
        "fault.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          import sandbox from "../sandbox.ts";
          export default defineExperiment({ adapter: agent, sandbox, evals: ["fault"], attempts: 1 });
        `,
      },
    });

    const niceevalManifest = new URL("../../packages/niceeval/package.json", import.meta.url);
    const codingPkg = findPackageJSON("@earendil-works/pi-coding-agent", niceevalManifest)!;
    const aiPkg = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(codingPkg))!;
    const piCoding = (await import(
      pathToFileURL(join(dirname(codingPkg), "dist/index.js")).href
    )) as typeof import("../../packages/niceeval/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
    const piAi = (await import(
      pathToFileURL(join(dirname(aiPkg), "dist/index.js")).href
    )) as typeof import("../../packages/niceeval/node_modules/@earendil-works/pi-ai/dist/index.js");
    const origPrompt = piCoding.AgentSession.prototype.prompt;
    const origReload = piCoding.DefaultResourceLoader.prototype.reload;
    const origSubscribe = piCoding.AgentSession.prototype.subscribe;
    const origDispose = piCoding.AgentSession.prototype.dispose;
    const origRefresh = piCoding.AgentSession.prototype.refreshContext;
    const origAppend = piCoding.SessionManager.prototype.appendMessage;
    const origSystemPrompt = Object.getOwnPropertyDescriptor(piCoding.AgentSession.prototype, "systemPrompt")!;

    const faultConfig = {
      timeoutMs: 30_000,
      judgeProvider: OpenAIProvider({
        model: "pi-fault",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "k",
        contextWindow: 128000,
        maxOutputTokens: 128,
      }),
    };
    try {
      for (const { mode } of sdkFaultModes) {
        piCoding.AgentSession.prototype.prompt = async function (...args: Parameters<typeof origPrompt>) {
          if (mode === "prompt") throw new Error("fixture prompt defect");
          this.agent.streamFunction = (model: { api: string; provider: string; id: string }) => {
            const stream = piAi.createAssistantMessageEventStream();
            const message: Record<string, unknown> = {
              role: "assistant",
              api: model.api,
              provider: model.provider,
              model: model.id,
              content: [],
              stopReason: mode === "aborted" ? "aborted" : "error",
              timestamp: Date.now(),
              usage: {
                input: mode === "usage" ? -1 : 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              errorMessage:
                mode === "json"
                  ? "JSON provider temporarily unavailable"
                  : mode === "unexpected"
                    ? "Unexpected remote failure"
                    : mode === "overflow"
                      ? "prompt is too long: 200000 tokens > 128000 maximum"
                      : "fixture final failure",
            };
            stream.push({ type: "error", reason: message.stopReason as "error" | "aborted", error: message as never });
            return stream;
          };
          return origPrompt.apply(this, args);
        };

        const res = await planAndRunExperiment(cwd, "fault", { config: faultConfig, rerun: "all" });
        const slot = res.run?.slots[0];
        if (slot?.publication.state !== "published") throw new Error(`Missing slot for ${mode}`);
        const [attemptDoc] = await showJsonDocuments(cwd, [slot.publication.attemptLocator]);
        const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
        if (!attempt.success) throw new Error(attempt.reason);
        const entry = attempt.value.attempt.assertions.entries[0]!;
        const { entry: fullEntry } = await readFullAssertionEntry(cwd, slot.publication.attemptLocator, entry.entryId);
        if (fullEntry.agentJudgeAudit?.state !== "available") {
          throw new Error(`Missing audit for ${mode}`);
        }
        const result = fullEntry.agentJudgeAudit.audit.result;
        if (result.state !== "unavailable" && result.state !== "errored") {
          throw new Error(`Unexpected result for ${mode}: ${JSON.stringify(result)}`);
        }
        sdkResults.set(mode, { state: result.state, code: result.code });
      }

      for (const fault of cleanupFaults) {
        const sessions = new Map<object, { disposed: number; subscriptions: number; reads: number }>();
        const track = (s: object) => {
          if (!sessions.has(s)) sessions.set(s, { disposed: 0, subscriptions: 0, reads: 0 });
          return sessions.get(s)!;
        };

        Object.defineProperty(piCoding.AgentSession.prototype, "systemPrompt", {
          ...origSystemPrompt,
          get() {
            const st = track(this);
            st.reads++;
            if (fault === "context" && st.reads === 2) throw new Error("sdk-fixture-context");
            if (fault === "hook" && st.reads === 1) {
              Object.defineProperty(this.agent, "beforeToolCall", {
                configurable: true,
                get: () => undefined,
                set: () => {
                  throw new Error("sdk-fixture-hook");
                },
              });
            }
            return origSystemPrompt.get!.call(this);
          },
        });
        piCoding.SessionManager.prototype.appendMessage = function (message: Parameters<typeof origAppend>[0]) {
          if (fault === "append") throw new Error("sdk-fixture-append");
          return origAppend.call(this, message);
        };
        piCoding.AgentSession.prototype.refreshContext = function () {
          if (fault === "refresh") throw new Error("sdk-fixture-refresh");
          return origRefresh.call(this);
        };
        piCoding.AgentSession.prototype.subscribe = function (listener: Parameters<typeof origSubscribe>[0]) {
          const st = track(this);
          if (fault === "subscribe") throw new Error("sdk-fixture-subscribe");
          const unsub = origSubscribe.call(this, listener);
          st.subscriptions++;
          return () => {
            unsub();
            st.subscriptions--;
          };
        };
        piCoding.AgentSession.prototype.prompt = async function () {
          if (fault === "capture") {
            this.sessionManager.getEntries = () => {
              throw new Error("sdk-fixture-capture");
            };
          }
          throw new Error("sdk-fixture-prompt");
        };
        piCoding.AgentSession.prototype.dispose = function () {
          track(this).disposed++;
          return origDispose.call(this);
        };

        const res = await planAndRunExperiment(cwd, "fault", { config: faultConfig, rerun: "all" });
        const slot = res.run?.slots[0];
        if (slot?.publication.state !== "published") throw new Error(`Missing cleanup slot for ${fault}`);
        const [attemptDoc] = await showJsonDocuments(cwd, [slot.publication.attemptLocator]);
        const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
        if (!attempt.success) throw new Error(attempt.reason);
        const [[session, state]] = [...sessions.entries()];
        cleanupResults.set(fault, {
          verdict: attempt.value.attempt.verdict,
          size: sessions.size,
          disposed: state!.disposed,
          subscriptions: state!.subscriptions,
          isIdle: (session as { isIdle: boolean }).isIdle,
          isStreaming: (session as { isStreaming: boolean }).isStreaming,
        });

        Object.defineProperty(piCoding.AgentSession.prototype, "systemPrompt", origSystemPrompt);
        piCoding.SessionManager.prototype.appendMessage = origAppend;
        piCoding.AgentSession.prototype.refreshContext = origRefresh;
        piCoding.AgentSession.prototype.subscribe = origSubscribe;
        piCoding.AgentSession.prototype.dispose = origDispose;
      }
    } finally {
      Object.defineProperty(piCoding.AgentSession.prototype, "systemPrompt", origSystemPrompt);
      piCoding.AgentSession.prototype.prompt = origPrompt;
      piCoding.DefaultResourceLoader.prototype.reload = origReload;
      piCoding.AgentSession.prototype.subscribe = origSubscribe;
      piCoding.AgentSession.prototype.dispose = origDispose;
      piCoding.AgentSession.prototype.refreshContext = origRefresh;
      piCoding.SessionManager.prototype.appendMessage = origAppend;
    }
  }, 45_000);

  afterAll(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test.each(sdkFaultModes)(
    "Agent Judge pi SDK failure layer $mode classifies as $expectedState/$expectedCode",
    ({ mode, expectedState, expectedCode }) => {
      expect(sdkResults.get(mode)).toEqual({ state: expectedState, code: expectedCode });
    },
  );

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test.each(cleanupFaults)("Agent Judge releases pi session cleanly after SDK fault %s", (fault) => {
    expect(cleanupResults.get(fault)).toEqual({
      verdict: "errored",
      size: 1,
      disposed: 1,
      subscriptions: 0,
      isIdle: true,
      isStreaming: false,
    });
  });
});
