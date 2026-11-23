import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { deepSeekHarnessAgent, type SandboxAgent } from "niceeval/adapter";
import type { Sandbox, SandboxCommandTarget } from "niceeval/sandbox";
import { expect, test } from "vitest";
import { startHttpServer } from "./fixtures/judge-harness/harness.ts";

const noop = () => {};
const unsupported = () => {
  throw new Error("Unexpected Sandbox operation");
};

const sessionId = "dsh-native-session";
const completed = { kind: "completed" };
const opening = { type: "session", sessionId };
const final = { type: "final", sessionId, reason: completed, text: "loopback-reply" };

function jsonLines(...frames: object[]): string {
  return frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n";
}

function coldStartSandbox(): Sandbox {
  const files = new Map<string, string>();
  const success = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });
  return {
    sandboxId: "dsh-loopback",
    workdir: "/workspace",
    otlpHost: null,
    runShell: async (script) => {
      if (script.startsWith('test -n "$HOME"')) return success("/home/user");
      if (script.includes("command -v 'dsh'")) return success("/bin/dsh");
      return success("");
    },
    async writeText(path, text) {
      files.set(path, text);
    },
    async runCommand(bin, args = [], options) {
      expect(bin).toBe("/bin/dsh");
      expect(args).toContain("--json");
      const patchArg = args.indexOf("--patch");
      const entries = JSON.parse(files.get(args[patchArg + 1]!)!);
      expect(entries).toEqual([
        { id: "agent-default-model", config: { provider: "deepseek-official", model: "deepseek-v4.1-flash" } },
      ]);
      expect(options?.env?.DSH_PERMISSION_MODE).toBe("danger-full-access");
      const response = await fetch(options?.env?.DEEPSEEK_BASE_URL + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: entries[0].config.model }),
      });
      return success(await response.text());
    },
    runCommandOrThrow: unsupported,
    runShellOrThrow: unsupported,
    startCommand: unsupported,
    startShell: unsupported,
    readText: unsupported,
    readBytes: unsupported,
    writeBytes: unsupported,
    pathExists: unsupported,
    upload: unsupported,
    uploadFile: unsupported,
    uploadDirectory: unsupported,
    downloadFile: unsupported,
    downloadDirectory: unsupported,
    stop: unsupported,
  };
}

function sendContext(sandbox: Sandbox): Parameters<SandboxAgent["send"]>[1] {
  type SendContext = Parameters<SandboxAgent["send"]>[1];
  return {
    sandbox,
    model: "deepseek-v4.1-flash",
    flags: {},
    signal: new AbortController().signal,
    turnId: "dsh-loopback-turn" as SendContext["turnId"],
    session: { capture: noop, get: () => undefined, set: noop, take: () => undefined },
    progress: noop,
    diagnostic: noop,
    log: noop,
  };
}

async function installFixturePlugins(agent: SandboxAgent, home: string) {
  const installer = agent.installers.find((candidate) => candidate.installMode === "sandbox-network");
  if (!installer || installer.installMode !== "sandbox-network") throw new Error("Expected the plugin installer");
  const runShell = promisify(execFile);
  const sandbox: SandboxCommandTarget = {
    ...coldStartSandbox(),
    copyPath: unsupported,
    putContent: unsupported,
    runShellOrThrow: async (script, options) => {
      const output = await runShell("/bin/sh", ["-c", script], {
        env: { HOME: home, PATH: `${home}${delimiter}${process.env.PATH}` },
        signal: options?.signal,
      });
      return { ...output, exitCode: 0 };
    },
  };
  await installer.install(sandbox, {
    identity: installer.identity,
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    signal: new AbortController().signal,
    progress: noop,
  });
}

