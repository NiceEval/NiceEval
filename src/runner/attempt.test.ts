// cases: docs/engineering/testing/unit/experiments-runner.md
//
// ctx.fact() 的作用域归属单测在本文件末尾单独一个 describe 块:layer prepare/cleanup /
// agent setup·send·teardown 上报的 fact 是否真的落进同一个 attempt 的 EvalResult.facts、
// 同 key 后写覆盖先写、非法 key / 非标量 value 是否完整报错(见
// docs/feature/record/architecture.md#facts运行事实)。
//
// 宿主侧转运单测:agent.setup 经 `ctx.reportSetup()` 交回的安装 manifest,runAttemptEffect
// 原样挂到 EvalResult.agentSetup,且沙箱磁盘上一个字节都不落(见
// docs/feature/record/architecture.md「agent-setup.json」、src/agents/manifest.ts 的注释)。
// 沙箱是内存 fake(记文件,不起容器)——这里要验的是运行器自己「何时读、读到什么、读不到
// 怎么办」这段编排逻辑,不是 adapter 侧的 manifest 构造规则(那部分已在 agents/skills.test.ts
// 覆盖)。
//
// cases: docs/engineering/testing/unit/sandbox.md「失败命令证据包装」——公开 `runCommand` /
// `runShell` 最外层调用非零退出时,在把 `CommandResult` 交还调用方前登记 `FailedCommandEvidence`
// 并与同一次 timing command 节点共用 id;成功命令不登记;调用方处理非零结果并继续不撤销证据,
// 即使随后只把 stderr 尾部拼进自己的诊断。见文件末尾专用 describe 块。

import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { runAttemptEffect } from "./attempt.ts";
import { resolveRunTimeout, type RunTimeout } from "./timeout.ts";
import { activateFeedbackSink, type DiagnosticInput, type FeedbackSink } from "./feedback/sink.ts";
import { defineSandboxAgent as defineSandboxAgentBase, defineSandbox } from "../define.ts";
import { dockerImageSandbox, sandboxLayer } from "../sandbox/layer.ts";
import type { SandboxLayer } from "../sandbox/layer.ts";
import { linkSandboxLayers } from "../sandbox/link.ts";
import { prepareRunSandboxes } from "./sandbox-selection.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { equals } from "../expect/index.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { STATELESS } from "../state/plan.ts";
import { defineExperimentState } from "../state/definition.ts";
import { ExperimentStateWindow } from "../state/runtime.ts";
import type { ReusableLeaseStateWindow, ReusableStateWindowDisposition } from "./sandbox-pool.ts";
import { encodeAttemptLocator } from "../record/locator.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { Attempt, AgentRun, AttemptLifecycleEvent, LifecyclePhase, RunOptions } from "./types.ts";
import type {
  AgentSetupManifest,
  Agent,
  CommandResult,
  Config,
  DiscoveredEval,
  Sandbox,
  SandboxAgentDef,
  ScoreTestContext,
  TestContext,
} from "../types.ts";

/** 这些测试关注 runner 生命周期；probe 恒命中，避免把安装行为混进 fixture。 */
function defineSandboxAgent(
  def: Omit<SandboxAgentDef, "ensure" | "installers" | "evidenceCoverage">,
) {
  const ensure = {
    identity: { agent: def.name, version: "0.0.0-test", revision: "1" },
    probe: defineSandboxCommand(
      { id: "test.agent.probe", revision: "1", inputs: { agent: def.name, version: "0.0.0-test" } },
      async () => {},
    ),
  };
  return defineSandboxAgentBase({ ...def, evidenceCoverage: completeEvidenceCoverage, ensure, installers: [] });
}

/** 内存沙箱:writeText/readText 记文件,runShell 恒成功(供 git ledger / diff 采集用)。 */
class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly files = new Map<string, string>();

  constructor(private readonly stopDelayMs = 0) {}

  async runShell(script?: string): Promise<CommandResult> {
    if (script?.includes("uname -s")) return { stdout: "Linux\nx86_64\nglibc\n", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
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
  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, Buffer.from(content).toString());
  }
  async pathExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async readText(path: string): Promise<string> {
    const hit = this.files.get(path);
    if (hit === undefined) throw new Error(`no such file: ${path}`);
    return hit;
  }
  async readBytes(path: string): Promise<Uint8Array> {
    return Buffer.from(this.files.get(path) ?? "");
  }
  async uploadFile(): Promise<void> {}
  async uploadDirectory(): Promise<void> {}
  async downloadFile(): Promise<void> {}
  async downloadDirectory(): Promise<void> {}
  async stop(): Promise<void> {
    if (this.stopDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.stopDelayMs));
  }
}

const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

/** 测试中的 template 既携带可规划 provider 身份，又始终物化内存 Sandbox。 */
function fakeProviderLayer(box: FakeSandbox, name = "fake-provider"): SandboxLayer<"template-bearing"> {
  return defineSandbox({
    name,
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    create: () => Effect.succeed(asSandbox(box)),
  });
}

const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

/** 跑一次 attempt:给定 agent,返回 EvalResult。沙箱用内存 fake,不起容器/不联网。
 *  可选 `evalDefOverrides` 覆盖默认 evalDef 的字段(如挂一个 `setup`);可选 `onPhase` 透传给
 *  `runAttemptEffect` 的第五个参数,原样转发 attempt.ts 的 enterPhase 边界(见下方
 *  onPhase 回调专用的 describe 块);可选 `timeoutMs` 覆盖默认的 5s 外层超时(超时证据保全
 *  测试专用,见下方专用 describe 块)。 */
async function runOnce(
  agent: Agent,
  box: FakeSandbox,
  opts: {
    evalDefOverrides?: Partial<DiscoveredEval>;
    onPhase?: (phase: LifecyclePhase) => void;
    timeoutMs?: number;
    /**
     * run 层(`--timeout` / experiment)的求值结果,原样铺进 AgentRun —— 空对象即「运行侧没写」,
     * 让解析链落到 eval → config,四层全缺就是无上限。给了它就不再套默认的 5s(解析链测试
     * 专用,见下方「timeoutMs 的四层解析链」describe)。
     */
    runTimeout?: RunTimeout;
    sandbox?: AgentRun["sandbox"];
    /** 测试专用：pure-link 的 Experiment layer；物理 fake provider 仍由 sandbox 提供。 */
    experimentLayer?: SandboxLayer;
    experimentId?: string;
    /** Experiment 级 Judge 覆盖。 */
    judge?: AgentRun["judge"];
    /** 已完成规划的 Experiment State（生命周期顺序测试用）。 */
    state?: AgentRun["state"];
    /** 项目级配置(judge 一类逐字段解析链的上层);省略即空配置。 */
    config?: Config;
    /** 复用池借出的实例(调度事实测试用):模拟 run.ts 把 lease 交给 runAttemptEffect。 */
    reusedSandbox?: {
      sandbox: Sandbox;
      reuseSandbox: number;
      reuseOrdinal: number;
      stateWindow?: ReusableLeaseStateWindow;
      decideStateWindow?: () => ReusableStateWindowDisposition;
    };
  } = {},
): Promise<import("../types.ts").EvalResult> {
  const evalDef = {
    id: "fake/eval",
    baseDir: "/project",
    sourcePath: "/project/fake.eval.ts",
    source,
    test: () => {},
    ...opts.evalDefOverrides,
  } as DiscoveredEval;
  const selectedSandbox = opts.experimentLayer ?? opts.sandbox ?? defineSandbox({
    name: "fake-provider",
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    create: () => Effect.succeed(asSandbox(box)),
  });
  const run: AgentRun = {
    agent,
    flags: {},
    attempts: 1,
    earlyExit: true,
    // 自定义 provider:create() 直接返回内存 fake,绕开真实沙箱 provider。
    sandbox: selectedSandbox,
    state: opts.state ?? STATELESS,
    experimentId: opts.experimentId ?? "fake/experiment",
    experimentBaseDir: "/project",
    experimentSourcePath: "/project/fake.experiment.ts",
    judge: opts.judge,
    ...(opts.runTimeout ?? { timeoutMs: opts.timeoutMs ?? 5_000 }),
    selectedEvalIds: [evalDef.id],
  };
  const [prepared] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (prepared === undefined) throw new Error("test fixture did not produce a sandbox plan");
  const attempt: Attempt = {
    evalDef,
    run,
    attempt: 0,
    key: "fake/eval",
    fingerprint: "",
    configHash: "",
    plan: prepared.plan,
    sandboxPlansByEval: { [evalDef.id]: prepared.identity },
    locator: encodeAttemptLocator({
      runId: "attempt-test-run",
      evalId: evalDef.id,
      attempt: 0,
    }),
  };
  const config: Config = opts.config ?? {};
  const runOpts: RunOptions = {
    config,
    evals: [evalDef],
    agentRuns: [run],
    reporters: [],
    maxConcurrency: 1,
  };
  const sandboxSem = Effect.runSync(Effect.makeSemaphore(1));
  return Effect.runPromise(
    runAttemptEffect(attempt, runOpts, sandboxSem, {
      buildLocators: new Map(),
      onPhase: opts.onPhase,
      ...(opts.reusedSandbox
        ? {
            reusedSandbox: {
              ...opts.reusedSandbox,
              decideStateWindow: opts.reusedSandbox.decideStateWindow ?? (() => ({ _tag: "Continue" as const })),
            },
          }
        : {}),
    }),
  );
}

