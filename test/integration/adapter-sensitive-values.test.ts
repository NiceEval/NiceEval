import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import fc from "fast-check";
import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  noSandboxBackendCapabilities,
  registerSandboxCapabilities,
  supportedBackendCapability,
} from "../../packages/niceeval/src/sandbox/backend.ts";
import { AGENT_BASELINE_VERSION } from "../../packages/niceeval/src/agents/coding-cli-versions.ts";
import type { ManagedProcess, ManagedProcessStart, Sandbox } from "../../packages/niceeval/src/types.ts";
import {
  createJudgeProject,
  HOST_SANDBOX_SOURCE,
  narrowInspectionSuccess,
  planAndRunExperiment,
  showJsonDocuments,
} from "./fixtures/judge-harness/harness.ts";

const registerProcess = Symbol.for("niceeval.test.adapter-sensitive-values");
const adapters = [
  { factory: "codexAgent", bin: "codex", version: AGENT_BASELINE_VERSION.codex, keyEnv: "CODEX_API_KEY" },
  { factory: "claudeCodeAgent", bin: "claude", version: AGENT_BASELINE_VERSION["claude-code"], keyEnv: "ANTHROPIC_API_KEY" },
  { factory: "openCodeAgent", bin: "opencode", version: "1.2.3", keyEnv: "OPENCODE_API_KEY" },
  { factory: "antigravityAgent", bin: "agy", version: "1.2.3", keyEnv: "GEMINI_API_KEY" },
  { factory: "ompAgent", bin: "omp", version: "1.2.3", keyEnv: "NICEEVAL_OMP_API_KEY" },
  { factory: "hermesAgent", bin: "hermes", version: "1.2.3", keyEnv: "HERMES_API_KEY" },
  { factory: "bubAgent", bin: "bub", version: AGENT_BASELINE_VERSION.bub, keyEnv: "BUB_API_KEY" },
  { factory: "openClawAgent", bin: "openclaw", version: "1.2.3", keyEnv: "OPENCLAW_API_KEY" },
  { factory: "deepSeekHarnessAgent", bin: "dsh", version: "1.2.3", keyEnv: "DEEPSEEK_API_KEY" },
] as const;

function startProcess({ argv, env }: ManagedProcessStart, keyEnv: string): ManagedProcess {
  const stdout = new PassThrough();
  const key = env?.[keyEnv];
  if (key === undefined) throw new Error("Driver omitted the configured credential");
  const emit = (frame: object) => stdout.write(JSON.stringify(frame) + "\n");
  const exited = Promise.withResolvers<{ exitCode: number; signal: undefined }>();
  const end = async () => {
    stdout.end();
    exited.resolve({ exitCode: 0, signal: undefined });
  };
  return {
    output: (async function* () {
      for await (const bytes of stdout) yield { _tag: "Stdout", bytes };
    })(),
    async writeStdin(bytes) {
      const frame = JSON.parse(Buffer.from(bytes).toString("utf8"));
      if (argv[1] === "app-server") {
        if (frame.id === undefined) return;
        if (frame.method === "turn/start") {
          emit({ id: frame.id, result: { turn: { id: "fixture-turn" } } });
          const params = { threadId: "fixture-session", turnId: "fixture-turn" };
          emit({ method: "item/completed", params: { ...params, item: { id: "fixture-message", type: "agentMessage", text: "turn " + key } } });
          emit({ method: "turn/completed", params: { ...params, turn: { id: "fixture-turn", status: "completed" } } });
        } else {
          emit({ id: frame.id, result: { thread: { id: "fixture-session" } } });
        }
      } else if (frame.type === "control_request") {
        emit({
          type: "control_response",
          response: {
            request_id: frame.request_id,
            subtype: "success",
            response: { account: { apiProvider: "firstParty", apiKeySource: keyEnv, tokenSource: "none" } },
          },
        });
      } else if (frame.type === "user") {
        emit({ type: "assistant", session_id: "fixture-session", message: { content: [{ type: "text", text: "turn " + key }] } });
        emit({ type: "result", session_id: "fixture-session", subtype: "success" });
      }
    },
    closeStdin: end,
    wait: () => exited.promise,
    terminate: end,
  };
}

