# Experiments —— 库用法

本页定义 Experiment 作者怎样声明运行配置、把值交给 Eval 与 Agent，以及怎样上报运行中的事实。
Run、Attempt、Claim、RunContribution、EvidenceValue 与 receipt 的公开形状由 [Record Library](../record/library.md) 唯一定义。

## model / reasoningEffort 与 flags：Agent 留空，Experiment 决定

Agent 定义不写死模型、推理努力程度或实验参数。
Experiment 给出它们，Runner 再经 `ctx` 和 `t` 透传给实际执行者。

- `model` 是一个模型字符串。省略时 Agent 使用原生默认；跨模型比较应写成多个 Experiment 文件。
- `reasoningEffort` 是模型支持的单个努力程度。它与 `model` 同样由 `ctx.reasoningEffort` 与 `t.reasoningEffort` 读取。
- `flags` 是 JSON 参数袋。Agent 的 `send` 从 `ctx.flags` 读取，Eval 的 `test` 从 `t.flags` 读取。

```ts
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.6",
  reasoningEffort: "high",
  flags: { webResearch: true, skill: "memory-v2" },
  attempts: 3,
});
```

`flags` 的全部键和值进入运行配置身份。
会改变实际执行的开关必须放在这里，不能藏在 Agent 工厂闭包里，否则 carry 无法判断历史 Attempt 是否仍可采用。

## evals：遍历发现结果，自定义选择

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: (e) =>
    e.id.startsWith("coding/") &&
    e.tags.includes("coding") &&
    !e.tags.includes("gpu"),
});
```

谓词对已发现的 `EvalDescriptor` 求值。
`e.id` 是项目内逻辑 ID，不暴露绝对路径；简单前缀可写成 `evals: ["memory/"]`，全部运行可省略或写成 `"*"`。

选择结果是本次 Invocation 的计划输入。
它进入 Run Provenance 与 receipt 所指向的 GraphRef；Sample 不重新执行谓词，也不以路径或时间反推选择范围。

## labels：声明归类坐标，不进运行时

`labels` 只给 Report 与 Sample 后续读取提供归类坐标。
Agent 和 Eval 看不见它；改变 labels 不会改变运行配置身份，也不会让已有 Attempt 失去可采用资格。

```ts
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.6",
  labels: { line: "codex", memory: "mempal" },
});
```

求值后的 labels 随该 Run 的 Experiments-owned Provenance 保存。
它不是 `RunPayloadV1` 的附加字段，也不是 Report 可以自行补写的注释；读取方从固定 RecordGraphRef 的 Provenance 得到它。

历史 Run 的 labels 不会随源码改动漂移。
再次运行时，Runner 创建带当前 labels 的新 Run，并可用 carried Contribution 采用仍合格的旧 Attempt；因此改归类不要求再次执行。

`flags` 与 labels 的分界很简单：会改变 Attempt 实际行为的值用 `flags`，只解释比较维度的值用 labels。
运行后才得到的事实则使用 `fact()`。

## 运行时坐标不进配置：三个家

隧道 URL、临时实例地址和服务端实际版本在运行后才知道。
它们不能进入 `flags` 或 labels；前两者是作者预先声明的值，后者是 Observation。

```ts
export function writeEnv(): SandboxCommand {
  return async (sandbox, context) => {
    context.fact("nowledge.endpoint", env!.url);
    await sandbox.writeBytes(
      ".nowledge/env",
      new TextEncoder().encode(`NMEM_URL=${env!.url}\n`),
    );
  };
}
```

Attempt 范围的 `fact()` 成为该 Attempt stream 中的 Observation。
Experiment Hook 的 `ctx.fact()` 成为 Run 范围 Observation；两者都经 Record 的持久事件与强依赖规则保存。

carry、accept 与 rename 采用历史 Attempt 时，历史 Observation 仍由被采用的 Attempt 提供。
新 Run 不能用本次的 URL 覆写它，也不能复制一份 Observation 假装是重新执行的事实。

| 值的角色 | 作者何时决定 | API | 读取位置 |
|---|---|---|---|
| 会改变执行的条件 | 调用前 | `flags` | Run Provenance |
| 报告归类坐标 | 调用前 | `labels` | Run Provenance |
| 实际发生的事实 | 调用中或调用后 | `fact()` / Observation | Run 或 Attempt stream |

## 不同 Eval 自带预制起点

同一 Experiment 可以选择不同起点的 Eval。
每个实际 Eval × Experiment 配对恰好一方声明 template-bearing Sandbox factory；双方都有或都没有时在任何外部资源创建前报错。

```ts
export const py39Astropy = () =>
  e2bSandbox({ template: "niceeval-py39-astropy42" });