describe("runAttemptEffect · agent-setup 宿主侧转运(ctx.reportSetup → EvalResult.agentSetup)", () => {
  it("每轮 send 的 AgentContext 保留当前 experiment/eval/attempt 身份", async () => {
    let seen: {
      experimentId?: string;
      evalId?: string;
      attempt?: { id: string; index: number };
    } | undefined;
    const agent = defineSandboxAgent({
      name: "fake-agent-attempt-identity",
      send: async (_input, ctx) => {
        seen = {
          experimentId: ctx.experimentId,
          evalId: ctx.evalId,
          attempt: ctx.attempt,
        };
        return { events: [], status: "completed" };
      },
    });

    const result = await runOnce(agent, new FakeSandbox(), {
      experimentId: "compare/identity",
      evalDefOverrides: { test: async (t: TestContext) => { await t.send("go"); } },
    });

    expect(result.error).toBeUndefined();
    expect(seen).toEqual({
      experimentId: "compare/identity",
      evalId: "fake/eval",
      attempt: { id: "fake/eval", index: 0 },
    });
  });

  it("adapter 交回 manifest 时,原样挂到 EvalResult.agentSetup,且沙箱里不落任何文件", async () => {
    const manifest: AgentSetupManifest = {
      skills: [
        { kind: "local", name: "effect-ts", path: "skills/effect-ts", sha256: "a".repeat(64) },
        { kind: "repo", source: "anthropics/skills", ref: "9d2f1ae187231d8199c64b5b762e1bdf2244733d", skills: ["pdf", "docx"] },
      ],
      nativePlugins: [
        {
          agent: "claude-code",
          marketplace: { name: "duyet", source: "duyet/codex-claude-plugins", ref: "82de4021a311034a9596e891baf3a8266fb33bf7" },
          name: "example-plugin",
          resolvedVersion: "1.2.3",
        },
      ],
      mcpServers: [{ name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] }],
    };

    const agent = defineSandboxAgent({
      name: "fake-agent",
      setup: async (_sandbox, ctx) => {
        ctx.reportSetup(manifest);
      },
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    expect(result.agentSetup).toEqual(manifest); // 深相等:内容原样保留,没有裁剪或改形。
    // 区分力:清单只走宿主侧内存,沙箱磁盘上不出现任何框架文件。
    expect([...box.files.keys()].filter((p) => /niceeval/i.test(p))).toEqual([]);
  });

  it("adapter 没交回 manifest 时(没装任何 Skill/plugin/MCP 的基线场景),不生成空/伪造的 artifact", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-install",
      // agent.setup 跑了(比如只装了 CLI 本体),但没有任何 skill/plugin/mcp 要报,
      // 所以从不调用 ctx.reportSetup —— 这是「基线场景」的真实形状。
      setup: async () => {},
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    expect(result.agentSetup).toBeUndefined();
  });

  it("agent 根本没有 setup 钩子时(非 coding agent adapter),同样不生成 agentSetup", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-setup",
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    expect(result.agentSetup).toBeUndefined();
  });
});

// run.ts 的 reportFailure() 需要「失败发生时所在的阶段」,但 attempt:complete 一发出 coordinator
// 就把 active map 里对应条目删了,run.ts 没法事后反查——只能在 attempt.ts 每次真正跨入一个新
// phase 边界时同步拿到通知。这里直接单测 runAttemptEffect 的第五个参数(onPhase)是否真的随
// enterPhase 同步触发、顺序是否符合「没有对应 hook/配置的步骤直接跳过」的契约
//(docs/feature/experiments/cli.md「Attempt 阶段」),而不是只在 run.ts 集成测试里间接验证。
describe("runAttemptEffect · onPhase 回调随 enterPhase 同步触发", () => {
  it("挂了 Eval prepare 与 agent.setup 时,phase 序列包含聚合与 owner 归因", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-with-setup",
      setup: async () => {},
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: { sandbox: sandboxLayer().prepare(async () => {}) },
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.error).toBeUndefined();
    // owner phase 只做归因，但仍通过 onPhase 对外报告；计时层单独保证不形成重复条目。
    expect(phases).toEqual([
      "sandbox.queue",
      "sandbox.create",
      "sandbox.prepare",
      "sandbox.prepare.eval",
      "agent.ensure",
      "workspace.baseline",
      "agent.setup",
      "eval.run",
      "workspace.diff",
      "assertions.evaluate",
    ]);
  });

  it("没有作者 prepare / agent.setup 时,对应阶段不出现；ensure 屏障仍执行", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-setup",
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    await runOnce(agent, box, { onPhase: (phase) => phases.push(phase) });

    expect(phases).toEqual(["sandbox.queue", "sandbox.create", "agent.ensure", "workspace.baseline", "eval.run", "workspace.diff", "assertions.evaluate"]);
  });

  it("test() 抛出的普通执行错误不设置 skipReason,diff/assertions.evaluate 仍照常进入", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-throws",
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        test: () => {
          throw new Error("boom-from-eval");
        },
      },
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.error?.message).toContain("boom-from-eval");
    expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("eval.run");
    // test() 里的普通异常被 runAttemptBody 内层 try/catch 收作 result.error,不设置
    // skipReason——所以 diff/assertions.evaluate 的跳过条件(`!skipReason`)不成立,两个阶段仍会进入,
    // 最后落 teardown。这是「running 阶段失败」的真实序列。
    expect(phases).toEqual(["sandbox.queue", "sandbox.create", "agent.ensure", "workspace.baseline", "eval.run", "workspace.diff", "assertions.evaluate"]);
  });

  it("agent.setup 中途抛错时,phase 序列停在 agent-setup 就跳进 teardown(不会假装跑到了 running)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-setup-throws",
      setup: async () => {
        throw new Error("boom-from-setup");
      },
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: LifecyclePhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, { onPhase: (phase) => phases.push(phase) });

    expect(result.error?.message).toContain("boom-from-setup");
    expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("agent.setup");
    // 失败发生在 agent-setup:之后不再出现 running/diff/assertions.evaluate —— run.ts 的 reportFailure()
    // 靠的正是这个真实的「最后已知阶段」,不是硬编码成 running(见 run.ts 的 lastPhase 注释)。
    expect(phases).toEqual(["sandbox.queue", "sandbox.create", "agent.ensure", "workspace.baseline", "agent.setup"]);
  });
});

