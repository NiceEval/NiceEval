import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  HOST_SANDBOX_SOURCE,
  OpenAIProvider,
  createJudgeProject,
  planAndRunExperiment,
  readFullAssertionEntry,
  readPaginatedTrace,
  showJsonDocuments,
  narrowInspectionSuccess,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";

// The Agent Judge seals its pi session history like the simulated user does; the same
// credential redaction must apply when a provider failure echoes request headers.
const token = fc.string({ unit: fc.constantFrom(..."0123456789abcdef".split("")), minLength: 16, maxLength: 24 });
const [apiKey, headerSecret] = fc
  .sample(fc.tuple(token, token), { numRuns: 1, seed: 5 })
  .flatMap(([a, b]) => [`key-${a}`, `hdr-${b}`]);

describe("Agent Judge sealed audit credential redaction", () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let cwd: string;
  let audit = "";

  beforeAll(async () => {
    server = await startHttpServer((req, _body, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `rejected: Authorization: ${req.headers.authorization} X-Fixture: ${req.headers["x-fixture"]} key ${apiKey} at ${server.baseUrl}`,
          },
        }),
      );
    });
    const provider = (baseUrl: string) =>
      `OpenAIProvider({ model: "aj-model", baseUrl: ${JSON.stringify(baseUrl)}, apiKey: ${JSON.stringify(apiKey)}, maxOutputTokens: 128, headers: { "X-Fixture": ${JSON.stringify(headerSecret)} } })`;
    cwd = await createJudgeProject("niceeval-aj-redaction-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({ timeoutMs: 30_000, judgeProvider: ${provider(server.baseUrl)} });
      `,
      agent: `
        import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
        import { shell } from "niceeval/sandbox";
        export default defineSandboxAgent({
          name: "aj-redaction-agent",
          evidenceCoverage: completeEvidenceCoverage,
          install: { identity: { agent: "aj-redaction-agent", version: "1", revision: "1" }, probe: shell("true") },
          send: async () => ({ status: "completed", events: [{ type: "message", role: "assistant", text: "done" }] }),
        });
      `,
      sandbox: HOST_SANDBOX_SOURCE,
      evals: {
        "aj.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineAgentJudge } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) {
              await t.send("go");
              t.agentJudge(defineAgentJudge({ timeoutMs: 10_000 }), { fact: "supplied" }).judge("Inspect").score(1);
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
    const res = await planAndRunExperiment(cwd, "aj", {
      config: {
        timeoutMs: 30_000,
        judgeProvider: OpenAIProvider({
          model: "aj-model",
          baseUrl: server.baseUrl,
          apiKey: apiKey!,
          maxOutputTokens: 128,
          headers: { "X-Fixture": headerSecret! },
        }),
      },
      rerun: "all",
    });
    const slot = res.run?.slots[0];
    if (slot?.publication.state !== "published") throw new Error("Missing Agent Judge slot");
    const locator = slot.publication.attemptLocator;
    const [attemptDoc] = await showJsonDocuments(cwd, [locator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const { entry } = await readFullAssertionEntry(cwd, locator, attempt.value.attempt.assertions.entries[0]!.entryId);
    if (entry.agentJudgeAudit?.state !== "available") throw new Error("Missing Agent Judge audit");
    audit = [
      JSON.stringify(entry),
      (await readPaginatedTrace(cwd, locator, entry.agentJudgeAudit.audit.trace.id)).bytes.toString("utf8"),
    ].join("\n");
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test("a provider failure echoing credentials leaves none in the sealed Agent Judge audit", () => {
    expect(audit).toContain("rejected");
    for (const secret of [apiKey!, headerSecret!, server.baseUrl])
      expect(audit.includes(secret), `leaked ${secret}`).toBe(false);
  });
});
