import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import fc from "fast-check";
import { shared } from "niceeval/adapter";
import type { InspectionSuccessDocumentFor } from "niceeval/inspection";
import { withInspectionQuery } from "niceeval/inspection/host";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  noSandboxBackendCapabilities,
  registerSandboxCapabilities,
  supportedBackendCapability,
} from "../../packages/niceeval/src/sandbox/backend.ts";
import { AGENT_BASELINE_VERSION } from "../../packages/niceeval/src/agents/coding-cli-versions.ts";
import type { ManagedProcess, ManagedProcessStart, Sandbox } from "../../packages/niceeval/src/types.ts";
import {
  HOST_SANDBOX_SOURCE,
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readAssertionsList,
  showJsonDocuments,
} from "./fixtures/judge-harness/harness.ts";

const registerProcess = Symbol.for("niceeval.test.codex-headers-access");

const usageCases = [
  { name: "no-base", coverage: "complete", firstCache: 60, lastCache: 90 },
  { name: "custom-headers", coverage: "partial", firstCache: 70, lastCache: 95 },
  { name: "cf-env-fallback", coverage: "unavailable" },
] as const;

const patches = [
  { path: "edited.txt", kind: { type: "update", move_path: null }, status: "completed" },
  { path: "added.txt", kind: { type: "add" }, status: "failed" },
  { path: "deleted.txt", kind: { type: "delete" }, status: "declined" },
] as const;

// @feature docs/feature/adapters/README.md#protocol-normalization
test("parses a file change from Codex exec JSONL through the public converter", () => {
  const item = { id: "item_0", type: "file_change", changes: [{ path: "edited.txt", kind: "update" }] };
  const jsonl = [
    { type: "item.started", item: { ...item, status: "in_progress" } },
    { type: "item.completed", item: { ...item, status: "completed" } },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");

  const change = { path: "edited.txt", kind: "update" };
  expect(shared.parseCodex(jsonl).events).toMatchObject([
    {
      type: "operation.started",
      operationId: "item_0#0",
      operation: { kind: "tool", name: "file_change", tool: "file_edit", input: change },
    },
    { type: "operation.finished", operationId: "item_0#0", kind: "tool", output: change, status: "completed" },
  ]);
});

function startCodexAppServer(argv: readonly string[]): ManagedProcess {
  const stdout = new PassThrough();
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
      if (argv[1] !== "app-server") return;
      const frame = JSON.parse(Buffer.from(bytes).toString("utf8"));
      if (frame.id === undefined) return;
      if (frame.method === "turn/start") {
        emit({ id: frame.id, result: { turn: { id: "fixture-turn" } } });
        const params = { threadId: "fixture-session", turnId: "fixture-turn" };
        const usageCase = usageCases.find(({ name }) => name === frame.params.input[0].text);
        if (usageCase === undefined) throw new Error("Unexpected Codex fixture input");
        const tokens = (
          inputTokens: number,
          cachedInputTokens: number,
          outputTokens: number,
          reasoningOutputTokens: number,
        ) => ({
          inputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningOutputTokens,
          totalTokens: inputTokens + outputTokens,
        });
        const update = (last: ReturnType<typeof tokens>, total: ReturnType<typeof tokens>) =>
          emit({
            method: "thread/tokenUsage/updated",
            params: { ...params, tokenUsage: { last, total, modelContextWindow: null } },
          });
        if (usageCase.coverage !== "unavailable") {
          const first = tokens(100, usageCase.firstCache, 10, 1);
          update(first, first);
          update(first, first);
        }
        for (const { path, kind, status } of patches) {
          const item = { id: path, type: "fileChange", changes: [{ path, kind, diff: "fixture diff" }] };
          emit({ method: "item/started", params: { ...params, item: { ...item, status: "inProgress" } } });
          emit({ method: "item/completed", params: { ...params, item: { ...item, status } } });
        }
        if (usageCase.coverage === "partial") {
          emit({ method: "error", params: { ...params, willRetry: true, error: { message: "Reconnecting" } } });
        }
        if (usageCase.coverage !== "unavailable") {
          update(
            tokens(125, usageCase.lastCache, 15, 1),
            tokens(225, usageCase.firstCache + usageCase.lastCache, 25, 2),
          );
        }
        emit({
          method: "item/completed",
          params: { ...params, item: { id: "msg-1", type: "agentMessage", text: "ok" } },
        });
        emit({ method: "turn/completed", params: { ...params, turn: { id: "fixture-turn", status: "completed" } } });
      } else {
        emit({ id: frame.id, result: { thread: { id: "fixture-session" } } });
      }
    },
    closeStdin: end,
    wait: () => exited.promise,
    terminate: end,
  };
}