describe("runAttemptEffect · SandboxLayer cleanup 的登记边界", () => {
  it("prepare 登记 cleanup 后抛错，已取得资源仍被清理", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-eval-setup-throws",
      send: async () => ({ events: [], status: "completed" }),
    });
    let cleanupCalls = 0;
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async (_sandbox, context) => {
          context.onCleanup(async () => {
            cleanupCalls += 1;
          });
          throw new Error("boom-from-eval-prepare");
        }),
      },
    });

    expect(result.error?.message).toContain("boom-from-eval-prepare");
    expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("sandbox.prepare.eval");
    expect(cleanupCalls).toBe(1);
  });

  it("prepare 未登记 cleanup 时不虚构收尾调用", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-eval-setup",
      send: async () => ({ events: [], status: "completed" }),
    });
    let cleanupCalls = 0;
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async () => {
          cleanupCalls += 0;
        }),
      },
    });

    expect(result.error).toBeUndefined();
    expect(cleanupCalls).toBe(0);
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「生命周期与资源释放」
describe("runAttemptEffect · SandboxLayer prepare 与 cleanup", () => {
  it("template owner 命令先执行，第二作者随后；cleanup 全局 LIFO", async () => {
    const events: string[] = [];
    const experimentId = "order/mock";
    const record = (event: string): void => {
      events.push(event);
    };
    const box = new FakeSandbox();
    const experimentLayer = fakeProviderLayer(box, "fake-provider-order")
      .prepare(async (_sandbox, context) => {
        expect(context.owner).toEqual({ kind: "experiment", id: experimentId });
        record("experiment.prepare:a");
        context.onCleanup(async () => record("experiment.cleanup:a"));
      })
      .prepare(async (_sandbox, context) => {
        record("experiment.prepare:b");
        context.onCleanup(async () => record("experiment.cleanup:b"));
      });
    const agent = defineSandboxAgent({
      name: "fake-agent-hook-order",
      setup: async () => record("agent.setup"),
      send: async () => {
        record("agent.send");
        return { events: [], status: "completed" };
      },
      teardown: async () => record("agent.teardown"),
    });

    const result = await runOnce(agent, box, {
      experimentId,
      experimentLayer,
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async (_sandbox, context) => {
          expect(context.owner).toEqual({ kind: "eval", id: "fake/eval" });
          record("eval.prepare");
          context.onCleanup(async () => record("eval.cleanup"));
        }),
        test: async (t: TestContext) => {
          await t.send("go");
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(events).toEqual([
      "experiment.prepare:a",
      "experiment.prepare:b",
      "eval.prepare",
      "agent.setup",
      "agent.send",
      "agent.teardown",
      "eval.cleanup",
      "experiment.cleanup:b",
      "experiment.cleanup:a",
    ]);
  });

  it("Reuse State 只在末条 Attempt 保存，且发生在 agent teardown 之后、作者 cleanup 之前", async () => {
    const events: string[] = [];
    const identity = { store: "fixture", cohort: "scope-order", schema: 1 } as const;
    const checkpoint = {
      identity: { revision: "fixture-r1" },
      digest: { _tag: "Sha256" as const, value: "a".repeat(64) },
      facts: {},
    };
    const definition = defineExperimentState({
      identity,
      consistency: { mode: "pinned", revision: "fixture-r1" },
      saveOn: "after-load",
      async load() {
        events.push("state.load");
        return checkpoint;
      },
      async save() {
        events.push("state.save");
        return checkpoint;
      },
    });
    const box = new FakeSandbox();
    const experimentLayer = fakeProviderLayer(box, "fake-provider-state-order")
      .prepare(async (_sandbox, context) => {
        events.push("sandbox.prepare");
        context.onCleanup(async () => {
          events.push("sandbox.cleanup");
        });
      });
    let sendOrdinal = 0;
    const agent = defineSandboxAgent({
      name: "fake-agent-state-order",
      setup: async () => {
        events.push("agent.setup");
      },
      send: async () => {
        sendOrdinal += 1;
        events.push(`agent.send:${sendOrdinal}`);
        return { events: [], status: "completed" };
      },
      teardown: async () => {
        events.push("agent.teardown");
      },
    });

    const state = {
      _tag: "Pinned" as const,
      definition,
      revision: "fixture-r1",
      cadence: "window" as const,
    };
    const window = await Effect.runPromise(ExperimentStateWindow.make(
      state,
      "fake/experiment",
      "state-order-window",
    ));
    const first = await runOnce(agent, box, {
      experimentLayer,
      state,
      reusedSandbox: {
        sandbox: asSandbox(box),
        reuseSandbox: 1,
        reuseOrdinal: 1,
        stateWindow: { _tag: "Stateful", window },
        decideStateWindow: () => ({ _tag: "Continue" }),
      },
      evalDefOverrides: {
        test: async (t: TestContext) => {
          await t.send("first");
        },
      },
    });
    const result = await runOnce(agent, box, {
      experimentLayer,
      state,
      reusedSandbox: {
        sandbox: asSandbox(box),
        reuseSandbox: 1,
        reuseOrdinal: 2,
        stateWindow: { _tag: "Stateful", window },
        decideStateWindow: () => ({ _tag: "Finalize" }),
      },
      evalDefOverrides: {
        test: async (t: TestContext) => {
          await t.send("second");
        },
      },
    });

    expect(first.error).toBeUndefined();
    expect(first.state).toEqual({ windowId: "state-order-window" });
    expect(result.error).toBeUndefined();
    expect(events).toEqual([
      "sandbox.prepare",
      "state.load",
      "agent.setup",
      "agent.send:1",
      "agent.teardown",
      "sandbox.cleanup",
      "sandbox.prepare",
      "agent.setup",
      "agent.send:2",
      "agent.teardown",
      "state.save",
      "sandbox.cleanup",
    ]);
    expect(result.state).toEqual({ windowId: "state-order-window" });
    expect(await Effect.runPromise(window.snapshot())).toMatchObject({
      _tag: "Finalized",
      record: {
        load: { outcome: "succeeded" },
        save: { outcome: "succeeded" },
      },
    });
  });

  it("prepare 中途失败时后续命令与 agent 不运行，只清理已登记资源", async () => {
    const events: string[] = [];
    const box = new FakeSandbox();
    const experimentLayer = fakeProviderLayer(box, "fake-provider-failing-prepare")
      .prepare((_sandbox, context) => {
        events.push("prepare:ok");
        context.onCleanup(async () => { events.push("cleanup:ok"); });
      })
      .prepare((_sandbox, context) => {
        events.push("prepare:boom");
        context.onCleanup(async () => { events.push("cleanup:boom"); });
        throw new Error("boom-from-sandbox-prepare");
      })
      .prepare(() => {
        events.push("prepare:must-not-run");
      });
    const agent = defineSandboxAgent({
      name: "fake-agent-must-not-start",
      setup: async () => {
        events.push("agent.setup:must-not-run");
      },
      send: async () => {
        events.push("agent.send:must-not-run");
        return { events: [], status: "completed" };
      },
      teardown: async () => {
        events.push("agent.teardown:must-not-run");
      },
    });

    const result = await runOnce(agent, box, { experimentLayer });

    expect(result.verdict).toBe("errored");
    expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("sandbox.prepare.experiment");
    expect(result.error?.message).toContain("boom-from-sandbox-prepare");
    expect(events).toEqual([
      "prepare:ok",
      "prepare:boom",
      "cleanup:boom",
      "cleanup:ok",
    ]);
  });
});

describe("runAttemptEffect · 主链与 Sample 收尾的计时边界", () => {
  it("sandbox.stop 只计入收尾,主链 phase 合计不超过 durationMs", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-timed-stop",
      send: async () => ({ events: [], status: "completed" }),
    });
    const result = await runOnce(agent, new FakeSandbox(40));
    const phases = result.phases ?? [];
    const closing = new Set<LifecyclePhase>([
      "agent.teardown",
      "sandbox.cleanup",
      "sandbox.suspend",
      "sandbox.stop",
    ]);
    const mainDurationMs = phases
      .filter((phase) => !closing.has(phase.name))
      .reduce((sum, phase) => sum + phase.durationMs, 0);
    const stop = phases.find((phase) => phase.name === "sandbox.stop");

    expect(stop?.durationMs).toBeGreaterThanOrEqual(30);
    expect(mainDurationMs).toBeLessThanOrEqual(result.durationMs);
  });

  it("墙钟在 send 期间回拨不会把 attempt / phase 耗时压成 0", async () => {
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const agent = defineSandboxAgent({
      name: "fake-agent-wall-clock-rollback",
      send: async () => {
        wallClock.mockReturnValue(1_000);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { events: [], status: "completed" };
      },
    });
    try {
      const result = await runOnce(agent, new FakeSandbox(), {
        evalDefOverrides: {
          test: async (t: TestContext) => {
            await t.send("measure me");
          },
        },
      });
      const evalRun = result.phases?.find((phase) => phase.name === "eval.run");
      expect(result.error).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(15);
      expect(evalRun?.durationMs).toBeGreaterThanOrEqual(15);
    } finally {
      wallClock.mockRestore();
    }
  });
});

