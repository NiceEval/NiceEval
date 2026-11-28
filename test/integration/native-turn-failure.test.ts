import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AGENT_BASELINE_VERSION } from "../../packages/niceeval/src/agents/coding-cli-versions.ts";
import {
  noSandboxBackendCapabilities,
  registerSandboxCapabilities,
  supportedBackendCapability,
} from "../../packages/niceeval/src/sandbox/backend.ts";
import type { ManagedProcess, Sandbox } from "../../packages/niceeval/src/types.ts";
import {
  HOST_SANDBOX_SOURCE,
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  showJsonDocuments,
} from "./fixtures/judge-harness/harness.ts";

const registerProcess = Symbol.for("niceeval.test.native-turn-failure");
const SESSION = "fixture-session";
const CREDENTIAL = "fixture-private-key";
const PROVIDER_BODY = "fixture-private-provider-body";
const upstreamMessage = `${CREDENTIAL} ${PROVIDER_BODY} ${"🦀".repeat(120)}`;
const codexParams = { threadId: SESSION, turnId: "fixture-turn" };
const codexError = {
  message: upstreamMessage,
  codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 503 } },
};
const openCodeFrames = [
  { type: "text", sessionID: SESSION, part: { text: "partial reply" } },
  {
    type: "error",
    sessionID: SESSION,
    error: { name: "APIError", data: { statusCode: 502, message: upstreamMessage } },
  },
] as const;
const bubFailureFrames = [
  { kind: "event", payload: { name: "loop.step", data: { status: "aborted", error: upstreamMessage } } },
  { kind: "error", payload: { kind: "provider", message: upstreamMessage } },
] as const;
const cases = [
  {
    adapter: "deepseek-harness",
    bin: "dsh",
    factory: "deepSeekHarnessAgent",
    version: AGENT_BASELINE_VERSION["deepseek-harness"],
    drive: "command",
    exitCode: 1,
    terminal: "failed",
    frames: [
      { type: "session", sessionId: SESSION },
      { type: "status", phase: "turn_start", turn: 1 },
      {
        type: "final",
        sessionId: SESSION,
        text: "",
        reason: { kind: "max-tokens", error: { code: "MAX_TOKENS", message: upstreamMessage } },
      },
    ],
    facts: ["max-tokens", "MAX_TOKENS"],
  },
  {
    adapter: "claude-code",
    bin: "claude",
    factory: "claudeCodeAgent",
    version: AGENT_BASELINE_VERSION["claude-code"],
    drive: "claude",
    terminal: "rejected",
    frames: [
      { type: "assistant", session_id: SESSION, error: "server_error", message: { content: [] } },
      {
        type: "result",
        session_id: SESSION,
        subtype: "error_during_execution",
        is_error: true,
        errors: ["API Error: 5022 invalid status", `API Error: 503 ${upstreamMessage}`],
      },
    ],
    facts: ["error_during_execution", "server_error", "HTTP 503"],
  },
  {
    adapter: "opencode",
    bin: "opencode",
    factory: "openCodeAgent",
    version: AGENT_BASELINE_VERSION.opencode,
    drive: "command",
    exitCode: 0,
    terminal: "failed",
    frames: openCodeFrames,
    facts: ["APIError", "HTTP 502"],
  },
  {
    adapter: "opencode",
    bin: "opencode",
    factory: "openCodeAgent",
    version: AGENT_BASELINE_VERSION.opencode,
    drive: "command",
    exitCode: 1,
    terminal: "rejected",
    frames: [{ ...openCodeFrames[1], error: { ...openCodeFrames[1].error, name: CREDENTIAL } }],
    facts: ["<redacted>", "HTTP 502"],
  },
  {
    adapter: "bub",
    bin: "bub",
    factory: "bubAgent",
    version: AGENT_BASELINE_VERSION.bub,
    drive: "command",
    exitCode: 1,
    terminal: "rejected",
    frames: bubFailureFrames,
    facts: ["provider", "aborted"],
  },
  {
    adapter: "bub",
    bin: "bub",
    factory: "bubAgent",
    version: AGENT_BASELINE_VERSION.bub,
    drive: "command",
    exitCode: 1,
    terminal: "rejected",
    frames: bubFailureFrames,
    facts: [],
    replacesPriorTape: true,
  },
  {
    adapter: "codex",
    bin: "codex",
    factory: "codexAgent",
    version: AGENT_BASELINE_VERSION.codex,
    drive: "codex",
    terminal: "failed",
    frames: [
      { method: "error", params: { ...codexParams, willRetry: true, error: { codexErrorInfo: "serverOverloaded" } } },
      {
        method: "error",
        params: { ...codexParams, turnId: "other-turn", willRetry: false, error: { codexErrorInfo: "badRequest" } },
      },
      {
        method: "turn/completed",
        params: { ...codexParams, turn: { id: codexParams.turnId, status: "failed", error: codexError } },
      },
    ],
    facts: ["responseTooManyFailedAttempts", "HTTP 503"],
  },
  {
    adapter: "codex",
    bin: "codex",
    factory: "codexAgent",
    version: AGENT_BASELINE_VERSION.codex,
    drive: "codex",
    terminal: "rejected",
    frames: [{ method: "error", params: { ...codexParams, willRetry: false, error: codexError } }],
    facts: ["responseTooManyFailedAttempts", "HTTP 503"],
  },
] as const;