export default defineEval({
  sandbox: py39Astropy(),
  async test(t) {
    // 上传任务、驱动 Agent、执行隐藏检查。
  },
});
```

逐 Eval 的起点身份进入该 Eval 的 fingerprint。
它由 Run Provenance 说明，不由文件名、目录层级或 Sample 读取时的宿主条件推断。

## 实验级共享服务：setup 与 teardown

`setup` 和 `teardown` 管理每个 Experiment Run 一份的宿主资源，例如临时数据库、mock 服务或隧道。
它们不管理 Eval 的题目材料、Sandbox 物理实例或跨 Invocation 常驻服务。

```ts
let tunnel: { url: string; stop(): Promise<void> } | undefined;

export default defineExperiment({
  agent: nowledgeAgent(() => ({ url: tunnel!.url })),
  evals: ["memory/"],
  async setup(ctx) {
    tunnel = await nowledgeTunnel({ signal: ctx.signal });
    ctx.fact("nowledge.endpoint", tunnel.url);
  },
  async teardown() {
    await tunnel?.stop();
  },
});
```

`setup` 在第一个真正要派发的 Attempt 前执行。
所有成员都由历史 Contribution 采用时不会启动服务；一旦开始过 `setup`，即使失败也会按 lifecycle 规则尝试 `teardown`。

Hook 的运行时值停留在模块闭包中，后续 Agent factory 或 prepare command 按需读取它。
需要跨进程恢复的资源必须由外部编排或 Hook 自己的持久化坐标处理，不能把闭包当成 Record 事实。

多个 Experiment 默认各有独立的 Hook 闭包。
若它们共享外部 checkpoint，应另外声明 `sharedState.key`；若它们需要共享单例服务，应由外部编排提供，而不是用 Process 内计数器伪造跨 Invocation 生命周期。

## 生命周期代码怎样向这次运行反馈

Experiment Hook、Sandbox provider、prepare command、Eval 和 Agent 都取得同一类作用域反馈入口。
Runner 绑定其 phase 与 owner，调用方不能把一条反馈伪装成另一个生命周期阶段。

```ts
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
  }): void;

  fact(key: string, value: string | number | boolean): void;
}
```

| 入口 | Runner 绑定的 phase | 持久语义 |
|---|---|---|
| Experiment `setup` / `teardown` | `experiment.setup` / `experiment.teardown` | Run stream 的 Observation |
| provider `create()` | `sandbox.create` | Attempt stream 的 Observation |
| Eval 与 Experiment prepare command | `sandbox.prepare.*` | Attempt stream 的 Observation |
| `EvalDefinition.test` | `eval.run` | Attempt stream 的 Observation 与 Claim |
| Agent `setup` / `send` / `teardown` | 对应 `agent.*` | Attempt stream 的 Observation |

`progress()` 是有界的 Live 反馈，不进入 durable sequence。
`diagnostic()` 与 `fact()` 是 Observation，按同一 Observation Hub 交给 Record、Reducer、Live 与可选 OTel。

要让运行失败，应抛出 typed error。
要改变 Verdict，应形成 assertion、Judge 或 Verdict Claim；`diagnostic({ level: "error" })` 本身不改变 Verdict。

## 路径只表达身份与选择

```text
experiments/agents/codex/coding.ts   -> agents/codex/coding
experiments/agents/claude/coding.ts  -> agents/claude/coding
```

路径只形成 `experimentId`，并支持 `niceeval exp agents/codex` 的前缀选择。
它不决定 Record 的物理布局，不提供 locator，也不成为 Sample 的隐式 selection 条件。

一个文件固定一个 Agent × model × flags 配置。
需要比较多个模型或 Agent 时创建多个 Experiment 文件，让每个 Run 的 Provenance 都能说明一格明确的运行条件。

## 与 config 的关系

`niceeval.config.ts` 提供项目级默认值，例如 Judge、Reporter、并发和 timeout。
Experiment 以具体运行配置替换这些默认值；Eval 只在其声明过的字段上参与求值链。

配置求值的顺序由 [Architecture](architecture.md#配置求值链一次求值处处同源) 定义。
凭据变量与宿主条件不能秘密替换已保存的运行配置。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的完整公开配置。
- [Architecture](architecture.md) —— Run、Attempt、Contribution、Invocation 与共享状态边界。
- [CLI](cli.md) —— 选择、Live、receipt 与 accept 的终端反馈。
- [Record Library](../record/library.md) —— `fact()`、Observation、Claim、receipt 与读取句柄。