describe("runAttemptEffect · 计分制(evaluationKind:\"points\")的挣分落盘", () => {
  const pointsAgent = () =>
    defineSandboxAgent({
      name: "fake-agent-points",
      send: async () => ({ events: [], status: "completed" }),
    });

  it(".points()/t.score() 的挣分正确写进 EvalResult.assertions[].points 与 scoreEntries", async () => {
    const result = await runOnce(pointsAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        evaluationKind: "points",
        test: (async (t: ScoreTestContext) => {
          await t.send("先执行任务");
          t.check("actual", equals("actual")).points(3); // 0/1 断言通过挣满 3 分
          t.score("手动给分", 7);
        }) as unknown as DiscoveredEval["test"],
      },
    });

    expect(result.evaluationKind).toBe("points");
    const passedAssertion = result.assertions.find((a) => a.outcome === "passed");
    if (passedAssertion?.outcome !== "passed") throw new Error("fixture 应产出 passed 得分点");
    expect(passedAssertion.points).toBe(3);
    expect(passedAssertion.pointsAvailable).toBe(3);
    expect(result.scoreEntries).toMatchObject([{ label: "手动给分", points: 7 }]);
    const userMessage = result.events?.find((event) => event.type === "message" && event.role === "user");
    expect([
      userMessage?.sourceOrder,
      passedAssertion.sourceOrder,
      result.scoreEntries?.[0]?.sourceOrder,
    ]).toEqual([1, 2, 3]);
  });

  it("通过制即使被运行时绕过类型调用 points/score，也不把给分字段落盘", async () => {
    const result = await runOnce(pointsAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        test: (async (t: ScoreTestContext) => {
          t.check("actual", equals("actual")).points(3);
          t.score("运行时绕过", 7);
        }) as unknown as DiscoveredEval["test"],
      },
    });
    expect(result.evaluationKind).toBe("pass");
    expect((result.assertions[0] as { points?: number } | undefined)?.points).toBeUndefined();
    expect(result.assertions[0]?.pointsAvailable).toBeUndefined();
    expect(result.scoreEntries).toBeUndefined();
  });

  it("计分制在评分前异常收束时也落空 scoreEntries，而非省略字段", async () => {
    const result = await runOnce(pointsAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        evaluationKind: "points",
        sandbox: sandboxLayer().prepare(async () => {
          throw new Error("setup boom");
        }),
      },
    });
    expect(result.verdict).toBe("errored");
    expect(result.scoreEntries).toEqual([]);
  });

  it(".gate().stopOnFailure() 中止后:verdict 为 failed,中止后的给分被丢弃", async () => {
    const result = await runOnce(pointsAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        evaluationKind: "points",
        test: (async (t: ScoreTestContext) => {
          t.score("早期给分", 5);
          await t.check("actual", equals("expected")).gate().stopOnFailure();
          t.score("永不执行", 100); // 中止之后的给分不进结果
        }) as unknown as DiscoveredEval["test"],
      },
    });

    // 前置已经把断言记下来了,不是执行异常——中止挣 0 是 agent 的责任,verdict 是 failed
    // 不是 errored(见 docs/feature/experiments/score-points.md「计分制:叠加给分」)。
    expect(result.error).toBeUndefined();
    expect(result.verdict).toBe("failed");
    expect(result.scoreEntries).toMatchObject([{ label: "早期给分", points: 5 }]); // 没有"永不执行"那 100 分
    expect(result.assertions).toHaveLength(1); // 前置之后记录的断言被截断
    expect(result.assertions[0]!.outcome).toBe("failed");
  });

  it("stopOnFailure 不写 await 也不漏中止:结论与写了 await 完全一致", async () => {
    const result = await runOnce(pointsAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        evaluationKind: "points",
        test: (async (t: ScoreTestContext) => {
          t.score("早期给分", 5);
          t.check("actual", equals("expected")).gate().stopOnFailure(); // 没有 await
          t.score("永不执行", 100);
        }) as unknown as DiscoveredEval["test"],
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.verdict).toBe("failed");
    expect(result.scoreEntries).toMatchObject([{ label: "早期给分", points: 5 }]);
    expect(result.assertions).toHaveLength(1);
  });

  it("计分制丢分不是失败:得分点全挂但没有前置中止时 verdict 仍是 passed", async () => {
    const result = await runOnce(pointsAgent(), new FakeSandbox(), {
      evalDefOverrides: {
        evaluationKind: "points",
        test: (async (t: ScoreTestContext) => {
          // matcher 自带默认 severity 是 gate,计分制里只贡献通过线——不使这条成为前置
          t.check("actual", equals("expected")).points(3);
          t.check("actual", equals("expected"));
        }) as unknown as DiscoveredEval["test"],
      },
    });

    expect(result.verdict).toBe("passed");
    expect(result.assertions.map((a) => a.severity)).toEqual(["soft", "soft"]);
    expect(result.assertions[0]).toMatchObject({ outcome: "failed", points: 0 });
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「超时、缓存与指纹」超时证据保全
// bug: memory/timeout-evidence-carry-censoring-ruling.md
// 契约: docs/runner.md「超时:双层保护」超时不丢证据 —— 中断终止的是「继续执行」,不撤销
// 「已经观察到的事实」。fixture 让第一轮 send 正常完成(留下真实事件/usage),第二轮永远挂起
// (never-resolving promise),外层 timeoutMs 到点后 Effect 中断整段 body:下面分别验证
// events/usage/diff/error.phase 取的是「中断前已收的证据」,而不是从 attempt 开始时的空壳
// base 重建(区分「空壳重建」与「真保全」的关键在于第一轮的事件/usage 是否被观测到)。
describe("runAttemptEffect · 超时证据保全(超时不丢证据,不是从空壳重建)", () => {
  it("中断前已发生的 events/usage 保留;usage 是部分累计值;error.phase 是中断时打开的阶段", async () => {
    vi.useFakeTimers();
    try {
      let sendCalls = 0;
      const agent = defineSandboxAgent({
        name: "fake-agent-timeout",
        send: async () => {
          sendCalls += 1;
          if (sendCalls === 1) {
            return {
              status: "completed" as const,
              events: [{ type: "message" as const, role: "assistant" as const, text: "first turn done" }],
              usage: { inputTokens: 10, outputTokens: 5 },
            };
          }
          // 第二轮永远不返回:模拟 agent 卡死,只能靠外层 timeoutMs 中断。
          return await new Promise<never>(() => {});
        },
      });

      const box = new FakeSandbox();
      const resultPromise = runOnce(agent, box, {
        timeoutMs: 5_000,
        evalDefOverrides: {
          test: async (t: TestContext) => {
            await t.send("go");
            await t.send("go again"); // 挂起在这里,直到外层超时打断
          },
        },
      });

      // 等第二轮真正发起(第一轮已完成、事件已经进了 SessionManager)再推进虚拟时钟,
      // 确保断言的是「中断前已收到的证据」,不是撞上一个还没来得及产生任何事件的空 attempt。
      await vi.waitFor(() => expect(sendCalls).toBe(2));
      await vi.advanceTimersByTimeAsync(5_100);
      const result = await resultPromise;

      expect(result.verdict).toBe("errored");
      expect(result.error?.code).toBe("timeout");
      // 中断发生在第二轮 send 在飞时,phase 归因到嵌套的 agent.run(不是顶层 eval.run)。
      expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("agent.run");

      // 核心断言:events 非空且确实是第一轮的真实事件,不是空壳重建(base 从不带 events)。
      expect(result.events).toBeDefined();
      expect(result.events!.length).toBeGreaterThan(0);
      expect(result.events!.some((e) => e.type === "message" && e.role === "assistant" && e.text === "first turn done")).toBe(
        true,
      );

      // usage 是已累计轮次的如实值(第一轮的 10/5,不是 0,也不是被后续未完成轮次污染)。
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

      // sources 照常折叠(即使这份 fixture 的事件不带 loc,字段本身也不能被超时路径漏掉)。
      expect(result.sources).toBeDefined();
      expect(Array.isArray(result.sources)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("沙箱型 attempt 超时:收尾段在 teardown 链前补折叠一次 workspace.diff(diff 字段存在)", async () => {
    vi.useFakeTimers();
    try {
      let sendCalls = 0;
      const agent = defineSandboxAgent({
        name: "fake-agent-timeout-diff",
        send: async () => {
          sendCalls += 1;
          if (sendCalls === 1) {
            return { status: "completed" as const, events: [], usage: { inputTokens: 1, outputTokens: 1 } };
          }
          return await new Promise<never>(() => {});
        },
      });

      const box = new FakeSandbox();
      const resultPromise = runOnce(agent, box, {
        timeoutMs: 5_000,
        evalDefOverrides: {
          test: async (t: TestContext) => {
            await t.send("go");
            await t.send("go again");
          },
        },
      });

      await vi.waitFor(() => expect(sendCalls).toBe(2));
      await vi.advanceTimersByTimeAsync(5_100);
      const result = await resultPromise;

      expect(result.error?.code).toBe("timeout");
      // diff 字段存在(数组,即便当前 fake 沙箱没有真实 git 状态导致内容为空)——「存在」
      // 而非 undefined 是关键:undefined 才是「沙箱不可用/没走到 workspace.baseline」的如实缺失。
      expect(result.diff).toBeDefined();
      expect(Array.isArray(result.diff)).toBe(true);
      // 补折叠的耗时进了收尾段 phases,不计入主链 durationMs 口径。
      expect(result.phases?.some((p) => p.name === "workspace.diff")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("超时发生在 SandboxLayer prepare 挂起时:events/usage/diff 如实缺失", async () => {
    vi.useFakeTimers();
    try {
      const agent = defineSandboxAgent({
        name: "fake-agent-early-timeout",
        send: async () => await new Promise<never>(() => {}),
      });

      const box = new FakeSandbox();
      // sandbox.create() 立即成功(内存 fake),但 Experiment prepare 永远不返回:
      // 超时发生在 workspace.baseline 之前,SessionManager/ledger 都还没建立,
      // liveEvents/liveLedger 从未登记过(registerEvidence/registerLedger 都没被调用)。
      const experimentLayer = defineSandbox({
        name: "fake-provider-hang-setup",
        targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
        create: () => Effect.succeed(asSandbox(box)),
      }).prepare(async () => await new Promise<never>(() => {}));
      const resultPromise = runOnce(agent, box, {
        timeoutMs: 5_000,
        sandbox: experimentLayer,
        experimentLayer,
      });
      await vi.advanceTimersByTimeAsync(5_100);
      const result = await resultPromise;

      expect(result.error?.code).toBe("timeout");
      expect(result.events).toBeUndefined();
      expect(result.usage).toBeUndefined();
      expect(result.diff).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「ctx.fact() 的作用域归属」
describe("runAttemptEffect · ctx.fact() 的作用域归属落进 EvalResult.facts", () => {
  it("两层 prepare/cleanup 与 agent setup·send·teardown 的 fact 落进同一 attempt", async () => {
    const box = new FakeSandbox();
    const experimentLayer = fakeProviderLayer(box, "fake-provider-facts")
      .prepare(async (_sandbox, ctx) => {
        ctx.facts("experiment.prepare_ran", true);
        ctx.facts("shared.key", "from-experiment-prepare");
        ctx.onCleanup(async (_target, cleanupCtx) => {
          cleanupCtx.facts("experiment.cleanup_ran", true);
        });
      });

    const agent = defineSandboxAgent({
      name: "fake-agent-facts",
      setup: async (_sandbox, ctx) => {
        ctx.fact("agent.setup_ran", true);
        ctx.fact("shared.key", "from-agent-setup");
      },
      send: async (_input, ctx) => {
        ctx.fact("shared.key", "from-send"); // 再次覆盖:最终值来自最后一次写
        return { events: [], status: "completed" };
      },
      teardown: async (_sandbox, ctx) => {
        ctx.fact("agent.teardown_ran", true);
      },
    });

    const result = await runOnce(agent, box, {
      experimentId: "facts/mock",
      experimentLayer,
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async (_sandbox, ctx) => {
          ctx.facts("eval.prepare_ran", true);
        }),
        test: async (t: TestContext) => { await t.send("go"); },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.facts).toEqual({
      "agent.ensure": "hit",
      "experiment.prepare_ran": true,
      "eval.prepare_ran": true,
      "agent.setup_ran": true,
      "shared.key": "from-send",
      "agent.teardown_ran": true,
      "experiment.cleanup_ran": true,
    });
  });

  it("没有任何作者 ctx.fact() 调用时,EvalResult.facts 只保留 Runner 的 ensure 事实", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-facts",
      send: async () => ({ events: [], status: "completed" }),
    });
    const result = await runOnce(agent, new FakeSandbox());
    expect(result.error).toBeUndefined();
    expect(result.facts).toEqual({ "agent.ensure": "hit" });
  });

  it("非法 key(不匹配 [a-z0-9._-]{1,64})抛错:attempt errored,错误信息带上具体 key", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-bad-fact-key",
      send: async () => ({ events: [], status: "completed" }),
    });
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async (_sandbox, ctx) => {
          ctx.facts("Not A Valid Key!", "x");
        }),
      },
    });
    expect(result.verdict).toBe("errored");
    expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("sandbox.prepare.eval");
    expect(result.error?.message).toContain("Not A Valid Key!");
  });

  it("非标量 value(对象)抛错:attempt errored,错误信息带上实际类型", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-bad-fact-value",
      send: async () => ({ events: [], status: "completed" }),
    });
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async (_sandbox, ctx) => {
          ctx.facts("service.config", { nested: true } as unknown as string);
        }),
      },
    });
    expect(result.verdict).toBe("errored");
    expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("sandbox.prepare.eval");
    expect(result.error?.message).toContain("object");
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「失败命令证据包装」
describe("runAttemptEffect · 失败命令证据包装(公开 runCommand/runShell 非零退出登记 FailedCommandEvidence)", () => {
  /** runCommand 恒返回同一个非零 CommandResult;runShell 沿用 FakeSandbox 的恒成功语义
   *  (供 workspace.baseline 的 git 初始化用,不产生额外的失败命令证据)。 */
  class FailingCommandSandbox extends FakeSandbox {
    constructor(private readonly failing: CommandResult) {
      super();
    }
    override async runCommand(): Promise<CommandResult> {
      return this.failing;
    }
  }

  it("非零退出:CommandResult 交还调用方前登记完整证据,timingNodeId 与 --timing 的 command 节点共用 id;调用方处理非零结果并继续、事后只把 stderr 截尾拼进自己的诊断也不影响已登记的完整证据", async () => {
    const fullStderr = "npm error code EACCES\nnpm error path /usr/lib/node_modules/pnpm\n" + "y".repeat(600);
    const box = new FailingCommandSandbox({ stdout: "", stderr: fullStderr, exitCode: 243 });
    const agent = defineSandboxAgent({
      name: "fake-agent-failing-command",
      send: async () => ({ events: [], status: "completed" }),
    });

    let observedExitCode: number | undefined;
    let observedStderrTail: string | undefined;
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        test: async (t: TestContext) => {
          const r = await t.sandbox.runCommand("npm", ["install", "-g", "pnpm"]);
          // 调用方读到真实非零退出(登记不改变 runCommand 的返回语义),处理它并继续——
          // 不抛错、不中止 attempt。事后只把尾部拼进自己的诊断变量(模拟 .slice(-500) 场景)。
          observedExitCode = r.exitCode;
          observedStderrTail = r.stderr.slice(-500);
        },
      },
    });

    expect(result.error).toBeUndefined(); // 调用方处理了非零退出并继续,attempt 正常完成
    expect(observedExitCode).toBe(243);
    expect(observedStderrTail).not.toContain("EACCES"); // 调用方自己截掉的尾部确实丢了根因

    // wrapper 登记的证据仍然完整——Eval 的自我阉割不影响它。
    expect(result.commands).toBeDefined();
    expect(result.commands).toHaveLength(1);
    const evidence = result.commands![0];
    expect(evidence.exitCode).toBe(243);
    expect(evidence.stderr).toBe(fullStderr);
    expect(evidence.stderr).toContain("EACCES");
    expect(evidence.stderr).toContain("/usr/lib/node_modules/pnpm");
    expect(evidence.display).toContain("npm install -g pnpm");
    expect(evidence.phase).toBe("eval.run");

    const evalRunPhase = result.phases?.find((p) => p.name === "eval.run");
    const node = evalRunPhase?.children?.find((n) => n.id === evidence.timingNodeId);
    expect(node).toBeDefined();
    expect(node?.id).toBe(evidence.timingNodeId);
    expect(node?.command?.exitCode).toBe(243);
  });

  it("成功命令(exitCode 0)不登记输出:EvalResult.commands 整个不出现", async () => {
    const box = new FakeSandbox(); // runCommand 恒返回 exitCode 0
    const agent = defineSandboxAgent({
      name: "fake-agent-successful-command",
      send: async () => ({ events: [], status: "completed" }),
    });
    const result = await runOnce(agent, box, {
      evalDefOverrides: {
        test: async (t: TestContext) => {
          await t.sandbox.runCommand("echo", ["ok"]);
        },
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.commands).toBeUndefined();
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「attempt 级诊断的对外词法与阶段标注」
// bug: memory/diagnostic-key-doubles-as-json-warning-code.md
describe("runAttemptEffect · attempt 级诊断进反馈流的 code 与 phase", () => {
  /** 捕获 reportDiagnostic 的入参:其余 sink 方法一律 no-op,这里只关心诊断这一条通路。 */
  function captureDiagnostics(): { seen: DiagnosticInput[]; deactivate: () => void } {
    const seen: DiagnosticInput[] = [];
    const noop = () => {};
    const sink: FeedbackSink = {
      activity: noop,
      diagnostic: (input) => {
        seen.push(input);
      },
      interrupted: noop,
      reporterError: noop,
      failure: noop,
      budgetExhausted: noop,
      kept: noop,
      experimentHook: noop,
      precheck: noop,
      lockWait: noop,
      runActivity: noop,
      experimentProgress: noop,
      lifecycle: noop,
    };
    return { seen, deactivate: activateFeedbackSink(sink) };
  }

  it("作者不传 dedupeKey:折叠 key 编进 attempt 身份,code 仍是作者给的干净字面量,phase 是报上来那一刻的阶段", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-diagnostic-code",
      send: async () => ({ events: [], status: "completed" }),
    });
    const { seen, deactivate } = captureDiagnostics();
    try {
      await runOnce(agent, new FakeSandbox(), {
        experimentId: "compare/codex",
        evalDefOverrides: {
          sandbox: sandboxLayer().prepare(async (_sandbox, ctx) => {
            ctx.diagnostic({
              code: "memory-warmup-degraded",
              level: "warning",
              message: "Memory warmup failed; continuing with a cold index",
            });
          }),
        },
      });
    } finally {
      deactivate();
    }

    expect(seen).toHaveLength(1);
    const [forwarded] = seen;
    expect(forwarded!.code).toBe("memory-warmup-degraded");
    expect(forwarded!.key).toBe("memory-warmup-degraded:compare/codex|fake/eval|0");
    expect(forwarded!.data?.phase).toBe("sandbox.prepare.eval");
    expect(forwarded!.identity).toEqual({ experimentId: "compare/codex", evalId: "fake/eval", attempt: 0 });
  });

  it("作者传了 dedupeKey:折叠按作者的 key,code 与 phase 不受影响", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-diagnostic-dedupe-key",
      send: async () => ({ events: [], status: "completed" }),
    });
    const { seen, deactivate } = captureDiagnostics();
    try {
      await runOnce(agent, new FakeSandbox(), {
        experimentId: "compare/codex",
        evalDefOverrides: {
          test: async (t: TestContext) => {
            t.diagnostic({
              code: "index-rebuilt",
              level: "warning",
              message: "rebuilt the index",
              dedupeKey: "index-rebuilt:compare/codex",
            });
          },
        },
      });
    } finally {
      deactivate();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBe("index-rebuilt:compare/codex");
    expect(seen[0]!.code).toBe("index-rebuilt");
    expect(seen[0]!.data?.phase).toBe("eval.run");
  });

  it("作者 data 里冒充的 phase 被运行器的实际阶段压过,其余 data 字段原样保留", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-diagnostic-forged-phase",
      send: async () => ({ events: [], status: "completed" }),
    });
    const { seen, deactivate } = captureDiagnostics();
    try {
      await runOnce(agent, new FakeSandbox(), {
        evalDefOverrides: {
          sandbox: sandboxLayer().prepare(async (_sandbox, ctx) => {
            ctx.diagnostic({
              code: "warmup-degraded",
              level: "warning",
              message: "cold index",
              data: { origin: { scope: "attempt" as const, phase: "assertions.evaluate" }, indexAgeDays: 12 },
            });
          }),
        },
      });
    } finally {
      deactivate();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]!.data).toEqual({
      phase: "sandbox.prepare.eval",
      origin: { scope: "attempt" as const, phase: "sandbox.prepare.eval" },
      indexAgeDays: 12,
    });
  });
});