function codexSandboxSource() {
  return HOST_SANDBOX_SOURCE.replace(
    "targetPlatform: hostPlatform(),",
    'targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },',
  )
    .replace(
      "  return {\n    sandboxId:",
      `
      const version = ${JSON.stringify(AGENT_BASELINE_VERSION.codex)};
      const result = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });
      const sandbox = {
        sandboxId:`,
    )
    .replace(
      '    runShell: (script, options) => run("bash", ["-c", script], options),',
      `
      runShell: async (script, options) => {
        if (script.includes("--version") && script.includes("codex")) return result(version);
        if (script.includes("command -v") && script.includes("codex")) return result("/fixture/codex");
        if (script.includes("command -v") && script.includes("apply_patch")) return result("/fixture/apply_patch");
        return run("bash", ["-c", script], options);
      },`,
    )
    .replace(
      "  };\n}\n\nexport default defineSandbox",
      `
      };
      process[Symbol.for("niceeval.test.codex-headers-access")](sandbox);
      return sandbox;
    }

    export default defineSandbox`,
    );
}

interface Scenario {
  readonly name: string;
  readonly baseUrl: string | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;
  readonly cfEnv: { readonly id: string; readonly secret: string } | undefined;
}

const SCENARIOS: readonly Scenario[] = [
  { name: "no-base", baseUrl: undefined, headers: undefined, cfEnv: undefined },
  {
    name: "custom-headers",
    baseUrl: "https://s2a.example.com/v1",
    headers: { "X-Custom-Token": "secret-token-123", "X-Organization": "org-456" },
    cfEnv: undefined,
  },
  {
    name: "cf-env-fallback",
    baseUrl: "https://s2a.example.com/v1",
    headers: { "X-Trace": "trace-secret-123" },
    cfEnv: { id: "cf-id-xyz-123", secret: "cf-secret-xyz-123" },
  },
  {
    name: "cf-explicit-override",
    baseUrl: "https://s2a.example.com/v1",
    headers: { "CF-Access-Client-Id": "custom-cf-id-123", "cf-access-client-secret": "custom-cf-secret-123" },
    cfEnv: { id: "cf-id-xyz-123", secret: "cf-secret-xyz-123" },
  },
];

