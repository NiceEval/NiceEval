// 路径提升单测:agent.setup 写进沙箱 `__niceeval__/agent-setup.json` 的安装 manifest,
// runAttemptEffect 在 setup 之后把它读出来、原样挂到 EvalResult.agentSetup(见
// docs/feature/results/architecture.md「agent-setup.json」、src/agents/manifest.ts 的注释)。
// 沙箱是内存 fake(记文件,不起容器)——这里要验的是运行器自己「何时读、读到什么、读不到
// 怎么办」这段编排逻辑,不是 adapter 侧的 manifest 构造规则(那部分已在 agents/skills.test.ts
// 覆盖)。

import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { runAttemptEffect } from "./attempt.ts";
import { defineSandboxAgent, defineSandbox } from "../define.ts";
import { writeAgentSetupManifest, AGENT_SETUP_MANIFEST_PATH } from "../agents/manifest.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { Attempt, AgentRun, AttemptPhase, RunOptions } from "./types.ts";
import type {
  AgentSetupManifest,
  Agent,
  CommandResult,
  Config,
  DiscoveredEval,
  Sandbox,
  SandboxFile,
} from "../types.ts";

/** 内存沙箱:writeFiles/readFile 记文件,runShell 恒成功(供 initGitAndCommit / diff 采集用)。 */
class FakeSandbox implements Partial<Sandbox> {
  readonly workdir = "/workspace";
  readonly sandboxId = "fake";
  readonly otlpHost = null;
  readonly files = new Map<string, string>();

  async runShell(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async runCommand(): Promise<CommandResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(targetDir ? `${targetDir}/${path}` : path, content);
    }
  }
  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    for (const f of files) {
      this.files.set(targetDir ? `${targetDir}/${f.path}` : f.path, f.content.toString());
    }
  }
  async uploadFile(path: string, content: Buffer): Promise<void> {
    this.files.set(path, content.toString());
  }
  async uploadDirectory(): Promise<void> {}
  async downloadFile(path: string): Promise<Buffer> {
    return Buffer.from(this.files.get(path) ?? "");
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async readFile(path: string): Promise<string> {
    const hit = this.files.get(path);
    if (hit === undefined) throw new Error(`no such file: ${path}`);
    return hit;
  }
  async readSourceFiles(): Promise<never> {
    throw new Error("not implemented");
  }
  async stop(): Promise<void> {}
}

const asSandbox = (box: FakeSandbox): Sandbox => box as unknown as Sandbox;

const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

/** 跑一次 attempt:给定 agent,返回 EvalResult。沙箱用内存 fake,不起容器/不联网。
 *  可选 `evalDefOverrides` 覆盖默认 evalDef 的字段(如挂一个 `setup`);可选 `onPhase` 透传给
 *  `runAttemptEffect` 的第五个参数,原样转发 attempt.ts 的 enterPhase 边界(见下方
 *  onPhase 回调专用的 describe 块)。 */
async function runOnce(
  agent: Agent,
  box: FakeSandbox,
  opts: { evalDefOverrides?: Partial<DiscoveredEval>; onPhase?: (phase: AttemptPhase) => void } = {},
): Promise<import("../types.ts").EvalResult> {
  const evalDef: DiscoveredEval = {
    id: "fake/eval",
    baseDir: "/project",
    sourcePath: "/project/fake.eval.ts",
    source,
    test: () => {},
    ...opts.evalDefOverrides,
  };
  const run: AgentRun = {
    agent,
    flags: {},
    runs: 1,
    earlyExit: true,
    // 自定义 provider:create() 直接返回内存 fake,绕开真实沙箱 provider。
    sandbox: defineSandbox({ name: "fake-provider", create: async () => asSandbox(box) }),
    timeoutMs: 5_000,
    evalFilter: () => true,
  };
  const attempt: Attempt = { evalDef, run, attempt: 0, key: "fake/eval", fingerprint: "" };
  const config: Config = {};
  const runOpts: RunOptions = {
    config,
    evals: [evalDef],
    agentRuns: [run],
    reporters: [],
    maxConcurrency: 1,
  };
  const sandboxSem = Effect.runSync(Effect.makeSemaphore(1));
  return Effect.runPromise(runAttemptEffect(attempt, runOpts, sandboxSem, undefined, opts.onPhase));
}