// assertions.evaluate 阶段的 detail 只解释「在等裁判模型」这一种等待:有判分断言时逐条推进,
// 没有则整段不发 detail(契约见 docs/feature/experiments/cli.md「Attempt 阶段」)。
// 断言面是 feedback 事件流里的 progress 文本,不断言渲染字节。
describe("runAttemptEffect · assertions.evaluate 阶段的 judge 推进 detail", () => {
  const judgeAgent = () =>
    defineSandboxAgent({
      name: "fake-agent-judge-progress",
      send: async () => ({ events: [], status: "completed" }),
    });

  const judgeConfig = { model: "fixture-model", baseUrl: "http://judge.fixture.internal/v1" };

  /** 截获全局 fetch:判分请求恒回一个 ClosedQA 选 "Y" 的响应,不起 HTTP server、不出网络。 */
  function stubJudgeGateway(): void {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    vi.stubGlobal("fetch", async (): Promise<Response> => {
      const payload = {
        id: "chatcmpl-fixture",
        object: "chat.completion",
        created: 0,
        model: "fixture",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "select_choice", arguments: JSON.stringify({ choice: "Y" }) },
                },
              ],
            },
          },
        ],
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    });
  }

  function captureLifecycle(): { seen: AttemptLifecycleEvent[]; deactivate: () => void } {
    const seen: AttemptLifecycleEvent[] = [];
    const noop = () => {};
    const sink: FeedbackSink = {
      activity: noop,
      diagnostic: noop,
      interrupted: noop,
      reporterError: noop,
      failure: noop,
      budgetExhausted: noop,
      kept: noop,
      experimentHook: noop,
      precheck: noop,
      lockWait: noop,
      runActivity: noop,
      experimentProgress: noop,
      lifecycle: (event) => {
        seen.push(event);
      },
    };
    return { seen, deactivate: activateFeedbackSink(sink) };
  }

  /** assertions.evaluate 这一段(到下一个阶段为止)里发出的 detail 文本。 */
  function assertionEvaluationDetails(seen: AttemptLifecycleEvent[]): string[] {
    const start = seen.findIndex((e) => e.type === "attempt:phase" && e.phase === "assertions.evaluate");
    expect(start, "attempt 应该进入过 assertions.evaluate 阶段").toBeGreaterThanOrEqual(0);
    const rest = seen.slice(start + 1);
    const next = rest.findIndex((e) => e.type === "attempt:phase");
    return (next === -1 ? rest : rest.slice(0, next))
      .filter((e): e is Extract<AttemptLifecycleEvent, { type: "attempt:progress" }> => e.type === "attempt:progress")
      .map((e) => e.detail);
  }

  it("逐条 judge 把 detail 推进为 judge k/n · <检查方式>", async () => {
    stubJudgeGateway();
    const { seen, deactivate } = captureLifecycle();
    try {
      await runOnce(judgeAgent(), new FakeSandbox(), {
        evalDefOverrides: {
          judge: judgeConfig,
          test: (async (t: TestContext) => {
            t.judge.autoevals.closedQA("回答是否切题?");
            t.judge.autoevals.factuality("布鲁克林今天是晴天");
          }) as unknown as DiscoveredEval["test"],
        },
      });
    } finally {
      deactivate();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    expect(assertionEvaluationDetails(seen)).toEqual([
      'judge 1/2 · closedQA("回答是否切题?")',
      'judge 2/2 · factuality("布鲁克林今天是晴天")',
    ]);
  });

  it("没有 judge 断言时 assertions.evaluate 阶段一个 detail 都不发(不存在与阶段词重复的静态占位)", async () => {
    const { seen, deactivate } = captureLifecycle();
    try {
      await runOnce(judgeAgent(), new FakeSandbox(), {
        evalDefOverrides: {
          test: (async (t: TestContext) => {
            t.check("actual", equals("actual"));
          }) as unknown as DiscoveredEval["test"],
        },
      });
    } finally {
      deactivate();
    }

    expect(assertionEvaluationDetails(seen)).toEqual([]);
  });
});

