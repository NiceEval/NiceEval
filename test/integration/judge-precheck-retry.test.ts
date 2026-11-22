import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  Effect,
  HOST_SANDBOX_SOURCE,
  OpenAIProvider,
  chatToolResponse,
  createJudgeProject,
  experimentHost,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readAssertionDetail,
  readAssertionsList,
  readFullAssertionEntry,
  showJsonDocuments,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";
import { type ModelRule, startModelEmulator } from "./fixtures/model-emulator.ts";

describe("Judge precheck isolation and concurrency scheduling", () => {
  describe("unresolved credential isolation", () => {
    let server: Awaited<ReturnType<typeof startModelEmulator>>;
    let cwd = "";
    let serverCalls = 0;
    let completion: string | undefined;
    let missingEntries: Awaited<ReturnType<typeof readAssertionsList>> = [];
    let missingFullAudit: unknown;
    let inlineEntries: Awaited<ReturnType<typeof readAssertionsList>> = [];

    beforeAll(async () => {
      server = await startModelEmulator([
        {
          id: "inline-credential-score",
          match: { model: "inline-model", tool: "record_score_match" },
          reply: [{ type: "tool_call", name: "record_score_match", arguments: { measurement: 1, rationale: "Valid key" } }],
        },
      ]);
      cwd = await createJudgeProject("niceeval-judge-precheck-", {
        config: `
          import { defineConfig } from "niceeval";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineConfig({
            judgeProvider: OpenAIProvider({
              model: "precheck-model",
              baseUrl: ${JSON.stringify(server.baseUrl)},
              apiKeyEnv: "NICEEVAL_DEFINITELY_MISSING_KEY",
            }),
          });
        `,
        agent: `
          import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
          export default defineAgent({ name: "precheck-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
        `,
        evals: {
          "missing-key.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineJudge, equals } from "niceeval/expect";
            export default defineScoreEval({
              test(t) {
                t.check(1, equals(1)).score(1).label("Local check");
                t.judge({ text: "hello" }, defineJudge({ rubric: "Check" })).score(2).label("Missing key judge");
              },
            });
          `,
          "inline-key.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineJudge } from "niceeval/expect";
            import { OpenAIProvider } from "niceeval/judge";
            export default defineScoreEval({
              judge: OpenAIProvider({ model: "inline-model", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "inline-ok" }),
              test(t) {
                t.judge({ text: "hello" }, defineJudge({ rubric: "Check" })).score(2).label("Inline key judge");
              },
            });
          `,
        },
        experiments: {
          "precheck.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../agent.ts";
            export default defineExperiment({ adapter: agent, evals: ["missing-key", "inline-key"], attempts: 1 });
          `,
        },
      });

      const res = await planAndRunExperiment(cwd, "precheck", {
        config: {
          judgeProvider: OpenAIProvider({
            model: "precheck-model",
            baseUrl: server.baseUrl,
            apiKeyEnv: "NICEEVAL_DEFINITELY_MISSING_KEY",
          }),
        },
        rerun: "all",
      });
      completion = res.receipt?.completion;
      const missingSlot = res.run?.slots.find((s) => s.evalId === "missing-key");
      const inlineSlot = res.run?.slots.find((s) => s.evalId === "inline-key");
      if (missingSlot?.publication.state !== "published" || inlineSlot?.publication.state !== "published") {
        throw new Error("Expected published slots");
      }
      missingEntries = await readAssertionsList(cwd, missingSlot.publication.attemptLocator);
      const { entry: missingFull } = await readFullAssertionEntry(
        cwd,
        missingSlot.publication.attemptLocator,
        missingEntries[1]!.entryId,
      );
      missingFullAudit = missingFull.scoreMatchAudit;
      inlineEntries = await readAssertionsList(cwd, inlineSlot.publication.attemptLocator);
      serverCalls = (await server.calls()).length;
    }, 30_000);

    afterAll(async () => {
      await server.close();
      if (cwd) await rm(cwd, { recursive: true, force: true });
    });

    // @feature docs/feature/judge/README.md#precheck-and-retry
    test("unresolved credential settles only affected entries and keeps other work schedulable", () => {
      expect(completion).toBe("completed");
      expect(serverCalls).toBe(1);
      expect(missingEntries.map((e) => ("entry" in e ? e.entry.decision : undefined))).toEqual([
        expect.objectContaining({ result: "matched" }),
        expect.objectContaining({ result: "unavailable", reason: "source-unavailable" }),
      ]);
      expect(missingFullAudit).toMatchObject({
        state: "available",
        audit: { result: { state: "unavailable", code: "judge-key-unresolved" } },
      });

      const inlineFirst = inlineEntries[0];
      expect(inlineFirst && "entry" in inlineFirst ? inlineFirst.entry.decision.result : undefined).toBe("matched");
    });
  });

  const ordinaryConcurrencyCases = [
    { limit: 1, selection: "base", expectedPeak: 1 },
    { limit: 2, selection: "model", expectedPeak: 2 },
    { limit: 4, selection: "base", expectedPeak: 4 },
    { limit: 1, selection: "provider", expectedPeak: 4 },
    { limit: 4, selection: "http400", expectedPeak: 3 },
  ] as const;

  const ordinaryConcurrencyResults = new Map<
    string,
    {
      cwd: string;
      locator: string;
      ordinal: number;
      peak: number;
      dryReused?: number;
    }
  >();

  describe("ordinary maxConcurrency and registration order", () => {
    beforeAll(async () => {
      await Promise.all(
        ordinaryConcurrencyCases.map(async ({ limit, selection, expectedPeak }) => {
          let active = 0;
          let peak = 0;
          let ordinal = 0;
          const pending: Array<() => void> = [];
          const server = await startHttpServer((_req, body, res) => {
            const payload = JSON.parse(body);
            ++ordinal;
            if (selection === "http400" && JSON.stringify(payload.messages).includes("ordinary-0")) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: { message: "Invalid input" } }));
              return;
            }
            active++;
            peak = Math.max(peak, active);
            const reply = () => {
              active--;
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(chatToolResponse(payload.tool_choice.function.name, { measurement: 1, rationale: "Present" }, payload.model));
            };
            pending.push(reply);
            if (pending.length === expectedPeak) for (const done of pending.splice(0)) done();
            else {
              setTimeout(() => {
                const idx = pending.indexOf(reply);
                if (idx >= 0) {
                  pending.splice(idx, 1);
                  reply();
                }
              }, 150);
            }
          });
          const cwd = await createJudgeProject(`niceeval-conc-${selection}-${limit}-`, {
            config: `
              import { defineConfig } from "niceeval";
              import { OpenAIProvider } from "niceeval/judge";
              export default defineConfig({
                judgeProvider: OpenAIProvider({
                  model: "base-model",
                  baseUrl: ${JSON.stringify(server.baseUrl)},
                  apiKey: "k",
                  maxConcurrency: ${limit},
                }),
              });
            `,
            agent: `
              import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
              export default defineAgent({ name: "conc-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
            `,
            evals: {
              "conc.eval.ts": `
                import { defineScoreEval } from "niceeval";
                import { defineJudge } from "niceeval/expect";
                export default defineScoreEval({
                  async test(t) {
                    await t.send("go");
                    for (let i = 0; i < 4; i++) {
                      t.judge(\`ordinary-\${i}\`, defineJudge({ rubric: \`ordinary-\${i}\` })).score(1).label(\`ordinary-\${i}\`);
                    }
                  },
                });
              `,
            },
            experiments: {
              "conc.ts": `
                import { defineExperiment } from "niceeval";
                import { OpenAIProvider } from "niceeval/judge";
                import agent from "../agent.ts";
                export default defineExperiment({
                  adapter: agent,
                  ${
                    selection === "model"
                      ? 'judge: "overridden-model",'
                      : selection === "provider"
                        ? `judge: OpenAIProvider({ model: "replacement", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "k" }),`
                        : ""
                  }
                  evals: ["conc"],
                  attempts: 1,
                });
              `,
            },
          });
          try {
            const res = await planAndRunExperiment(cwd, "conc", {
              config: {
                judgeProvider: OpenAIProvider({
                  model: "base-model",
                  baseUrl: server.baseUrl,
                  apiKey: "k",
                  maxConcurrency: limit,
                }),
              },
              rerun: "all",
            });
            const slot = res.run?.slots[0];
            if (slot?.publication.state !== "published") throw new Error("Missing slot");
            let dryReused: number | undefined;
            if (selection === "base" && limit === 4) {
              // Changing maxConcurrency does not invalidate identity
              const preview = await Effect.runPromise(
                experimentHost.invocation.plan({
                  cwd,
                  experimentSelector: "conc",
                  config: {
                    judgeProvider: OpenAIProvider({
                      model: "base-model",
                      baseUrl: server.baseUrl,
                      apiKey: "k",
                      maxConcurrency: 1,
                    }),
                  },
                  preview: true,
                }),
              );
              if (preview.status === "ready" && preview.dry !== undefined) {
                dryReused = preview.dry.slots.filter((s) => s.state === "reuse").length;
              }
            }
            ordinaryConcurrencyResults.set(`${selection}-${limit}`, {
              cwd,
              locator: slot.publication.attemptLocator,
              ordinal,
              peak,
              ...(dryReused === undefined ? {} : { dryReused }),
            });
          } finally {
            await server.close();
          }
        }),
      );
    }, 30_000);

    afterAll(async () => {
      await Promise.all(
        [...ordinaryConcurrencyResults.values()].map((r) => rm(r.cwd, { recursive: true, force: true })),
      );
    });

    // @feature docs/feature/judge/README.md#precheck-and-retry
    test.each(ordinaryConcurrencyCases)(
      "managed Judge entries respect maxConcurrency=$limit ($selection) and preserve registration order",
      async ({ limit, selection, expectedPeak }) => {
        const result = ordinaryConcurrencyResults.get(`${selection}-${limit}`)!;
        expect(result.ordinal).toBe(4);
        expect(result.peak).toBe(expectedPeak);
        if (result.dryReused !== undefined) expect(result.dryReused).toBe(1);

        const [doc] = await showJsonDocuments(result.cwd, [result.locator]);
        const attempt = narrowInspectionSuccess(doc!, "attempt.get");
        if (!attempt.success) throw new Error(attempt.reason);
        expect(attempt.value.attempt.assertions.entries.map((e) => e.display.label)).toEqual([
          "ordinary-0",
          "ordinary-1",
          "ordinary-2",
          "ordinary-3",
        ]);
        expect(attempt.value.attempt.verdict).toBe(selection === "http400" ? "errored" : "passed");
        expect(attempt.value.attempt.score).toMatchObject(
          selection === "http400"
            ? { state: "unavailable", earned: 3, possible: 4, unavailable: 1 }
            : { state: "complete", earned: 4, possible: 4 },
        );

        const [usageDoc] = await showJsonDocuments(result.cwd, [result.locator, "usage"]);
        const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
        if (!usage.success) throw new Error(usage.reason);
        if (usage.value.usage.judgeUsage.state !== "complete") throw new Error("Expected complete usage");
        expect(usage.value.usage.judgeUsage.calls.map((c) => [c.entryIndex, c.entryId])).toEqual(
          attempt.value.attempt.assertions.entries.map((e, idx) => [idx, e.entryId]),
        );
      },
    );
  });

  describe("Agent Judge concurrent sessions and batch boundaries", () => {
    const sessionModes = ["overlap", "timeout", "queue"] as const;
    const sessionResults = new Map<
      string,
      {
        cwd: string;
        locator: string;
        errors: string[];
        peak: number;
        startedCount: number;
        completedCount: number;
      }
    >();

    beforeAll(async () => {
      await Promise.all(
        sessionModes.map(async (mode) => {
          let ordinary = 0;
          let ordinal = 0;
          let active = 0;
          let peak = 0;
          const started: string[] = [];
          const completed: string[] = [];
          const errors: string[] = [];
          const waiting = new Map<string, () => void>();
          const timers = new Set<ReturnType<typeof setTimeout>>();

          const server = await startHttpServer((_req, body, res) => {
            const payload = JSON.parse(body);
            const id = ++ordinal;
            const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
            if (!payload.stream) {
              ordinary++;
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(chatToolResponse(payload.tool_choice.function.name, { measurement: 1, rationale: "ok" }, payload.model, usage));
              return;
            }
            const user = payload.messages.findLast((m: { role: string }) => m.role === "user");
            const step = JSON.parse(
              typeof user.content === "string"
                ? user.content
                : user.content
                    .filter((p: { type: string }) => p.type === "text")
                    .map((p: { text: string }) => p.text)
                    .join("\n"),
            );
            const question: string = step.message;
            const name = question.split("-")[0]!;
            const first = question.endsWith("first");
            const tool = payload.messages.at(-1).role === "user" ? "read" : "submit_evaluation";
            if (ordinary !== 4) errors.push("review started before ordinary group completed");
            if (tool === "read") {
              started.push(question);
              if (!first && !completed.includes(`${name}-first`)) errors.push("second question overtook first");
              if (
                name === "boundary" &&
                !["alpha-second", "beta-second"].every((q) => completed.includes(q)) &&
                mode !== "timeout"
              ) {
                errors.push("boundary started early");
              }
              if (["gamma", "delta"].includes(name) && !completed.includes("boundary-second")) {
                errors.push("later batch started early");
              }
            }
            active++;
            peak = Math.max(peak, active);
            const send = () => {
              active--;
              if (tool === "submit_evaluation") completed.push(question);
              const args =
                tool === "read"
                  ? { path: "application.txt" }
                  : {
                      satisfied: true,
                      rationale: "Evidence read",
                      evidence: [{ kind: "file", ref: "application.txt", note: "Real file" }],
                    };
              res.writeHead(200, { "Content-Type": "text/event-stream" });
              res.end(
                `data: ${JSON.stringify({
                  id: `call-${id}`,
                  object: "chat.completion.chunk",
                  model: payload.model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        role: "assistant",
                        content: null,
                        tool_calls: [{ index: 0, id: `call-${id}`, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }],
                      },
                      finish_reason: "tool_calls",
                    },
                  ],
                  usage,
                })}\n\ndata: [DONE]\n\n`,
              );
            };
            if (mode === "timeout" && name === "alpha") {
              res.on("close", () => {
                active--;
              });
              return;
            }
            if (mode === "overlap" && first && tool === "read" && name !== "boundary") {
              waiting.set(name, send);
              const pair = ["alpha", "beta"].includes(name) ? ["alpha", "beta"] : ["gamma", "delta"];
              if (pair.every((k) => waiting.has(k))) {
                for (const k of pair) {
                  const done = waiting.get(k)!;
                  waiting.delete(k);
                  done();
                }
              }
              return;
            }
            const timer = setTimeout(
              () => {
                timers.delete(timer);
                send();
              },
              mode === "timeout" && name === "beta" ? 250 : mode === "queue" ? 50 : 5,
            );
            timers.add(timer);
          });

          const cwd = await createJudgeProject(`niceeval-aj-conc-${mode}-`, {
            config: `
              import { defineConfig } from "niceeval";
              import { OpenAIProvider } from "niceeval/judge";
              export default defineConfig({
                timeoutMs: 30_000,
                judgeProvider: OpenAIProvider({
                  model: "aj-conc",
                  baseUrl: ${JSON.stringify(server.baseUrl)},
                  apiKey: "k",
                  maxConcurrency: ${mode === "queue" ? 1 : 2},
                }),
              });
            `,
            agent: `
              import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
              import { shell } from "niceeval/sandbox";
              export default defineSandboxAgent({
                name: "aj-conc-agent",
                evidenceCoverage: completeEvidenceCoverage,
                install: { identity: { agent: "aj-conc-agent", version: "1", revision: "1" }, probe: shell("true") },
                send: async (_input, ctx) => {
                  await ctx.sandbox.writeText("application.txt", "evidence");
                  return { status: "completed", events: [] };
                },
              });
            `,
            sandbox: HOST_SANDBOX_SOURCE,
            evals: {
              "sessions.eval.ts": `
                import { defineScoreEval } from "niceeval";
                import { defineAgentJudge, defineJudge } from "niceeval/expect";
                export default defineScoreEval({
                  async test(t) {
                    await t.send("go");
                    for (let i = 0; i < 4; i++) {
                      t.judge(\`ordinary-\${i}\`, defineJudge({ rubric: \`ordinary-\${i}\` })).score(1).label(\`ordinary-\${i}\`);
                    }
                    for (const name of ["alpha", "beta", "boundary", "gamma", "delta"]) {
                      const review = t.agentJudge(
                        defineAgentJudge({
                          concurrent: name !== "boundary",
                          timeoutMs: ${mode === "timeout" ? 'name === "alpha" ? 200 : 10000' : 10000},
                        }),
                        { name },
                      );
                      review.judge(\`\${name}-first\`).score(1).label(\`\${name}-first\`);
                      review.judge(\`\${name}-second\`).score(1).label(\`\${name}-second\`);
                    }
                  },
                });
              `,
            },
            experiments: {
              "sessions.ts": `
                import { defineExperiment } from "niceeval";
                import agent from "../agent.ts";
                import sandbox from "../sandbox.ts";
                export default defineExperiment({ adapter: agent, sandbox, evals: ["sessions"], attempts: 1 });
              `,
            },
          });

          try {
            const res = await planAndRunExperiment(cwd, "sessions", {
              config: {
                timeoutMs: 30_000,
                judgeProvider: OpenAIProvider({
                  model: "aj-conc",
                  baseUrl: server.baseUrl,
                  apiKey: "k",
                  maxConcurrency: mode === "queue" ? 1 : 2,
                }),
              },
              rerun: "all",
            });
            const slot = res.run?.slots[0];
            if (slot?.publication.state !== "published") throw new Error(`Missing slot for ${mode}`);
            sessionResults.set(mode, {
              cwd,
              locator: slot.publication.attemptLocator,
              errors,
              peak,
              startedCount: started.length,
              completedCount: completed.length,
            });
          } finally {
            for (const timer of timers) clearTimeout(timer);
            await server.close();
          }
        }),
      );
    }, 45_000);

    afterAll(async () => {
      await Promise.all([...sessionResults.values()].map((r) => rm(r.cwd, { recursive: true, force: true })));
    });

    // @feature docs/feature/judge/README.md#precheck-and-retry
    test.each(sessionModes)("concurrent Agent Judge sessions (%s) respect batch boundaries and isolate timeouts", async (mode) => {
      const res = sessionResults.get(mode)!;
      expect(res.errors).toEqual([]);
      expect(res.peak).toBe(mode === "queue" ? 1 : 2);
      expect(res.startedCount).toBe(mode === "timeout" ? 9 : 10);
      expect(res.completedCount).toBe(mode === "timeout" ? 8 : 10);

      const [doc] = await showJsonDocuments(res.cwd, [res.locator]);
      const attempt = narrowInspectionSuccess(doc!, "attempt.get");
      if (!attempt.success) throw new Error(attempt.reason);
      expect(attempt.value.attempt.verdict).toBe(mode === "timeout" ? "errored" : "passed");
      expect(attempt.value.attempt.score).toMatchObject(
        mode === "timeout"
          ? { state: "unavailable", earned: 12, possible: 14, unavailable: 2 }
          : { state: "complete", earned: 14, possible: 14 },
      );

      const [usageDoc] = await showJsonDocuments(res.cwd, [res.locator, "usage"]);
      const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
      if (!usage.success) throw new Error(usage.reason);
      if (usage.value.usage.judgeUsage.state !== "complete") throw new Error("Expected complete usage");
      const agentCalls = usage.value.usage.judgeUsage.calls.filter((c) => c.operation === "agent");
      expect(agentCalls).toHaveLength(mode === "timeout" ? 16 : 20);
    });
  });
});

describe("Judge retry policy, Retry-After bounds, and abort during backoff", () => {
  const retryModes = fc.sample(
    fc.constantFrom("recover", "backoff", "persistent", "deadline", "header-no-retry", "body-no-retry", "protocol"),
    { numRuns: 7, seed: 90210 },
  );
  const retryResults = new Map<
    string,
    { cwd: string; locator: string; sentAt: number[]; expectedCount: number; expectedState: string }
  >();

  beforeAll(async () => {
    await Promise.all(
      retryModes.map(async (mode) => {
        const sentAt: number[] = [];
        const match = { model: "retry-model" };
        const headers = {
          ...(mode === "backoff" ? {} : { "Retry-After": mode === "deadline" ? "120" : "0.05" }),
          ...(mode === "header-no-retry" ? { "x-should-retry": "false" } : {}),
        };
        const rules: ModelRule[] = [
          {
            id: "provider-unavailable",
            match,
            ...(mode === "recover" || mode === "backoff" ? { times: 1 } : {}),
            error: { status: mode === "protocol" ? 400 : 502, message: "Fixture failure", headers },
          },
        ];
        if (mode === "recover") {
          rules.push({ id: "rate-limited", match, times: 1, error: { status: 429, message: "Fixture failure", headers } });
        }
        if (mode === "recover" || mode === "backoff") {
          rules.push({
            id: "recovered",
            match: { ...match, tool: "record_score_match" },
            reply: [{ type: "tool_call", name: "record_score_match", arguments: { measurement: 1, rationale: "Recovered" } }],
          });
        }
        const emulator = mode === "body-no-retry" ? undefined : await startModelEmulator(rules);
        const server = emulator ?? (await startHttpServer((_req, _body, res) => {
          sentAt.push(Date.now());
          res.writeHead(502, { "Content-Type": "application/json", ...headers });
          res.end(JSON.stringify({ error: { message: "Fixture failure", retryable: false } }));
        }));

        const cwd = await createJudgeProject(`niceeval-retry-${mode}-`, {
          config: `
            import { defineConfig } from "niceeval";
            import { OpenAIProvider } from "niceeval/judge";
            export default defineConfig({
              judgeProvider: OpenAIProvider({
                model: "retry-model",
                baseUrl: ${JSON.stringify(server.baseUrl)},
                apiKey: "k",
                timeoutMs: ${mode === "deadline" ? 1500 : 10_000},
              }),
            });
          `,
          agent: `
            import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
            export default defineAgent({ name: "retry-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
          `,
          evals: {
            "retry.eval.ts": `
              import { defineScoreEval } from "niceeval";
              import { defineJudge } from "niceeval/expect";
              export default defineScoreEval({
                test(t) {
                  t.judge({ text: "hello" }, defineJudge({ rubric: "Retry check" })).score(1).label("Retry policy");
                },
              });
            `,
          },
          experiments: {
            "retry.ts": `
              import { defineExperiment } from "niceeval";
              import agent from "../agent.ts";
              export default defineExperiment({ adapter: agent, evals: ["retry"], attempts: 1 });
            `,
          },
        });

        try {
          const res = await planAndRunExperiment(cwd, "retry", {
            config: {
              judgeProvider: OpenAIProvider({
                model: "retry-model",
                baseUrl: server.baseUrl,
                apiKey: "k",
                timeoutMs: mode === "deadline" ? 1500 : 10_000,
              }),
            },
            rerun: "all",
          });
          const slot = res.run?.slots[0];
          if (slot?.publication.state !== "published") throw new Error(`Missing slot for ${mode}`);
          const expectedCount =
            mode === "recover" || mode === "persistent" ? 3 : mode === "backoff" ? 2 : 1;
          const expectedState =
            mode === "recover" || mode === "backoff"
              ? "matched"
              : mode === "protocol"
                ? "errored"
                : "unavailable";
          if (emulator) sentAt.push(...(await emulator.calls()).map(({ time }) => Date.parse(time)));
          retryResults.set(mode, {
            cwd,
            locator: slot.publication.attemptLocator,
            sentAt,
            expectedCount,
            expectedState,
          });
        } finally {
          await server.close();
        }
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await Promise.all([...retryResults.values()].map((r) => rm(r.cwd, { recursive: true, force: true })));
  });

  // @feature docs/feature/judge/README.md#precheck-and-retry
  test.each(retryModes)("retry mode %s enforces retry count, backoff/Retry-After, and physical usage ledger", async (mode) => {
    const res = retryResults.get(mode)!;
    expect(res.sentAt).toHaveLength(res.expectedCount);
    if (mode === "backoff") expect(res.sentAt[1]! - res.sentAt[0]!).toBeGreaterThanOrEqual(1900);
    if (mode === "recover") {
      expect(res.sentAt[1]! - res.sentAt[0]!).toBeGreaterThanOrEqual(40);
      expect(res.sentAt[2]! - res.sentAt[1]!).toBeGreaterThanOrEqual(40);
    }

    const [attemptDoc] = await showJsonDocuments(res.cwd, [res.locator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const entry = attempt.value.attempt.assertions.entries[0]!;
    const detail = await readAssertionDetail(res.cwd, res.locator, entry.entryId);
    expect(detail.assertion).toMatchObject({ check: { state: res.expectedState } });

    const [usageDoc] = await showJsonDocuments(res.cwd, [res.locator, "usage"]);
    const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
    if (!usage.success) throw new Error(usage.reason);
    if (usage.value.usage.judgeUsage.state !== "complete") throw new Error("Expected complete usage");
    expect(usage.value.usage.judgeUsage.calls).toHaveLength(res.expectedCount);
    expect(usage.value.usage.judgeUsage.calls.map((c) => c.httpStatus)).toEqual(
      mode === "recover"
        ? [502, 429, 200]
        : mode === "backoff"
          ? [502, 200]
          : Array.from({ length: res.expectedCount }, () => (mode === "protocol" ? 400 : 502)),
    );
  });

  // @feature docs/feature/judge/README.md#precheck-and-retry
  test("cancelling during retry backoff sleep aborts before sending the retry request", async () => {
    let calls = 0;
    let firstDone!: () => void;
    const firstSeen = new Promise<void>((r) => {
      firstDone = r;
    });
    const server = await startHttpServer((_req, _body, res) => {
      calls++;
      res.writeHead(503, { "Retry-After": "10" });
      res.end("retry later");
      firstDone();
    });
    const cwd = await createJudgeProject("niceeval-retry-cancel-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: OpenAIProvider({ model: "retry-cancel", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "k", timeoutMs: 30_000 }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({ name: "rc-agent", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) });
      `,
      evals: {
        "rc.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          export default defineScoreEval({
            test(t) { t.judge({ text: "hello" }, defineJudge({ rubric: "Check" })).score(1); },
          });
        `,
      },
      experiments: {
        "rc.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({ adapter: agent, evals: ["rc"], attempts: 1 });`,
      },
    });
    const abort = new AbortController();
    try {
      const running = planAndRunExperiment(cwd, "rc", {
        config: {
          judgeProvider: OpenAIProvider({
            model: "retry-cancel",
            baseUrl: server.baseUrl,
            apiKey: "k",
            timeoutMs: 30_000,
          }),
        },
        rerun: "all",
        signal: abort.signal,
      });
      await firstSeen;
      abort.abort();
      const res = await running;
      expect(res.receipt?.completion).toBe("interrupted");
      expect(calls).toBe(1);
    } finally {
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("Ordinary Judge HTTP 200 errors", () => {
  const scenarios = [
    { name: "recovered", sse: false, recovery: true, partial: false, expected: ["failed", "succeeded"] },
    { name: "sse-recovered", sse: true, recovery: true, partial: false, expected: ["failed", "succeeded"] },
    { name: "exhausted", sse: false, recovery: false, partial: false, expected: ["failed", "failed", "failed"] },
    { name: "partial", sse: false, recovery: false, partial: true, expected: ["succeeded"] },
    { name: "sse-partial", sse: true, recovery: false, partial: true, expected: ["succeeded"] },
    { name: "opt-out", sse: false, recovery: false, partial: false, expected: ["failed"] },
  ];
  const reason = "gateway declined this request";
  const calls = new Map<string, number>();
  const locators = new Map<string, string>();
  let cwd: string | undefined;
  let server: Awaited<ReturnType<typeof startHttpServer>> | undefined;

  beforeAll(async () => {
    server = await startHttpServer((_req, body, res) => {
      const name = JSON.parse(body).model;
      const scenario = scenarios.find((item) => item.name === name);
      if (scenario === undefined) throw new Error(`Unexpected model ${name}`);
      const count = (calls.get(name) ?? 0) + 1;
      calls.set(name, count);
      const sse = scenario.sse && count === 1;
      res.writeHead(200, { "Content-Type": sse ? "text/event-stream" : "application/json", "Retry-After": "0.01" });
      if (scenario.recovery && count === 2) {
        res.end(chatToolResponse("record_score_match", { measurement: 1, rationale: "Recovered" }));
      } else if (sse) {
        const output = scenario.partial ? 'data: {"choices":[{"delta":{"content":"partial"}}]}\r\n\r\n' : "";
        res.end(`${output}event: error\r\ndata: ${JSON.stringify({ message: reason })}\r\n\r\n`);
      } else {
        res.end(JSON.stringify({
          error: { message: `${reason} ${count}`, ...(name === "opt-out" ? { retryable: false } : {}) },
          choices: scenario.partial ? [{ message: { content: "partial" } }] : [],
        }));
      }
    });
    cwd = await createJudgeProject("niceeval-judge-preoutput-", {
      agent: `import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({ name: "retry-agent", evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({ status: "completed", events: [] }) });`,
      evals: Object.fromEntries(scenarios.map(({ name }) => [
        `${name}.eval.ts`,
        `import { defineScoreEval } from "niceeval";
        import { defineJudge } from "niceeval/expect";
        export default defineScoreEval({ judge: ${JSON.stringify(name)},
          test(t) { t.judge("input", defineJudge({ rubric: "Check" })).score(1); } });`,
      ])),
      experiments: { "retry.ts": `import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        export default defineExperiment({ adapter: agent,
          evals: ${JSON.stringify(scenarios.map(({ name }) => name))}, attempts: 1 });` },
    });
    const result = await planAndRunExperiment(cwd, "retry", {
      config: { judgeProvider: OpenAIProvider({ model: "retry-model", baseUrl: server.baseUrl, apiKey: "k" }) },
      rerun: "all",
    });
    for (const slot of result.run?.slots ?? []) {
      if (slot.publication.state === "published") locators.set(slot.evalId, slot.publication.attemptLocator);
    }
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#precheck-and-retry
  test.each(scenarios)("$name retries only before output and records every request", async (scenario) => {
    const locator = locators.get(scenario.name);
    if (cwd === undefined || locator === undefined) throw new Error(`Missing retry slot for ${scenario.name}`);
    expect(calls.get(scenario.name)).toBe(scenario.expected.length);
    const [attemptDoc] = await showJsonDocuments(cwd, [locator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const detail = await readAssertionDetail(cwd, locator, attempt.value.attempt.assertions.entries[0]!.entryId);
    if ("fields" in detail.assertion) throw new Error("Expected one page for the small retry diagnostic");
    expect(detail.assertion.check.state).toBe(scenario.recovery ? "matched" : scenario.partial ? "errored" : "unavailable");
    if (scenario.name === "exhausted") expect(JSON.stringify(detail.assertion.check)).toContain(`${reason} 3`);
    const [usageDoc] = await showJsonDocuments(cwd, [locator, "usage"]);
    const usage = narrowInspectionSuccess(usageDoc!, "attempt.usage");
    if (!usage.success || usage.value.usage.judgeUsage.state !== "complete") throw new Error("Missing usage");
    expect(usage.value.usage.judgeUsage.calls.map(({ httpStatus, status }) => [httpStatus, status])).toEqual(
      scenario.expected.map((status) => [200, status]),
    );
  });
});