type Scenario = (typeof cases)[number];

function managedProcess(scenario: Scenario): ManagedProcess {
  const stdout = new PassThrough();
  const stopped = Promise.withResolvers<{ exitCode: number; signal: undefined }>();
  const emit = (value: object) => {
    stdout.write(JSON.stringify(value) + "\n");
  };
  const end = async () => {
    stdout.end();
    stopped.resolve({ exitCode: 0, signal: undefined });
  };
  return {
    output: (async function* () {
      for await (const bytes of stdout) yield { _tag: "Stdout", bytes };
    })(),
    async writeStdin(bytes) {
      const request = JSON.parse(Buffer.from(bytes).toString("utf8"));
      if (scenario.drive === "codex") {
        if (request.id === undefined) return;
        if (request.method === "turn/start") {
          emit({ id: request.id, result: { turn: { id: codexParams.turnId } } });
        } else {
          emit({ id: request.id, result: { thread: { id: SESSION } } });
          return;
        }
      } else if (request.type === "control_request") {
        emit({
          type: "control_response",
          response: {
            request_id: request.request_id,
            subtype: "success",
            response: { account: { apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY", tokenSource: "none" } },
          },
        });
        return;
      } else if (request.type !== "user") {
        return;
      }
      for (const frame of scenario.frames) emit(frame);
    },
    closeStdin: end,
    wait: () => stopped.promise,
    terminate: end,
  };
}

function sandboxSource(scenario: Scenario) {
  const { bin, version } = scenario;
  const stdout = scenario.frames.map((frame) => JSON.stringify(frame)).join("\n");
  const exitCode = scenario.drive === "command" ? scenario.exitCode : 0;
  return HOST_SANDBOX_SOURCE.replace(
    "  return {\n    sandboxId:",
    `
      const bin = ${JSON.stringify(bin)};
      const ok = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });
      let tape;
      let firstBubTurn = ${"replacesPriorTape" in scenario};
      const sandbox = {
        sandboxId:`,
  )
    .replace(
      '    runCommand: run,\n    runShell: (script, options) => run("bash", ["-c", script], options),',
      `
      runCommand: (command, args, options) => command === "/fixture/" + bin
        ? Promise.resolve(args[0] === "export" ? ok(JSON.stringify({ info: { id: "${SESSION}" }, messages: [] }))
            : { stdout: ${JSON.stringify(stdout)}, stderr: "", exitCode: ${exitCode} })
        : run(command, args, options),
      runShell: (script, options) => {
        if (script.includes("--version") && script.includes(bin)) return Promise.resolve(ok(${JSON.stringify(version)}));
        if (script.includes("command -v") && script.includes(bin)) return Promise.resolve(ok("/fixture/" + bin));
        if (script.includes("command -v") && script.includes("apply_patch")) return Promise.resolve(ok("/fixture/apply_patch"));
        if (bin === "bub" && script.startsWith("test -x ")) return Promise.resolve(ok());
        if (bin === "bub" && options?.env?.BUB_API_KEY) {
          if (firstBubTurn) {
            firstBubTurn = false;
            tape = JSON.stringify({ kind: "message", payload: { role: "assistant", content: "earlier turn" } });
            return Promise.resolve(ok());
          }
          tape = ${JSON.stringify(stdout)};
          return Promise.resolve({ stdout: "", stderr: "", exitCode: ${exitCode} });
        }
        return run("bash", ["-c", script], options);
      },`,
    )
    .replace(
      '    readText: (path) => readFile(at(path), "utf8"),',
      `
      readText: (path) => bin === "bub" && tape !== undefined && path.endsWith(".jsonl")
        ? Promise.resolve(tape) : readFile(at(path), "utf8"),`,
    )
    .replace(
      "  };\n}\n\nexport default defineSandbox",
      `
      };
      process[Symbol.for("niceeval.test.native-turn-failure")](sandbox);
      return sandbox;
    }
    export default defineSandbox`,
    );
}

async function publishAttempt(scenario: Scenario) {
  Reflect.set(process, registerProcess, (sandbox: Sandbox) => {
    registerSandboxCapabilities(sandbox, {
      ...noSandboxBackendCapabilities,
      managedProcess: supportedBackendCapability(async () => managedProcess(scenario)),
    });
  });
  let cwd: string | undefined;
  try {
    cwd = await createJudgeProject("niceeval-native-failure-", {
      agent: `
        import { ${scenario.factory} } from "niceeval/adapter";
        export default ${scenario.factory}({
          apiKey: ${JSON.stringify(CREDENTIAL)}, baseUrl: "https://fixture.invalid/v1",
          version: ${JSON.stringify(scenario.version)},
        });`,
      sandbox: sandboxSource(scenario),
      experiments: {
        "record.ts": `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        import sandbox from "../sandbox.ts";
        export default defineExperiment({ adapter: agent, sandbox, evals: ["record"], attempts: 1 });`,
      },
      evals: {
        "record.eval.ts": `
        import { defineScoreEval } from "niceeval";
        export default defineScoreEval({ async test(t) {
          t.diagnostic({ code: "fixture-attempt-advisory", level: "warning", message: "Fixture Attempt advisory." });
          ${"replacesPriorTape" in scenario ? 'await t.send("Earlier turn.");' : ""}
          const turn = await t.send("Ask the fixture.");
          await turn.succeeded().orStop();
        } });`,
      },
    });
    const result = await planAndRunExperiment(cwd, "record", { rerun: "all" });
    const slot = result.run?.slots[0];
    if (slot?.publication.state !== "published") throw new Error(`Expected a published Attempt, got ${result.status}.`);
    return { cwd, locator: slot.publication.attemptLocator };
  } catch (error) {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
    throw error;
  } finally {
    Reflect.deleteProperty(process, registerProcess);
  }
}

describe.each(
  cases.map((scenario) => ({
    scenario,
    title: `${scenario.adapter} ${scenario.terminal} send${"replacesPriorTape" in scenario ? " with replaced tape" : ""}`,
  })),
)("$title", ({ scenario }) => {
  let published: Awaited<ReturnType<typeof publishAttempt>> | undefined;

  beforeAll(async () => {
    published = await publishAttempt(scenario);
  });

  afterAll(async () => {
    if (published !== undefined) await rm(published.cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/adapters/README.md#tool-projection-and-privacy
  test("show preserves the upstream facts on the failed Turn", async () => {
    if (published === undefined) throw new Error("Missing fixture publication");
    const [document] = await showJsonDocuments(published.cwd, [published.locator, "execution"]);
    const execution = narrowInspectionSuccess(document!, "attempt.trace");
    if (!execution.success) throw new Error(execution.reason);
    const { trace } = execution.value;
    expect(trace.conversation.turns, JSON.stringify(trace.diagnostics.items)).toMatchObject([
      ...("replacesPriorTape" in scenario ? [{ outcome: "completed" }] : []),
      {
        outcome: "failed",
        terminal:
          scenario.terminal === "rejected"
            ? { state: "unavailable", reason: "send-failed" }
            : { state: "recorded", status: "failed" },
      },
    ]);
    expect(trace.diagnostics.items.find((item) => item.code === "fixture-attempt-advisory")).toMatchObject({
      turnId: null,
      summary: "Fixture Attempt advisory.",
    });
    expect(trace.diagnostics.items.some((item) => item.code === "agent-send-failed")).toBe(
      scenario.terminal === "rejected",
    );
    if (scenario.adapter === "bub") {
      expect(trace.conversation.items.filter((item) => item.kind === "conversation-error")).toMatchObject([
        { summary: expect.stringContaining(PROVIDER_BODY) },
        { summary: expect.stringContaining(PROVIDER_BODY) },
      ]);
    }
    const diagnostics = trace.diagnostics.items.filter((item) => item.code === "agent-upstream-failure");
    if ("replacesPriorTape" in scenario) {
      expect(diagnostics).toEqual([]);
      return;
    }
    expect(diagnostics).toMatchObject([
      {
        turnId: trace.conversation.turns[0]?.turnId,
        phase: "agent.send",
        summaryTruncated: false,
      },
    ]);
    const [diagnostic] = diagnostics;
    for (const fact of scenario.facts) expect(diagnostic?.summary).toContain(fact);
    expect(diagnostic?.summary).not.toContain(CREDENTIAL);
    expect(diagnostic?.summary).not.toContain(PROVIDER_BODY);
  });
});
