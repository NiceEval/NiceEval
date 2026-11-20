import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  OpenAIProvider,
  OpenRouterProvider,
  TypesafeProvider,
  VercelProvider,
  binaryJudge,
  createJudgeProject,
  defineAgentJudge,
  defineJudge,
  factuality,
  faithfulness,
  HOST_SANDBOX_SOURCE,
  instructionFollowing,
  judgeImage,
  pairwisePreference,
  planAndRunExperiment,
  readAssertionDetail,
  readAssertionsList,
  readFullAssertionEntry,
  showJsonDocuments,
  startHttpServer,
  validPngBytes,
  narrowInspectionSuccess,
} from "./fixtures/judge-harness/harness.ts";

describe("Judge admission and validation", () => {
  // @feature docs/feature/judge/README.md#material-admission
  test("configuring Judge providers and definitions validates options strictly without network requests", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Unexpected network request during Judge configuration");
    });
    try {
      fc.assert(
        fc.property(
          fc.constantFrom("openai", "vercel", "openrouter", "typesafe") as fc.Arbitrary<
            "openai" | "vercel" | "openrouter" | "typesafe"
          >,
          fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0 && !/\p{Cc}/u.test(s)),
          fc.integer({ min: 1, max: 32 }),
          (kind, model, maxConcurrency) => {
            const factory =
              kind === "openai"
                ? OpenAIProvider
                : kind === "vercel"
                  ? VercelProvider
                  : kind === "openrouter"
                    ? OpenRouterProvider
                    : TypesafeProvider;
            const provider = factory({
              model,
              baseUrl: "https://judge.example.invalid/v1/",
              apiKeyEnv: "NICEEVAL_TEST_UNUSED_KEY",
              timeoutMs: 30_000,
              maxResponseBytes: 8_192,
              maxConcurrency,
              headers: { "X-Tenant": "tenant-1" },
            });
            expect(Object.isFrozen(provider)).toBe(true);
            expect(Object.keys(provider)).toEqual([]);

            // Reject invalid options across all factories
            expect(() => factory({ model: "" } as never)).toThrow();
            expect(() => factory({ model: "m\n1" } as never)).toThrow();
            expect(() => factory({ model, baseUrl: "ftp://judge.example.invalid" } as never)).toThrow();
            expect(() => factory({ model, baseUrl: "https://user:pass@judge.example.invalid" } as never)).toThrow();
            expect(() => factory({ model, baseUrl: "https://judge.example.invalid?q=1" } as never)).toThrow();
            expect(() => factory({ model, apiKey: "a", apiKeyEnv: "B" } as never)).toThrow();
            expect(() => factory({ model, maxConcurrency: 0 } as never)).toThrow();
            expect(() => factory({ model, maxConcurrency: 33 } as never)).toThrow();
            expect(() => factory({ model, unknownField: true } as never)).toThrow();

            // Header validation
            expect(() => factory({ model, headers: "bad" } as never)).toThrow("headers must be an object");
            expect(() => factory({ model, headers: ["a"] } as never)).toThrow("headers must be an object");
            const accessorHeaders = {};
            Object.defineProperty(accessorHeaders, "X-Custom", { get: () => "v", enumerable: true });
            expect(() => factory({ model, headers: accessorHeaders } as never)).toThrow(
              "must be an enumerable data property",
            );
            const nonEnumHeaders = {};
            Object.defineProperty(nonEnumHeaders, "X-Custom", { value: "v", enumerable: false });
            expect(() => factory({ model, headers: nonEnumHeaders } as never)).toThrow(
              "must be an enumerable data property",
            );
            expect(() => factory({ model, headers: { "   ": "val" } })).toThrow("non-empty and control-free");
            expect(() => factory({ model, headers: { "X-Bad\n": "val" } })).toThrow("non-empty and control-free");
            expect(() => factory({ model, headers: { "X-Key": "" } })).toThrow("non-empty and control-free string");
            expect(() => factory({ model, headers: { "X-Key": "a\nb" } })).toThrow("non-empty and control-free string");
          },
        ),
        { numRuns: 16 },
      );

      // contextWindow & maxOutputTokens restrictions
      for (const bad of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => OpenAIProvider({ model: "gpt-4o", contextWindow: bad })).toThrow("contextWindow");
      }
      expect(() => TypesafeProvider({ model: "system-one", contextWindow: 32_768 } as never)).toThrow();
      expect(() => TypesafeProvider({ model: "system-one", maxOutputTokens: 128 } as never)).toThrow();

      // Definition factories
      expect(() => defineJudge({ rubric: "   " })).toThrow();
      expect(() =>
        defineJudge({
          rubric: "r",
          anchors: [
            { measurement: 0.2, description: "a" },
            { measurement: 1, description: "b" },
          ],
        }),
      ).toThrow();
      expect(() =>
        defineJudge({
          rubric: "r",
          anchors: [
            { measurement: 0, description: "a" },
            { measurement: 0.5, description: "b" },
            { measurement: 0.5, description: "c" },
            { measurement: 1, description: "d" },
          ],
        }),
      ).toThrow();
      expect(() => binaryJudge({ rubric: "r", anchors: [] } as never)).toThrow();
      expect(() => factuality({ maxCalls: 0 })).toThrow();
      expect(() => factuality({ extra: true } as never)).toThrow();
      expect(() => faithfulness({ maxMaterialBytes: "bad" as never })).toThrow();
      expect(() => instructionFollowing({ maxCalls: "bad" as never })).toThrow();
      expect(() => pairwisePreference({ maxMaterialBytes: "bad" as never })).toThrow();
      expect(() => defineAgentJudge({ instructions: "   " })).toThrow();
      expect(() => defineAgentJudge({ maxTurns: 0 })).toThrow();
      expect(() => defineAgentJudge({ timeoutMs: -5 })).toThrow();
      expect(() => defineAgentJudge({ extra: 1 } as never)).toThrow();

      // Image validation
      expect(() => judgeImage({ body: new Uint8Array(0), mediaType: "image/png" })).toThrow();
      expect(() => judgeImage({ body: new Uint8Array([1, 2, 3]), mediaType: "image/png" })).toThrow();
      expect(() => judgeImage({ body: validPngBytes(), mediaType: "image/jpeg" })).toThrow();
      expect(() => judgeImage({ body: validPngBytes(), mediaType: "image/png", extra: 1 } as never)).toThrow();

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("Judge runtime admission and zero-network rejections", () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  const requests: string[] = [];
  const projects: string[] = [];

  beforeAll(async () => {
    server = await startHttpServer((_req, body, res) => {
      requests.push(body);
      if (body.includes("Valid question Q1") && !body.includes("Caught stop Q2")) {
        const payload = JSON.parse(body);
        const call = {
          index: 0,
          id: "call-q1",
          type: "function",
          function: {
            name: "submit_evaluation",
            arguments: JSON.stringify({
              satisfied: true,
              rationale: "Q1 valid",
              evidence: [{ kind: "observation", ref: "q1", note: "valid step" }],
            }),
          },
        };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          `data: ${JSON.stringify({
            id: "gen-q1",
            object: "chat.completion.chunk",
            model: payload.model,
            choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [call] }, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })}\n\ndata: [DONE]\n\n`,
        );
        return;
      }
      res.writeHead(500);
      res.end("must not be called");
    });
  });

  afterAll(async () => {
    await server.close();
    await Promise.all(projects.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  describe("shared runtime admission & authoring violations", () => {
    let cwd: string;
    let authoringCwd: string;
    let invalidAssertions: Awaited<ReturnType<typeof readAssertionsList>>;
    let ordinaryRes: Awaited<ReturnType<typeof planAndRunExperiment>>;
    let typesafeRes: Awaited<ReturnType<typeof planAndRunExperiment>>;
    let chatRes: Awaited<ReturnType<typeof planAndRunExperiment>>;
    let directRes: Awaited<ReturnType<typeof planAndRunExperiment>>;
    let stopRes: Awaited<ReturnType<typeof planAndRunExperiment>>;
    let mixedStopRes: Awaited<ReturnType<typeof planAndRunExperiment>>;
    let sharedError: string;

    beforeAll(async () => {
      const invalidMaterialCases = fc.sample(
        fc.constantFrom("getter", "bigint", "symbol", "hole", "nan", "cycle", "forged-match"),
        { numRuns: 7, seed: 104729 },
      );
      const invalidCwd = await createJudgeProject("niceeval-judge-admission-", {
        config: `
          import { defineConfig } from "niceeval";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineConfig({
            judgeProvider: OpenAIProvider({ model: "admission-model", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "k" }),
          });
        `,
        agent: `
          import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
          export default defineAgent({
            name: "admission-agent",
            evidenceCoverage: completeEvidenceCoverage,
            send: async () => ({ status: "completed", events: [] }),
          });
        `,
        evals: {
          "admission.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineJudge, equals, factuality } from "niceeval/expect";
            const rubric = defineJudge({ rubric: "Valid rubric" });
            const cases = ${JSON.stringify(invalidMaterialCases)};
            export default defineScoreEval({
              async test(t) {
                let getterCalls = 0;
                for (const kind of cases) {
                  try {
                    if (kind === "getter") {
                      const obj = {};
                      Object.defineProperty(obj, "trap", {
                        enumerable: true,
                        get() { getterCalls++; return "should-not-read"; },
                      });
                      t.judge(obj, rubric);
                    } else if (kind === "bigint") {
                      t.judge({ n: 1n } as never, rubric);
                    } else if (kind === "symbol") {
                      t.judge({ s: Symbol("x") } as never, rubric);
                    } else if (kind === "hole") {
                      const arr: unknown[] = [];
                      arr[1] = "x";
                      t.judge(arr as never, rubric);
                    } else if (kind === "nan") {
                      t.judge({ n: Number.NaN }, rubric);
                    } else if (kind === "cycle") {
                      const cyc: Record<string, unknown> = {};
                      cyc.self = cyc;
                      t.judge(cyc as never, rubric);
                    } else if (kind === "forged-match") {
                      t.check("ok", { kind: "score", name: "forged" } as never);
                    }
                  } catch {}
                }
                t.check(getterCalls, equals(0)).label("Getter never invoked");
                t.judge({ input: " ", output: "a", expected: "b" }, factuality()).label("Blank preset rejected before transport");
              },
            });
          `,
        },
        experiments: {
          "admission.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../agent.ts";
            export default defineExperiment({ adapter: agent, evals: ["admission"], attempts: 1 });
          `,
        },
      });
      projects.push(invalidCwd);
      const invalidResult = await planAndRunExperiment(invalidCwd, "admission", {
        config: {
          judgeProvider: OpenAIProvider({ model: "admission-model", baseUrl: server.baseUrl, apiKey: "k" }),
        },
        rerun: "all",
      });
      expect(invalidResult.receipt?.completion).toBe("completed");
      const invalidSlot = invalidResult.run?.slots[0];
      if (invalidSlot?.publication.state !== "published") throw new Error("Expected published slot");
      invalidAssertions = await readAssertionsList(invalidCwd, invalidSlot.publication.attemptLocator);

      cwd = await createJudgeProject("niceeval-judge-zero-net-", {
        config: `export default {};`,
        agent: `
          import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
          import { shell } from "niceeval/sandbox";
          export default defineSandboxAgent({
            name: "zero-net-agent",
            evidenceCoverage: completeEvidenceCoverage,
            install: { identity: { agent: "zero-net-agent", version: "1", revision: "1" }, probe: shell("true") },
            send: async () => ({ status: "completed", events: [] }),
          });
        `,
        extra: {
          "direct-agent.ts": `
            import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
            export default defineAgent({
              name: "zero-net-direct",
              evidenceCoverage: completeEvidenceCoverage,
              send: async () => ({ status: "completed", events: [] }),
            });
          `,
        },
        sandbox: HOST_SANDBOX_SOURCE,
        evals: {
          "ordinary-and-unresolved.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineJudge, equals } from "niceeval/expect";
            export default defineScoreEval({
              async test(t) {
                t.check(1, equals(1)).score(1).label("Ordinary check");
                t.judge({ text: "hello" }, defineJudge({ rubric: "Check" })).score(1).label("Unresolved provider");
              },
            });
          `,
          "typesafe-rejections.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineAgentJudge, defineJudge, faithfulness } from "niceeval/expect";
            import { judgeImage } from "niceeval/judge";
            const png = new Uint8Array(${JSON.stringify([...validPngBytes()])});
            const elevenAnchors = Array.from({ length: 11 }, (_, i) => ({
              measurement: i / 10,
              description: "Anchor " + i,
            }));
            export default defineScoreEval({
              async test(t) {
                await t.send("run");
                t.judge({ input: "q", output: "a", context: "c" }, faithfulness()).score(1).label("TypeSafe extract");
                t.judge("text", defineJudge({ rubric: "11 anchors", anchors: elevenAnchors })).score(1).label("TypeSafe 11 anchors");
                t.judge({ img: judgeImage({ body: png, mediaType: "image/png" }) }, defineJudge({ rubric: "img" })).score(1).label("TypeSafe image");
                t.agentJudge(defineAgentJudge({}), {}).judge("Agent Judge on TypeSafe").score(1).label("TypeSafe agent");
              },
            });
          `,
          "chat-capabilities-and-budget.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineAgentJudge, defineJudge } from "niceeval/expect";
            import { judgeImage } from "niceeval/judge";
            const png = new Uint8Array(${JSON.stringify([...validPngBytes()])});
            export default defineScoreEval({
              async test(t) {
                await t.send("run");
                t.judge({ img: judgeImage({ body: png, mediaType: "image/png" }) }, defineJudge({ rubric: "img" })).score(1).label("Images disabled");
                t.judge({ huge: "x".repeat(500) }, defineJudge({ rubric: "budget", maxMaterialBytes: 16 })).score(1).label("Ordinary budget");
                t.agentJudge(defineAgentJudge({ maxMaterialBytes: 16 }), { huge: "x".repeat(500) }).judge("Agent budget").score(1).label("Agent budget");
                t.agentJudge(defineAgentJudge({}), { evidence: "Large opening. ".repeat(4000) }).judge("Context budget").score(1).label("Agent context budget");
                const chatOnly = t.agentJudge(defineAgentJudge({}), { ok: true });
                chatOnly.chat("CHAT_ONLY_MUST_NOT_SEND");
              },
            });
          `,
        },
        experiments: {
          "ordinary.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../direct-agent.ts";
            export default defineExperiment({ adapter: agent, evals: ["ordinary-and-unresolved"], attempts: 1 });
          `,
          "typesafe.ts": `
            import { defineExperiment } from "niceeval";
            import { TypesafeProvider } from "niceeval/judge";
            import agent from "../agent.ts";
            import sandbox from "../sandbox.ts";
            export default defineExperiment({
              adapter: agent,
              sandbox,
              // Deliberately unset apiKeyEnv: capability checks must reject before credential lookup.
              judge: TypesafeProvider({ model: "jev-1", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKeyEnv: "NICEEVAL_UNSET_KEY" }),
              evals: ["typesafe-rejections"],
              attempts: 1,
            });
          `,
          "chat-caps.ts": `
            import { defineExperiment } from "niceeval";
            import { OpenAIProvider } from "niceeval/judge";
            import agent from "../agent.ts";
            import sandbox from "../sandbox.ts";
            export default defineExperiment({
              adapter: agent,
              sandbox,
              judge: OpenAIProvider({ model: "gpt-4o-mini", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "unused-key", contextWindow: 8000 }),
              evals: ["chat-capabilities-and-budget"],
              attempts: 1,
            });
          `,
        },
      });
      projects.push(cwd);

      [ordinaryRes, typesafeRes, chatRes] = await Promise.all([
        planAndRunExperiment(cwd, "ordinary"),
        planAndRunExperiment(cwd, "typesafe"),
        planAndRunExperiment(cwd, "chat-caps"),
      ]);

      authoringCwd = await createJudgeProject("niceeval-agent-judge-authoring-", {
        config: `
          import { defineConfig } from "niceeval";
          import { OpenAIProvider } from "niceeval/judge";
          export default defineConfig({
            judgeProvider: OpenAIProvider({ model: "m", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "k" }),
          });
        `,
        agent: `
          import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
          import { shell } from "niceeval/sandbox";
          export default defineSandboxAgent({
            name: "sandbox-agent",
            evidenceCoverage: completeEvidenceCoverage,
            install: { identity: { agent: "sandbox-agent", version: "1", revision: "1" }, probe: shell("true") },
            send: async () => ({ status: "completed", events: [] }),
          });
        `,
        sandbox: HOST_SANDBOX_SOURCE,
        extra: {
          "direct-agent.ts": `
            import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
            export default defineAgent({
              name: "direct-agent",
              evidenceCoverage: completeEvidenceCoverage,
              send: async () => ({ status: "completed", events: [] }),
            });
          `,
        },
        evals: {
          "direct.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineAgentJudge } from "niceeval/expect";
            export default defineScoreEval({
              test(t) { t.agentJudge(defineAgentJudge({}), {}).judge("Needs sandbox"); },
            });
          `,
          "stop.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineAgentJudge } from "niceeval/expect";
            export default defineScoreEval({
              async test(t) {
                await t.send("hi");
                t.agentJudge(defineAgentJudge({}), {}).judge("No stop").gate(0.5).score(4).orStop();
              },
            });
          `,
          "mixed-stop.eval.ts": `
            import { defineScoreEval } from "niceeval";
            import { defineAgentJudge } from "niceeval/expect";
            export default defineScoreEval({
              async test(t) {
                await t.send("hi");
                const review = t.agentJudge(defineAgentJudge({}), {});
                review.judge("Valid question Q1").score(2).label("Q1");
                try {
                  review.judge("Caught stop Q2").score(3).gate(0.5).label("Q2").orStop();
                } catch {}
              },
            });
          `,
        },
        experiments: {
          "direct.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../direct-agent.ts";
            export default defineExperiment({ adapter: agent, evals: ["direct"], attempts: 1 });
          `,
          "shared.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../agent.ts";
            import sandbox from "../sandbox.ts";
            export default defineExperiment({ adapter: agent, sandbox, sharedState: { key: "shared-key" }, evals: ["stop"], attempts: 1 });
          `,
          "stop.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../agent.ts";
            import sandbox from "../sandbox.ts";
            export default defineExperiment({ adapter: agent, sandbox, evals: ["stop"], attempts: 1 });
          `,
          "mixed-stop.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../agent.ts";
            import sandbox from "../sandbox.ts";
            export default defineExperiment({ adapter: agent, sandbox, evals: ["mixed-stop"], attempts: 1 });
          `,
        },
      });
      projects.push(authoringCwd);

      sharedError = await planAndRunExperiment(authoringCwd, "shared").then(
        () => "",
        (error) => String(error),
      );
      [directRes, stopRes, mixedStopRes] = await Promise.all([
        planAndRunExperiment(authoringCwd, "direct", {
          config: { judgeProvider: OpenAIProvider({ model: "m", baseUrl: server.baseUrl, apiKey: "k" }) },
          rerun: "all",
        }),
        planAndRunExperiment(authoringCwd, "stop", {
          config: { judgeProvider: OpenAIProvider({ model: "m", baseUrl: server.baseUrl, apiKey: "k" }) },
          rerun: "all",
        }),
        planAndRunExperiment(authoringCwd, "mixed-stop", {
          config: { judgeProvider: OpenAIProvider({ model: "m", baseUrl: server.baseUrl, apiKey: "k" }) },
          rerun: "all",
        }),
      ]);
    }, 30_000);

    // @feature docs/feature/judge/README.md#material-admission
    test("invalid material never triggers accessors, creates Assertions, or sends requests", () => {
      expect(invalidAssertions.map((e) => [e.display.label, e.entry.decision.result])).toEqual([
        ["Getter never invoked", "matched"],
        ["Blank preset rejected before transport", "errored"],
      ]);
      expect(requests.filter((r) => r.includes('"admission-model"'))).toEqual([]);
    });

    // @feature docs/feature/judge/README.md#material-admission
    test("capability rejections, budget limits, ordinary assertions, and unresolved provider send zero requests", async () => {
      expect(requests.filter((r) => !r.includes('"model":"m"'))).toEqual([]);

      // Ordinary & unresolved provider
      const ordSlot = ordinaryRes.run?.slots[0];
      if (ordSlot?.publication.state !== "published") throw new Error("Missing ordinary slot");
      const ordAssertions = await readAssertionsList(cwd, ordSlot.publication.attemptLocator);
      expect(ordAssertions[0]?.entry.decision.result).toBe("matched");
      expect(ordAssertions[1]?.entry.decision).toMatchObject({
        result: "unavailable",
        reason: "source-unavailable",
      });
      const { entry: ordUnresolved } = await readFullAssertionEntry(
        cwd,
        ordSlot.publication.attemptLocator,
        ordAssertions[1]!.entryId,
      );
      expect(ordUnresolved.scoreMatchAudit).toMatchObject({
        state: "available",
        audit: { result: { state: "unavailable", code: "judge-provider-unresolved" } },
      });

      // TypeSafe capability rejections
      const tsSlot = typesafeRes.run?.slots[0];
      if (tsSlot?.publication.state !== "published") throw new Error("Missing typesafe slot");
      const [tsDoc] = await showJsonDocuments(cwd, [tsSlot.publication.attemptLocator, "assertions"]);
      const tsAssertions = narrowInspectionSuccess(tsDoc!, "attempt.assertions");
      if (!tsAssertions.success) throw new Error(tsAssertions.reason);
      for (const entry of tsAssertions.value.assertions) {
        if (!("entry" in entry)) throw new Error("Expected assertion entry");
        expect(entry.entry.decision.result).toBe("unavailable");
        const { detail, entry: fullEntry } = await readFullAssertionEntry(cwd, tsSlot.publication.attemptLocator, entry.entryId);
        if (fullEntry.agentJudgeAudit?.state === "available") {
          expect(fullEntry.agentJudgeAudit.audit.result).toMatchObject({
            state: "unavailable",
            code: "agent-judge-unsupported-provider",
          });
        } else {
          expect(JSON.stringify(detail)).toContain("judge-capability-unavailable");
        }
      }

      // Chat capability & budget rejections (and chat-only session created zero entries)
      const chatSlot = chatRes.run?.slots[0];
      if (chatSlot?.publication.state !== "published") throw new Error("Missing chat-caps slot");
      const [chatDoc] = await showJsonDocuments(cwd, [chatSlot.publication.attemptLocator, "assertions"]);
      const chatAssertions = narrowInspectionSuccess(chatDoc!, "attempt.assertions");
      if (!chatAssertions.success) throw new Error(chatAssertions.reason);
      const chatItems = chatAssertions.value.assertions.map((e) => {
        if (!("entry" in e) || !("display" in e)) throw new Error("Expected assertion item");
        return e;
      });
      expect(chatItems.map((e) => e.display.label)).toEqual([
        "Images disabled",
        "Ordinary budget",
        "Agent budget",
        "Agent context budget",
      ]);
      for (const item of chatItems) {
        expect(item.entry.decision.result).toBe("unavailable");
      }
      const imgDetail = await readAssertionDetail(
        cwd,
        chatSlot.publication.attemptLocator,
        chatItems[0]!.entryId,
      );
      expect(JSON.stringify(imgDetail)).toContain("judge-capability-unavailable");
      const { entry: ctxEntry } = await readFullAssertionEntry(
        cwd,
        chatSlot.publication.attemptLocator,
        chatItems[3]!.entryId,
      );
      if (ctxEntry.agentJudgeAudit?.state === "available") {
        expect(ctxEntry.agentJudgeAudit.audit.result).toMatchObject({
          state: "unavailable",
          code: "judge-material-exceeds-context",
        });
      } else {
        throw new Error("Expected available agentJudgeAudit for context budget");
      }
    });

    // @feature docs/feature/judge/README.md#material-admission
    test("Agent Judge direct agent and shared sandbox fail before transport", async () => {
      // shared sandbox rejected at planning
      expect(sharedError).toContain("judge.agent-shared-sandbox");

      // direct agent rejected during test(t)
      const directSlot = directRes.run?.slots[0];
      if (directSlot?.publication.state !== "published") throw new Error("Expected direct slot");
      const [directExecDoc] = await showJsonDocuments(authoringCwd, [directSlot.publication.attemptLocator, "execution"]);
      expect(JSON.stringify(directExecDoc)).toContain("judge.agent-requires-sandbox");
      expect(requests.filter((r) => r.includes("Needs sandbox"))).toEqual([]);
    });

    // Regression counterexample: calling .orStop() on Agent Judge throws judge.agent-stop-unsupported
    // at registration time; entry stays with errored/evaluation-errored without audit or Judge HTTP requests,
    // and valid sibling questions in the same session still execute normally.
    // @feature docs/feature/judge/README.md#material-admission
    test("Agent Judge .orStop() rejects at registration without sending Judge requests", async () => {
      const stopSlot = stopRes.run?.slots[0];
      if (stopSlot?.publication.state !== "published") throw new Error("Expected stop slot");
      const [stopExecDoc] = await showJsonDocuments(authoringCwd, [stopSlot.publication.attemptLocator, "execution"]);
      expect(JSON.stringify(stopExecDoc)).toContain("judge.agent-stop-unsupported");
      const stopAssertions = await readAssertionsList(authoringCwd, stopSlot.publication.attemptLocator);
      expect(stopAssertions).toHaveLength(1);
      expect(stopAssertions[0]?.entry.decision).toMatchObject({ result: "errored", reason: "evaluator-failed" });
      expect(stopAssertions[0]?.entry.contribution).toMatchObject({
        state: "unavailable",
        points: 4,
        reason: "evaluation-errored",
      });
      expect(requests.filter((r) => r.includes("No stop"))).toEqual([]);

      const mixedSlot = mixedStopRes.run?.slots[0];
      if (mixedSlot?.publication.state !== "published") throw new Error("Expected mixed-stop slot");
      const mixedAssertions = await readAssertionsList(authoringCwd, mixedSlot.publication.attemptLocator);
      expect(mixedAssertions.map((e) => [e.display.label, e.entry.decision.result, e.entry.contribution])).toEqual([
        ["Q1", "matched", { state: "earned", points: 2, earned: 2 }],
        ["Q2", "errored", { state: "unavailable", points: 3, reason: "evaluation-errored" }],
      ]);
      const { entry: q1Full } = await readFullAssertionEntry(
        authoringCwd,
        mixedSlot.publication.attemptLocator,
        mixedAssertions[0]!.entryId,
      );
      expect(q1Full.agentJudgeAudit?.state).toBe("available");
      expect(requests.some((r) => r.includes("Valid question Q1"))).toBe(true);
      expect(requests.filter((r) => r.includes("Caught stop Q2"))).toEqual([]);
    });
  });
});