function sandboxSource({ bin, version, keyEnv }: typeof adapters[number]) {
  // Keep real fixture files and commands. Substitute only native CLI probes and responses.
  return HOST_SANDBOX_SOURCE
    .replace("  return {\n    sandboxId:", `
      const bin = ${JSON.stringify(bin)};
      const version = ${JSON.stringify(version)};
      const keyEnv = ${JSON.stringify(keyEnv)};
      const result = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });
      let bubTape;
      function runAgent(options) {
        const key = options.env[keyEnv];
        const text = "turn " + key;
        const frame = (value) => JSON.stringify(value) + "\\n";
        switch (bin) {
          case "opencode":
            return result(frame({ type: "text", sessionID: "fixture-session", part: { type: "text", text } }));
          case "agy":
            return result(frame({ event: "result", conversation_id: "fixture-session", result: { status: "SUCCESS", response: text } }));
          case "omp":
            return result(frame({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } }) +
              frame({ type: "agent_end", isTerminal: true, yielded: true, messages: [] }));
          case "openclaw":
            return result(JSON.stringify({ text }));
          case "dsh":
            return result(
              frame({ type: "session", sessionId: "fixture-session" }) +
              frame({ type: "status", phase: "turn_start", turn: 0 }) +
              frame({ type: "text", text }) +
              frame({ type: "status", phase: "turn_end", turn: 0, reason: { kind: "completed" } }) +
              frame({ type: "final", sessionId: "fixture-session", reason: { kind: "completed" }, text })
            );
          case "bub":
            bubTape = frame({ kind: "message", payload: { role: "assistant", content: text } });
            return result(text);
          default:
            return result(text);
        }
      }
      const sandbox = {
        sandboxId:`)
    .replace('    runCommand: run,\n    runShell: (script, options) => run("bash", ["-c", script], options),', `
      runCommand: async (command, args, options) => {
        if (command === "/fixture/" + bin && !["export", "sessions"].includes(args?.[0]))
          return runAgent(options);
        return run(command, args, options);
      },
      runShell: async (script, options) => {
        if (script.includes("--version") && script.includes("/bun")) return result("1.2.3");
        if (script.includes("--version") && script.includes(bin)) return result(version);
        if (script.includes("command -v") && script.includes(bin)) return result("/fixture/" + bin);
        if (bin === "bub" && script.includes("test -x") && script.includes("bub")) return result();
        if (options?.env?.[keyEnv] !== undefined) return runAgent(options);
        return run("bash", ["-c", script], options);
      },`)
    .replace('    readText: (path) => readFile(at(path), "utf8"),', `
      readText: (path) => bin === "bub" && path.endsWith(".jsonl") && bubTape
        ? Promise.resolve(bubTape) : readFile(at(path), "utf8"),`)
    .replace("  };\n}\n\nexport default defineSandbox", `
      };
      process[Symbol.for("niceeval.test.adapter-sensitive-values")](sandbox, keyEnv);
      return sandbox;
    }

    export default defineSandbox`);
}

async function observe(adapter: typeof adapters[number], key: string) {
  Reflect.set(process, registerProcess, (sandbox: Sandbox, keyEnv: string) => {
    registerSandboxCapabilities(sandbox, {
      ...noSandboxBackendCapabilities,
      managedProcess: supportedBackendCapability(async (input) => startProcess(input, keyEnv)),
    });
  });

  vi.stubEnv("CF_ACCESS_CLIENT_ID", undefined);
  vi.stubEnv("CF_ACCESS_CLIENT_SECRET", undefined);
  let cwd: string | undefined;
  try {
    cwd = await createJudgeProject("niceeval-adapter-secrets-", {
      agent: `
        import { ${adapter.factory} } from "niceeval/adapter";
        export default ${adapter.factory}({
          apiKey: ${JSON.stringify(key)}, baseUrl: "https://fixture.invalid/v1",
          version: ${JSON.stringify(adapter.version)}, bunVersion: "1.2.3",
        });
      `,
      sandbox: sandboxSource(adapter),
      experiments: { "record.ts": `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        import sandbox from "../sandbox.ts";
        export default defineExperiment({ adapter: agent, sandbox, evals: ["record"], attempts: 1 });
      ` },
      evals: { "record.eval.ts": `
        import assert from "node:assert/strict";
        import { defineScoreEval } from "niceeval";
        const key = ${JSON.stringify(key)};
        export default defineScoreEval({ async test(t) {
          await t.send("echo supplied credential");
          const printed = await t.sandbox.runCommand("printf", ["command %s", key]);
          assert.equal(printed.stdout, "command " + key);
        } });
      ` },
    });
    const result = await planAndRunExperiment(cwd, "record", { rerun: "all" });
    const slot = result.run?.slots[0];
    if (slot?.publication.state !== "published") {
      throw new Error(`Expected a published Attempt. Plan status was ${result.status}.`);
    }
    const locator = slot.publication.attemptLocator;
    const [executionDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
    const execution = narrowInspectionSuccess(executionDoc!, "attempt.trace");
    if (!execution.success) throw new Error(execution.reason);
    const { trace } = execution.value;
    const turn = trace.conversation.turns[0]?.turnId;
    if (turn === undefined) {
      throw new Error("Adapter did not reach its first Turn: " + JSON.stringify(trace.diagnostics.items));
    }
    const [turnDocument] = await showJsonDocuments(cwd, [locator, turn]);
    const commands = await Promise.all(trace.identityIndex.commandIds.map(async (id) =>
      (await showJsonDocuments(cwd!, [locator, id]))[0]));
    const output = commands.find((command) => JSON.stringify(command).includes("command %s"));
    if (output === undefined) {
      throw new Error("Eval did not reach the command after adapter send: " + JSON.stringify(trace.diagnostics.items));
    }
    return { turn: JSON.stringify(turnDocument), output: JSON.stringify(output) };
  } finally {
    Reflect.deleteProperty(process, registerProcess);
    vi.unstubAllEnvs();
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  }
}

const samples = [
  "eightkey", // Reduced counterexample for the managed-process adapters.
  ...fc.sample(fc.stringMatching(/^[a-z][a-z0-9]{12,18}$/), { numRuns: 1, seed: 1137142104 }),
  ...fc.sample(fc.stringMatching(/^[a-z][a-z0-9]{6}$/), { numRuns: 1, seed: 1137142104 }),
];

describe.each(adapters)("$factory", (adapter) => {
  const observations = new Map<string, Awaited<ReturnType<typeof observe>>>();
  beforeAll(async () => {
    for (const key of samples) observations.set(key, await observe(adapter, key));
  }, 30_000);

  // @feature docs/feature/adapters/README.md#tool-projection-and-privacy
  test("redacts injected keys of at least eight characters from sealed Turns and command output", () => {
    for (const [key, { turn, output }] of observations) {
      const expected = key.length < 8 ? key : "<redacted>";
      expect(turn).toContain("turn " + expected);
      expect(output).toContain("command " + expected);
      if (key.length >= 8) {
        expect(turn).not.toContain(key);
        expect(output).not.toContain(key);
      }
    }
  });
});
