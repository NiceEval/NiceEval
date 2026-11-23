import { deepSeekHarnessAgent } from "niceeval/adapter";
import type { Sandbox } from "niceeval/sandbox";
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

// @feature docs/feature/adapters/README.md#live-compatibility
test("DeepSeek Harness uses the experiment model on the first request from a fresh Sandbox", async () => {
  const model = "deepseek-v4.1-flash";
  const requests: unknown[] = [];
  const server = await startHttpServer((request, body, response) => {
    requests.push({ method: request.method, path: request.url, model: JSON.parse(body).model });
    response.end("loopback-reply");
  });
  try {
    const agent = deepSeekHarnessAgent({ apiKey: "fixture-key", baseUrl: server.baseUrl });
    if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
    const sandbox = coldStartSandbox();
    type SendContext = Parameters<typeof agent.send>[1];
    const context: SendContext = {
      sandbox,
      model,
      flags: {},
      signal: new AbortController().signal,
      turnId: "dsh-loopback-turn" as SendContext["turnId"],
      session: { capture: noop, get: () => undefined, set: noop, take: () => undefined },
      progress: noop,
      diagnostic: noop,
      log: noop,
    };
    await agent.before?.(sandbox, { ...context, reportInstallation: noop });
    const turn = await agent.send({ text: "Reply once." }, context);
    expect(requests).toEqual([{ method: "POST", path: "/v1/messages", model }]);
    expect(turn.status).toBe("completed");
  } finally {
    await server.close();
  }
});
