import fc from "fast-check";
import { ompAgent, type SandboxAgent } from "niceeval/adapter";
import type { CommandResult, Sandbox } from "niceeval/sandbox";
import { expect, test } from "vitest";

const noop = () => {};
const unsupported = () => {
  throw new Error("Unexpected Sandbox operation");
};

async function send(result: CommandResult, diagnostic: Parameters<SandboxAgent["send"]>[1]["diagnostic"] = noop) {
  const sandbox: Sandbox = {
    sandboxId: "omp-protocol",
    workdir: "/workspace",
    otlpHost: null,
    runShell: async (script) => ({
      stdout: script.startsWith('test -n "$HOME"') ? "/home/user" : script.includes("command -v 'omp'") ? "/bin/omp" : "",
      stderr: "",
      exitCode: 0,
    }),
    runCommand: async () => result,
    runCommandOrThrow: unsupported,
    runShellOrThrow: unsupported,
    startCommand: unsupported,
    startShell: unsupported,
    readText: unsupported,
    readBytes: unsupported,
    writeText: unsupported,
    writeBytes: unsupported,
    pathExists: unsupported,
    upload: unsupported,
    uploadFile: unsupported,
    uploadDirectory: unsupported,
    downloadFile: unsupported,
    downloadDirectory: unsupported,
    stop: unsupported,
  };
  const agent = ompAgent({ apiKey: "fixture-token", baseUrl: "http://127.0.0.1:1/v1" });
  if (agent.kind !== "sandbox") throw new Error("Expected Sandbox Agent");
  type SendContext = Parameters<SandboxAgent["send"]>[1];
  const ctx: SendContext = {
    sandbox,
    model: "fixture-model",
    flags: {},
    signal: new AbortController().signal,
    turnId: "omp-protocol-turn" as SendContext["turnId"],
    session: { capture: noop, get: () => undefined, set: noop, take: () => undefined },
    progress: noop,
    diagnostic,
    log: noop,
  };
  await agent.before?.(sandbox, { ...ctx, reportInstallation: noop });
  return agent.send({ text: "Reply once." }, ctx);
}

const assistantEnd = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "fixture-reply" }],
    stopReason: "stop",
    usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 0, cost: { total: 0.25 } },
  },
};
const loopEnd = fc.record(
  { type: fc.constant("agent_end"), isTerminal: fc.boolean(), messages: fc.constantFrom([], null) },
  { requiredKeys: ["type", "messages"] },
);

// @feature docs/feature/adapters/README.md#protocol-normalization
test("OMP completes a JSONL Turn only when exit succeeds and exactly one end is marked terminal", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(loopEnd, { maxLength: 4 }), fc.constantFrom(0, 1, 143), async (ends, exitCode) => {
      const stdout = [assistantEnd, ...ends].map((frame) => JSON.stringify(frame)).join("\n");
      const turn = send({ exitCode, stdout, stderr: "" });
      if (exitCode === 0 && ends.filter((end) => end.isTerminal === true && Array.isArray(end.messages)).length === 1) {
        await expect(turn).resolves.toEqual({
          status: "completed",
          events: [{ type: "message", role: "assistant", text: "fixture-reply" }],
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheCreationTokens: 0, requests: 1 },
        });
      } else {
        await expect(turn).rejects.toMatchObject({ type: "agent-send-failed", process: { exitCode } });
      }
    }),
    {
      examples: [
        [[{ type: "agent_end", messages: [] }], 0],
        [
          [
            { type: "agent_end", messages: [], isTerminal: false },
            { type: "agent_end", messages: [], isTerminal: true },
          ],
          0,
        ],
        [[{ type: "agent_end", messages: [], isTerminal: true }], 1],
      ],
      numRuns: 35,
    },
  );
});

// @feature docs/feature/adapters/README.md#tool-projection-and-privacy
test("OMP retains the assistant's named failed stop reason without copying its error text", async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom("aborted", "error"), fc.string(), async (stopReason, errorMessage) => {
      const stdout = [
        { ...assistantEnd, message: { ...assistantEnd.message, stopReason, errorMessage } },
        { type: "agent_end", isTerminal: true, messages: [] },
      ]
        .map((frame) => JSON.stringify(frame))
        .join("\n");
      const diagnostics: Parameters<Parameters<SandboxAgent["send"]>[1]["diagnostic"]>[0][] = [];
      const turn = await send({ exitCode: 0, stdout, stderr: "" }, (value) => diagnostics.push(value));
      expect(turn.status).toBe("failed");
      expect(diagnostics).toMatchObject([
        {
          code: "agent-upstream-failure",
          message: `Oh My Pi upstream failure: ${stopReason}`,
          data: { reason: stopReason },
        },
      ]);
    }),
    {
      examples: [
        ["aborted", ""],
        ["error", "provider body"],
      ],
      numRuns: 12,
    },
  );
});

// @feature docs/feature/adapters/README.md#usage-accounting
test("OMP reports partial usage coverage for requests outside its JSONL stream", () => {
  expect(ompAgent().evidenceCoverage?.usage).toMatchObject({ status: "partial", reason: expect.stringContaining("probe") });
});
