# Experiments —— 库用法

Experiment 声明运行配置、选择 Eval，并把值交给 Agent。Runner 把执行结果写入 [Record](../record/README.md)：
Core 表达身份、引用与 action。

运行事实只能进入 NiceEval Record catalog 中具名、owner 固定的 family。

本页定义 `defineExperiment` 作者 API。执行 Host 使用公开、受支持的 `niceeval/experiment/host` 与
`experimentHost.list()`、`plan()`、`run()`、`accept()` 组合 CLI 或深度应用集成。这个 Host entry 不开放
Runner、selector、Record family 或 migration registration；普通 Experiment 作者通常不导入它。运行后的固定
query 与 View 由 Inspection 和 Delivery 的 owner 组合，不从 Experiment Host 取得通用 selection API。

## Agent 留空，Experiment 决定变量

Agent 定义不写死模型、推理努力程度或实验参数。Experiment 给出它们，Runner 再经 `ctx` 和 `t` 透传给执行者。

```ts
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.6",
  reasoningEffort: "high",
  flags: { webResearch: true, skill: "memory-v2" },
  attempts: 3,
});
```

- `model` 与 `reasoningEffort` 省略时使用 Agent 原生默认；跨模型比较应建立多个 Experiment。
- `flags` 是 JSON 参数袋。会改变执行的开关必须在这里声明，不能藏在不可描述的闭包里。
- 已求值配置形成带 `{ domain, value }` 的不透明 identity。只有相同 domain 的值才可比较；identity 只是 reuse planning 的输入，不认证或锁定 Record。

`maxConcurrency`、同一 Experiment 的 dispatch claim（派发占用）与 execution deduplication（执行去重）由
Coordination（协调）处理。它们使用 `.niceeval/` 中 Record 外的本地状态；每个 Run writer 仍只追加自己的
`RunId` directory。

## 选择 Eval

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: (e) =>
    e.id.startsWith("coding/") &&
    e.tags.includes("coding") &&
    !e.tags.includes("gpu"),
});
```

谓词对已发现的 `EvalDescriptor` 求值。`e.id` 是项目内逻辑 ID；简单前缀可写成 `evals: ["memory/"]`，全部运行可以省略或写成 `"*"`。

一次实际选择只能包含一种 `evaluationKind`。同时命中 `defineEval()` 与 `defineScoreEval()` 时，`niceeval check`、
`niceeval exp --dry` 与普通运行在 Agent、Sandbox、fingerprint 和 Record 写入前拒绝，并分别列出 Pass/Score Eval ID。
两种题型需要复用同一 Agent 配置时仍写两个 Experiment 文件；CLI 前缀可以继续收窄一个本来更宽的选择，只要本次实际集合保持同型。

Invocation builder 先把求值结果形成 `ExecutionTarget` 的 expected slots。reuse planning 完成后，writer 才原样写入 Run；固定 Inspection 只读取这份已落盘分母，不重新执行谓词，也不从当前源码猜历史范围。

## labels 与运行时观测

`labels` 是报告归类坐标，不改变执行行为：

```ts
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.6",
  labels: { line: "codex", memory: "mempal" },
});
```

求值后的 labels、配置 manifest 和 identity 属于这次 Run 的不可变配置上下文。历史 Run 不随源码改变；再次运行会保存当前值。

隧道 URL、临时服务地址和实际服务版本在运行时才知道，因此不写进 `flags` 或 `labels`。Hook 可以通过闭包把它交给后续的 Agent factory 或 Sandbox command；这不授予 Hook 通用 Record writer。

运行时观测只有语义正好落入 NiceEval 已发布 typed collector 或 Adapter 能力时，才会进入九个固定 family 中对应的 Assertions、source receipt、File Changes、Sources 或 Artifacts。每个 collector 的 owner、payload 与 blob closure 都由 NiceEval 定义。第三方任意 JSON、URL 或版本值没有已发布 collector 时，不会自动持久化，也不能由 Record、query 或 View 读取；需要成为产品事实时，先进入 NiceEval 的领域设计与 persistence revision 治理。

| 值 | 何时决定 | 入口 | 结果 |
|---|---|---|---|
| 改变执行的条件 | 调用前 | `flags` | Run 的不可变配置上下文 |
| 报告归类坐标 | 调用前 | `labels` | Run 的不可变配置上下文；不透传给 Agent 或 Eval |
| 有已发布 collector 的运行时观测 | 调用中或调用后 | 对应 NiceEval typed collector 或 Adapter 能力 | Record catalog 中与 owner 匹配的 fixed family |
| 未发布 collector 的第三方运行时值 | 调用中或调用后 | 无通用持久化 API | 不自动持久化或查询 |

carry、accept 与 rename 引用历史 Attempt 时，不复制其事实。之后读取仍沿引用取得 origin Run 中已经封存的同一份 Attempt。

## 不同 Eval 自带预制起点

同一 Experiment 可以选择不同起点的 Eval。每个实际 Eval × Experiment 配对恰好一方声明带 template 的 Sandbox factory；双方都有或都没有时，在创建外部资源前报错。

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

逐 Eval 的起点进入 input identity 和可读 manifest，不由路径或读取时的宿主条件推断。

## setup 与 teardown

`setup` 和 `teardown` 管理每个 Run 一份的宿主资源，例如临时数据库、mock 服务或隧道。

```ts
let tunnel: { url: string; stop(): Promise<void> } | undefined;

