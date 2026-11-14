import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createE2EContext, defined, only, pollUntil, command, withInspectionRequest } from "@niceeval/testkit";
import { expect, test } from "vitest";

const scenario = createE2EContext({ repoId: "agent-judge", project: {
  from: process.cwd(), prefix: "niceeval-agent-review-", omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
}, commands: { niceeval: [resolve("node_modules/.bin/niceeval")] } });

// Only this external model endpoint is scripted. pi, HTTP, Sandbox and storage are real.
function modelServer(mode: string) {
  const bodies: string[] = [];
  let ordinal = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      if (!payload.tools) throw new Error("Expected tools protocol");
      bodies.push(body);
      ordinal += 1;
      if (mode === "timeout") return;
      if (mode === "response-limit") { response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "x".repeat(4 * 1024 * 1024) }, finish_reason: "stop" }] })); return; }
      if (mode === "http400") { response.writeHead(400); response.end("invalid request"); return; }
      if (mode === "malformed") { response.end('{"choices":[]}'); return; }
      if (mode === "transport") { response.writeHead(503); response.end("unavailable"); return; }
      const lastUser = payload.messages.findLast((message: { role: string }) => message.role === "user");
      const step = JSON.parse(lastUser.content);
      const last = payload.messages.at(-1);
      const call = (name: string, args: unknown, suffix = "") => ({ id: `call-${ordinal}${suffix}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
      const submit = call("submit_evaluation", { measurement: 1, rationale: "Observed real Sandbox evidence", evidence: [{ kind: "file", ref: "application.txt", note: "Read application evidence" }] });
      let calls: unknown[] = [];
      let text: string | null = null;
      if (step.kind === "chat") text = "Ready to inspect.";
      else if (mode === "cancel") calls = [call("bash", { command: "touch judge-running; sleep 30; touch late-write" })];
      else if (mode === "no-submit") text = "I decline to grade.";
      else if (mode === "turns" && step.message === "First question") calls = [call("read", { path: "application.txt" })];
      else if (step.message === "First question" && last.role === "user") calls = [call("read", { path: mode === "truncation" ? "large.txt" : "application.txt" })];
      else if (step.message === "First question" && last.role === "tool" && (last.content.includes('"truncated"') || last.content.includes("application evidence"))) calls = [call("write", { path: "review.txt", content: "review evidence" })];
      else if (mode === "success" && step.message === "Second question" && last.role === "user") calls = [call("submit_evaluation", { measurement: 2, rationale: "invalid", evidence: [] })];
      else if (mode !== "turns" && step.message.includes("preceding") && last.role === "user") calls = [call("read", { path: "review.txt" })];
      else calls = [submit, call("write", { path: "MUST_NOT_WRITE", content: "forbidden" }, "-skipped")];
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: `generation-${ordinal}`, object: "chat.completion", model: "agent-review-fixture", created: 0,
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        choices: [{ index: 0, finish_reason: calls.length > 0 ? "tool_calls" : "stop", message: { role: "assistant", content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}) } }],
      }));
    });
  });
  return { server, bodies };
}

// @feature docs/feature/judge/README.md
test.concurrent.each(["success", "barrier", "no-submit", "turns", "timeout", "http400", "malformed", "transport", "budget", "material", "typesafe", "response-limit", "truncation"])("Agent Judge keeps real Sandbox evidence and terminal classification: %s", async (mode) => {
  const { server, bodies } = modelServer(mode);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing model endpoint");
  try {
    await scenario.case(`agent-judge-${mode}`, async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "agent-judge", "--rerun", "all", "--json"], { timeoutMs: 180_000,
        env: { ...process.env, NICEEVAL_E2E_AGENT_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_AGENT_JUDGE_KEY: "fixture-only-key", NICEEVAL_E2E_AGENT_JUDGE_MODE: mode } });
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const evaluation = only(run.expEvalEvents(), (entry) => entry.evalId === "agent-judge", run.diagnostic());
      const locator = defined(evaluation.locator);
      const attempt = await withInspectionRequest({ kind: "attempt.get", locator }, async (path) => {
        const result = await niceeval.run(["query", "run", "--request", path]);
        expect(result.exitCode, result.diagnostic()).toBe(0);
        return result.querySuccess("attempt.get");
      });
      expect(attempt.attempt.assertions.entries, run.diagnostic()).toHaveLength(mode === "barrier" ? 5 : 4);
      const entries = attempt.attempt.assertions.entries.filter((entry) => ["First review", "Second review", "Following session"].includes(entry.display.label ?? ""));
      for (const [index, entry] of entries.slice(0, 3).entries()) {
        await withInspectionRequest({ kind: "attempt.assertion.detail", locator, entryId: entry.entryId }, async (path) => {
          const result = await niceeval.run(["query", "run", "--request", path]);
          const detail = result.attemptAssertionDetail();
          if (!("entry" in detail.assertion)) throw new Error(result.diagnostic());
          const audit = detail.assertion.entry.agentJudgeAudit;
          if (mode === "budget") {
            expect(audit).toBeUndefined();
            expect(JSON.stringify(detail)).toContain("agent-judge-audit-budget");
            return;
          }
          expect(audit, JSON.stringify(detail)).toMatchObject({ state: "available" });
          if (audit?.state !== "available") throw new Error("Missing audit");
          const expected = ["success", "barrier", "truncation"].includes(mode) || mode === "turns" && index > 0 ? "measured" : ["http400", "malformed"].includes(mode) ? "errored" : "unavailable";
          expect(audit.audit.result.state, `${mode} question ${index}: ${JSON.stringify(audit.audit.result)}`).toBe(expected);
          expect(audit.trace.steps.filter((step) => step.kind === "judge")).toHaveLength(index === 2 ? 1 : 2);
          if (mode === "truncation" && index === 0) {
            const read = audit.trace.tools.find((tool) => tool.name === "read");
            expect(read?.result).toContain('"truncated":true');
            expect(read?.result).not.toContain("�");
          }
          if (index === 1) expect(audit.audit.trace.state).toBe("reference");
          if (mode === "success" && index === 0) {
            expect(audit.trace.tools.some((tool) => tool.name === "read" && tool.result?.includes("application evidence"))).toBe(true);
            expect(audit.trace.tools.filter((tool) => tool.name === "write" && tool.state === "completed")).toHaveLength(1);
            expect(audit.trace.tools.some((tool) => tool.state === "not-started")).toBe(true);
          }
        });
      }
      if (mode === "success") {
        const shown = await niceeval.run(["show", locator, "--assertions", "--entry", entries[0]!.entryId, "--full"]);
        expect(shown.stdout).toContain("Measurement"); expect(shown.stdout).toContain("Observed real Sandbox evidence"); expect(shown.stdout).toContain("application evidence");
        const diff = await niceeval.run(["show", locator, "--diff"]);
        expect(diff.stdout).not.toContain("review evidence"); expect(diff.stdout).not.toContain("MUST_NOT_WRITE");
        const usage = await niceeval.run(["show", locator, "--usage"]);
        expect(usage.stdout).toContain("agent");
      }
      expect(JSON.stringify(bodies)).not.toContain("MUTATED_MATERIAL");
      expect(JSON.stringify(bodies)).not.toContain("CHAT_ONLY_MUST_NOT_SEND");
      expect(JSON.stringify(bodies)).not.toContain("TRAILING_CHAT_MUST_NOT_SEND");
      if (["budget", "material", "typesafe"].includes(mode)) expect(bodies).toHaveLength(0);
    });
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

// @feature docs/feature/judge/README.md
test.concurrent.each(["direct", "shared", "stop"])("Agent Judge rejects incompatible authoring before model transport: %s", async (mode) => {
  await scenario.case(`agent-judge-${mode}`, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "agent-judge", "--rerun", "all", "--json"], { timeoutMs: 90_000,
      env: { ...process.env, NICEEVAL_E2E_AGENT_JUDGE_MODE: mode } });
    expect(run.exitCode, run.diagnostic()).not.toBe(0);
    if (mode === "stop") {
      const locator = defined(only(run.expEvalEvents(), () => true).locator);
      await withInspectionRequest({ kind: "attempt.trace", locator }, async (path) => {
        const trace = await niceeval.run(["query", "run", "--request", path]);
        expect(JSON.stringify(trace.querySuccess("attempt.trace"))).toContain("judge.agent-stop-unsupported");
      });
      return;
    }
    expect(run.stdout + run.stderr).toContain(mode === "direct" ? "judge.agent-requires-sandbox" : mode === "shared" ? "judge.agent-shared-sandbox" : "judge.agent-stop-unsupported");
  });
});

// @feature docs/feature/judge/README.md
test.concurrent("Cancelling Agent Judge stops the real Sandbox command tree and prevents further requests", async () => {
  const { server, bodies } = modelServer("cancel");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing model endpoint");
  try {
    await scenario.case("agent-judge-cancel", async ({ commands: { niceeval } }) => {
      const controlled = niceeval.start(["exp", "agent-judge", "--rerun", "all", "--json"], { timeoutMs: 90_000,
        env: { ...process.env, NICEEVAL_E2E_AGENT_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_AGENT_JUDGE_KEY: "fixture-only-key", NICEEVAL_E2E_AGENT_JUDGE_MODE: "cancel" } });
      try {
        const container = await pollUntil(async () => {
          const listed = await command(["docker"]).run(["ps", "-q", "--filter", `label=niceeval.pid=${defined(controlled.pid)}`]);
          for (const id of listed.stdout.trim().split(/\s+/u).filter(Boolean)) {
            const marker = await command(["docker"]).run(["exec", id, "test", "-f", "/home/sandbox/workspace/judge-running"]);
            if (marker.exitCode === 0) return id;
          }
          return undefined;
        }, { timeoutMs: 60_000, intervalMs: 100, label: "Judge command started in owned Sandbox" });
        expect(controlled.signal("SIGINT")).toBe(true);
        const interrupted = await controlled.done;
        expect(interrupted.expReceipt().completion, interrupted.diagnostic()).toBe("interrupted");
        const count = bodies.length;
        const stopped = await command(["docker"]).run(["ps", "-aq", "--filter", `id=${container}`]);
        expect(stopped.stdout.trim()).toBe("");
        expect(bodies).toHaveLength(count);
      } finally { await controlled.dispose(); }
    });
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

// @feature docs/feature/judge/README.md
test.concurrent("Agent Judge reuse follows question, budget and effective model inputs", async () => {
  const { server, bodies } = modelServer("success");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing model endpoint");
  try {
    await scenario.case("agent-judge-identity", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const env = { ...process.env, NICEEVAL_E2E_AGENT_JUDGE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_AGENT_JUDGE_KEY: "fixture-only-key" };
      const initial = await niceeval.run(["exp", "agent-judge", "--json"], { env, timeoutMs: 90_000 });
      expect(initial.exitCode, initial.diagnostic()).toBe(0);
      const first = bodies.length;
      const reused = await niceeval.run(["exp", "agent-judge", "--json"], { env, timeoutMs: 90_000 });
      expect(reused.exitCode, reused.diagnostic()).toBe(0);
      expect(bodies).toHaveLength(first);
      const file = join(projectRoot, "evals/agent-judge.eval.ts");
      for (const [before, after] of [["First question", "Revised question"], ["? 1 : 8", "? 1 : 9"]]) {
        await writeFile(file, (await readFile(file, "utf8")).replace(before!, after!));
        const count = bodies.length;
        const changed = await niceeval.run(["exp", "agent-judge", "--json"], { env, timeoutMs: 90_000 });
        expect(changed.exitCode, changed.diagnostic()).toBe(0);
        expect(bodies.length).toBeGreaterThan(count);
      }
      const count = bodies.length;
      const model = await niceeval.run(["exp", "agent-judge", "--json"], { env: { ...env, NICEEVAL_E2E_AGENT_JUDGE_MODEL: "revised-model" }, timeoutMs: 90_000 });
      expect(model.exitCode, model.diagnostic()).toBe(0);
      expect(bodies.length).toBeGreaterThan(count);
      expect(JSON.parse(bodies.at(-1)!).model).toBe("revised-model");
    });
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
