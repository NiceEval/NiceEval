import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  HOST_SANDBOX_SOURCE, OpenAIProvider, createJudgeProject, invokeCli, narrowInspectionSuccess,
  planAndRunExperiment, readFullAssertionEntry, readPaginatedTrace, showJsonDocuments, startHttpServer,
} from "./fixtures/judge-harness/harness.ts";

const actors = ["judge", "user"] as const;
const modes = ["recover", "persistent", "protocol", "stream", "deadline", "cancel"] as const;
const cases = actors.flatMap((actor) => modes.map((mode) => ({ actor, mode, name: `${actor}-${mode}` })));

describe("Managed pi retries use HTTP status within the caller budget", () => {
  const projects: string[] = [];
  const observations = new Map<string, { count: number; intervals: number[]; verdict: string | null; evidence: string; human: string }>();
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  const sent = new Map<string, number[]>();
  const controllers = new Map<string, AbortController>();

  beforeAll(async () => {
    server = await startHttpServer((_req, body, res) => {
      const payload = JSON.parse(body);
      const scenario = cases.find((item) => item.name === payload.model)!;
      const times = sent.get(scenario.name) ?? [];
      times.push(Date.now()); sent.set(scenario.name, times);
      if (scenario.mode === "cancel") setTimeout(() => controllers.get(scenario.name)!.abort(), 30);
      const success = scenario.mode === "recover" && times.length === 3;
      if (!success && scenario.mode !== "stream") {
        res.writeHead(scenario.mode === "protocol" ? 400 : times.length === 2 ? 503 : 429, {
          "Content-Type": "text/plain", "Retry-After": ["deadline", "cancel"].includes(scenario.mode) ? "5" : "0.04",
        });
        // A raw gateway error omits the status from pi's assistant errorMessage.
        // Its text deliberately has no pi retry-regex keywords.
        res.end("Concurrency limit exceeded for account, please retry later");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (scenario.mode === "stream") {
        res.end(`data: ${JSON.stringify({ error: { message: "rate limit during stream" } })}\n\ndata: [DONE]\n\n`);
        return;
      }
      const args = scenario.actor === "judge"
        ? { satisfied: true, rationale: "Recovered", evidence: [{ kind: "observation", ref: "input", note: "Observed" }] }
        : { message: "Confirmed" };
      res.end(`data: ${JSON.stringify({
        id: "generation-1", object: "chat.completion.chunk", model: payload.model,
        choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: scenario.actor === "judge" ? "submit_evaluation" : "reply_to_agent", arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })}\n\ndata: [DONE]\n\n`);
    });
    for (const scenario of cases) {
      const timeoutMs = scenario.mode === "deadline" ? 250 : 10000;
      const cwd = await createJudgeProject("niceeval-managed-retry-", {
        agent: `import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
          import { shell } from "niceeval/sandbox";
          export default defineSandboxAgent({ name: "retry-agent", evidenceCoverage: completeEvidenceCoverage,
            install: { identity: { agent: "retry-agent", version: "1", revision: "1" }, probe: shell("true") },
            send: async () => ({ status: "completed", events: [{ type: "message", role: "assistant", text: "Question" }] }) });`,
        sandbox: HOST_SANDBOX_SOURCE,
        evals: { "retry.eval.ts": `import { defineEval, defineSimulatedUser } from "niceeval";
          import { defineAgentJudge, equals } from "niceeval/expect";
          export default defineEval({ async test(t) {
            const turn = await t.send("go");
            ${scenario.actor === "judge"
              ? `t.agentJudge(defineAgentJudge({ timeoutMs: ${timeoutMs} }), { fact: "supplied" }).judge("Inspect").gate(1);`
              : `const user = t.simulatedUser(defineSimulatedUser({ instructions: "Confirm", timeoutMs: ${timeoutMs} }));
                 const next = await user.reply(turn); t.check(next.status, equals("completed"));`}
          } });` },
        experiments: { "retry.ts": `import { defineExperiment } from "niceeval"; import agent from "../agent.ts"; import sandbox from "../sandbox.ts";
          export default defineExperiment({ adapter: agent, sandbox, evals: ["retry"], attempts: 1 });` },
      });
      projects.push(cwd);
      const controller = new AbortController(); controllers.set(scenario.name, controller);
      const result = await planAndRunExperiment(cwd, "retry", { config: {
        timeoutMs: 15000,
        judgeProvider: OpenAIProvider({ model: scenario.name, baseUrl: server.baseUrl, apiKey: "fixture-secret", maxOutputTokens: 128 }),
      }, signal: controller.signal, rerun: "all" });
      if (scenario.mode === "cancel") {
        observations.set(scenario.name, { count: sent.get(scenario.name)!.length, intervals: [], verdict: null, evidence: "", human: "" });
        continue;
      }
      const slot = result.run?.slots[0];
      if (slot?.publication.state !== "published") throw new Error(`Missing retry slot ${scenario.name}`);
      const locator = slot.publication.attemptLocator;
      const [doc] = await showJsonDocuments(cwd, [locator]);
      const attempt = narrowInspectionSuccess(doc!, "attempt.get");
      if (!attempt.success) throw new Error(attempt.reason);
      const evidence: string[] = [];
      if (scenario.actor === "judge") {
        const item = attempt.value.attempt.assertions.entries[0]!;
        const { entry } = await readFullAssertionEntry(cwd, locator, item.entryId);
        evidence.push(JSON.stringify(entry));
        if (entry.agentJudgeAudit?.state === "available") evidence.push((await readPaginatedTrace(cwd, locator, entry.agentJudgeAudit.audit.trace.id)).bytes.toString("utf8"));
      } else {
        const [traceDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
        const trace = narrowInspectionSuccess(traceDoc!, "attempt.trace");
        if (!trace.success) throw new Error(trace.reason);
        for (const event of trace.value.trace.execution.events.filter((event) => event.source.id === "niceeval.simulated-user"))
          for (const item of event.evidence) {
            const raw = JSON.parse((await readPaginatedTrace(cwd, locator, item.evidenceId)).bytes.toString("utf8"));
            const activity = typeof raw === "string" ? JSON.parse(raw) : raw;
            evidence.push(JSON.stringify(activity), activity.conversation ?? "");
          }
      }
      const human = await invokeCli(cwd, ["show", locator, ...(scenario.actor === "judge" ? [attempt.value.attempt.assertions.entries[0]!.entryId, "--full"] : [])]);
      if (human.code !== 0) throw new Error(human.stderr);
      const times = sent.get(scenario.name)!;
      observations.set(scenario.name, { count: times.length, intervals: times.slice(1).map((time, i) => time - times[i]!), verdict: attempt.value.attempt.verdict, evidence: evidence.join("\n"), human: human.stdout });
    }
  }, 120000);

  afterAll(async () => {
    await server?.close();
    await Promise.all(projects.map((cwd) => rm(cwd, { recursive: true, force: true })));
  });

  // @feature docs/feature/judge/README.md#precheck-and-retry
  // @feature docs/feature/eval/README.md#simulated-user-failures
  test.each(cases)("$name keeps retries bounded and retains HTTP facts", ({ name, mode }) => {
    const result = observations.get(name)!;
    expect(sent.get(name)!.length).toBe(result.count);
    if (mode === "cancel") { expect(result.count).toBe(1); return; }
    expect(result.count).toBe(mode === "recover" || mode === "persistent" ? 3 : 1);
    expect(result.verdict).toBe(mode === "recover" ? "passed" : "errored");
    for (const interval of result.intervals) { expect(interval).toBeGreaterThanOrEqual(35); expect(interval).toBeLessThan(1500); }
    expect(result.evidence.includes('"customType":"niceeval.http"')).toBe(true);
    expect(result.evidence).toContain(`"status":${mode === "protocol" ? 400 : mode === "stream" ? 200 : 429}`);
    if (mode === "persistent" || mode === "protocol") {
      expect(result.human).toContain(`HTTP ${mode === "protocol" ? 400 : 429}`);
      expect(result.human).toContain("Concurrency limit exceeded");
    }
  });
});
