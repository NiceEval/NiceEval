# Sandbox 复用运行级反馈

结果携带的 `carried` 词表、冻结 reuse plan、完整 prior locator 与 membership provenance 已由
[缓存与携带](../../feature/experiments/cache.md)拥有。本方向只补齐本次 Invocation 内物理 Sandbox 复用的运行级汇总，
不再定义或复制结果携带契约。

## 核心心智

`sandboxReuse` 是当前 Invocation 的进度值，不属于 frozen reuse plan。
每项汇总固定关联一个 Experiment 和一个物理复用范围：

```ts
type SandboxReuseGroup =
  | { readonly kind: "experiment" }
  | { readonly kind: "eval-group"; readonly evalGroupId: string };

interface SandboxReuseSummary {
  readonly experimentId: ExperimentId;
  readonly group: SandboxReuseGroup;
  readonly active: number;
  readonly created: number;
  readonly assignments: number;
  readonly replacements: number;
}
```

- `active` 是仍可承接 Attempt 的 Sandbox 数。
- `created` 只计已进入复用池并承接首条 Attempt 的实例。
- `assignments` 计已租借 Sandbox 的 Attempt，即使租借后的 prepare 失败或超时。
- `replacements` 计实例退出后，为下一未开始 Slot 成功建立的替代实例。

carried、过滤掉的 Slot 和 early-exit 未开始 Slot 不租借 Sandbox。
替代实例不会重新派发已经开始的 Attempt。

## 反馈面

本方向不新增命令。`niceeval exp` 的 live 面板按 Experiment 与 Eval Group 分别显示 `active`、`created` 和
`assignments`；`replacements` 只有非零才显示。结束反馈显示四项最终值，不把多个 group 合成一个总数。

JSON 事件在既有 progress 与 result 形状中增加：

```ts
interface SandboxReuseEvent extends ExperimentOutputFields {
  readonly type: "progress" | "result";
  readonly sandboxReuse: readonly SandboxReuseSummary[];
}
```

逐实例承接事实仍由 Attempt 的 Sandbox Attachment 拥有，`show` 与 `view` 负责展开。
汇总不改变 `carried`、Member relation、Attempt origin、Verdict 或结果携带资格。

## 验收

公开验收涉及 Experiment 复用、Eval Group 复用、实例 replacement、carried Slot 与 early-exit Slot。
同一切片同时核对 TTY live 面板、结束反馈和 JSON 事件；不新增 Eval Assertion。
