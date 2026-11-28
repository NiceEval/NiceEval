import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { openClawAgent, type SandboxAgent, type SessionKey } from "niceeval/adapter";
import type { Sandbox, SandboxCommandTarget } from "niceeval/sandbox";
import { expect, test } from "vitest";

const unsupported = () => {
  throw new Error("Unexpected Sandbox operation");
};

const sandboxOperations = {
  runCommandOrThrow: unsupported,
  runShellOrThrow: unsupported,
  startCommand: unsupported,
  startShell: unsupported,
  readBytes: unsupported,
  writeText: unsupported,
  writeBytes: unsupported,
  pathExists: unsupported,
};

function transcriptSandbox(
  bin: string,
  runCommand: Sandbox["runCommand"],
  readText: Sandbox["readText"] = unsupported,
): Sandbox {
  return {
    ...sandboxOperations,
    sandboxId: "openclaw-fixture",
    workdir: "/workspace",
    otlpHost: null,
    runShell: async () => ({ stdout: bin, stderr: "", exitCode: 0 }),
    runCommand,
    readText,
    upload: unsupported,
    uploadFile: unsupported,
    uploadDirectory: unsupported,
    downloadFile: unsupported,
    downloadDirectory: unsupported,
    stop: unsupported,
  };
}

type SendContext = Parameters<SandboxAgent["send"]>[1];

function sendContext(sandbox: Sandbox): SendContext {
  let sessionId: string | undefined;
  const slots = new Map<symbol, unknown>();
  return {
    sandbox,
    model: "compat/gpt-5.4",
    flags: {},
    signal: new AbortController().signal,
    turnId: "openclaw-fixture-turn" as SendContext["turnId"],
    session: {
      get id() {
        return sessionId;
      },
      capture(id) {
        sessionId ??= id;
      },
      get<T>(slot: SessionKey<T>) {
        return slots.get(slot.key) as T | undefined;
      },
      set(slot, value) {
        slots.set(slot.key, value);
      },
      take<T>(slot: SessionKey<T>) {
        const value = slots.get(slot.key) as T | undefined;
        slots.delete(slot.key);
        return value;
      },
    },
    progress: () => {},
    diagnostic: () => {},
    log: () => {},
  };
}

// @feature docs/feature/adapters/README.md#tool-projection-and-privacy
test.each([
  { exitCode: 0, sessionId: undefined },
  { exitCode: 1, sessionId: undefined },
  { exitCode: 1, sessionId: "unrelated-session" },
])(
  "OpenClaw attributes upstream failures with exit $exitCode and reported session $sessionId",
  async ({ exitCode, sessionId }) => {
    const agent = openClawAgent({ apiKey: "fixture-key" });
    if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
    const sandbox = transcriptSandbox("/bin/openclaw", async (bin) =>
      bin === "/bin/openclaw"
        ? {
            stdout: JSON.stringify({
              sessionId,
              status: "failed",
              error: { code: "gateway_error", status: 503, message: "provider response body" },
              text: "partial reply",
            }),
            stderr: "",
            exitCode,
          }
        : { stdout: "", stderr: "", exitCode: 1 },
    );
    const diagnostics: Parameters<SendContext["diagnostic"]>[0][] = [];
    const sending = agent.send(
      { text: "Reply once." },
      { ...sendContext(sandbox), diagnostic: (input) => diagnostics.push(input) },
    );
    if (exitCode === 0) {
      await expect(sending).resolves.toMatchObject({
        status: "failed",
        events: [
          { type: "message", role: "assistant", text: "partial reply" },
          { type: "error", message: expect.stringContaining("agent run exited with code 0") },
        ],
      });
    } else {
      await expect(sending).rejects.toMatchObject({
        type: "agent-send-failed",
        acceptance: "started",
        events: [{ type: "message", role: "assistant", text: "partial reply" }],
      });
    }
    expect(diagnostics).toMatchObject(
      sessionId === undefined
        ? [{ code: "agent-upstream-failure", message: "OpenClaw upstream failure: failed · gateway_error · HTTP 503" }]
        : [],
    );
  },
);