// judge 的解析链(Experiment → Eval → Config)逐字段合并:上层写了哪个字段用哪个,没写的字段
// config 的 judge 取。断言面是判分断言实际请求到的 model 与端点(截获 fetch,不出网络)。
describe("runAttemptEffect · judge 配置的逐字段解析链", () => {
  const mergeAgent = () =>
    defineSandboxAgent({
      name: "fake-agent-judge-merge",
      send: async () => ({ events: [], status: "completed" }),
    });

  const judgeEval = {
    test: (async (t: TestContext) => {
      t.judge.autoevals.closedQA("回答是否切题?");
    }) as unknown as DiscoveredEval["test"],
  };

  /** 截获全局 fetch,记录判分请求的 URL / Authorization / model。 */
  function captureJudgeRequests(): Array<{ url: string; authorization: string | null; model?: string }> {
    const captured: Array<{ url: string; authorization: string | null; model?: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawBody = init?.body;
      captured.push({
        url: input instanceof Request ? input.url : String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        model: typeof rawBody === "string" ? (JSON.parse(rawBody) as { model?: string }).model : undefined,
      });
      const payload = {
        id: "chatcmpl-fixture",
        object: "chat.completion",
        created: 0,
        model: "fixture",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "select_choice", arguments: JSON.stringify({ choice: "Y" }) },
                },
              ],
            },
          },
        ],
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    });
    return captured;
  }

  it("eval 只声明 model 时 baseUrl / apiKeyEnv 仍从 config 来(逐字段合并,不是整体覆盖)", async () => {
    vi.stubEnv("MY_GATEWAY_KEY", "gateway-key");
    const captured = captureJudgeRequests();
    try {
      await runOnce(mergeAgent(), new FakeSandbox(), {
        config: {
          judge: { model: "config-model", baseUrl: "http://config.fixture.internal/v1", apiKeyEnv: "MY_GATEWAY_KEY" },
        },
        evalDefOverrides: { judge: { model: "eval-model" }, ...judgeEval },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]!.model, "eval 写下的字段压过 config").toBe("eval-model");
    expect(captured[0]!.url, "eval 没写的字段仍从 config 来").toBe("http://config.fixture.internal/v1/chat/completions");
    expect(captured[0]!.authorization).toBe("Bearer gateway-key");
  });

  it("eval 与 config 都声明同一字段时取 eval 的值", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const captured = captureJudgeRequests();
    try {
      await runOnce(mergeAgent(), new FakeSandbox(), {
        config: { judge: { model: "config-model", baseUrl: "http://config.fixture.internal/v1" } },
        evalDefOverrides: {
          judge: { model: "eval-model", baseUrl: "http://eval.fixture.internal/v1" },
          ...judgeEval,
        },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]!.model).toBe("eval-model");
    expect(captured[0]!.url).toBe("http://eval.fixture.internal/v1/chat/completions");
  });

  it("Experiment 只覆盖 model，端点与 key 仍从 Eval / Config 补齐", async () => {
    vi.stubEnv("CONFIG_JUDGE_KEY", "config-key");
    const captured = captureJudgeRequests();
    try {
      const result = await runOnce(mergeAgent(), new FakeSandbox(), {
        judge: { model: "experiment-model" },
        config: {
          judge: {
            model: "config-model",
            baseUrl: "http://config.fixture.internal/v1",
            apiKeyEnv: "CONFIG_JUDGE_KEY",
          },
        },
        evalDefOverrides: {
          judge: { model: "eval-model", baseUrl: "http://eval.fixture.internal/v1" },
          ...judgeEval,
        },
      });
      expect(result.experiment?.judge).toEqual({
        model: "experiment-model",
        baseUrl: "http://eval.fixture.internal/v1",
        timeoutMs: undefined,
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      model: "experiment-model",
      url: "http://eval.fixture.internal/v1/chat/completions",
      authorization: "Bearer config-key",
    });
  });
});

