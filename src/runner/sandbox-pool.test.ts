// cases: docs/engineering/testing/unit/sandbox.md
// pair-owned plan 的 reuse 门：池只消费物理计划的 runtime capability，不能从作者声明反推
// 或 public Sandbox 鸭子类型猜测 provider 行为。

import { Effect, Exit, Option, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { defineEval, defineSandbox, defineSandboxAgent } from "../define.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { shell } from "../sandbox/commands.ts";
import { defineSandboxTemplate, sandboxProviderPlan, type SandboxLayer, type SandboxProviderModule } from "../sandbox/layer.ts";
import {
  noSandboxBackendCapabilities,
  supportedBackendCapability,
  type SandboxProviderBackend,
} from "../sandbox/backend.ts";
import { normalizeSandboxPaths } from "../sandbox/paths.ts";
import { prepareRunSandboxes } from "./sandbox-selection.ts";
import { ReusableSandboxPool } from "./sandbox-pool.ts";
import { discoverEval, type AgentRun } from "./types.ts";
import type { CommandOptions, CommandResult } from "../types.ts";

const agent = defineSandboxAgent({
  name: "pool-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "pool-agent", version: "1", revision: "1" },
    probe: shell("true"),
  },
  async send() {
    return { events: [], status: "completed" };
  },
});

async function preparedPlanFor(layer: SandboxLayer) {
  const evalDef = discoverEval(defineEval({ test() {} }), {
    id: "pool/eval",
    baseDir: "/repo/evals/pool",
    sourcePath: "/repo/evals/pool/eval.ts",
    loaderDataPaths: Object.freeze([]),
    criteriaPaths: Object.freeze([]),
    privatePaths: Object.freeze([]),
    source: { path: "eval.ts", content: "", sha256: "source" },
  });
  const run: AgentRun = {
    agent,
    flags: {},
    attempts: 1,
    earlyExit: false,
    sandbox: layer,
    experimentId: "experiments/pool",
    experimentBaseDir: "/repo/experiments",
    experimentSourcePath: "/repo/experiments/pool.ts",
    selectedEvalIds: [evalDef.id],
  };
  const [prepared] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (prepared === undefined || prepared.plan._tag !== "Sandbox") throw new Error("expected Sandbox plan");
  return prepared.plan;
}

async function customProviderPlan() {
  let creates = 0;
  const layer = defineSandbox({
    name: "opaque-test-provider",
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    create() {
      creates += 1;
      return Effect.dieMessage("must not materialize an unsupported reusable provider");
    },
  });
  const plan = await preparedPlanFor(layer);
  return { plan, creates: () => creates };
}

/**
 * 内存 fake:只实现 createChangeLedger 建账/reset 用到的两条 shell 脚本(`command -p id -u`、
 * `git reset -q --hard` 打头的回锚脚本),其余一律返回成功——池测试只关心这两条脚本触发的
 * 分支,不需要一个会真正执行 git 的 fake(那是 ledger.test.ts 自己的 Fixture 规范)。
 */
class FakeReusableSandbox {
  readonly workdir = "/workspace";
  readonly otlpHost = null;
  constructor(
    readonly sandboxId: string,
    private readonly handleShell: (script: string, options: CommandOptions) => CommandResult | undefined,
  ) {}
  async runShell(script: string, options: CommandOptions = {}): Promise<CommandResult> {
    return this.handleShell(script, options) ?? { stdout: "", stderr: "", exitCode: 0 };
  }
  async runCommand(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runCommandOrThrow(): Promise<CommandResult & { exitCode: 0 }> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runShellOrThrow(): Promise<CommandResult & { exitCode: 0 }> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeText(_path: string, _content: string): Promise<void> {}
  async writeBytes(_path: string, _content: Uint8Array): Promise<void> {}
  async pathExists(_path: string): Promise<boolean> {
    return false;
  }
  async readText(_path: string): Promise<string> {
    return "";
  }
  async readBytes(_path: string): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async uploadFile(): Promise<void> {}
  async uploadDirectory(): Promise<void> {}
  async downloadFile(): Promise<void> {}
  async downloadDirectory(): Promise<void> {}
  async stop(): Promise<void> {}
}

/**
 * 复用路径不能用 opaque custom provider 冒充：它明确没有 reset contract。这份 provider 声明
 * `reuse: Supported` 与 `ensureLifetime`,让池真正走到 create() 里建分类账;`rootCommands` 与
 * `handleShell` 按各测试需要控制 `command -p id -u` 探测结果与 reset 脚本的成败。
 */
function reusableFakeSandboxLayer(opts: {
  onCreate?: (sandboxId: string) => void;
  rootCommands?: boolean;
  handleShell?: (script: string, options: CommandOptions) => CommandResult | undefined;
}) {
  const provider = "test-reusable-provider";
  let created = 0;
  const module: SandboxProviderModule<undefined> = {
    id: provider,
    capabilities: {
      retention: { _tag: "DestroyOnly" },
      reuse: { _tag: "Supported" },
      sessionLimit: { _tag: "Unlimited" },
    },
    materialize: (_plan, context) => Effect.sync(() => {
      created += 1;
      const sandboxId = `reusable-${created}`;
      opts.onCreate?.(sandboxId);
      const box = new FakeReusableSandbox(sandboxId, (script, options) => opts.handleShell?.(script, options));
      const backend: SandboxProviderBackend = {
        workdir: box.workdir,
        sandboxId: box.sandboxId,
        otlpHost: box.otlpHost,
        capabilities: {
          ...noSandboxBackendCapabilities,
          ensureLifetime: supportedBackendCapability(async () => ({ ready: true as const })),
          ...(opts.rootCommands ? { rootCommands: supportedBackendCapability(true as const) } : {}),
        },
        runCommand: () => box.runCommand(),
        runShell: (script, options) => box.runShell(script, options),
        readText: (path) => box.readText(path),
        writeText: (path, content) => box.writeText(path, content),
        readBytes: (path) => box.readBytes(path),
        writeBytes: (path, content) => box.writeBytes(path, content),
        pathExists: (path) => box.pathExists(path),
        uploadFile: () => box.uploadFile(),
        uploadDirectory: () => box.uploadDirectory(),
        downloadFile: () => box.downloadFile(),
        downloadDirectory: () => box.downloadDirectory(),
        stop: () => box.stop(),
      };
      const sandbox = normalizeSandboxPaths(backend, provider);
      return {
        sandbox,
        group: {
          primary: { sandboxId: sandbox.sandboxId, provider },
          resources: { kind: "primary-only", sandboxId: sandbox.sandboxId },
          stop: () => sandbox.stop(),
        },
        caseKind: "custom" as const,
        caseKey: context.plan.providerPlan.build.caseKey,
        buildKeys: context.plan.providerPlan.build.buildKeys,
        identity: { provider },
        facts: null,
      };
    }),
    collectBuildPreparation: () => Effect.succeed(Option.none()),
  };
  return defineSandboxTemplate({
    provider,
    kind: "test-reusable",
    publishableIdentity: { provider },
    privateFingerprintIdentity: { provider, revision: 1 },
    leakGate: { _tag: "None" },
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider,
      plannerRevision: "1",
      caseKind: "custom",
      target: {
        platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
        source: "provider-defined",
      },
      scheduling: {
        recommendedConcurrency: 1,
        lane: { key: provider, limit: 1 },
        admission: { _tag: "Shared" },
      },
      module,
      runtimePlan: undefined,
      build: { _tag: "None", caseKey: "test-reusable-case", buildKeys: [] },
      publishableIdentity: { provider },
      privateFingerprintIdentity: { provider, revision: 1 },
    })),
  });
}

