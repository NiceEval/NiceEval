# Experiments —— 库用法

Experiment 声明运行配置、选择 Eval，并把值交给 Agent。Runner 把执行结果写入 [Record](../record/README.md)：Run 与 Attempt 的永久核心只表达身份和引用，配置、标签、运行事实与诊断进入具名通道。

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
- 已求值配置形成带 `{ domain, value }` 的不透明 identity。只有相同 domain 的值才可比较；identity 只是 execution projector 的输入，不认证或锁定 Record。

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

Invocation builder 先把求值结果形成 `ExecutionTarget` 的 expected slots。execution projector 完成后，writer 才原样写入 Run；`AnalysisSample` 以后只读取这份已落盘分母，不重新执行谓词，也不从当前源码猜历史范围。

## labels 与运行时事实

`labels` 是报告归类坐标，不改变执行行为：

```ts
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.6",
  labels: { line: "codex", memory: "mempal" },
});
```

求值后的 labels、配置 manifest 和 identity 写入 Run 的配置通道。历史 Run 不随源码改变；再次运行会保存当前值。

隧道 URL、临时服务地址和实际服务版本在运行时才知道，应使用 `fact()`：

```ts
export function writeEnv(): SandboxCommand {
  return async (sandbox, context) => {
    context.fact("com.example.nowledge.endpoint", env!.url);
    await sandbox.writeBytes(
      ".nowledge/env",
      new TextEncoder().encode(`NMEM_URL=${env!.url}\n`),
    );
  };
}
```

`fact()` 在当前 context 的 owner 上写一个以反向域名命名的自定义 JSON document。Run hook 写 Run-owned fact，Attempt context 写 Attempt-owned fact；同一 owner/name 第二次写入是 typed error，不替换旧值或追加。Record 为它补充 `observedAt`，精确 transport 由 [Record Architecture](../record/architecture.md#通道语义与兼容性) 单点定义。

Report 通过 `defineJsonFact()` 提供局部纯 parser。parser 只收到已经验证的 document，不接收 bytes、路径或 blob。generic `fact()` 不支持 JSONL、追加或大 blob；大内容使用具名内建/专用 Attempt channel。

| 值 | 何时决定 | API | 保存位置 |
|---|---|---|---|
| 改变执行的条件 | 调用前 | `flags` | Run 配置通道 |
| 报告归类坐标 | 调用前 | `labels` | Run 配置通道 |
| 实际发生的事实 | 调用中或调用后 | `fact()` | Run 或 Attempt facts 通道 |

carry、accept 与 rename 引用历史 Attempt 时，不复制其事实。之后读取会看到源 Attempt 的当前值。

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
    ctx.fact("com.example.nowledge.endpoint", tunnel.url);
  },
  async teardown() {
    await tunnel?.stop();
  },
});
```

`setup` 在第一个真正需要执行的 Attempt 前运行；全部成员都由历史 Attempt carry 时不启动服务。一旦调用过 `setup`，即使它失败也必须尝试 `teardown`。

需要跨进程恢复的资源由外部编排或 Hook 自己的持久坐标管理，不能把模块闭包当成 Record 事实。共享外部可变状态使用 `sharedState.key` 协调。

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

  fact(name: string, value: JsonValue): void;
}
```

`progress()` 是有界临时反馈，不进入 Record。`diagnostic()` 进入 owner-local 事件通道；`fact()` 写一个 owner-local 自定义 JSON document。两者的 descriptor 都说明采集 coverage。

<code>fact()</code> 补齐 <code>observedAt</code> 后按 Record 契约计量完整 document。超过 65,536 UTF-8 bytes 时同步抛出 code 为 <code>record-custom-fact-too-large</code> 的 typed error，不写入部分文件。调用方应删减 JSON；大文本或二进制内容必须改用具名专用 Attempt channel 与 blob。

要让运行失败，应抛出 typed error。要改变 Verdict，应形成 assertion 或 Judge 结果；error diagnostic 本身不改变 Verdict。

## 路径只表达身份与选择

```text
experiments/agents/codex/coding.ts   -> agents/codex/coding
experiments/agents/claude/coding.ts  -> agents/claude/coding
```

路径形成 `experimentId` 并支持前缀选择。它不决定 Record 物理布局，也不成为 Sample 的隐含 selection。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的公开配置。
- [Architecture](architecture.md) —— Invocation、Run、Member 与共享状态。
- [CLI](cli.md) —— 选择、临时反馈、receipt 与 accept。
- [Record Library](../record/library.md) —— writer、reader、通道与 receipt。
