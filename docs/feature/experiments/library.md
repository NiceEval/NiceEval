# Experiments —— 库用法

model/flags 怎么透传、怎样选择 eval、路径怎样形成 id,以及和 `niceeval.config.ts` 的关系。核心契约见 [README](README.md)。

## model / reasoningEffort 与 flags:agent 留空,实验决定

agent 定义里**不写死模型、不写死开关**(那样就锁死了复用)。这几样由实验给,经 `ctx` 透传:

- **`model`** —— 单个模型字符串,agent 的 `send` 从 `ctx.model` 拿;省略则不传 `--model`,用 agent CLI 的原生默认。**跨模型对比写多个实验文件**(各钉一个 model),别在一个实验里塞数组。
- **`reasoningEffort`** —— 单个推理努力程度字符串(取值由具体模型定义,如 `"low"`/`"medium"`/`"high"`),归属与 `model` 完全一致:agent 的 `send` 从 `ctx.reasoningEffort` 拿,eval 的 `test` 从 `t.reasoningEffort` 拿;省略则用 agent 原生默认。跨档位对比同样写多个实验文件。
- **`flags`** —— 任意 KV 的参数,**两处可见**:agent 的 `send`(`ctx.flags`)、eval 的 `test`(`t.flags`)。用来开关联网、注入某个 skill、或让某条 eval 只在某个参数下断言。

```typescript
// experiments/research-mode.experiment.ts
export default defineExperiment({
  agent: codexAgent(),
  model: "opus",                                    // 模型在实验给,agent 留空
  reasoningEffort: "high",                          // → ctx.reasoningEffort / t.reasoningEffort
  flags: { webResearch: true, skill: "memory-v2" }, // → ctx.flags / t.flags
  attempts: 3,
});
```

参数驱动的环境差异(比如按 `flags.skill` 往沙箱注入一个 skill 文件)写在 eval 的 `test(t)` 里:`if (t.flags.skill) await t.sandbox.writeFiles({ ".agent/skill.md": loadSkill(t.flags.skill) })`——普通代码,不需要框架 Hook。

详见 [Adapter · 配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)。

## evals：遍历发现结果，自定义选择

```typescript
export default defineExperiment({
  agent: codexAgent(),
  evals: (e) =>
    e.id.startsWith("coding/") &&
    e.tags.includes("coding") &&
    e.environment !== "gpu",
});
```

