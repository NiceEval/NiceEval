import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  HOST_SANDBOX_SOURCE,
  OpenAIProvider,
  createJudgeProject,
  invokeCli,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readFullAssertionEntry,
  readPaginatedTrace,
  showJsonDocuments,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";

// Reduced DB-GPT counterexample: a bash argument contains an Authorization
// assignment. Redacting only the pi history breaks its association with tools.
const secrets = fc.sample(fc.stringMatching(/^[a-f0-9]{16}$/), { seed: 20261121, numRuns: 3 });
const modes = [...secrets.map((secret) => ({ name: secret, secret, corrupt: false })),
  { name: "duplicate-call", secret: "fixture-secret", corrupt: true },
  { name: "provider-failure", secret: "fixture-secret", corrupt: false }];

describe("Agent Judge redacted audit preserves associations and diagnostics", () => {
  const projects: string[] = [];
  const results = new Map<string, { entries: unknown[]; trace: string; human: string }>();
  let server: Awaited<ReturnType<typeof startHttpServer>>;

  beforeAll(async () => {
    let ordinal = 0;
    server = await startHttpServer((_req, body, res) => {
      const payload = JSON.parse(body);
      if (payload.model === "provider-failure") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Gateway rejected request; retry settings require inspection" } }));
        return;
      }
      const mode = modes.find((item) => item.name === payload.model)!;
      const last = payload.messages.at(-1);
      const command = `printf '%s' 'Authorization: Bearer ${mode.secret}'\nprintf 'evidence'`;
      const args = last.role === "user"
        ? { command }
        : { satisfied: true, rationale: `Checked authorization: Bearer ${mode.secret}`, evidence: [{ kind: "observation", ref: "local", note: `key=${mode.secret}` }] };
      const name = last.role === "user" ? "bash" : "submit_evaluation";
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({
        id: `generation-${++ordinal}`,
        object: "chat.completion.chunk",
        model: payload.model,
        choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: mode.corrupt ? "duplicate" : `call-${ordinal}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })}\n\ndata: [DONE]\n\n`);
    });
    for (const mode of modes) {
      const cwd = await createJudgeProject("niceeval-audit-association-", {
        agent: `
          import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
          import { shell } from "niceeval/sandbox";
          export default defineSandboxAgent({ name: "audit-agent", evidenceCoverage: completeEvidenceCoverage,
            install: { identity: { agent: "audit-agent", version: "1", revision: "1" }, probe: shell("true") },
            send: async () => ({ status: "completed", events: [] }) });
        `,
        sandbox: HOST_SANDBOX_SOURCE,
        evals: { "audit.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineAgentJudge } from "niceeval/expect";
          export default defineScoreEval({ async test(t) {
            await t.send("go");
            const review = t.agentJudge(defineAgentJudge({ timeoutMs: 5000 }), { fact: "supplied" });
            review.judge("Inspect first").score(1);
            review.judge("Inspect second").score(1);
          } });
        ` },
        experiments: { "audit.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          import sandbox from "../sandbox.ts";
          export default defineExperiment({ adapter: agent, sandbox, evals: ["audit"], attempts: 1 });
        ` },
      });
      projects.push(cwd);
      const result = await planAndRunExperiment(cwd, "audit", { config: {
        timeoutMs: 10000,
        judgeProvider: OpenAIProvider({ model: mode.name, baseUrl: server.baseUrl, apiKey: mode.secret, maxOutputTokens: 128 }),
      }, rerun: "all" });
      const slot = result.run?.slots[0];
      if (slot?.publication.state !== "published") throw new Error("Missing audit slot");
      const locator = slot.publication.attemptLocator;
      const [document] = await showJsonDocuments(cwd, [locator]);
      const attempt = narrowInspectionSuccess(document!, "attempt.get");
      if (!attempt.success) throw new Error(attempt.reason);
      const entries = [];
      let trace = "";
      for (const item of attempt.value.attempt.assertions.entries) {
        const { entry } = await readFullAssertionEntry(cwd, locator, item.entryId);
        entries.push(entry);
        if (entry.agentJudgeAudit?.state === "available")
          trace = (await readPaginatedTrace(cwd, locator, entry.agentJudgeAudit.audit.trace.id)).bytes.toString("utf8");
      }
      const human = await invokeCli(cwd, ["show", locator, attempt.value.attempt.assertions.entries[0]!.entryId, "--full"]);
      results.set(mode.name, { entries, trace, human: human.stdout });
    }
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await Promise.all(projects.map((cwd) => rm(cwd, { recursive: true, force: true })));
  });

  // @feature docs/feature/judge/README.md#score-audit
  test.each(secrets)("redacting credential %s preserves scores and every tool association", (secret) => {
    const result = results.get(secret)!;
    for (const entry of result.entries) expect(entry).toMatchObject({ agentJudgeAudit: { state: "available", audit: { result: { state: "measured", value: 1 } } } });
    expect(result.trace).not.toBe("");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.trace).toContain("[redacted");
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test("invalid audit identifies the violated validation rule without payloads", () => {
    const result = results.get("duplicate-call")!;
    for (const entry of result.entries) expect(entry).toMatchObject({ agentJudgeAudit: { state: "invalid", message: expect.stringContaining("pi tool call") } });
    expect(result.human).toContain("pi tool call");
    expect(result.human).not.toContain("fixture-secret");
  });

  // @feature docs/feature/judge/README.md#failures-and-cancellation
  test("human detail includes the retained provider failure cause", () => {
    expect(results.get("provider-failure")!.human).toContain("Gateway rejected request");
  });
});