describe("codexAgent headers and Cloudflare Access config generation and redaction", () => {
  const results = new Map<string, { configToml: string; commandsText: string; passed: boolean }>();
  const usageByCase = new Map<string, InspectionSuccessDocumentFor<"attempt.usage">["usage"]>();
  let executionIdentityDigest: string | undefined;
  const projects: string[] = [];
  let patchEvidence: { tool: string; input: unknown; outcome: string | undefined }[] = [];

  beforeAll(async () => {
    Reflect.set(process, registerProcess, (sandbox: Sandbox) => {
      registerSandboxCapabilities(sandbox, {
        ...noSandboxBackendCapabilities,
        managedProcess: supportedBackendCapability(async (input: ManagedProcessStart) =>
          startCodexAppServer(input.argv),
        ),
      });
    });

    for (const scenario of SCENARIOS) {
      const exerciseUsage = usageCases.some(({ name }) => name === scenario.name);
      vi.stubEnv("CODEX_API_KEY", "codex-fixture-key-123");
      vi.stubEnv("CODEX_BASE_URL", undefined);
      vi.stubEnv("CF_ACCESS_CLIENT_ID", scenario.cfEnv?.id);
      vi.stubEnv("CF_ACCESS_CLIENT_SECRET", scenario.cfEnv?.secret);

      const agentOpts = {
        ...(scenario.baseUrl === undefined ? {} : { baseUrl: scenario.baseUrl }),
        ...(scenario.headers === undefined ? {} : { headers: scenario.headers }),
      };

      const cwd = await createJudgeProject(`niceeval-codex-headers-${scenario.name}-`, {
        agent: `
          import { codexAgent } from "niceeval/adapter";
          export default codexAgent(${JSON.stringify(agentOpts)});
        `,
        sandbox: codexSandboxSource(),
        evals: {
          "check-config.eval.ts": `
            import { writeFile } from "node:fs/promises";
            import { defineEval } from "niceeval";
            import { includes } from "niceeval/expect";

            export default defineEval({
              async test(t) {
                const res = await t.sandbox.runShell("cat ~/.codex/config.toml");
                await writeFile(process.env.NICEEVAL_CODEX_FIXTURE_CONFIG_OUTPUT, res.stdout, "utf8");
                t.check(res.stdout, includes('model = "gpt-5.4"')).label("model-written");
                ${exerciseUsage ? `await t.send(${JSON.stringify(scenario.name)});` : ""}
              },
            });
          `,
        },
        experiments: {
          "run.ts": `
            import { defineExperiment } from "niceeval";
            import agent from "../agent.ts";
            import sandbox from "../sandbox.ts";
            export default defineExperiment({ adapter: agent, sandbox, model: "gpt-5.4", evals: ["check-config"], attempts: 1 });
          `,
        },
      });
      projects.push(cwd);
      const configPath = join(cwd, "config-toml.txt");
      vi.stubEnv("NICEEVAL_CODEX_FIXTURE_CONFIG_OUTPUT", configPath);

      const run = await planAndRunExperiment(cwd, "run", { rerun: "all" });
      const slot = run.run?.slots[0];
      if (slot?.publication.state !== "published") throw new Error(`Missing slot for ${scenario.name}`);
      const locator = slot.publication.attemptLocator;
      if (exerciseUsage) {
        const usage = await withInspectionQuery(
          { cwd },
          async (query) => (await query.inspect({ kind: "attempt.usage", locator })).usage,
        );
        usageByCase.set(scenario.name, usage);
      }

      const { readFile } = await import("node:fs/promises");
      const configToml = await readFile(configPath, "utf8");
      const entries = await readAssertionsList(cwd, locator);
      const [execDoc] = await showJsonDocuments(cwd, [locator, "execution"]);
      const exec = narrowInspectionSuccess(execDoc!, "attempt.trace");
      if (!exec.success) throw new Error(exec.reason);
      if (scenario.name === "no-base") {
        executionIdentityDigest = slot.executionIdentityDigest;
        const items = exec.value.trace.conversation.items;
        patchEvidence = items.flatMap((item) => {
          if (item.kind !== "tool-call" || item.toolOccurrenceId === undefined) return [];
          const result = items.find(
            (entry) => entry.kind === "tool-result" && entry.toolOccurrenceId === item.toolOccurrenceId,
          );
          return [
            {
              tool: item.tool,
              input: JSON.parse(item.input),
              outcome: result?.kind === "tool-result" ? result.outcome : undefined,
            },
          ];
        });
      }
      const commands = await Promise.all(
        exec.value.trace.identityIndex.commandIds.map(async (id) => (await showJsonDocuments(cwd, [locator, id]))[0]),
      );

      results.set(scenario.name, {
        configToml,
        commandsText: JSON.stringify(commands),
        passed: entries[0]?.entry.decision.result === "matched",
      });
    }
  }, 45_000);

  afterAll(async () => {
    Reflect.deleteProperty(process, registerProcess);
    vi.unstubAllEnvs();
    await Promise.all(projects.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // @feature docs/feature/adapters/README.md#usage-accounting
  // @issue docs/issues/codex-agent-send-usage-counts-only-last-request.md
  test("preserves Codex usage and marks incomplete receipt coverage", () => {
    fc.assert(
      fc.property(fc.constantFrom(...usageCases), (sample) => {
        const usage = usageByCase.get(sample.name);
        expect(usage?.state).toBe(sample.coverage === "complete" ? "complete" : "partial");
        if (sample.coverage === "unavailable") {
          expect(usage?.turns.map(({ coverage }) => coverage)).toEqual([
            { state: "unavailable", reason: "codex-token-usage-not-reported" },
          ]);
          expect(usage?.totals.requests).toEqual({ state: "unavailable", value: null, observationCount: 0 });
        } else {
          const quantityState = sample.coverage === "partial" ? "partial" : "available";
          expect(usage?.totals).toMatchObject({
            requests: { state: quantityState, value: 2, observationCount: 2 },
            inputTokens: { state: quantityState, value: 225 - sample.firstCache - sample.lastCache },
            outputTokens: { state: quantityState, value: 25 },
          });
          expect(usage?.turns.map(({ coverage }) => coverage)).toEqual([
            sample.coverage === "partial"
              ? { state: "partial", reason: "codex-native-retry-usage-not-reported" }
              : { state: "complete" },
          ]);
        }
        expect(usage?.modelGroups).toMatchObject({
          basis: "reported-sends",
          state: "unavailable",
          reason: "physical-call-identity-not-recorded",
        });
        expect(usage?.totalCosts).toMatchObject({ state: "unavailable", values: [] });
      }),
      { seed: 171, numRuns: 8, examples: [[usageCases[2]], [usageCases[1]]] },
    );
  });

  // @feature docs/feature/experiments/README.md#partial-reuse
  test("preserves the execution identity recorded before the Codex usage coverage correction", () => {
    expect(executionIdentityDigest).toBe("4f1fd948d36b81d1de7285e04b7e47d1ab5d53fa65dd4cef378da90dc82b5b1e");
  });

  // @feature docs/feature/adapters/README.md#protocol-normalization
  test("pairs Codex app-server file changes and outcomes in the public trace", () => {
    expect(patchEvidence).toEqual([
      { tool: "file_change", input: { path: "edited.txt", kind: "update" }, outcome: "completed" },
      { tool: "file_change", input: { path: "added.txt", kind: "add" }, outcome: "failed" },
      { tool: "file_change", input: { path: "deleted.txt", kind: "delete" }, outcome: "rejected" },
    ]);
  });

  // @feature docs/feature/adapters/README.md#tool-projection-and-privacy
  test("writes s2a headers and CF Access env_http_headers only when configured and redacts secrets in sealed commands", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SCENARIOS), (scenario) => {
        const res = results.get(scenario.name)!;
        expect(res.passed).toBe(true);
        expect(res.configToml).toContain('model = "gpt-5.4"');

        if (scenario.baseUrl === undefined) {
          expect(res.configToml).not.toContain("[model_providers.s2a]");
          return;
        }

        expect(res.configToml).toContain("[model_providers.s2a]");
        expect(res.configToml).toContain(`base_url = "${scenario.baseUrl}"`);
        expect(res.commandsText).not.toContain(scenario.baseUrl);

        if (scenario.headers !== undefined) {
          expect(res.configToml).toContain("[model_providers.s2a.http_headers]");
          for (const [key, value] of Object.entries(scenario.headers)) {
            expect(res.configToml).toContain(`"${key}" = "${value}"`);
            if (value.length >= 8) {
              expect(res.commandsText).not.toContain(value);
            } else {
              expect(res.commandsText).toContain(value);
            }
          }
        }

        const hasExplicitCf =
          scenario.headers !== undefined &&
          Object.keys(scenario.headers).some((k) =>
            ["cf-access-client-id", "cf-access-client-secret"].includes(k.toLowerCase()),
          );

        if (scenario.cfEnv !== undefined && !hasExplicitCf) {
          expect(res.configToml).toContain("[model_providers.s2a.env_http_headers]");
          expect(res.configToml).toContain('"CF-Access-Client-Id" = "CF_ACCESS_CLIENT_ID"');
          expect(res.configToml).toContain('"CF-Access-Client-Secret" = "CF_ACCESS_CLIENT_SECRET"');
        } else {
          expect(res.configToml).not.toContain("[model_providers.s2a.env_http_headers]");
        }
      }),
      { numRuns: SCENARIOS.length },
    );
  });
});