// cases: docs/engineering/testing/unit/sandbox.md「Sandbox 复用」——调度事实。
//
// provider / sandboxId / reused / reuseSandbox / reuseOrdinal 在 Sandbox 租借给这条 Attempt 的
// 那一刻确定。Attempt 无论在哪个阶段终结(这里造 Eval setup 失败),记录里都必须带全——
// 复用模式下最需要归属的恰恰是这类没走到收尾的失败(见 docs/feature/record/architecture.md
// 的 `sandbox` 字段与 memory/reuse-dogfooding-observability-gaps.md)。
describe("runAttemptEffect · sandbox 调度事实在租借时刻落记录", () => {
  const quietAgent = () =>
    defineSandboxAgent({
      name: "fake-agent-reuse",
      send: async () => ({ events: [], status: "completed" }),
    });

  it("复用实例承接的 attempt 正常跑完时,带全归属键", async () => {
    const box = new FakeSandbox();
    const result = await runOnce(quietAgent(), box, {
      reusedSandbox: { sandbox: asSandbox(box), reuseSandbox: 2, reuseOrdinal: 3 },
    });

    expect(result.error).toBeUndefined();
    expect(result.sandbox).toEqual({
      provider: "fake-provider",
      sandboxId: "fake",
      reused: true,
      reuseSandbox: 2,
      reuseOrdinal: 3,
    });
  });

  it("Eval prepare 抛错的 attempt 同样带全归属键", async () => {
    const box = new FakeSandbox();
    const result = await runOnce(quietAgent(), box, {
      reusedSandbox: { sandbox: asSandbox(box), reuseSandbox: 1, reuseOrdinal: 5 },
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async () => {
          throw new Error("fixture prep failed");
        }),
      },
    });

    expect(result.verdict).toBe("errored");
    expect((result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined)).toBe("sandbox.prepare.eval");
    expect(result.sandbox).toEqual({
      provider: "fake-provider",
      sandboxId: "fake",
      reused: true,
      reuseSandbox: 1,
      reuseOrdinal: 5,
    });
  });

  it("一次性沙箱(未复用)的 attempt 记 provider 与实例 id,不谎报复用键", async () => {
    const box = new FakeSandbox();
    const result = await runOnce(quietAgent(), box, {
      evalDefOverrides: {
        sandbox: sandboxLayer().prepare(async () => {
          throw new Error("fixture prep failed");
        }),
      },
    });

    expect(result.verdict).toBe("errored");
    expect(result.sandbox).toEqual({ provider: "fake-provider", sandboxId: "fake" });
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「含 eval 层的字段解析链(timeoutMs)」
// bug: memory/multi-source-field-resolution-order.md
// 断言面是**实际生效的 deadline**(推进虚拟时钟到线前后各看一次)与超时消息里的来源标注,
// 不是解析函数的中间返回值。run 层用 CLI 自己那条 `resolveRunTimeout(flag, experiment)` 铺进
// AgentRun —— 于是「把 config 的缺省提前物化进 run 值」这个真机 bug 在这里会红:第三格
// (config 有值、experiment 没写、eval 写了)会按 config 的线超时,而不是 eval 自己声明的线。
describe("runAttemptEffect · timeoutMs 的四层解析链(--timeout → experiment → eval → config,默认无上限)", () => {
  /** 挂死的 attempt:只能靠外层超时打断,于是「什么时候被打断」就是实际生效的 deadline。 */
  function hangingAgent() {
    return defineSandboxAgent({
      name: "fake-agent-hang",
      send: async () => await new Promise<never>(() => {}),
    });
  }

  /** 推进到线前 1s 应仍在跑,越线后应 errored;返回越线后的结果供断言来源标注。 */
  async function timeoutAt(
    expectedMs: number,
    opts: { runTimeout: RunTimeout; evalTimeoutMs?: number; configTimeoutMs?: number },
  ) {
    vi.useFakeTimers();
    try {
      let settled = false;
      const promise = runOnce(hangingAgent(), new FakeSandbox(), {
        runTimeout: opts.runTimeout,
        evalDefOverrides: {
          // 挂在 send 上直到外层超时打断:被打断的时刻就是实际生效的 deadline。
          test: async (t: TestContext) => {
            await t.send("go");
          },
          ...(opts.evalTimeoutMs !== undefined ? { timeoutMs: opts.evalTimeoutMs } : {}),
        },
        ...(opts.configTimeoutMs !== undefined ? { config: { timeoutMs: opts.configTimeoutMs } } : {}),
      }).then((r) => {
        settled = true;
        return r;
      });

      // 线前:还在跑。这一步是区分力所在——链少一层时 attempt 已经被更早的那条线打断了。
      await vi.advanceTimersByTimeAsync(expectedMs - 1_000);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      // 越线即收束:少了这一条,链多算了一层时会挂在下面的 await 上超时,而不是给出一条断言。
      expect(settled).toBe(true);
      const result = await promise;
      expect(result.error?.code).toBe("timeout");
      return result;
    } finally {
      vi.useRealTimers();
    }
  }

  it("--timeout 压过 experiment / eval / config 三层,消息标 from flag", async () => {
    const result = await timeoutAt(30_000, {
      runTimeout: resolveRunTimeout(30_000, 60_000),
      evalTimeoutMs: 90_000,
      configTimeoutMs: 120_000,
    });
    expect(result.error?.message).toContain("30000ms");
    expect(result.error?.message).toContain("from flag");
  });

  it("没有 --timeout 时 experiment 字段压过 eval / config,消息标 from experiment", async () => {
    const result = await timeoutAt(60_000, {
      runTimeout: resolveRunTimeout(undefined, 60_000),
      evalTimeoutMs: 90_000,
      configTimeoutMs: 120_000,
    });
    expect(result.error?.message).toContain("60000ms");
    expect(result.error?.message).toContain("from experiment");
  });

  // 区分力最强的一格:`??` 链少写一层(把 config 提前物化成 run 值)时只有这一格会红。
  it("config 有值、experiment 没写、eval 写了自己的值时按 eval 的值超时,消息标 from eval", async () => {
    const result = await timeoutAt(90_000, {
      runTimeout: resolveRunTimeout(undefined, undefined),
      evalTimeoutMs: 90_000,
      configTimeoutMs: 120_000,
    });
    expect(result.error?.message).toContain("90000ms");
    expect(result.error?.message).toContain("from eval");
  });

  it("只有 config 写了时按 config 的值超时,消息标 from config", async () => {
    const result = await timeoutAt(120_000, {
      runTimeout: resolveRunTimeout(undefined, undefined),
      configTimeoutMs: 120_000,
    });
    expect(result.error?.message).toContain("120000ms");
    expect(result.error?.message).toContain("from config");
  });

  // cases: docs/engineering/testing/unit/experiments-runner.md「超时归属」
  // 归属三样一起断言:触发层、生效的上限值、值来自哪一层。fixture 让 deadline(90s,来自 eval)
  // 与 config 的 120s 不同,来源层才有区分力——落成 config 就红。
  it("attempt deadline 撞线时 error.timeout 记 attempt-deadline + 上限值 + 解析链的赢家层", async () => {
    const result = await timeoutAt(90_000, {
      runTimeout: resolveRunTimeout(undefined, undefined),
      evalTimeoutMs: 90_000,
      configTimeoutMs: 120_000,
    });
    expect(result.error?.timeout).toEqual({ trigger: "attempt-deadline", limitMs: 90_000, source: "eval" });
  });
  // 链末端没有内置默认(docs 的解析链表格写死默认「无上限」):四层都没声明就不挂 deadline。
  // 区分力:链末端偷偷兜一个毫秒数(比如 10 分钟)时,这一格会在推进到那个数时被打断。
  it("四层都没写时不挂 deadline:推进几小时也不超时,attempt 跑到自己结束", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const agent = defineSandboxAgent({
        name: "fake-agent-gated",
        send: async () => {
          await gate;
          return { events: [], status: "completed" as const };
        },
      });

      let settled = false;
      const promise = runOnce(agent, new FakeSandbox(), {
        runTimeout: resolveRunTimeout(undefined, undefined),
        evalDefOverrides: {
          test: async (t: TestContext) => {
            await t.send("go");
          },
        },
      }).then((r) => {
        settled = true;
        return r;
      });

      await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
      expect(settled).toBe(false);

      // 闸门放开后照常收束成一条正常结果——证明「没有 deadline」不等于「永远挂着不收尾」。
      release();
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;
      expect(result.error).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