export default defineExperiment({
  agent: nowledgeAgent(() => ({ url: tunnel!.url })),
  evals: ["memory/"],
  async setup(ctx) {
    tunnel = await nowledgeTunnel({ signal: ctx.signal });
    ctx.progress({ message: "tunnel ready" });
  },
  async teardown() {
    await tunnel?.stop();
  },
});
```

`setup` 在第一个真正需要执行的 Attempt 前运行；全部成员都由历史 Attempt carry 时不启动服务。一旦调用过 `setup`，即使它失败也必须尝试 `teardown`。

需要跨进程恢复的资源由外部编排或 Hook 自己的持久坐标管理，不能把模块闭包当成 Record 事实。共享外部可变状态使用 Coordination 的 `sharedState.key` 协调；它不把同一 Record root 的多个 Invocation 变成一条队列。

## 反馈入口

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
}
```

`progress()` 是有界临时反馈，不进入 Record。`diagnostic()` 是作用域绑定的结构化反馈，不改变 Verdict。两者都不是通用持久化 writer，也不能定义 Attachment、family、schema、blob 或 migration。

需要持久化的运行时事实只能调用 NiceEval 已发布的 typed collector 或 Adapter 能力；它们只写入 Record catalog 中与其 owner 匹配的 fixed family。没有匹配 collector 的第三方值保留在本进程或外部系统，不自动进入 Record。新增不可恢复事实须由 NiceEval 定义 payload、读面与版本迁移，而不是由 Experiment callback 扩展。

要让运行失败，应抛出 typed error。要改变 Verdict，应形成 assertion 或 Judge 结果；error diagnostic 本身不改变 Verdict。

## 路径表达身份、选择与实验组

```text
experiments/agents/codex/coding.ts   -> agents/codex/coding
experiments/agents/claude/coding.ts  -> agents/claude/coding
```

路径形成 `experimentId` 并支持前缀选择。第一段同时形成具名实验组；无目录段的根级 Experiment 形成单成员组。

```ts
type ExperimentGroupIdentity =
  | { readonly kind: "named"; readonly groupId: ExperimentGroupId }
  | { readonly kind: "singleton"; readonly experimentId: ExperimentId };
```

实验组不决定 Record 物理布局，也不改变 Inspection selection。它只能在已固定 selection 内形成单调收窄的实验比较范围。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的公开配置。
- [Architecture](architecture.md) —— Invocation、Run、Member 与共享状态。
- [CLI](cli.md) —— 选择、临时反馈、receipt 与 accept。
- [Record Library](../record/library.md) —— writer、reader、固定 Attachment 与 receipt。
