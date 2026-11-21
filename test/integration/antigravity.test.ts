import { readFileSync } from "node:fs";
import fc from "fast-check";
import { expect, test, vi } from "vitest";
import {
  antigravityAgent,
  type AgentContext,
  type AgentInstallationManifest,
  type AgentSession,
  type AntigravityConfig,
} from "../../packages/niceeval/src/agents/index.ts";
import type { CommandOptions, CommandResult, Sandbox } from "../../packages/niceeval/src/sandbox/index.ts";

type SendContext = Parameters<ReturnType<typeof antigravityAgent>["send"]>[1];

function fixture(name: string): string[] {
  return readFileSync(new URL(`./fixtures/antigravity/${name}.ndjson`, import.meta.url), "utf8").trimEnd().split("\n");
}

const [init, user, modelUsage, toolActive, toolDone, delta, lastModel, success] = fixture("print") as [
  string, string, string, string, string, string, string, string,
];
const resume = fixture("resume");
const error = fixture("error");
const EXPECTED_USAGE = { inputTokens: 11408, outputTokens: 41, cacheReadTokens: 7198, requests: 2 };
const nonAbortSignal = new AbortController().signal;
const noop = () => {};

function session(): AgentSession {
  let captured: string | undefined;
  return {
    get id() { return captured; },
    capture(id) { captured ??= id; },
    get: () => undefined,
    set: noop,
    take: () => undefined,
  };
}

function protocolResult(lines: readonly string[], exitCode = 0): CommandResult {
  return { stdout: lines.join("\n") + "\n", stderr: "", exitCode };
}

async function withAgent(
  run: (args: readonly string[], options?: CommandOptions) => CommandResult | Promise<CommandResult>,
  use: (driver: {
    send: (session?: AgentSession) => ReturnType<ReturnType<typeof antigravityAgent>["send"]>;
    diagnostics: readonly Parameters<AgentContext["diagnostic"]>[0][];
    files: ReadonlyMap<string, string>;
    manifests: readonly AgentInstallationManifest[];
  }) => Promise<void>,
  config: AntigravityConfig = { apiKey: "fake-key-for-tests" },
): Promise<void> {
  const agent = antigravityAgent(config);
  const diagnostics: Parameters<AgentContext["diagnostic"]>[0][] = [];
  const manifests: AgentInstallationManifest[] = [];
  const files = new Map<string, string>();
  const unsupported = () => { throw new Error("Unexpected Sandbox operation"); };
  const sandbox: Sandbox = {
    sandboxId: "agy-protocol-fixture",
    workdir: "/workspace",
    otlpHost: null,
    runShell: async () => protocolResult(["/usr/local/bin/agy"]),
    runCommandOrThrow: async (bin, args = []) => {
      if (bin === "mktemp") return { stdout: "/tmp/agy-protocol-home", stderr: "", exitCode: 0 };
      if (bin === "rm") {
        for (const path of files.keys()) if (path.startsWith(args[2] + "/")) files.delete(path);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`Unexpected Sandbox command ${bin}`);
    },
    runCommand: async (bin, args = [], options) => {
      if (bin !== "/usr/local/bin/agy") throw new Error(`Unexpected Sandbox command ${bin}`);
      return await run(args, options);
    },
    pathExists: async (path) => files.has(path),
    writeText: async (path, value) => { files.set(path, value); },
    runShellOrThrow: unsupported,
    readText: unsupported,
    readBytes: unsupported,
    writeBytes: unsupported,
    upload: unsupported,
    uploadFile: unsupported,
    uploadDirectory: unsupported,
    downloadFile: unsupported,
    downloadDirectory: unsupported,
    stop: unsupported,
  };
  const ctx: SendContext = {
    sandbox,
    flags: {},
    signal: nonAbortSignal,
    model: "gemini-3.8-flash-low",
    reasoningEffort: "low",
    session: session(),
    turnId: "agy-protocol-turn" as SendContext["turnId"],
    progress: noop,
    diagnostic: (input) => diagnostics.push(input),
    log: noop,
  };
  try {
    await agent.before?.(ctx.sandbox, { ...ctx, reportInstallation: (manifest) => manifests.push(manifest) });
    await use({
      diagnostics,
      files,
      manifests,
      send: (target = ctx.session) => agent.send({ text: "/literal prompt" }, { ...ctx, session: target }),
    });
  } finally {
    await agent.after?.(ctx.sandbox, ctx);
  }
}