describe("ReusableSandboxPool · pair-owned runtime capability", () => {
  it("opaque custom provider 在物化前明确拒绝 reuse，绝不调用 create", async () => {
    const fixture = await customProviderPlan();
    const pool = new ReusableSandboxPool(
      fixture.plan,
      1,
      { progress() {}, diagnostic() {} },
      { experimentId: "experiments/pool", signal: new AbortController().signal, progress() {}, diagnostic() {}, fact() {} },
    );

    await expect(Effect.runPromise(Effect.scoped(pool.acquire(60_000, new Map())))).rejects.toThrow(/sandboxReuse is unsupported/);
    expect(fixture.creates()).toBe(0);
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用 · 执行身份」「Sandbox 复用 · 寿命」
// bug: memory/reuse-pool-retire-silently-swallows-root-guard.md
describe("ReusableSandboxPool · root 执行身份与 reset 失败不静默通过", () => {
  it("执行身份为 root 时,在第一条 Attempt 派发前报错,不静默留在池里", async () => {
    const plan = await preparedPlanFor(reusableFakeSandboxLayer({
      rootCommands: true,
      handleShell: (script) => (script === "command -p id -u" ? { stdout: "0\n", stderr: "", exitCode: 0 } : undefined),
    }));
    const pool = new ReusableSandboxPool(
      plan,
      1,
      { progress() {}, diagnostic() {} },
      { experimentId: "experiments/pool", signal: new AbortController().signal, progress() {}, diagnostic() {}, fact() {} },
    );

    await expect(Effect.runPromise(Effect.scoped(pool.acquire(60_000, new Map())))).rejects.toThrow(
      /execution identity is root.*non-root execution user \(declare USER in the image\) or disable sandboxReuse/,
    );
  });

  it("题间 reset 失败时归还 finalizer 发出 sandbox-reset-failed diagnostic 并淘汰实例,下一条 Attempt 改用替代实例", async () => {
    let resetCalls = 0;
    const plan = await preparedPlanFor(reusableFakeSandboxLayer({
      handleShell: (script) => {
        if (!script.includes("git reset -q --hard")) return undefined;
        resetCalls += 1;
        return { stdout: "", stderr: "ledger reset exploded\n", exitCode: 1 };
      },
    }));
    const diagnostics: Array<{ code: string; level: string; message: string }> = [];
    const pool = new ReusableSandboxPool(
      plan,
      1,
      { progress() {}, diagnostic: (input) => diagnostics.push(input) },
      { experimentId: "experiments/pool", signal: new AbortController().signal, progress() {}, diagnostic() {}, fact() {} },
    );

    const ids = await Effect.runPromise(Effect.gen(function* () {
      const firstScope = yield* Scope.make();
      const first = yield* Scope.extend(pool.acquire(60_000, new Map()), firstScope);
      yield* first.commit({ _tag: "Reset" });
      yield* Scope.close(firstScope, Exit.void);

      const secondScope = yield* Scope.make();
      const second = yield* Scope.extend(pool.acquire(60_000, new Map()), secondScope);
      yield* Scope.close(secondScope, Exit.void);

      return { first: first.sandbox.sandboxId, second: second.sandbox.sandboxId };
    }));

    expect(resetCalls).toBe(1);
    expect(ids.second).not.toBe(ids.first);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "sandbox-reset-failed", level: "warning", message: expect.stringContaining("ledger reset exploded") }),
    );
  });
});
