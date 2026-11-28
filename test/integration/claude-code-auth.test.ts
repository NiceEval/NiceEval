import { spawn } from "node:child_process";
import { chmod, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { claudeCodeAgent } from "niceeval/adapter";
import { withInspectionQuery } from "niceeval/inspection/host";
import { beforeAll, expect, test, vi } from "vitest";
import { DEFAULT_CLAUDE_CODE_CLI_VERSION } from "../../packages/niceeval/src/agents/coding-cli-versions.ts";
import {
  noSandboxBackendCapabilities,
  registerSandboxCapabilities,
  supportedBackendCapability,
} from "../../packages/niceeval/src/sandbox/backend.ts";
import type { ManagedProcess, ManagedProcessStart, Sandbox } from "../../packages/niceeval/src/types.ts";
import {
  createJudgeProject,
  HOST_SANDBOX_SOURCE,
  narrowInspectionSuccess,
  planAndRunExperiment,
  showJsonDocuments,
} from "./fixtures/judge-harness/harness.ts";

const registration = Symbol.for("niceeval.test.claude-code-auth");
const key = "fixture-claude-api-key";
const token = "fixture-claude-oauth-token";
const rotated = "fixture-rotated-oauth-token";
const apiKeyEnv = "ANTHROPIC_API_KEY";
const oauthEnv = "CLAUDE_CODE_OAUTH_TOKEN";
const none = { apiProvider: "firstParty", tokenSource: "none" };
const apiKey = { ...none, apiKeySource: apiKeyEnv };
const oauth = { ...none, tokenSource: oauthEnv };

const fakeCli = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const { ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, NICEEVAL_CLAUDE_LOG, NICEEVAL_CLAUDE_ACCOUNT } = process.env;
const record = (value) => appendFileSync(NICEEVAL_CLAUDE_LOG, JSON.stringify(value) + "\\n");
const emit = (value) => console.log(JSON.stringify(value));
const session = "claude-fixture";
record({ ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN });
for await (const line of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  record(frame.type);
  if (frame.request?.subtype === "initialize") {
    emit({
      type: "control_response",
      response: { subtype: "success", request_id: frame.request_id, response: { account: JSON.parse(NICEEVAL_CLAUDE_ACCOUNT) } }
    });
  } else if (frame.type === "user") {
    const text = "echoed " + (CLAUDE_CODE_OAUTH_TOKEN ?? ANTHROPIC_API_KEY);
    emit({ type: "assistant", session_id: session, message: { content: [{ type: "text", text }] } });
    emit({ type: "result", session_id: session, subtype: "success" });
  }
}
`;

const sandboxSource = HOST_SANDBOX_SOURCE.replace("  return {\n    sandboxId:", "  const sandbox = {\n    sandboxId:")
  .replace(
    '    runShell: (script, options) => run("bash", ["-c", script], options),',
    `    runShell: (script, options) => {
      const probe = (stdout) => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
      if (script.includes("--version") && script.includes("claude")) return probe(${JSON.stringify(DEFAULT_CLAUDE_CODE_CLI_VERSION)});
      if (script.includes("command -v claude")) return probe("/fixture/claude");
      return run("bash", ["-c", script], options);
    },`,
  )
  .replace(
    "  };\n}\n\nexport default defineSandbox",
    `  };
  process[Symbol.for("niceeval.test.claude-code-auth")](sandbox);
  return sandbox;
}

