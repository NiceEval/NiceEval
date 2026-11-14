import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext, defined, only, pollUntil } from "@niceeval/testkit";
import { expect, test } from "vitest";

const scenario = createE2EContext({
  repoId: "agent-judge",
  project: {
    from: process.cwd(),
    prefix: "niceeval-pi-failure-",
    omitTopLevel: [".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});

// Real SDK sessions run their real request/settlement loop. Only the public SDK
// stream boundary or the specifically failing SDK operation is fault-injected.
async function exercise(mode: string, simulated: boolean, state: string, code: string) {
  await scenario.case(
    `failure-${simulated ? "user" : "judge"}-${mode}`,
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(
        join(projectRoot, "sdk-fault.mjs"),
        `
import module, { findPackageJSON, syncBuiltinESMExports } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
const manifest = findPackageJSON("@earendil-works/pi-coding-agent", import.meta.resolve("niceeval"));
const { AgentSession, DefaultResourceLoader } = await import(pathToFileURL(resolve(dirname(manifest), "dist/index.js")).href);
const aiManifest = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(manifest));
const { createAssistantMessageEventStream } = await import(pathToFileURL(resolve(dirname(aiManifest), "dist/index.js")).href);
const mode = ${JSON.stringify(mode)};
if (mode === "dependency") {
  module.findPackageJSON = (...args) => {
    if (String(args[0]).includes("pi-coding-agent")) throw new Error("fixture missing pi dependency");
    return findPackageJSON(...args);
  };
  syncBuiltinESMExports();
}
if (mode === "session") DefaultResourceLoader.prototype.reload = async () => { throw new Error("fixture session initialization"); };
const prompt = AgentSession.prototype.prompt;
AgentSession.prototype.prompt = async function(...args) {
  if (mode === "prompt") throw new Error("fixture prompt defect");
  this.agent.streamFunction = (model, context, options) => {
    writeFileSync("request-started", "yes");
    const stream = createAssistantMessageEventStream();
    const message = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [], stopReason: "error", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      errorMessage: mode === "json" ? "JSON provider temporarily unavailable" : mode === "unexpected" ? "Unexpected remote failure" : mode === "overflow" ? "prompt is too long: 200000 tokens > 128000 maximum" : "fixture final request failure",
    };
    if (mode === "safe") message.errorMessage = "fixture failure at http://127.0.0.1:1/v1 with fixture-only and fixture-header-secret\\nAuthorization: Bearer hidden-header\\n" + "x".repeat(3000);
    if (mode === "usage") message.usage.input = -1;
    if (mode === "tool") {
      message.stopReason = "toolUse";
      message.content = [{ type: "toolCall", id: "answer", name: "reply_to_agent", arguments: { message: "Continue" } }];
      delete message.errorMessage;
      stream.push({ type: "done", reason: "toolUse", message });
    } else if (mode === "cancel") {
      const finish = () => { message.stopReason = "aborted"; stream.push({ type: "error", reason: "aborted", error: message }); };
      options.signal.addEventListener("abort", finish, { once: true });
      if (options.signal.aborted) finish();
    } else {
      if (mode === "aborted") message.stopReason = "aborted";
      stream.push({ type: "error", reason: message.stopReason, error: message });
    }
    return stream;
  };
  const result = await prompt.apply(this, args);
  if (mode === "tool") this.getToolDefinition = () => undefined;
  return result;
};
if (mode === "unknown") AgentSession.prototype.setActiveToolsByName = () => { throw new Error("fixture unexpected binding failure"); };
`,
      );
      await writeFile(
        join(projectRoot, "niceeval.config.ts"),
        `
import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
export default defineConfig({ timeoutMs: 30000, ${mode === "provider" ? "" : `judgeProvider: OpenAIProvider({ model: "failure-fixture", baseUrl: "http://127.0.0.1:1/v1", ${mode === "credential" ? 'apiKeyEnv: "NICEEVAL_FIXTURE_MISSING_CREDENTIAL"' : 'apiKey: "fixture-only"'}, contextWindow: 128000, maxOutputTokens: 128, headers: { "X-Fixture": "fixture-header-secret" } })`} });
`,
      );
      await writeFile(
        join(projectRoot, "experiments/failure.ts"),
        `
import { defineExperiment } from "niceeval";
import { lifecycleSandbox, quickAgent, directAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: ${simulated ? "directAgent" : "quickAgent"}, ${simulated ? "" : "sandbox: lifecycleSandbox,"} evals: ["failure"] });
`,
      );
      await writeFile(
        join(projectRoot, "evals/failure.eval.ts"),
        `
import { defineEval, defineSimulatedUser } from "niceeval";
import { defineAgentJudge } from "niceeval/expect";
import { writeFile } from "node:fs/promises";
await import(new URL("../sdk-fault.mjs", import.meta.url).href);
export default defineEval({ async test(t) {
  ${
    simulated
      ? `const user = t.simulatedUser(defineSimulatedUser({ instructions: "Use supplied facts.", timeoutMs: 15000 }));
  try {
    const next = await user.reply(await t.send("Question"));
    if (${mode === "tool"}) await user.reply(next);
  } catch (error) { await writeFile("caught.json", JSON.stringify({ code: error.code, reason: error.reason, message: error.message, cause: error.cause !== undefined })); }`
      : 't.agentJudge(defineAgentJudge({ timeoutMs: 15000 }), { fact: "supplied" }).judge("Inspect supplied facts").gate(1);'
  }
} });
`,
      );
      if (mode === "cancel") {
        const controlled = niceeval.start(["exp", "failure", "--json"], { timeoutMs: 60_000 });
        try {
          await pollUntil(async () => readFile(join(projectRoot, "request-started"), "utf8").catch(() => undefined), {
            timeoutMs: 30_000,
            intervalMs: 25,
            label: "pi request started",
          });
          expect(controlled.signal("SIGINT")).toBe(true);
          expect((await controlled.done).expReceipt().completion).toBe("interrupted");
        } finally {
          await controlled.dispose();
        }
        return;
      }
      const run = await niceeval.run(["exp", "failure", "--json"], { timeoutMs: 90_000 });
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const evaluation = only(run.expEvalEvents(), (event) => event.evalId === "failure", run.diagnostic());
      const locator = defined(evaluation.locator);
      if (simulated) {
        const trace = await (async () =>
          (await niceeval.run(["show", locator, "execution", "--json"])).attemptTrace())();
        const diagnostic = defined(
          trace.trace.diagnostics.items.find((item) => item.code === "simulated-user-failed"),
          JSON.stringify(trace),
        );
        expect(diagnostic.causes[0]?.code, JSON.stringify(diagnostic)).toBe(code);
        const caught = JSON.parse(await readFile(join(projectRoot, "caught.json"), "utf8"));
        if (mode === "provider") expect(caught.message).toContain("Provider is not configured");
        if (mode === "credential") expect(caught.message).toContain("credential is unresolved");
        if (["session", "prompt", "unknown", "tool", "json", "aborted", "safe", "usage"].includes(mode))
          expect(caught.cause).toBe(true);
        if (mode === "safe") {
          const persisted = JSON.stringify(diagnostic);
          for (const secret of ["http://127.0.0.1:1/v1", "fixture-only", "fixture-header-secret", "hidden-header"]) {
            expect(persisted).not.toContain(secret);
            expect(caught.message).not.toContain(secret);
          }
          expect(caught.message.length).toBeLessThan(1100);
          expect(persisted).toContain("fixture failure");
        }
      } else {
        const attempt = await (async () =>
          (await niceeval.run(["show", locator, "--json"])).inspectionSuccess("attempt.get"))();
        const entry = only(attempt.attempt.assertions.entries, () => true);
        const detail = await (async () =>
          (await niceeval.run(["show", locator, entry.entryId, "--full", "--json"])).attemptAssertionDetail())();
        if (!("entry" in detail.assertion)) throw new Error("Missing assertion detail");
        const audit = detail.assertion.entry.agentJudgeAudit;
        expect(audit?.state, JSON.stringify(detail)).toBe("available");
        if (audit?.state !== "available") throw new Error("Missing Agent Judge audit");
        expect(audit.audit.result).toMatchObject({ state, code });
        if (mode === "json" || mode === "unexpected")
          expect(audit.audit.result).toMatchObject({
            message: expect.stringContaining(mode === "json" ? "JSON" : "Unexpected"),
          });
      }
    },
  );
}

// @feature docs/feature/judge/README.md
test.concurrent.each([
  ["json", "unavailable", "judge-call-failed"],
  ["unexpected", "unavailable", "judge-call-failed"],
  ["prompt", "errored", "agent-judge-defect"],
  ["usage", "errored", "agent-judge-defect"],
  ["overflow", "unavailable", "agent-judge-context-overflow"],
  ["aborted", "unavailable", "judge-call-failed"],
  ["cancel", "interrupted", ""],
])("Agent Judge classifies the failing layer and preserves cancellation: %s", (mode, state, code) =>
  exercise(mode, false, state, code),
);

// @feature docs/feature/eval/README.md
test.concurrent.each([
  ["provider", "provider-unconfigured"],
  ["credential", "provider-unconfigured"],
  ["dependency", "pi-unavailable"],
  ["session", "session-failed"],
  ["tool", "defect"],
  ["unknown", "defect"],
  ["prompt", "defect"],
  ["json", "transport"],
  ["aborted", "transport"],
  ["overflow", "context-overflow"],
  ["safe", "transport"],
  ["usage", "defect"],
])("Simulated user reports the failing layer with runtime cause: %s", (mode, code) =>
  exercise(mode, true, "errored", code),
);
