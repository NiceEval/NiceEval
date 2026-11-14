import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext, defined, only } from "@niceeval/testkit";
import { expect, test } from "vitest";

const scenario = createE2EContext({
  repoId: "agent-judge",
  project: {
    from: process.cwd(),
    prefix: "niceeval-pi-cleanup-",
    omitTopLevel: [".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});

// Faults affect only the public third-party SDK. The installed NiceEval owner,
// real pi sessions, tools, storage and Docker Sandbox are never replaced.
// @feature docs/feature/judge/README.md
test.concurrent.each(["context", "hook", "append", "refresh", "subscribe", "capture", "abort", "release-errors"])(
  "Acquired pi sessions are released after SDK failures: %s",
  async (fault) => {
    await scenario.case(`pi-cleanup-${fault}`, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const simulated = fault === "abort" || fault === "release-errors";
      await writeFile(
        join(projectRoot, "sdk-fault.mjs"),
        `
import { findPackageJSON } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const manifest = findPackageJSON("@earendil-works/pi-coding-agent", import.meta.resolve("niceeval"));
const { readFileSync } = await import("node:fs");
const entry = JSON.parse(readFileSync(manifest, "utf8")).exports["."].import;
const { AgentSession, SessionManager } = await import(pathToFileURL(resolve(dirname(manifest), entry)).href);
import { writeFileSync } from "node:fs";
const fault = ${JSON.stringify(fault)};
const sessions = new Map();
const calls = [];
const failure = stage => { calls.push(stage); throw new Error("sdk-fixture-" + stage); };
const track = session => {
  if (!sessions.has(session)) sessions.set(session, { disposed: 0, subscriptions: 0, reads: 0 });
  return sessions.get(session);
};
const systemPrompt = Object.getOwnPropertyDescriptor(AgentSession.prototype, "systemPrompt");
Object.defineProperty(AgentSession.prototype, "systemPrompt", { ...systemPrompt, get() {
  const state = track(this);
  state.reads++;
  if (fault === "context" && state.reads === 2) failure("context");
  if (fault === "hook" && state.reads === 1) {
    Object.defineProperty(this.agent, "beforeToolCall", { configurable: true, get: () => undefined, set: () => failure("hook") });
  }
  return systemPrompt.get.call(this);
} });
const append = SessionManager.prototype.appendMessage;
SessionManager.prototype.appendMessage = function(message) {
  if (fault === "append") failure("append");
  return append.call(this, message);
};
const refresh = AgentSession.prototype.refreshContext;
AgentSession.prototype.refreshContext = function() {
  if (fault === "refresh") failure("refresh");
  return refresh.call(this);
};
const subscribe = AgentSession.prototype.subscribe;
AgentSession.prototype.subscribe = function(listener) {
  const state = track(this);
  if (fault === "subscribe") failure("subscribe");
  const unsubscribe = subscribe.call(this, listener);
  state.subscriptions++;
  return () => {
    calls.push("unsubscribe");
    unsubscribe();
    state.subscriptions--;
    if (fault === "release-errors") failure("unsubscribe-error");
  };
};
AgentSession.prototype.prompt = async function(...args) {
  if (fault === "capture") this.sessionManager.getEntries = () => failure("capture");
  failure("prompt");
};
const abort = AgentSession.prototype.abort;
AgentSession.prototype.abort = async function() {
  calls.push("abort");
  if (fault === "abort" || fault === "release-errors") failure("abort-error");
  return abort.call(this);
};
const dispose = AgentSession.prototype.dispose;
AgentSession.prototype.dispose = function() {
  calls.push("dispose");
  const state = track(this);
  state.disposed++;
  dispose.call(this);
  if (fault === "release-errors") failure("dispose-error");
};
// The process remains alive after the owner settles: sample the real SDK's
// public activity state and retained fixture subscriptions on the next turn.
process.once("beforeExit", () => {
  const settledCalls = calls.slice();
  setTimeout(() => writeFileSync("sdk-cleanup.json", JSON.stringify({
    calls, lateCalls: calls.slice(settledCalls.length),
    sessions: [...sessions].map(([session, state]) => ({ ...state, idle: session.isIdle, streaming: session.isStreaming }))
  })), 50);
});
`,
      );
      await writeFile(
        join(projectRoot, "niceeval.config.ts"),
        `
import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
export default defineConfig({ timeoutMs: 30000, judgeProvider: OpenAIProvider({ model: "cleanup-fixture", baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-only", contextWindow: 128000, maxOutputTokens: 128 }) });
`,
      );
      await writeFile(
        join(projectRoot, "experiments/cleanup.ts"),
        `
import { defineExperiment } from "niceeval";
import { lifecycleSandbox, quickAgent, directAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: ${simulated ? "directAgent" : "quickAgent"}, ${simulated ? "" : "sandbox: lifecycleSandbox,"} evals: ["cleanup"] });
`,
      );
      await writeFile(
        join(projectRoot, "evals/cleanup.eval.ts"),
        `
import { defineEval, defineSimulatedUser } from "niceeval";
import { defineAgentJudge } from "niceeval/expect";
await import(new URL("../sdk-fault.mjs", import.meta.url).href);
export default defineEval({ async test(t) {
  ${
    simulated
      ? `const user = t.simulatedUser(defineSimulatedUser({ instructions: "Use only supplied facts." }));
  try { await user.reply(await t.send("Question")); } catch {}`
      : `t.agentJudge(defineAgentJudge({ timeoutMs: 5000 }), { fact: "supplied" }).judge("Inspect supplied facts").gate(1);`
  }
} });
`,
      );
      const run = await niceeval.run(["exp", "cleanup", "--json"], { timeoutMs: 90_000 });
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const evaluation = only(run.expEvalEvents(), (event) => event.evalId === "cleanup", run.diagnostic());
      const locator = defined(evaluation.locator);
      const attempt = await (async () => (await niceeval.run(["show", locator, "--json"])).inspectionSuccess("attempt.get"))();
      expect(attempt.attempt.verdict).toBe("errored");
      const evidence = JSON.parse(await readFile(join(projectRoot, "sdk-cleanup.json"), "utf8"));
      expect(evidence.lateCalls).toEqual([]);
      expect(evidence.sessions, JSON.stringify(evidence)).toHaveLength(1);
      expect(evidence.sessions[0], JSON.stringify(evidence)).toMatchObject({
        disposed: 1,
        subscriptions: 0,
        idle: true,
        streaming: false,
      });
      if (simulated) {
        expect(evidence.calls.indexOf("abort-error")).toBeLessThan(evidence.calls.lastIndexOf("unsubscribe"));
        expect(evidence.calls.lastIndexOf("unsubscribe")).toBeLessThan(evidence.calls.indexOf("dispose"));
      }
      expect(evidence.calls).toContain(simulated ? "abort-error" : fault);
    });
  },
);
