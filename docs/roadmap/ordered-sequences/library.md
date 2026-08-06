# 有序 Eval 序列 —— Library

## `defineSequence()`

```ts
import { defineSequence } from "niceeval";

export default defineSequence({
  evals: [
    "toggl-cli-evolution/capacity-policy",
    "toggl-cli-evolution/capacity-weekly",
    "toggl-cli-evolution/capacity-policy-update",
    "toggl-cli-evolution/capacity-monthly",
  ],
});
```

公开形状只有有序成员：

```ts
interface SequenceInput {
  readonly evals: readonly [string, ...string[]];
}

declare const SEQUENCE_DEFINITION: unique symbol;

interface SequenceDefinition {
  readonly evals: readonly [string, ...string[]];
  readonly [SEQUENCE_DEFINITION]: true;
}

function defineSequence(input: SequenceInput): SequenceDefinition;
```

`evals` 非空，每一项都是完整 Eval ID，同一 ID 在一条 Sequence 中只能出现一次。
成员顺序就是执行顺序；没有 `role`、依赖对象、回调、metadata 或手写 `id`。
`SEQUENCE_DEFINITION` 是模块私有品牌，作者不能导入或手写；Sequence 必须由 `defineSequence()` 创建。

## 文件发现与身份

Sequence 使用独立目录与文件后缀：

```text
sequences/toggl-cli-capacity-policy.sequence.ts
  → Sequence ID "toggl-cli-capacity-policy"

sequences/memory/toggl-cli-capacity-policy/sequence.ts
  → Sequence ID "memory/toggl-cli-capacity-policy"
```

同一 ID 的文件入口与目录入口不能并存。
共享代码放在不匹配 `*.sequence.ts`、且文件名不是 `sequence.ts` 的普通模块中。

Sequence ID 只来自文件路径。
Sequence 成员继续引用 Eval 文件路径派生的 ID；移动 Sequence 文件不修改任何 Eval 身份，移动 Eval 文件则必须同步更新引用。

## 与 Experiment 的关系

Sequence 不包含 Agent、model、Sandbox、timeout、flags 或 lifecycle Hook。
这些执行条件仍由 CLI 选中的一个 Experiment 提供。

Experiment 的 `evals` 选择必须覆盖 Sequence 的全部成员。
发现后若有成员不在该 Experiment 的选择结果中，规划失败并列出缺失 Eval；Sequence 不越过 Experiment 的边界自动扩题。

Sequence Invocation 要求解析后的 `attempts` 为 1。
多次重复需要彼此隔离的状态起点，不能在没有状态实例模型时把 `attempts: N` 解释成 N 条独立 Sequence。

`sandboxReuse` 不由 Sequence 强制设置。
连续物理 Sandbox、外部服务或无状态基线都可以承载同一条 Sequence；具体状态位置仍归 Experiment 和 Sandbox lifecycle。
