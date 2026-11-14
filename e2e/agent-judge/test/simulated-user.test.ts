import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext, defined, only, pollUntil, withInspectionRequest } from "@niceeval/testkit";
import { decodeSimulatedUserActivity } from "niceeval/inspection";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";

const invalidModes = ["invalid", "duplicate", "missing", "unknown", "both"];
const guardModes = ["stale", "foreign", "busy", "clone", "closed"];

const scenario = createE2EContext({ repoId: "agent-judge", project: {
  from: process.cwd(), prefix: "niceeval-simulated-user-", omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
}, commands: { niceeval: [resolve("node_modules/.bin/niceeval")] } });

// Only the external HTTP model is scripted; the installed Session and pi are real.
// @feature docs/feature/eval/README.md
test.concurrent.each(["waiting", "message", "invalid", "no-answer", "typesafe", "timeout", "cancel", "stale", "foreign", "busy", "clone", "closed", "race", "duplicate", "missing", "unknown", "both", "correct", "compact", "compact-failed", "large-session"])("Simulated user answers within its Session and retains execution evidence: %s", async mode => {
  const bodies: string[] = [];
  let ordinary = 0;
  let overflowed = false;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const summary = payload.messages[0]?.content?.includes("context summarization assistant") === true;
      bodies.push(body);
      if (mode === "timeout" || mode === "cancel") return;
      if (summary && mode === "compact-failed") { response.writeHead(400); response.end("summary unavailable"); return; }
      if (!summary) ordinary++;
      if (!summary && mode.startsWith("compact") && ordinary === 2 && !overflowed) {
        overflowed = true; response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "maximum context length exceeded", code: "context_length_exceeded", type: "invalid_request_error" } })); return;
      }
      const answer = (mode === "message" || mode === "large-session" || mode.startsWith("compact")) ? { message: `CONTINUE_${ordinary}` }
        : { answers: [{ requestId: "note", text: "Tier 1" }, { requestId: "choice", optionId: "allow" }] };
      if (mode === "invalid" || mode === "correct" && ordinary === 1) answer.answers = [{ requestId: "choice", optionId: "WRONG" }, { requestId: "note", text: "Tier 1" }];
      if (mode === "duplicate") Object.assign(answer, { answers: [{ requestId: "choice", optionId: "allow" }, { requestId: "choice", optionId: "allow" }] });
      if (mode === "missing") Object.assign(answer, { answers: [{ requestId: "choice", optionId: "allow" }] });
      if (mode === "unknown") Object.assign(answer, { answers: [{ requestId: "choice", optionId: "allow" }, { requestId: "unknown", text: "Tier 1" }] });
      if (mode === "both") Object.assign(answer, { answers: [{ requestId: "choice", optionId: "allow", text: "Yes" }, { requestId: "note", text: "Tier 1" }] });
      const calls = summary || mode === "no-answer" || mode === "large-session" && ordinary === 1 ? [] : [
        { index: 0, id: `answer-${bodies.length}`, type: "function", function: { name: "reply_to_agent", arguments: JSON.stringify(answer) } },
        ...(mode === "waiting" ? [{ index: 1, id: `duplicate-${bodies.length}`, type: "function", function: { name: "reply_to_agent", arguments: JSON.stringify(answer) } }] : []),
      ];
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const finish = () => response.end(`data: ${JSON.stringify({ id: `generation-${bodies.length}`, object: "chat.completion.chunk", model: payload.model,
        choices: [{ index: 0, delta: { role: "assistant", content: mode === "large-session" && ordinary === 1 ? "LARGE_SESSION_START" + "x".repeat(4 * 1024 * 1024) + "LARGE_SESSION_END" : summary ? "User chose Tier 1. Continue answering." : calls.length ? null : "No answer.", ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\ndata: [DONE]\n\n`);
      if (mode === "race") setTimeout(finish, 150); else finish();
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing HTTP endpoint");
  try {
    await scenario.case(`simulated-user-${mode}`, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(join(projectRoot, "niceeval.config.ts"), `
import { defineConfig } from "niceeval";
import { OpenAIProvider, TypesafeProvider } from "niceeval/judge";
export default defineConfig({ maxConcurrency: ${mode === "closed" ? 1 : 10}, timeoutMs: 20000, pricing: { "simulated-fixture": { inputPerMTok: 1, outputPerMTok: 2 } },
judgeProvider: ${mode === "typesafe" ? "TypesafeProvider" : "OpenAIProvider"}({ model: "simulated-fixture", baseUrl: "http://127.0.0.1:${address.port}/v1", apiKey: "fixture-only"${mode === "typesafe" ? "" : ", maxOutputTokens: 128"} }) });
`);
      await writeFile(join(projectRoot, "experiments/simulated.ts"), `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { appendFile } from "node:fs/promises";
export default defineExperiment({ attempts: ${mode === "closed" ? 2 : 1}, earlyExit: false, evals: ["simulated"], adapter: defineAgent({ name: "questioner", evidenceCoverage: completeEvidenceCoverage,
async send(input, ctx) {
  await appendFile("drives.jsonl", JSON.stringify({ text: input.text, responses: input.responses, session: ctx.session.index }) + "\\n");
  if (input.text === "SLOW") await new Promise(resolve => setTimeout(resolve, 80));
  // Answer generation has an 8s budget; the Agent continuation owns its own deadline.
  if (${mode === "waiting"} && input.responses || ${mode === "message"} && input.text === "CONTINUE_1") await new Promise(resolve => setTimeout(resolve, 9000));
  const waiting = ${!["message", "compact", "compact-failed", "large-session"].includes(mode)} && input.text === "START";
  return { status: waiting ? "waiting" : "completed", events: waiting ? [
    { type: "input.requested", request: { id: "choice", prompt: "Allow?", options: [{ id: "allow", label: "Yes" }, { id: "deny" }] } },
    { type: "input.requested", request: { id: "note", prompt: "Which tier?" } },
  ] : [{ type: "message", role: "assistant", text: "Agent question " + input.text + ${mode.startsWith("compact") ? '"x".repeat(100000)' : '""'} }] };
} }) });
`);
      await writeFile(join(projectRoot, "evals/simulated.eval.ts"), `
import { defineEval, defineSimulatedUser } from "niceeval";
import { readFile, writeFile } from "node:fs/promises";
let prior;
export default defineEval({ async test(t) {
  const user = t.simulatedUser(defineSimulatedUser({ instructions: "Choose allow and Tier 1. Do not invent other facts.", timeoutMs: ${mode === "timeout" ? 100 : 8000} }));
  const first = await t.send("START");
  if (${mode === "closed"}) {
    if (prior === undefined) { prior = { user, first }; return; }
    try { await prior.user.reply(prior.first); throw new Error("Closed instance accepted a Turn"); }
    catch (error) { if (error.code !== "simulated-user-invalid-turn" || error.reason !== "closed") throw error; }
    return;
  }
  let source = first;
  if (${mode === "stale"}) await t.send("NEW");
  if (${mode === "foreign"}) source = await t.newSession().send("OTHER");
  if (${mode === "clone"}) source = { ...first };
  const inFlight = ${mode === "busy"} ? t.send("SLOW") : undefined;
  try {
    const reply = user.reply(source);
    if (${mode === "race"}) { await new Promise(resolve => setTimeout(resolve, 80)); await t.send("NEW"); }
    const next = await reply;
    if (next === first) throw new Error("Expected a new Turn");
    if (${["message", "compact", "compact-failed"].includes(mode)}) await user.reply(next);
  } catch (error) { await writeFile("caught.json", JSON.stringify({ code: error.code, reason: error.reason })); }
  await inFlight;
  const drives = (await readFile("drives.jsonl", "utf8")).trim().split("\\n").map(JSON.parse);
  const expected = ${["waiting", "correct", "large-session"].includes(mode) ? 2 : ["message", "compact"].includes(mode) ? 3 : ["stale", "foreign", "busy", "race", "compact-failed", "large-session"].includes(mode) ? 2 : 1};
  if (drives.length !== expected) throw new Error("Unexpected Adapter sends " + JSON.stringify(drives) + " caught=" + await readFile("caught.json", "utf8").catch(() => "none"));
  if (${["waiting", "correct"].includes(mode)} && JSON.stringify(drives[1].responses) !== JSON.stringify([{ requestId: "choice", optionId: "allow" }, { requestId: "note", text: "Tier 1" }])) throw new Error("Responses must be atomic and ordered");
  if (t.usage.inputTokens.state === "exact" && t.usage.inputTokens.value > 0) throw new Error("Simulated usage leaked into application usage");
} });
`);
      if (mode === "cancel") {
        const controlled = niceeval.start(["exp", "simulated", "--json"], { timeoutMs: 30_000 });
        try {
          await pollUntil(async () => bodies.length > 0 ? true : undefined, { timeoutMs: 15_000, intervalMs: 25, label: "Simulated model request started" });
          expect(controlled.signal("SIGINT")).toBe(true);
          const interrupted = await controlled.done;
          expect(interrupted.expReceipt().completion, interrupted.diagnostic()).toBe("interrupted");
          expect((await readFile(join(projectRoot, "drives.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
          expect(bodies).toHaveLength(1);
        } finally { await controlled.dispose(); }
        return;
      }
      const run = await niceeval.run(["exp", "simulated", "--json"], { timeoutMs: 60_000 });
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const evaluation = only(run.expEvalEvents(), event => event.evalId === "simulated", run.diagnostic());
      const locator = defined(evaluation.locator);
      const attempt = await withInspectionRequest({ kind: "attempt.get", locator }, async path => (await niceeval.run(["query", "run", "--request", path])).querySuccess("attempt.get"));
      expect(attempt.attempt.assertions.entries).toHaveLength(0);
      const failed = [...invalidModes, "no-answer", "typesafe", "timeout", "cancel", "compact-failed"].includes(mode);
      expect(attempt.attempt.verdict, run.diagnostic()).toBe(failed ? "errored" : "passed");
      if ([...guardModes, "typesafe"].includes(mode)) expect(bodies).toHaveLength(0);
      if (invalidModes.includes(mode) || mode === "no-answer") expect(ordinary).toBe(4);
      if (mode === "waiting") expect(ordinary).toBe(1);
      if (mode === "correct") expect(ordinary).toBe(2);
      if (mode === "message") {
        expect(ordinary).toBe(2);
        expect(bodies[1]).toContain("CONTINUE_1");
        expect(bodies[1]).toContain("Agent question START");
      }
      if (!guardModes.includes(mode)) {
        const trace = await withInspectionRequest({ kind: "attempt.trace", locator }, async path => (await niceeval.run(["query", "run", "--request", path])).attemptTrace());
        if (failed) {
          const diagnostic = defined(trace.trace.diagnostics.items.find(item => item.code === (mode === "typesafe" ? "simulated-user-unsupported-provider" : "simulated-user-failed")));
          expect(diagnostic.phase).toBe("eval.run");
          expect(diagnostic.causes[0]?.code).toBe(mode === "typesafe" ? "typesafe" : mode === "timeout" ? "timeout" : mode === "no-answer" ? "no-answer" : mode === "compact-failed" ? "context-overflow" : "invalid-answer");
        }
        const activity = defined(trace.trace.execution.events.find(event => event.source.id === "niceeval.simulated-user"));
        expect(activity.actor?.id).toBe("simulated-user");
        const shown = await niceeval.run(["show", locator, "--execution"]);
        expect(shown.stdout, shown.diagnostic()).toContain("Simulated user");
        const evidence = defined(activity.evidence[0]);
        const expanded = await niceeval.run(["show", locator, "--execution", "--expand", evidence.evidenceId]);
        expect(expanded.stdout, expanded.diagnostic()).toContain("Simulated user requests, responses and answer");
        const audits = [];
        for (const event of trace.trace.execution.events.filter(event => event.source.id === "niceeval.simulated-user")) {
          const evidence = defined(event.evidence[0]);
          const chunks: Buffer[] = [];
          let offset: number | null = 0;
          while (offset !== null) {
            const part = await withInspectionRequest({ kind: "attempt.trace.detail", locator, selector: { kind: "execution-evidence", evidenceId: evidence.evidenceId, offset, limit: 256 * 1024 } },
              async path => (await niceeval.run(["query", "run", "--request", path])).attemptTraceDetail());
            if (part.detail.kind !== "execution-evidence") throw new Error("Expected sealed evidence");
            chunks.push(Buffer.from(part.detail.base64, "base64"));
            offset = part.detail.nextOffset;
          }
          audits.push(decodeSimulatedUserActivity(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        }
        if (!["timeout", "typesafe"].includes(mode)) expect(audits.flatMap(audit => audit.generations).some(generation => generation.inputTokens !== null)).toBe(true);
        if (mode === "compact") expect(audits.flatMap(audit => audit.generations).some(generation => generation.kind === "compaction" && generation.inputTokens !== null && generation.inputTokens > 0)).toBe(true);
        if (mode === "waiting") {
          const source = defined(audits[0]);
          const start = shown.stdout.indexOf(`Turn ${source.sourceTurnId}`);
          const activity = shown.stdout.indexOf("Simulated user");
          const target = shown.stdout.indexOf(`Turn ${source.targetTurnId}`);
          expect(start).toBeGreaterThanOrEqual(0);
          expect(activity).toBeGreaterThan(start);
          expect(target).toBeGreaterThan(activity);
        }
        if (mode === "large-session") {
          const final = defined(audits.at(-1));
          expect(Buffer.byteLength(final.conversation)).toBeGreaterThan(4 * 1024 * 1024);
          expect(final.conversation).toContain("LARGE_SESSION_START");
          expect(final.conversation).toContain("LARGE_SESSION_END");
          expect(final.answer).toContain("CONTINUE_2");
          expect(final.failure).toBeNull();
          expect(ordinary).toBe(2);
        }
        if (mode === "compact-failed") expect(audits.at(-1)?.failure?.reason).toBe("context-overflow");
        const usage = await withInspectionRequest({ kind: "attempt.usage", locator }, async path => (await niceeval.run(["query", "run", "--request", path])).attemptUsage());
        expect(usage.usage.totalCosts.simulatedUser?.source).toBe("simulated-user");
        if (["waiting", "message", "correct", "compact"].includes(mode)) expect(usage.usage.totalCosts.simulatedUser?.amountUSD).toBeGreaterThan(0);
      }
      if (mode === "waiting") {
        const dry = async () => decodeExpPlanDocument((await niceeval.run(["exp", "simulated", "--dry", "--json"])).json());
        expect((await dry()).reused).toBe(1);
        const evalPath = join(projectRoot, "evals/simulated.eval.ts");
        const original = await readFile(evalPath, "utf8");
        await writeFile(evalPath, original.replace("Choose allow and Tier 1", "Choose allow and Tier 2"));
        expect((await dry()).reused).toBe(0);
        await writeFile(evalPath, original);
        const configPath = join(projectRoot, "niceeval.config.ts");
        await writeFile(configPath, (await readFile(configPath, "utf8")).replace('model: "simulated-fixture"', 'model: "another-fixture"'));
        expect((await dry()).reused).toBe(0);
      }
      if (mode === "compact") expect(bodies.some(body => !JSON.parse(body).tools), JSON.stringify(bodies.map(body => JSON.parse(body).messages[0]))).toBe(true);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
});