// @feature docs/feature/adapters/library/sdk/agy/cost.md
test("counts usage once per observed model step and never adds the cumulative total", async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), fc.boolean(), fc.boolean(), async (firstUsage, lastUsage, repeatUpdate) => {
      const withoutUsage = (line: string) => line.replace(/,"usage":\{[^{}]+\}/, "");
      const first = firstUsage ? modelUsage : withoutUsage(modelUsage);
      const last = lastUsage ? lastModel : withoutUsage(lastModel);
      const lines = [init, user, first, ...(repeatUpdate ? [first] : []), toolActive, toolDone, delta, last, success];
      await withAgent(
        () => protocolResult(lines),
        async ({ send }) => {
          const turn = await send();
          const expected = firstUsage
            ? lastUsage
              ? EXPECTED_USAGE
              : { inputTokens: 9240, outputTokens: 36, cacheReadTokens: 0, requests: 1 }
            : lastUsage
              ? { inputTokens: 2168, outputTokens: 5, cacheReadTokens: 7198, requests: 1 }
              : undefined;
          expect(turn.usage).toEqual(expected);
          const coverage = firstUsage && lastUsage ? undefined : firstUsage || lastUsage ? "partial" : "unavailable";
          expect(turn.evidenceCoverage?.usage?.status).toBe(coverage);
        },
      );
    }),
    { numRuns: 16, examples: [[true, true, true], [true, false, false], [false, true, false], [false, false, false]] },
  );
});

// @feature docs/feature/adapters/library/sdk/agy/README.md#行为轨与会话
test("pairs overlapping tool steps by conversation and step index and leaves output unavailable", async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), fc.boolean(), async (reverseCompletion, toolFailed) => {
      const anotherActive = toolActive.replace('"step_index":2', '"step_index":4');
      const anotherDone = toolDone.replace('"step_index":2', '"step_index":4');
      const firstDone = toolFailed
        ? toolDone.replace('"output":"1 lines, 11 bytes"', '"error":{"type":"io","message":"Fixture read failed"}')
        : toolDone;
      const completed = reverseCompletion ? [anotherDone, firstDone] : [firstDone, anotherDone];
      const lines = [init, user, modelUsage, toolActive, anotherActive, ...completed, delta, lastModel, success];
      await withAgent(
        () => protocolResult(lines),
        async ({ send }) => {
          const turn = await send();
          const operations = turn.events.filter((event) => event.type.startsWith("operation."));
          const firstId = '["session-1",2]';
          const secondId = '["session-1",4]';
          const start = (operationId: string) => ({
            type: "operation.started", operationId,
            operation: {
              kind: "tool", name: "read_file", tool: "file_read",
              input: { Path: "/workspace/probe.txt" }, command: { kind: "not-command" },
            },
          });
          const done = (operationId: string) => ({
            type: "operation.finished", operationId, kind: "tool",
            status: operationId === firstId && toolFailed ? "failed" : "completed",
          });
          expect(operations).toEqual([
            start(firstId),
            start(secondId),
            ...(reverseCompletion ? [done(secondId), done(firstId)] : [done(firstId), done(secondId)]),
          ]);
          expect(turn.events.filter((event) => event.type === "error")).toEqual(
            toolFailed ? [{ type: "error", message: "Fixture read failed" }] : [],
          );
          expect(turn.status).toBe("completed");
        },
      );
    }),
    { numRuns: 8, examples: [[true, true]] },
  );
});

// @feature docs/feature/adapters/library/sdk/agy/README.md#终态与失败
test("rejects invalid terminal evidence while retaining accepted events, usage and exit evidence", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("nonzero", "signal", "malformed", "missing", "status"),
      fc.constantFrom("ERROR", "CANCELED", "INTERRUPTED", "INVALID", "WAITING", "RUNNING"),
      async (mode, status) => {
        const lines = [init, user, modelUsage, toolActive, toolDone, delta, lastModel];
        if (mode === "malformed") lines.push('{"event":');
        if (mode !== "missing") {
          lines.push(mode === "status" ? success.replace('"SUCCESS"', `"${status}"`) : success);
        }
        const output = protocolResult(lines, mode === "nonzero" ? 2 : mode === "signal" ? 137 : 0);
        await withAgent(
          () => output,
          async ({ send }) => {
            await expect(send()).rejects.toMatchObject({
              type: "agent-send-failed", acceptance: "started",
              events: expect.arrayContaining([{ type: "message", role: "assistant", text: "indigo-731" }]),
              usage: EXPECTED_USAGE, process: { exitCode: output.exitCode },
            });
          },
        );
      },
    ),
    { numRuns: 30, examples: [["status", "WAITING"], ["malformed", "ERROR"], ["missing", "ERROR"]] },
  );
  await withAgent(
    () => protocolResult(error, 2),
    async ({ send }) => {
      await expect(send()).rejects.toMatchObject({ type: "agent-send-failed", acceptance: "unknown", process: { exitCode: 2 } });
    },
  );
});

// @feature docs/feature/adapters/library/sdk/agy/README.md#终态与失败
test("keeps observed frames if the managed command throws after streaming a prefix", async () => {
  await withAgent(
    async (_args, options) => {
      await options?.onStdout?.(protocolResult([init, user, modelUsage, toolActive]).stdout);
      await options?.onStderr?.("transport interrupted");
      throw new Error("Transport closed");
    },
    async ({ send }) => {
      await expect(send()).rejects.toMatchObject({
        type: "agent-send-failed",
        acceptance: "started",
        events: [{ type: "operation.started", operationId: '["session-1",2]' }],
        usage: { inputTokens: 9240, outputTokens: 36, cacheReadTokens: 0, requests: 1 },
        process: { stderr: "transport interrupted" },
      });
    },
  );
});

