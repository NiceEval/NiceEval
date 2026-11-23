import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      // DSH 0.1.7-rc.2 imports legacy settings.yaml after resolving the first Turn.
      const patchArg = args.indexOf("--patch");
      const entries = patchArg < 0 ? [] : JSON.parse(files.get(args[patchArg + 1]!)!);
      const selection = entries.find((entry: { id: string }) => entry.id === "agent-default-model")?.config;
      const response = await fetch(options?.env?.DEEPSEEK_BASE_URL + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: selection?.model ?? "deepseek-flash" }),
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

// @feature docs/feature/adapters/README.md#live-compatibility
test("DeepSeek Harness uses the experiment model on the first request from a fresh Sandbox", async () => {
  const requests: unknown[] = [];
  const server = await startHttpServer((request, body, response) => {
    requests.push({ method: request.method, path: request.url, model: JSON.parse(body).model });
    response.end("loopback-reply");
  });
  try {
    const agent = deepSeekHarnessAgent({ apiKey: "fixture-key", baseUrl: server.baseUrl });
    if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
    const sandbox = coldStartSandbox();
    const context = sendContext(sandbox);
    await agent.before?.(sandbox, { ...context, reportInstallation: noop });
    const turn = await agent.send({ text: "Reply once." }, context);
    expect(requests).toEqual([{ method: "POST", path: "/v1/messages", model: "deepseek-v4.1-flash" }]);
    expect(turn.status).toBe("completed");
  } finally {
    await server.close();
  }
});

// @feature docs/feature/adapters/README.md#install-extensions-and-session
test("DeepSeek Harness reports an incompatible plugin during installation", async () => {
  const agent = deepSeekHarnessAgent({ plugins: ["dsh-dead-links@0.1.1"] });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
  const installer = agent.installers.find((candidate) => candidate.installMode === "sandbox-network");
  if (!installer || installer.installMode !== "sandbox-network") throw new Error("Expected the plugin installer");

  const home = await mkdtemp(join(tmpdir(), "niceeval-dsh-plugin-"));
  try {
    // The published bundle installs and composes but fails native schema inspection when DSH imports it.
    await writeFile(
      join(home, "dsh"),
      `#!/bin/sh
case "$*" in
  'plugin --profile headless add dsh-dead-links@0.1.1') mkdir -p "$DSH_HOME/profiles/headless" ;;
  '--profile headless --dump-config') exit 0 ;;
  '--profile headless --dump-config-schema')
    echo 'dsh: error: The requested module @deepseek-ai/dsh-llm does not provide an export named CallId' >&2
    exit 1 ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o700 },
    );
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
    await expect(
      installer.install(sandbox, {
        identity: installer.identity,
        targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
        signal: new AbortController().signal,
        progress: noop,
      }),
    ).rejects.toThrow("does not provide an export named CallId");
    await expect(access(join(home, ".niceeval-dsh", "profiles", "headless"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// @feature docs/feature/adapters/README.md#install-extensions-and-session
test("DeepSeek Harness reports native plugin activation warnings and preserves a completed Turn", async () => {
  const agent = deepSeekHarnessAgent({ apiKey: "fixture-key", plugins: ["dsh-dead-links@0.1.1"] });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
  const activationWarning = "dead-links (dsh-dead-links): failed to import";
  const sandbox = {
    ...coldStartSandbox(),
    runCommand: async () => ({
      stdout: "loopback-reply",
      stderr: `dsh: warning: 1 entry did not activate\n${activationWarning}\nunrelated stderr\n`,
      exitCode: 0,
    }),
  };
  type Diagnostic = Parameters<ReturnType<typeof sendContext>["diagnostic"]>[0];
  const diagnostics: Diagnostic[] = [];
  const context = { ...sendContext(sandbox), diagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic) };
  await agent.before?.(sandbox, { ...context, reportInstallation: noop });
  const turn = await agent.send({ text: "Reply once." }, context);
  expect(turn.status).toBe("completed");
  expect(diagnostics).toEqual([
    { code: "dsh-plugin-activation-failed", level: "warning", message: activationWarning },
  ]);
});