describe("runAttemptEffect · agent-setup 路径提升(沙箱 __niceeval__/agent-setup.json → EvalResult.agentSetup)", () => {
  it("沙箱内有 manifest 时,原样读出挂到 EvalResult.agentSetup(不做任何转换/裁剪)", async () => {
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
      setup: async (sandbox) => {
        await writeAgentSetupManifest(sandbox, manifest);
      },
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    // 沙箱内确实落了这个文件(否则下面的断言测不出"提升"这一步真的发生了)。
    expect(box.files.has(`${box.workdir}/${AGENT_SETUP_MANIFEST_PATH}`)).toBe(true);
    expect(result.agentSetup).toEqual(manifest); // 深相等:内容原样保留,没有裁剪或改形。
  });

  it("沙箱内没有 manifest 时(没装任何 Skill/plugin/MCP 的基线场景),不生成空/伪造的 artifact", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-install",
      // agent.setup 跑了(比如只装了 CLI 本体),但没有任何 skill/plugin/mcp 可写,
      // 所以从不调用 writeAgentSetupManifest —— 这是「基线场景」的真实形状。
      setup: async () => {},
      send: async () => ({ events: [], status: "completed" }),
    });

    const box = new FakeSandbox();
    const result = await runOnce(agent, box);

    expect(result.error).toBeUndefined();
    expect(box.files.has(`${box.workdir}/${AGENT_SETUP_MANIFEST_PATH}`)).toBe(false);
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
  it("挂了 eval.setup 与 agent.setup 时,phase 序列包含两者且不产生空阶段", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-with-setup",
      setup: async () => {},
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: AttemptPhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, {
      evalDefOverrides: { setup: async () => {} },
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.error).toBeUndefined();
    // sandbox-setup(没有 SandboxSpec.setup 钩子)与 telemetry-setup(没有 tracing)都该跳过——
    // 不产生空阶段,序列只含实际执行到的边界,严格按生命周期顺序出现一次。
    expect(phases).toEqual([
      "sandbox-provision",
      "workspace-setup",
      "eval-setup",
      "agent-setup",
      "running",
      "diff",
      "scoring",
      "teardown",
    ]);
  });

  it("没有 eval.setup / agent.setup 时,对应阶段整个不出现(不是出现后立刻跳过的空事件)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-no-setup",
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: AttemptPhase[] = [];
    const box = new FakeSandbox();
    await runOnce(agent, box, { onPhase: (phase) => phases.push(phase) });

    expect(phases).toEqual(["sandbox-provision", "workspace-setup", "running", "diff", "scoring", "teardown"]);
  });

  it("test() 抛出的普通执行错误不设置 skipReason,diff/scoring 仍照常进入", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-throws",
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: AttemptPhase[] = [];
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
    expect(result.error?.operation).toBe("eval.run");
    // test() 里的普通异常被 runAttemptBody 内层 try/catch 收作 result.error,不设置
    // skipReason——所以 diff/scoring 的跳过条件(`!skipReason`)不成立,两个阶段仍会进入,
    // 最后落 teardown。这是「running 阶段失败」的真实序列。
    expect(phases).toEqual(["sandbox-provision", "workspace-setup", "running", "diff", "scoring", "teardown"]);
  });

  it("agent.setup 中途抛错时,phase 序列停在 agent-setup 就跳进 teardown(不会假装跑到了 running)", async () => {
    const agent = defineSandboxAgent({
      name: "fake-agent-setup-throws",
      setup: async () => {
        throw new Error("boom-from-setup");
      },
      send: async () => ({ events: [], status: "completed" }),
    });

    const phases: AttemptPhase[] = [];
    const box = new FakeSandbox();
    const result = await runOnce(agent, box, { onPhase: (phase) => phases.push(phase) });

    expect(result.error?.message).toContain("boom-from-setup");
    expect(result.error?.operation).toBe("agent.setup");
    // 失败发生在 agent-setup:之后不再出现 running/diff/scoring —— run.ts 的 reportFailure()
    // 靠的正是这个真实的「最后已知阶段」,不是硬编码成 running(见 run.ts 的 lastPhase 注释)。
    expect(phases).toEqual(["sandbox-provision", "workspace-setup", "agent-setup", "teardown"]);
  });
});