// @feature docs/feature/adapters/library/sdk/agy/README.md#驱动面
// @feature docs/feature/adapters/library/sdk/agy/README.md#行为轨与会话
test("resumes only the captured session, falls back to the terminal reply, and reports unknown steps once", async () => {
  const calls: Array<{ args: readonly string[]; options?: CommandOptions }> = [];
  let diagnostics: readonly Parameters<AgentContext["diagnostic"]>[0][] = [];
  await withAgent(
    (args, options) => {
      calls.push(options === undefined ? { args } : { args, options });
      if (calls.length === 1) return protocolResult([init, user, modelUsage, toolActive, toolDone, delta, lastModel, success]);
      return protocolResult([JSON.stringify({ event: "future_event" }), ...resume]);
    },
    async (driver) => {
      diagnostics = driver.diagnostics;
      const original = session();
      const fresh = session();
      const first = await driver.send(original);
      expect(first.events.filter((event) => event.type === "message").map((event) => event.text)).toEqual(["indigo-731", "\n"]);
      expect(original.id).toBe("session-1");
      const continued = await driver.send(original);
      expect(continued.status).toBe("completed");
      expect(continued.events).toEqual([
        { type: "message", role: "assistant", text: "Please choose between `indigo-731` and `amber`.\n" },
      ]);
      expect(continued.usage).toBeUndefined();
      expect(continued.evidenceCoverage).toMatchObject({ actions: { status: "partial" }, events: { status: "partial" } });
      await driver.send(fresh);
      expect(driver.diagnostics).toEqual([]);
      expect(JSON.parse(driver.files.get("/tmp/agy-protocol-home/.gemini/antigravity-cli/settings.json")!)).toEqual({ modelProvider: "gemini" });
    },
    { apiKey: "fake-key-for-tests", baseUrl: "https://gemini.invalid" },
  );
  const commonArgs = ["--print", "/literal prompt", "--output-format", "stream-json", "--dangerously-skip-permissions", "--disable-slash-commands"];
  const modelArgs = ["--model", "gemini-3.8-flash-low", "--effort", "low"];
  expect(calls.map((call) => call.args)).toEqual([
    [...commonArgs, ...modelArgs],
    [...commonArgs, "--conversation", "session-1", ...modelArgs],
    [...commonArgs, ...modelArgs],
  ]);
  expect(calls[0]?.options).toMatchObject({
    env: {
      AGY_CLI_DISABLE_AUTO_UPDATE: "true",
      HOME: "/tmp/agy-protocol-home",
      ANTIGRAVITY_APP_DATA_DIR: "/tmp/agy-protocol-home/.gemini/antigravity-cli",
      GEMINI_API_KEY: "fake-key-for-tests",
      GOOGLE_GEMINI_BASE_URL: "https://gemini.invalid",
    },
    sensitiveValues: ["fake-key-for-tests"],
  });
  expect(diagnostics).toMatchObject([
    { code: "agent-event-unrecognized", level: "warning", data: { events: [
      { type: "future_event", count: 2 },
      { type: "step_update:unknown", count: 2 },
    ] } },
  ]);
});

// @feature docs/feature/adapters/library/sdk/agy/README.md#鉴权
test("fails before starting a print process when the API key is missing", async () => {
  vi.stubEnv("GEMINI_API_KEY", undefined);
  try {
    await expect(withAgent(
      () => { throw new Error("Unexpected print process"); },
      async ({ send }) => { await send(); },
      {},
    )).rejects.toThrow(/GEMINI_API_KEY/);
  } finally {
    vi.unstubAllEnvs();
  }
});

// @feature docs/feature/adapters/library/sdk/agy/README.md#行为轨与会话
test("installs native Skill and MCP files and reports only public MCP fields", async () => {
  const path = "test/integration/fixtures/antigravity/fixture-skill.md";
  await withAgent(
    () => protocolResult([success]),
    async ({ files, manifests }) => {
      expect(files.get(".agents/skills/fixture-skill/SKILL.md")).toBe(readFileSync(path, "utf8"));
      expect(JSON.parse(files.get(".agents/mcp_config.json")!)).toEqual({
        mcpServers: {
          local: { command: "fixture-mcp", args: ["--stdio"], cwd: "/workspace/tools", env: { TOKEN: "fixture-token" } },
          remote: { serverUrl: "https://mcp.invalid", headers: { Authorization: "Bearer fixture-header" } },
        },
      });
      expect(manifests).toEqual([{
        skills: [{ kind: "local", name: "fixture-skill", path, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }],
        mcpServers: [
          { name: "local", command: "fixture-mcp", args: ["--stdio"] },
          { name: "remote", url: "https://mcp.invalid" },
        ],
      }]);
    },
    {
      apiKey: "fake-key-for-tests",
      skills: [{ kind: "local", path }],
      mcpServers: [
        { name: "local", command: "fixture-mcp", args: ["--stdio"], cwd: "/workspace/tools", env: { TOKEN: "fixture-token" } },
        { name: "remote", url: "https://mcp.invalid", headers: { Authorization: "Bearer fixture-header" } },
      ],
    },
  );
});