export default defineSandbox`,
  );

function startFakeProcess(input: ManagedProcessStart, testEnv: NodeJS.ProcessEnv, fakeBin: string): ManagedProcess {
  const [command, ...args] = input.argv.map((arg) => (arg === "/fixture/claude" ? fakeBin : arg));
  if (!command) throw new Error("Missing fake Claude Code command");
  const child = spawn(command, args, {
    cwd: input.cwd,
    env: { ...testEnv, ...input.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<Awaited<ReturnType<ManagedProcess["wait"]>>>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal: signal ?? undefined }));
  });
  return {
    output: (async function* () {
      for await (const bytes of child.stdout) yield { _tag: "Stdout", bytes };
    })(),
    writeStdin: (bytes) =>
      new Promise<void>((resolve, reject) => {
        child.stdin.write(bytes, (error) => (error ? reject(error) : resolve()));
      }),
    async closeStdin() {
      child.stdin.end();
    },
    wait: () => exited,
    async terminate() {
      child.kill();
    },
  };
}

const cases = [
  {
    name: "explicit OAuth",
    options: { oauthToken: token },
    host: { key, token: rotated },
    account: oauth,
    expected: { [oauthEnv]: token },
  },
  {
    name: "rotated OAuth",
    options: { oauthToken: rotated },
    host: { key, token },
    account: oauth,
    expected: { [oauthEnv]: rotated },
  },
  {
    name: "explicit API key",
    options: { apiKey: key },
    host: { token },
    account: apiKey,
    expected: { [apiKeyEnv]: key },
  },
  { name: "host OAuth", options: {}, host: { token }, account: oauth, expected: { [oauthEnv]: token } },
  { name: "host API key wins", options: {}, host: { key, token }, account: apiKey, expected: { [apiKeyEnv]: key } },
  { name: "missing", options: {}, host: {}, account: none },
  {
    name: "OAuth overridden by API key",
    options: { oauthToken: token },
    host: {},
    account: { ...oauth, apiKeySource: apiKeyEnv },
    expected: { [oauthEnv]: token },
    mismatch: apiKeyEnv,
  },
  {
    name: "OAuth suppressed",
    options: { oauthToken: token },
    host: {},
    account: none,
    expected: { [oauthEnv]: token },
    mismatch: "none",
  },
  {
    name: "API key overridden by bearer token",
    options: { apiKey: key },
    host: {},
    account: { ...apiKey, tokenSource: "ANTHROPIC_AUTH_TOKEN" },
    expected: { [apiKeyEnv]: key },
    mismatch: "ANTHROPIC_AUTH_TOKEN",
  },
  {
    name: "reserved settings env",
    options: { oauthToken: token, settingsFile: "reserved-settings.json" },
    host: {},
    account: oauth,
  },
] as const;

const observations = new Map<
  string,
  { frames: unknown[]; digest: string; execution: string; turn: string; record: string; manifest: string }
>();

beforeAll(async () => {
  const cwd = await createJudgeProject("niceeval-claude-auth-", {
    agent: `
      import { claudeCodeAgent } from "niceeval/adapter";
      export default claudeCodeAgent({
        settingsFile: "test-settings.json",
        ...JSON.parse(process.env.NICEEVAL_TEST_CLAUDE_OPTIONS),
      });
    `,
    sandbox: sandboxSource,
    experiments: {
      "record.ts": `
      import { defineExperiment } from "niceeval";
      import adapter from "../agent.ts";
      import sandbox from "../sandbox.ts";
      export default defineExperiment({ adapter, sandbox, evals: ["record"], attempts: 1 });
    `,
    },
    evals: {
      "record.eval.ts": `
      import { defineScoreEval } from "niceeval";
      export default defineScoreEval({ async test(t) { await t.send("say hello"); } });
    `,
    },
    extra: {
      "fake-claude.mjs": fakeCli,
      "test-settings.json": '{"permissions":{"deny":["WebSearch"]}}',
      "reserved-settings.json": JSON.stringify({ env: { [apiKeyEnv]: key, [oauthEnv]: token } }),
    },
  });
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    const fakeBin = join(cwd, "fake-claude.mjs");
    await chmod(fakeBin, 0o755);
    for (const [index, scenario] of cases.entries()) {
      const log = join(cwd, `fake-claude-${index}.jsonl`);
      vi.stubEnv(apiKeyEnv, "key" in scenario.host ? scenario.host.key : undefined);
      vi.stubEnv(oauthEnv, "token" in scenario.host ? scenario.host.token : undefined);
      vi.stubEnv("NICEEVAL_TEST_CLAUDE_OPTIONS", JSON.stringify(scenario.options));
      // Simulate a Sandbox image that already exports both credentials.
      const testEnv = {
        PATH: process.env.PATH,
        [apiKeyEnv]: "fixture-inherited-key",
        [oauthEnv]: "fixture-inherited-token",
        NICEEVAL_CLAUDE_LOG: log,
        NICEEVAL_CLAUDE_ACCOUNT: JSON.stringify(scenario.account),
      };
      Reflect.set(process, registration, (sandbox: Sandbox) => {
        registerSandboxCapabilities(sandbox, {
          ...noSandboxBackendCapabilities,
          managedProcess: supportedBackendCapability(async (input) => startFakeProcess(input, testEnv, fakeBin)),
        });
      });
      const result = await planAndRunExperiment(cwd, "record", { rerun: "all" });
      const slot = result.run?.slots[0];
      if (slot?.publication.state !== "published") throw new Error(`Expected a published Attempt for ${scenario.name}`);
      const locator = slot.publication.attemptLocator;
      const [executionDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
      const execution = narrowInspectionSuccess(executionDoc!, "attempt.trace");
      if (!execution.success) throw new Error(execution.reason);
      const turnId = execution.value.trace.conversation.turns[0]?.turnId;
      const turn = turnId === undefined ? undefined : (await showJsonDocuments(cwd, [locator, turnId]))[0];
      const { record, manifest } = await withInspectionQuery({ cwd }, async (query) => {
        const record = (await query.inspect({ kind: "attempt.get", locator })).attempt;
        if (!("expected" in scenario) || "mismatch" in scenario) return { record, manifest: "" };
        const { artifacts } = await query.inspect({ kind: "attempt.artifacts", locator });
        const descriptor =
          artifacts.state === "available"
            ? artifacts.value.artifacts.find(({ label }) => label === "agent-setup.json")
            : undefined;
        if (!descriptor) throw new Error("Missing Claude Code agent-setup.json");
        const { artifact } = await query.inspect({
          kind: "attempt.artifact",
          locator,
          artifactId: descriptor.artifactId,
        });
        if (artifact.state !== "available" || artifact.nextOffset !== null) {
          throw new Error("Expected the complete Claude Code manifest");
        }
        return { record, manifest: Buffer.from(artifact.base64, "base64").toString("utf8") };
      });
      const logText = await readFile(log, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      observations.set(scenario.name, {
        frames: logText
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
        digest: slot.executionIdentityDigest,
        execution: JSON.stringify(executionDoc),
        turn: JSON.stringify(turn ?? null),
        record: JSON.stringify(record),
        manifest,
      });
    }
  } finally {
    process.chdir(originalCwd);
    Reflect.deleteProperty(process, registration);
    vi.unstubAllEnvs();
    await rm(cwd, { recursive: true, force: true });
  }
}, 60_000);

// @feature docs/feature/adapters/library/sdk/claude-code/README.md
test.for(cases)("Claude Code authentication: $name", (scenario) => {
  const result = observations.get(scenario.name)!;
  if (scenario.name === "reserved settings env") {
    expect(result.frames).toEqual([]);
    expect(result.execution).toContain("contains reserved keys: env");
    return;
  }
  if (!("expected" in scenario)) {
    expect(result.frames).toEqual([]);
    expect(result.execution).toContain(apiKeyEnv);
    expect(result.execution).toContain(oauthEnv);
    return;
  }
  if ("mismatch" in scenario) {
    const [expectedSource] = Object.keys(scenario.expected);
    expect(result.frames).toEqual([scenario.expected, "control_request"]);
    expect(result.execution).toContain(`expected ${expectedSource}, reported ${scenario.mismatch}`);
    return;
  }
  expect(result.frames).toEqual([scenario.expected, "control_request", "user"]);
  expect(result.turn).toContain("echoed <redacted>");
  for (const secret of [key, token, rotated]) {
    expect(result.turn + result.execution + result.record + result.manifest).not.toContain(secret);
  }
  expect(result.manifest).toContain("test-settings.json");
});

// @feature docs/feature/adapters/library/sdk/claude-code/README.md
test("credential rotation and authentication changes preserve execution identity", () => {
  const digests = cases
    .filter((scenario) => scenario.name !== "reserved settings env")
    .map(({ name }) => observations.get(name)?.digest);
  expect(digests[0]).toMatch(/^[a-f0-9]{64}$/u);
  expect(new Set(digests).size).toBe(1);
});

// @feature docs/feature/adapters/library/sdk/claude-code/README.md
test("Claude Code rejects conflicting authentication options at construction", () => {
  const options = { apiKey: key, oauthToken: token };
  expect(() => claudeCodeAgent(options)).toThrow(TypeError);
  for (const name of [apiKeyEnv, oauthEnv]) {
    const config = { env: { [name]: token } };
    expect(() => claudeCodeAgent(config)).toThrow(TypeError);
    expect(() => claudeCodeAgent(config)).toThrow(name);
  }
  const bareOAuth = { oauthToken: token, env: { CLAUDE_CODE_SIMPLE: "1" } };
  expect(() => claudeCodeAgent(bareOAuth)).toThrow(TypeError);
  expect(() => claudeCodeAgent(bareOAuth)).toThrow("CLAUDE_CODE_SIMPLE");
});