上例对应 [Eval Library](../eval/library.md#tags-与-environment让-experiment-选择) 里声明的 `coding/fix-button` 与 `research/gpu-literature`：前者返回 `true`，后者返回 `false`。参数是发现并扇出后的只读 `EvalDescriptor`，不能叫 `eval`——`eval` 是 strict mode 下的保留绑定标识符，作为参数名会直接语法报错。`e.id` 是文件路径推导出的项目内逻辑 id（去掉 `evals/` 与 `.eval.ts`），可直接用 `startsWith` / `includes` 判断；不暴露绝对文件路径。测试集扇出已经完成，所以谓词拿到的是最终 id。简单前缀仍可写 `evals: ["memory/"]`，全部运行可省略或写 `"*"`。

选择结果随 Run 保存，报告不再重跑表达式：

```json
{
  "experimentId": "agents/codex/coding",
  "experiment": {
    "selectedEvalIds": ["coding/fix-button"]
  }
}
```

另一个 experiment 可以记录另一组 id。报告分别按各自的 `selectedEvalIds` 读取，不取交集，也不把没选的 eval 算失败。

## labels:声明归类坐标,不进运行时

「哪些实验算一条线」写在 `labels` 上。labels 是纯报告侧事实——agent 的 `send` 和 eval 的 `test` 都看不见,也不参与[可比性配置](../sample/library.md#两个选择器),改 labels 不会作废任何已有结果。值域限定 `string | number`,与 `flags` 同样在解析时校验,随 Run 落盘进 [`ExperimentRunInfo`](../record/architecture.md#runjson)。

「一条线」的模型是 **lineage(族系)**:线 = 同一个基座,线上的点 = 基座上的各个变体。声明成两条轴——`line` 说这个实验属于哪条线,变体轴(如 `memory`)说它是线上哪个点:

```typescript
// experiments/compare/codex-baseline.ts —— codex 线的基线
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.4",
  labels: { line: "codex", memory: "baseline" },
});

// experiments/compare/codex-mempal.ts —— 同一条线:codex 加 mempal
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.4",
  labels: { line: "codex", memory: "mempal" },
});

// experiments/compare/claude-baseline.ts / claude-mempal.ts —— claude 各自成线,同两条轴
export default defineExperiment({
  agent: claudeCodeAgent(),
  model: "gpt-5.4",
  labels: { line: "claude", memory: "baseline" },
});
```

`line` 是默认报告识别的归类键：当前 Sample 任一实验声明了它，图表就按线归类并连线——
codex / claude 各成一色，基线到 mempal 的位移直接可见。变体轴（`memory`）和其它轴名由报告侧
用 [`label()`](../reports/library/measures.md#维度与数值轴) 显式选轴：

- **成线**：在 `chart(...)` 的 scatter series 中写 `by: label("line"), connect: true`。
- **横切**：把 `by` 换成 `label("memory")`，跨 agent 比较记忆机制本身；
  `by: ["agent", label("memory")]` 表示复合归类。
- **参数进程**:数值坐标(`labels: { contextK: 32 }`)用 `numericLabel("contextK")` 直接当[数值 `XAxis`](../reports/components/charts/README.md#xaxis) 的绑定。

与 `flags` 的分界一句话:**这个值会改变 attempt 里发生的事吗?** 会(开关联网、注入 skill)→ `flags`,进 `ctx.flags` / `t.flags`、参与可比性配置;只是给报表归类 → `labels`。两边都落盘、报告都能分组(`flag()` / `label()`),区别只在运行时可见性与可比性——已经用 `flags` 表达且确实影响行为的变量不必迁移到 labels。两者都是**你写下的声明**;跑起来才知道的值两边都不进,见下一节。

## 运行时坐标不进配置:三个家

隧道 / 反向代理 URL、服务端实例地址这类坐标每次跑都可能换,但换了不改变 attempt 里发生什么。它们不属于配置:`flags` 整袋进指纹、**没有逐键豁免**,把轮换值写进去等于每换一次坐标就作废全部已完成结果。它们的本质是**跑起来才存在**的事实——`setup` 起完隧道才有 URL——所以坐标经工厂闭包流给 agent / sandbox Hook(见[多个实验共享同一套生命周期代码](#多个实验共享同一套生命周期代码)),要留在记录里就用 `ctx.fact()` 上报。

判据因此是机械的,不需要判断「它会不会改变行为」:

> **值是你写下的 → 配置(`flags` / `labels`);值是跑起来才有的 → `ctx.fact()`。**

| | 谁写 | 进指纹 | 运行时可见 | 落盘 | 携带条目读到的值 |
|---|---|---|---|---|---|
| `flags` | 实验作者静态声明 | 整袋,无逐键豁免 | `ctx.flags` / `t.flags` | Run 级 `ExperimentRunInfo.flags` | 本轮的值 |
| `labels` | 实验作者静态声明 | 否 | 否 | Run 级 `ExperimentRunInfo.labels` | 本轮的值 |
| `ctx.fact()` | 生命周期代码运行时上报 | 结构上进不来 | 工厂闭包 | attempt 级 / Run 级 `facts` | 产出它那一轮的值 |

```typescript
// experiments/shared/nowledge.ts —— 工厂闭包里那个每沙箱执行的 Hook
sandboxSetup(): SandboxHook {
  return async (sandbox, ctx) => {
    ctx.fact("nowledge.endpoint", env!.url);   // 这条 attempt 实际连的实例,随它的结果落盘
    await sandbox.writeFiles({ ".nowledge/env": `NMEM_URL=${env!.url}\n` });
  };
}
```

- **报在哪个作用域,决定它跟不跟着结果走。** attempt 作用域(sandbox Hook、agent setup / teardown、adapter send)上报的进 `AttemptRecord.facts`,随携带条目**原样携带**——携带来的那条读到的仍是产出它那一轮的地址,报告按它分组不会张冠李戴。experiment 作用域(`setup` / `teardown`)上报的进 `RunMeta.facts`,记的是整场观测。要按它分组、要它跟着单条结果走,就报在 attempt 作用域。
- **报告按 [`fact()`](../reports/library/measures.md#维度与数值轴) 选轴**分组,与 `flag()` / `label()` 并列。
- **同一个事实是条件还是观测,由谁写下决定。** 实验声明「我要 0.10.39」→ `flags`,换版本作废旧结果正是想要的;跑起来问服务端「你现在是哪个版本」→ `ctx.fact()`,那是审计证据。
- **别把实验条件写成 fact。** 「启用了哪个特性」只报 fact、不进 `flags`,条件变了旧结果会被错误携带(边界见 [Results · facts](../record/architecture.md#facts运行事实))。
- 已经把轮换坐标写进 `flags` 的实验,搬进 fact 会让 flags 袋变化、历史结果一次性作废;搬迁那一次用 [`--carry-ignoring-flag`](use-case/缓存与沿用/) 保住它们。

文件名与归类自此脱钩:`codex-gpt-5.4--mempal.ts` 的后缀只是给人看的命名习惯,报告不从 experiment id 字符串里猜任何语义,归类只认 `labels` 声明。

## 不同 eval 起自不同预制环境

同一 experiment 可以覆盖一批运行时年代不同的真实任务：一条需要 Python 3.9 + astropy 4.2，其余用默认 Node 环境。稳定的大依赖应进 image/template/snapshot（构建工作流见 [Sandbox · 预制环境](../sandbox/library/prebuilt-environments.md)），但具体产物名属于 provider 配置，不能写死在 eval。两边用一个 provider-neutral 的 environment profile 对接：eval 声明需求，sandbox spec 的 `environments` 表把需求翻译成产物：

```typescript
// evals/memory/terminal-swe-bench-astropy-1.eval.ts —— 任务声明自己需要什么
export default defineEval({
  environment: "python-3.9-astropy-4.2",
  async test(t) { /* 上传任务、驱动 agent、跑隐藏测试 */ },
});

// experiments/shared.ts —— 一个 provider 一张翻译表，整组实验复用
export const e2b = e2bSandbox({
  template: "niceeval-agents",                 // 未声明 environment 的 eval 从它起步
  environments: {
    "python-3.9-astropy-4.2": { template: "niceeval-py39-astropy42" },
  },
});

// experiments/compare/codex.ts —— experiment 仍是单一配置，覆盖全部 eval
export default defineExperiment({ agent: codexAgent(), sandbox: e2b });
```

- `environment` 是非空、不透明的稳定 id，不是一组由 NiceEval 解释的包版本约束。
- `environments` 是纯数据：键为 profile id，值为该 provider「预制产物槽位」的覆盖参数（docker 的 `image`、e2b 的 `template`、vercel 的 `snapshotId`），字段类型由各内置工厂声明；`defineSandbox` 自定义 spec 没有这张表。详见 [Sandbox · 按 environment 选预制产物](../sandbox/library/prebuilt-environments.md#按-environment-选预制产物)。
- NiceEval 在创建任何沙箱、计算 carry 或选择全局并发前，对每条**选中** eval 完成查表；选中 eval 声明的 profile 缺表项是启动期配置错误，一次穷举列出全部 (eval id, profile) 缺项，不消耗 provider / Agent 预算。未选中 eval 的 profile 不影响本次运行。
- 查表只决定这条 attempt 从哪个预制产物起步；spec 上的 `.setup()` / `.teardown()` Hook 链与其余参数对全部 eval 共享，`EvalDef.setup` 继续只负责分类账锚点之后的任务 fixture。remote Agent 不创建 sandbox，不参与查表，`environment` 只作为 eval fingerprint 的一部分保留。

翻译表放在 spec 上而不是 experiment 上，是因为它的真实维度是 **profile × provider**，与具体实验无关：表随 spec 被多个实验共享（模块常量或 `Config.sandbox` 兜底），新增环境只改一处，experiment 保持「一行 diff」的形态，一个实验覆盖全集、对比横截面完整。

## 实验级共享服务:setup 与 teardown

「这个实验的所有 attempt 共享一份、跑在宿主机上」的资源——到内网记忆服务的隧道、每实验专用的 mock server、license 租约——写在 `ExperimentDef.setup` / `teardown` 这对 Hook 里。整场恰好至多一次:`setup` 在本实验第一个真正要派发的 attempt 之前执行,`teardown` 在全部 attempt 收尾后执行(中断也执行),当且仅当 `setup` 的时点走到过;全部结果被 carry 携入时两者都不执行。执行语义与失败语义的完整定义见 [Architecture · 实验级生命周期](architecture.md#实验级生命周期setup-与-teardown)。

```typescript
// experiments/compare/claude--nowledge.ts
import { defineExperiment } from "niceeval";
import { nowledgeAgent, nowledgeTunnel } from "../../agents/nowledge.ts";

// setup 产出的运行时坐标放模块闭包:teardown 和同文件的 agent / sandbox Hook
// (后两者每 attempt 执行、晚于 setup)直接读它;runner 不做值的中介,这些值也不进 Run。
let tunnel: { url: string; apiKey: string; stop(): Promise<void> };

export default defineExperiment({
  agent: nowledgeAgent(() => ({ url: tunnel.url, apiKey: tunnel.apiKey })),
  evals: ["memory/"],
  async setup(ctx) {
    ctx.progress({ message: "starting nowledge tunnel" });
    tunnel = await nowledgeTunnel({ signal: ctx.signal });
  },
  async teardown(ctx) {
    ctx.progress({ message: "stopping nowledge tunnel" });
    await tunnel?.stop();   // setup 抛错也会走到这里:对可能未赋值的闭包变量做防御
  },
});
```

隧道起失败时这个实验的每条 attempt 都记 `errored`(`experiment-setup-failed`)、逐条进报告,同批其它实验照常跑——环境起不来不该伪装成绿,也不该连坐别人。

`teardown` 里资源释放是必达底线,观测类动作(probe、指标上报)是 best-effort:给观测自己的短超时、失败不阻断,且在 `ctx.signal.aborted` 时直接跳过——中断路径上,一次可能挂起的观测不该挡在「拆容器、退租约」前面;无论观测成败,释放必须执行(`try/finally`)。

`setup` 管的是**宿主机侧、每实验一份**的资源;别把其它层的活挪进来:沙箱内的环境预置(装二进制、预热)挂 `sandbox` spec 的链式 Hook,任务 Fixture 写 `EvalDef.setup` / `test(t)`,跨实验共享、run 之前就该存在的服务仍用外部编排(分工表见 [环境预置放哪](../sandbox/library.md#环境预置放哪))。运行时值要传给沙箱内的 agent 时,在 agent / sandbox Hook 里把闭包值写成沙箱内的 env 或配置文件——那是每 attempt 的事,发生在 `setup` 之后。

### 与沙箱 Hook 在同一个实验文件里协作

实验级 Hook 起宿主机侧服务,沙箱 Hook 每沙箱把坐标写进沙箱、收尾回存状态——两层在同一个文件里靠模块闭包衔接,时序由 runner 保证:实验级 `setup` 早于本实验任何沙箱 Hook,沙箱 Hook 读到的闭包值一定已赋好:

```typescript
// experiments/compare/claude--nowledge.ts
import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { nowledgeAgent, nowledgeTunnel } from "../../agents/nowledge.ts";
import { loadMemoryState, saveMemoryState } from "../shared/memory-state.ts";

let tunnel: { url: string; apiKey: string; stop(): Promise<void> };

export default defineExperiment({
  agent: nowledgeAgent(() => ({ url: tunnel.url, apiKey: tunnel.apiKey })),
  evals: ["memory/"],
  maxConcurrency: 1,          // [载入…回存] 是临界区,声明式串行(见 Sandbox · 沙箱生命周期 Hook)
  sandbox: e2bSandbox({ template: "niceeval-agents" })
    .setup(async (sandbox, ctx) => {
      // 每沙箱一次,晚于实验级 setup:把宿主机侧坐标写进沙箱
      await sandbox.writeFiles({
        ".nowledge/config.json": JSON.stringify({ url: tunnel.url, apiKey: tunnel.apiKey }),
      });
      await loadMemoryState(sandbox, ctx.experimentId);
    })
    .teardown(async (sandbox, ctx) => {
      await saveMemoryState(sandbox, ctx.experimentId);   // 每沙箱回存跨 attempt 状态
    }),
  async setup(ctx) {
    tunnel = await nowledgeTunnel({ signal: ctx.signal }); // 整场一次,宿主机侧
  },
  async teardown() {
    await tunnel?.stop();                                  // 全部 attempt 收尾后拆
  },
});
```

一份实验文件从上往下读就是完整的运行说明:整场一次的宿主机资源在实验级 Hook 对里;每沙箱的写入与回存在 `sandbox` 链式 Hook 里,经闭包消费实验级产物;agent 怎么连自己、eval 的任务 Fixture 各在 agent 定义与 `EvalDef` 里,不进实验文件。层的分工判据(随什么变化 × 活在哪一侧)见 [环境预置放哪](../sandbox/library.md#环境预置放哪)。

### 多个实验共享同一套生命周期代码

对比组里常常是几个实验对着同一类基础设施——同一个记忆产品,claude 与 codex 各一格对照,启停机制完全一样。先分清共享的单位是**代码**还是**实例**,写法不同;两种都是普通用户代码,niceeval 不为共享设框架原语。

**共享代码、每实验一份实例(默认)**——启停写成一个**工厂**,返回共享同一闭包的整套件:实验级 Hook 对、给 agent / MCP 工厂读坐标的 getter、把坐标写进沙箱的 sandbox Hook。每个实验文件各自实例化,同一套代码、各自的实例与坐标。两条纪律:

- **工厂在 import 期只创建闭包,不做 I/O、不读配置**——实验文件在 `niceeval exp` 的发现阶段就会被 import,import 抛错会连累同批无关实验;所有硬失败留给 `setup`。
- **运行时坐标活在工厂闭包里,不放模块级单例**——同批并行的两个实验各持一份,互不覆写;坐标在 `setup` 之后才存在,不需要「模块态 → 进程 env → 落盘文件」的兜底链。

```typescript
// experiments/shared/nowledge.ts —— 启停一份代码;实例、坐标每实验一份
import type { ExperimentHookContext } from "niceeval";
import type { SandboxHook } from "niceeval/sandbox";

export function nowledgeLifecycle() {
  let instance: string | undefined;
  let env: { url: string; apiKey: string } | undefined;

  return {
    /** agent / MCP 工厂经它读连接信息:闭包值,setup 之后才存在 */
    endpoint: () => env!,

    async setup(ctx: ExperimentHookContext) {
      instance = `exp-${ctx.experimentId.replace(/[^A-Za-z0-9]+/g, "-")}`;
      ctx.progress({ message: `[nowledge] activating ${instance}` });
      await memctl("up", instance);                  // 容器 + 隧道,全新记忆库
      env = await readInstanceEnv(instance);
      ctx.progress({ message: `[nowledge] ready → ${env.url}` });
    },

    async teardown(ctx: ExperimentHookContext) {
      if (!instance) return;                         // setup 没走到起实例就抛了:无事可扫
      try {
        // probe 是观测:best-effort、短超时、中断时跳过,不拦 down
        if (!ctx.signal.aborted) {
          await memctl("probe", instance, { timeoutMs: 10_000 }).catch(() => {});
        }
      } finally {
        await memctl("down", instance);              // 释放是必达底线
      }
    },

    /** 每沙箱一次:把闭包坐标写进沙箱 */
    sandboxSetup(): SandboxHook {
      return async (sandbox) => {
        await sandbox.writeFiles({
          ".nowledge/env": `NMEM_URL=${env!.url}\nNMEM_API_KEY=${env!.apiKey}\n`,
        });
      };
    },
  };
}
```

实验文件里换 agent 只换 agent 那几行,生命周期四行接完:

```typescript
// experiments/compare/codex-gpt-5.4--nowledge.ts
const nowledge = nowledgeLifecycle();
export default defineExperiment({
  agent: codexAgent(nowledgeCodexConfig(nowledge.endpoint)),
  sandbox: e2bSandbox({ template: CODEX_TEMPLATE }).setup(nowledge.sandboxSetup()),
  setup: nowledge.setup,
  teardown: nowledge.teardown,
  maxConcurrency: 1,          // 中心化记忆库,attempt 串行累积
});

// experiments/compare/claude-dp-v4--nowledge.ts —— 同套启停,另一个 agent,自己的实例
const nowledge = nowledgeLifecycle();
export default defineExperiment({
  agent: claudeCodeAgent(nowledgeClaudeConfig(nowledge.endpoint)),
  sandbox: e2bSandbox({ template: CLAUDE_TEMPLATE }).setup(nowledge.sandboxSetup()),
  setup: nowledge.setup,
  teardown: nowledge.teardown,
  maxConcurrency: 1,
});
```

**同批共享一份实例(贵重资源)**——服务起多份太贵时,helper 导出同一对 Hook 对象给所有实验引用,内部用「首进启动、末出关停」的计数:并发到达的 setup 等同一个启动 promise,最后一个实验的 teardown 关停。计数能平衡,靠的是成对触发规则本身:teardown 当且仅当同层 setup 时点走到过、`setup` 抛错也配对执行,`refs` 不会泄漏:

```typescript
// experiments/shared/nowledge-shared.ts
import type { ExperimentHookContext } from "niceeval";

let refs = 0;
let starting: Promise<void> | undefined;
let service: { url: string; stop(): Promise<void> } | undefined;

export const sharedNowledge = {
  async setup(ctx: ExperimentHookContext) {
    refs += 1;
    starting ??= startNowledge().then((s) => { service = s; });
    await starting;                        // 并发实验等同一个启动;启动失败各自抛错
  },
  async teardown() {
    refs -= 1;
    if (refs === 0) {
      await service?.stop();               // 启动失败时 service 未赋值,防御式跳过
      service = undefined;
      starting = undefined;
    }
  },
};
```

边界在生命周期:同批共享的服务活不过这次 run。要**跨 run** 存在的服务(先起好、连续跑多次 `niceeval exp`)仍归外部编排,URL 经 env 传入,见 [环境预置放哪](../sandbox/library.md#环境预置放哪)。

## 生命周期代码怎样向这次运行反馈

真正执行工作的实验级 setup、sandbox provider、sandbox hook、eval 和 Agent Adapter 会从 runner 注入的上下文获得同一套**作用域反馈 API**:

```typescript
interface ScopedFeedback {
  progress(update: {
    message: string;
    current?: number;
    total?: number;
  }): void;

  diagnostic(input: {
    code: string;
    level: "warning" | "error";
    message: string;
    data?: Readonly<Record<string, JsonValue>>;
    dedupeKey?: string;
  }): void;
}
```

- `progress(...)` 表达**此刻正在做什么**,例如下载 3/8、恢复缓存或等待 agent 完成一轮。它是短命状态:人读文本的 live 面板更新 active 行的次要文本(attempt 级回调更新该 attempt 的行,实验级 Hook 更新该实验的运行级行,见 [CLI · 实验级 Hook 的显示](cli.md#实验级-hook-的显示)),非 TTY 文本与 `--json` 不逐条打印,也不进入最终结果。
- `diagnostic(...)` 表达**运行结束后仍应保留的问题**,例如退化到备用缓存、provider 返回异常响应或 transcript 不完整。它进入两种输出形态的永久事件流;`dedupeKey` 用于并发 attempt 产生同一问题时去重。
- 两个方法都不接受 `phase`、`scope`、颜色、输出流或 ANSI。runner 已经知道当前回调属于 `sandbox.setup`、`eval.run` 还是 `agent.run`,并据此决定 Human active 行显示的正式阶段。
- 两个方法都不改变执行结论。要让 setup/attempt 进入 `errored`,抛出异常;要让 eval 判定失败,使用 `t.check` / `t.require` / gate 断言。`diagnostic({ level: "error" })` 只表示一条需要永久保留的错误诊断。

各入口拿到的 scope 固定,调用方不能冒充其它生命周期;scope 的取值就是 [Record Format 的 `LifecyclePhase`](../record/architecture.md#resultjson) 闭集成员,与落盘 `phases` / `error.phase` 同一套名字:

| 代码入口 | 反馈入口 | runner 绑定的 phase | 典型内容 |
|---|---|---|---|
| `ExperimentDef.setup` / `.teardown` | 各自 Hook 的 `ctx.progress/diagnostic` | `experiment.setup` / `experiment.teardown` | 起/拆每实验一份的宿主机共享服务 |
| 自定义 `SandboxSpec.create(options)` | `options.feedback` | `sandbox.create` | 分配实例、拉镜像、恢复 snapshot |
| `sandbox.setup/teardown` | hook `ctx.progress/diagnostic` | `sandbox.setup` / `sandbox.teardown` | 安装环境依赖、预热、回存状态 |
| `EvalDef.setup` | setup `ctx.progress/diagnostic` | `eval.setup` | 准备这条 eval 的 fixture |
| `EvalDef.teardown` | teardown `ctx.progress/diagnostic` | `eval.teardown` | 回收这条 eval 的 fixture |
| `EvalDef.test` | `t.progress/diagnostic` | `eval.run` | eval 自己执行的长步骤 |
| `Agent.setup/send/teardown` | `ctx.progress/diagnostic` | 当前 `agent.*` 阶段 | 安装 CLI、turn/tool 进度、协议诊断 |

同一个方法在不同回调里拿到的是不同的绑定对象,不能保存后跨回调复用。下面三条消息分别属于 sandbox setup、eval run 和 agent run,runner 会把它们投影到正确阶段:

```typescript
const sandbox = e2bSandbox({ template: "niceeval-agents" }).setup(async (sandbox, ctx) => {
  ctx.progress({ message: "restoring memory cache" });
  await restoreCache(sandbox, ctx.experimentId);
});

export const evalDef = defineEval({
  async test(t) {
    t.progress({ message: "preparing hidden tests", current: 2, total: 5 });
    // ...
  },
});

export const agent = defineSandboxAgent({
  name: "my-agent",
  async send(input, ctx) {
    ctx.progress({ message: "turn 2 · running shell" });
    // ...
  },
});
```

终端最终怎样展示这些反馈由输出形态(人读文本 / `--json`)决定,不是这些回调的职责。完整渲染契约见 [CLI · Attempt 阶段](cli.md#attempt-阶段)。

### 哪些会落盘、怎样回顾

反馈按用途分成三层,不能混成一份无限增长的日志:

| 信息 | 是否落盘 | 回顾入口 |
|---|---|---|
| `progress(...)` 的 message/current/total | 否;后一条覆盖前一条 | 只在运行中的 Human active 行可见 |
| runner 的正式 lifecycle phase | 是,只保存发生过的阶段与耗时 | `result.json` 的 `phases`、`niceeval show @locator` |
| `diagnostic(...)` | 是,去重并有界地写入本 attempt 的 `result.json` | `niceeval show @locator` / view Attempt 详情 |
| 未捕获异常、timeout、provider/adapter 执行失败 | 是,作为结构化 `error` 写入 `result.json` | 终端的一行摘要 → locator → `niceeval show` |
| OTel trace | 有则保存,但不是错误记录的前提 | `niceeval show @locator --execution` / view trace |

trace 不能替代 diagnostic/error:沙箱创建可能发生在 telemetry 建立前,teardown 可能发生在 trace 收集后,自定义 provider 也可能完全没有 tracing。`result.json` 是失败能否回顾的最低保证;trace 只回答“内部步骤怎样串起来、各花多久”。

diagnostic 是有界摘要,不是原始 SDK 日志转储。相同 `dedupeKey` 在同一 attempt 内折叠为一条并累计 `count`;`data` 只放定位所需的结构化小字段,不得放 token、完整 transcript 或无限增长的 stdout/stderr。原始 agent 行为属于 `events.json`,trace 属性属于 `trace.json`。

实验级 Hook(`ExperimentDef.setup` / `teardown`)不属于任何单个 attempt,它的 `diagnostic(...)` 只进运行级永久事件流(人读文本与 `--json` 各追加一条),不落 attempt 的 `result.json`;`setup` 抛错则以每条 attempt 的结构化 `error`(`phase: "experiment.setup"`)落盘,失败照样可回顾。Hook 的起止本身由 runner 直接发布为运行级反馈(Human 的运行级 active 行、`--json` 的起止事件,见 [CLI · 实验级 Hook 的显示](cli.md#实验级-hook-的显示)),不写 `progress` 的 setup 在终端上同样可见。

attempt 在 teardown 链与 sandbox stop 都结束后才封口并原子写 `result.json`,因此收尾 diagnostic 也能随 attempt 保存。teardown diagnostic 默认不反改已经得到的 verdict;如果某个收尾动作是结果正确性的必要条件,它应抛出致命错误并由 runner 明确把 attempt 记为 `errored`,而不是只打一条 diagnostic。

## 路径只表达身份与选择

```text
路径                                      experiment id
experiments/agents/codex/coding.ts        agents/codex/coding
experiments/agents/claude/coding.ts       agents/claude/coding
experiments/suites/safety/codex.ts        suites/safety/codex
```

```typescript
// experiments/agents/codex/coding.ts
export default defineExperiment({
  agent: codexAgent(),
  evals: ["coding/"],
});

// experiments/agents/claude/coding.ts
export default defineExperiment({
  agent: claudeCodeAgent(),
  evals: ["coding/"],
});

// experiments/suites/safety/codex.ts —— 同一仓库可以跑另一套 eval
export default defineExperiment({
  agent: codexAgent(),
  evals: ["safety/"],
});
```

- 路径只生成 id，并支持 `niceeval exp agents/codex` 按目录批量选择；任意深度都按完整相对路径处理。
- 每个 experiment 跑哪些 eval 只看自己的 `evals`；解析后的结果作为 `selectedEvalIds` 随 Run 落盘。
- 默认报告直接比较当前 Sample 里的 experiments。每个 experiment 按自己的 `selectedEvalIds` 计算 eval 数与分母，不自动取交集、不把未选择的 eval 当失败。要同分母比较，就给这些 experiments 写相同的 `evals`。

### 一文件一配置

**一个实验文件 = 一个配置**(一个 agent × 一个 model)。要跨模型 / 跨 agent 对比,就**写多个实验文件**,各钉对照轴之外的一切(如同一 model),差异才干净归因到那一个轴。`model` 是单个字符串,不接受数组 —— 想扫多个模型,复制一份实验文件改 `model` 即可。

这样每个配置独立成文件:可命名(`<agent>-<model>[-<feature>]`)、可 diff、可单独 review。报告按当前 Sample 把这些配置并排展示。

### 例子

```typescript
// experiments/compare/bub-gpt-5.4.ts —— 对照组的一格:bub(tape on)
export default defineExperiment({
  description: "bub · gpt-5.4(tape on)",
  agent: bubAgent(),
  model: "gpt-5.4",        // 对照配置钉同一 model,差异归因到 agent / 记忆机制
  attempts: 5,                 // earlyExit 默认关,跑满 5 次给出完整通过率分布(pass^k)
  budget: 15,
});

// experiments/compare/codex-gpt-5.4.ts —— 对照的另一格(只换 agent)
export default defineExperiment({
  description: "codex · gpt-5.4",
  agent: codexAgent(),
  model: "gpt-5.4",
  attempts: 5,
  budget: 15,
});

// 想扫多个 agent/model 时,复制多个实验文件;不要在单文件里塞数组。
```

## 与 config 的关系

- **`niceeval.config.ts`(`defineConfig`)** = 项目级默认:`judge`、`reporters`、并发 / 超时、`pricing`、`sandbox`。`Config.sandbox` 必须是工厂函数产出的显式 `SandboxSpec`（可携带 `environments` 表）；experiment 的 `sandbox` 可以覆盖它。两处都没配置时，沙箱型 Agent 直接报错，不探测环境或选择内置 Provider 默认值。
- **`experiments/**/*.ts`(默认导出 `defineExperiment`)** = 一次具体运行的配置,覆盖 config 默认；路径形成 id，`evals` 形成落盘的 `selectedEvalIds`(`.experiment.ts` 后缀可选,位于 `experiments/` 下即识别)。

调度项覆盖优先级(高 → 低):**CLI flag → experiment → config → 内置默认**。这条链里没有环境变量:配置项的家是代码(experiment / config)与本次命令(flag),环境变量只承担凭据和终端环境事实([边界](../../architecture.md#配置从代码来凭据从环境来))。agent、model、flags 属于 experiment,不由 CLI 覆盖。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Architecture](architecture.md) —— 对照 agent-eval 砍了什么。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Sandbox](../sandbox/library.md#向运行反馈进度与诊断) —— provider 与环境 hook 的反馈示例。
- [Adapters](../adapters/library.md#向运行反馈进度与诊断) —— Agent setup/send/teardown 的反馈示例。