// @feature docs/feature/adapters/README.md#install-extensions-and-session
test("DeepSeek Harness imports and prepares bundles in declared order after a native batch install", async () => {
  const declaredOrder = ["dsh-fixture-z", "dsh-fixture-a"];
  const agent = deepSeekHarnessAgent({ plugins: declaredOrder.map((name) => `${name}@1.0.0`) });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
  const home = await mkdtemp(join(tmpdir(), "niceeval-dsh-order-"));
  try {
    const fixture = join(home, "fixture");
    for (const name of declaredOrder) {
      const pkg = join(fixture, "node_modules", name);
      await mkdir(pkg, { recursive: true });
      await writeFile(join(pkg, "package.json"), JSON.stringify({ name, version: "1.0.0", dsh: { bundle: {} } }));
    }
    await writeFile(
      join(fixture, "package.json"),
      JSON.stringify({
        dependencies: { "dsh-fixture-a": "1.0.0", "dsh-fixture-z": "1.0.0" },
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-fixture-a", "dsh-fixture-z"] } },
      }),
    );
    await writeFile(
      join(home, "dsh"),
      `#!/bin/sh
profile="$DSH_HOME/profiles/headless"
case "$*" in
  'plugin --profile headless add dsh-fixture-z@1.0.0 dsh-fixture-a@1.0.0')
    mkdir -p "$profile" && cp -R "$HOME/fixture/." "$profile/" ;;
  '--profile headless --dump-config-schema') cp "$profile/package.json" "$HOME/imported.json" ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o700 },
    );
    await installFixturePlugins(agent, home);
    const imported = JSON.parse(await readFile(join(home, "imported.json"), "utf8"));
    expect(imported.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", ...declaredOrder]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// @feature docs/feature/adapters/README.md#live-compatibility
test("DeepSeek Harness uses the experiment model and projects the native Session from a fresh Sandbox", async () => {
  const requests: unknown[] = [];
  const server = await startHttpServer((request, body, response) => {
    requests.push({ method: request.method, path: request.url, model: JSON.parse(body).model });
    response.end(
      jsonLines(
        opening,
        { type: "status", phase: "turn_start", turn: 1 },
        { type: "status", phase: "step_start", turn: 1, step: 1 },
        { type: "thinking", text: "I should inspect the file." },
        { type: "text", text: "I will read it." },
        { type: "tool_call", callId: "read-1", tool: "read", input: { file_path: "fixture.txt" } },
        { type: "tool_result", callId: "read-1", status: "completed", result: "a file" },
        {
          type: "status", phase: "step_end", turn: 1, step: 1,
          usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 2 },
        },
        { type: "status", phase: "step_start", turn: 1, step: 2 },
        { type: "text", text: "loopback-" },
        { type: "text", text: "reply" },
        {
          type: "status", phase: "step_end", turn: 1, step: 2,
          usage: { inputTokens: 11, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 0 },
        },
        { type: "status", phase: "step_start", turn: 1, step: 3 },
        { type: "status", phase: "step_end", turn: 1, step: 3 },
        { type: "status", phase: "turn_end", turn: 1, reason: completed },
        final,
      ),
    );
  });
  try {
    const agent = deepSeekHarnessAgent({ apiKey: "fixture-key", baseUrl: server.baseUrl });
    if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
    const sandbox = coldStartSandbox();
    const captured: Array<string | undefined> = [];
    const baseContext = sendContext(sandbox);
    const context = { ...baseContext, session: { ...baseContext.session, capture: (id: string | undefined) => captured.push(id) } };
    await agent.before?.(sandbox, { ...context, reportInstallation: noop });
    const turn = await agent.send({ text: "Reply once." }, context);
    expect(requests).toEqual([{ method: "POST", path: "/v1/messages", model: "deepseek-v4.1-flash" }]);
    expect(turn.status).toBe("completed");
    expect(captured).toEqual([sessionId]);
    expect(turn.events).toEqual([
      { type: "thinking", text: "I should inspect the file." },
      { type: "message", role: "assistant", text: "I will read it." },
      {
        type: "operation.started",
        operationId: "read-1",
        operation: {
          kind: "tool", name: "read", input: { file_path: "fixture.txt" }, tool: "file_read", command: { kind: "not-command" },
        },
      },
      { type: "operation.finished", kind: "tool", operationId: "read-1", status: "completed", output: "a file" },
      { type: "message", role: "assistant", text: "loopback-reply" },
    ]);
    expect(turn.usage).toEqual({ inputTokens: 18, outputTokens: 5, cacheReadTokens: 6, cacheCreationTokens: 1 });
    expect(agent.evidenceCoverage.usage.status).toBe("partial");
    expect(turn.evidenceCoverage?.usage).toMatchObject({ status: "partial" });
  } finally {
    await server.close();
  }
});

// @feature docs/feature/adapters/README.md#install-extensions-and-session
test("DeepSeek Harness reports an incompatible plugin during installation", async () => {
  const agent = deepSeekHarnessAgent({ plugins: ["niceeval-dsh-broken-bundle@1.0.0"] });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");

  const home = await mkdtemp(join(tmpdir(), "niceeval-dsh-plugin-"));
  try {
    const name = "niceeval-dsh-broken-bundle";
    const fixture = join(home, "fixture");
    const pkg = join(fixture, "node_modules", name);
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name, version: "1.0.0", dsh: { bundle: {} } }));
    await writeFile(
      join(fixture, "package.json"),
      JSON.stringify({ dependencies: { [name]: "1.0.0" }, dsh: { profile: { bundles: [name] } } }),
    );
    // Native schema inspection imports the fixture's module after installation and composition.
    await writeFile(
      join(home, "dsh"),
      `#!/bin/sh
profile="$DSH_HOME/profiles/headless"
case "$*" in
  'plugin --profile headless add niceeval-dsh-broken-bundle@1.0.0')
    mkdir -p "$profile" && cp -R "$HOME/fixture/." "$profile/" ;;
  '--profile headless --dump-config') exit 0 ;;
  '--profile headless --dump-config-schema')
    echo 'dsh: error: [/101] NiceEval fixture import failed' >&2
    exit 1 ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o700 },
    );
    await expect(installFixturePlugins(agent, home)).rejects.toThrow("NiceEval fixture import failed");
    await expect(access(join(home, ".niceeval-dsh", "profiles", "headless"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// @feature docs/feature/adapters/README.md#install-extensions-and-session
test("DeepSeek Harness reports native plugin activation warnings and preserves a completed Turn", async () => {
  const agent = deepSeekHarnessAgent({ apiKey: "fixture-key", plugins: ["niceeval-dsh-broken-bundle@1.0.0"] });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
  const compatibilityWarning = 'dsh: disabling profile plugin row "fixture-incompatible": incompatible runtime';
  const bundleWarning = 'dsh: skipping profile bundle "niceeval-dsh-broken-bundle": missing its patch file';
  const activationWarning = "fixture-broken (niceeval-dsh-broken-bundle): failed to import";
  const sandbox = {
    ...coldStartSandbox(),
    runCommand: async () => ({
      stdout: jsonLines(opening, final),
      stderr: `${compatibilityWarning}\n${bundleWarning}\ndsh: warning: 1 entry did not activate\n${activationWarning}\nunrelated stderr\n`,
      exitCode: 0,
    }),
  };
  type Diagnostic = Parameters<ReturnType<typeof sendContext>["diagnostic"]>[0];
  const diagnostics: Diagnostic[] = [];
  const context = { ...sendContext(sandbox), diagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic) };
  await agent.before?.(sandbox, { ...context, reportInstallation: noop });
  const turn = await agent.send({ text: "Reply once." }, context);
  expect(turn.status).toBe("completed");
  expect(diagnostics).toEqual(
    [compatibilityWarning, bundleWarning, activationWarning].map((message) => ({
      code: "dsh-plugin-activation-failed",
      level: "warning",
      message,
    })),
  );
});

// @feature docs/feature/adapters/README.md#protocol-normalization
test.each([
  { label: "a durable failed turn", exitCode: 1, terminal: { ...final, reason: { kind: "max-tokens" } }, status: "failed" },
  { label: "a successful exit without a final frame", exitCode: 0, terminal: undefined },
  { label: "a completed frame with an empty reply", exitCode: 0, terminal: { ...final, text: "" } },
  { label: "a final frame from another session", exitCode: 0, terminal: { ...final, sessionId: "other-session" } },
  { label: "a completed frame with nonzero exit", exitCode: 1, terminal: final },
  { label: "a term signal after a completed frame", exitCode: 143, terminal: final },
])("DeepSeek Harness distinguishes $label", async ({ exitCode, terminal, status }) => {
  const agent = deepSeekHarnessAgent({ apiKey: "fixture-key" });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
  const frames = [{ type: "status", phase: "turn_start", turn: 1 }, { type: "text", text: "partial reply" }];
  const sandbox = {
    ...coldStartSandbox(),
    runCommand: async () => ({
      stdout: jsonLines(opening, ...frames, ...(terminal === undefined ? [] : [terminal])),
      stderr: "",
      exitCode,
    }),
  };
  const context = sendContext(sandbox);
  await agent.before?.(sandbox, { ...context, reportInstallation: noop });
  const turn = agent.send({ text: "Reply once." }, context);
  if (status) {
    await expect(turn).resolves.toMatchObject({
      status,
      evidenceCoverage: { usage: { status: "unavailable" } },
    });
  } else {
    await expect(turn).rejects.toMatchObject({ type: "agent-send-failed", acceptance: "started" });
  }
});