// @feature docs/feature/adapters/README.md#coding-cli-compatibility
test("OpenClaw reports unavailable evidence when the native session accessor fails", async () => {
  const agent = openClawAgent({ apiKey: "fixture-key" });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");

  const staleTranscript = [
    { type: "message", message: { role: "user", content: "another session" } },
    { type: "message", message: { role: "assistant", content: "unrelated reply" } },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
  const sandbox = transcriptSandbox(
    "/bin/openclaw",
    async (bin) => {
      if (bin === "/bin/openclaw") {
        return {
          stdout: JSON.stringify({
            payloads: [{ text: "current reply" }],
            meta: { agentMeta: { sessionFile: "/tmp/other-session.jsonl" } },
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "OpenClaw transcript accessor unavailable", exitCode: 42 };
    },
    async () => staleTranscript,
  );

  const turn = await agent.send({ text: "Reply once." }, sendContext(sandbox));
  expect(turn.status).toBe("completed");
  expect(turn.events).toEqual([{ type: "message", role: "assistant", text: "current reply" }]);
  expect(turn.evidenceCoverage).toMatchObject({
    events: { status: "unavailable" },
    actions: { status: "unavailable" },
    usage: { status: "unavailable" },
  });
});

// @feature docs/feature/adapters/README.md#coding-cli-compatibility
test.each([
  { condition: "reads only the current Turn after an append", replaced: false },
  { condition: "reports unavailable coverage after a transcript replacement", replaced: true },
])("OpenClaw $condition", async ({ replaced }) => {
  const agent = openClawAgent({ apiKey: "fixture-key" });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");

  const first = [
    { type: "message", message: { role: "user", content: "Read the fixture." } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_read", name: "read", arguments: { path: "fixture.txt" } }],
        usage: { input: 17, output: 7 },
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call_read",
        content: [{ type: "text", text: "fixture contents" }],
      },
    },
    {
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "First reply." }], usage: { input: 17, output: 7 } },
    },
  ];
  const second = [
    { type: "message", message: { role: "user", content: "Reply without any tool." } },
    {
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "Second reply." }], usage: { input: 47, output: 5 } },
    },
  ];
  const tmp = await mkdtemp(join(tmpdir(), "niceeval-openclaw-replay-"));
  const bin = join(tmp, "openclaw.mjs");
  const storage = join(tmp, "transcript.json");
  try {
    // A package self-reference exercises the same adapter reader that resolves the SDK on the CLI.
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        name: "openclaw",
        exports: {
          "./plugin-sdk/session-transcript-runtime": "./transcript.mjs",
          "./plugin-sdk/runtime-config-snapshot": "./runtime.mjs",
        },
      }),
    );
    await writeFile(bin, "");
    await writeFile(join(tmp, "runtime.mjs"), "export const captureRuntimeConfigAsyncReader = () => async () => {};");
    await writeFile(
      join(tmp, "transcript.mjs"),
      `import { readFile } from "node:fs/promises";
export const resolveSessionTranscriptIdentity = async (identity) => identity;
const readTranscript = async () => JSON.parse(await readFile(new URL("./transcript.json", import.meta.url), "utf8"));
export async function readSessionTranscriptEvents() {
  return (await readTranscript()).events;
}
export async function readSessionTranscriptRawDelta({ cursor }) {
  const { generation, events } = await readTranscript();
  const [cursorGeneration, offset] = cursor?.split(":") ?? [];
  if (cursorGeneration !== undefined && cursorGeneration !== generation) {
    return { kind: "reset", cursor: generation + ":0", reason: "generation_mismatch" };
  }
  const start = Number(offset ?? 0);
  const end = Math.min(start + 2, events.length);
  return {
    kind: "page",
    cursor: generation + ":" + end,
    events: events.slice(start, end).map((event, index) => ({ seq: start + index, event })),
    hasMore: end < events.length,
    serializedBytes: 0,
  };
}
`,
    );
    const run = promisify(execFile);
    let nativeSession = "";
    const sandbox = transcriptSandbox(bin, async (command, args = [], options) => {
      if (command === "node") {
        try {
          const result = await run(process.execPath, [...args], { signal: options?.signal });
          return { ...result, exitCode: 0 };
        } catch (cause) {
          if (!(cause instanceof Error) || !("code" in cause) || typeof cause.code !== "number") throw cause;
          return { stdout: "", stderr: cause.message, exitCode: cause.code };
        }
      }
      const id = args[args.indexOf("--session-id") + 1]!;
      const text = args[args.indexOf("--message") + 1];
      const isFirst = text === "Read the fixture.";
      if (isFirst) nativeSession = id;
      expect(id).toBe(nativeSession);
      if (isFirst) {
        await writeFile(storage, JSON.stringify({ generation: "original", events: first }));
      } else {
        const { generation, events } = JSON.parse(await readFile(storage, "utf8"));
        await writeFile(
          storage,
          JSON.stringify({ generation: replaced ? "replacement" : generation, events: [...events, ...second] }),
        );
      }
      return {
        stdout: JSON.stringify({
          payloads: [{ text: isFirst ? "First reply." : "Second reply." }],
          meta: { agentMeta: { sessionId: id } },
        }),
        stderr: "",
        exitCode: 0,
      };
    });
    const context = sendContext(sandbox);
    const firstTurn = await agent.send({ text: "Read the fixture." }, context);
    expect(firstTurn.events).toContainEqual({
      type: "operation.finished",
      operationId: "call_read",
      kind: "tool",
      output: "fixture contents",
      status: "completed",
    });
    expect(firstTurn.usage).toMatchObject({ inputTokens: 34, outputTokens: 14 });

    // Include an append between sends to distinguish a fresh checkpoint from the previous read's cursor.
    await writeFile(
      storage,
      JSON.stringify({
        generation: "original",
        events: [
          ...first,
          {
            type: "message",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Intervening reply." }],
              usage: { input: 3, output: 2 },
            },
          },
        ],
      }),
    );
    const secondTurn = await agent.send({ text: "Reply without any tool." }, context);
    const reply = { type: "message", role: "assistant", text: "Second reply." };
    expect(secondTurn.status).toBe("completed");
    if (replaced) {
      expect(secondTurn.events).toEqual([reply]);
      expect(secondTurn.evidenceCoverage).toMatchObject({
        events: { status: "unavailable" },
        actions: { status: "unavailable" },
        usage: { status: "unavailable" },
      });
    } else {
      expect(secondTurn.events).toEqual([{ type: "message", role: "user", text: "Reply without any tool." }, reply]);
      expect(secondTurn.usage).toMatchObject({ inputTokens: 47, outputTokens: 5 });
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// @feature docs/feature/adapters/README.md#install-extensions-and-session
test("OpenClaw installs exact plugin declarations from its npm registry source", async () => {
  const plugin = "@openclaw/brave-plugin@2026.11.7";
  const agent = openClawAgent({ plugins: [plugin] });
  if (agent.kind !== "sandbox") throw new Error("Expected a Sandbox Agent");
  const installer = agent.installers.find((candidate) => candidate.installMode === "sandbox-network");
  if (!installer) throw new Error("Expected the OpenClaw plugin installer");

  const home = await mkdtemp(join(tmpdir(), "niceeval-openclaw-plugin-"));
  try {
    await writeFile(
      join(home, "openclaw"),
      `#!/bin/sh
case "$*" in
  'plugins list --json') printf '%s\\n' '{"plugins":[]}' ;;
  'plugins install --force --pin npm:${plugin}') printf '%s' '${plugin}' > "$HOME/installed" ;;
  'plugins install --force --pin '*) echo '--pin is only supported with npm registry installs.' >&2; exit 1 ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o700 },
    );
    const run = promisify(execFile);
    const sandbox: SandboxCommandTarget = {
      ...sandboxOperations,
      sandboxId: "openclaw-plugin",
      workdir: home,
      runCommand: unsupported,
      runShell: unsupported,
      readText: unsupported,
      copyPath: unsupported,
      putContent: unsupported,
      runShellOrThrow: async (script, options) => {
        const result = await run("/bin/sh", ["-c", script], {
          env: { HOME: home, PATH: `${home}${delimiter}${process.env.PATH}` },
          signal: options?.signal,
        });
        return { ...result, exitCode: 0 };
      },
    };
    await installer.install(sandbox, {
      identity: installer.identity,
      targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
      signal: new AbortController().signal,
      progress: () => {},
    });
    await expect(readFile(join(home, "installed"), "utf8")).resolves.toBe(plugin);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
