# State —— 库用法

## 公开 API

`defineExperimentState()` 是唯一构造入口。
作者传入可书写的 `ExperimentStateInput`,得到带私有品牌的 `ExperimentStateDefinition`;`defineExperiment()` 的 `state` 字段只接受后者。

```typescript
import type { JsonValue } from "niceeval";
import type { SandboxCommandTarget } from "niceeval/sandbox";

export interface StateCheckpoint {
  readonly identity: JsonValue;
  readonly digest:
    | { readonly _tag: "Unavailable" }
    | { readonly _tag: "Sha256"; readonly value: string };
  readonly facts: Readonly<Record<string, JsonValue>>;
}

export interface ExperimentStateContext {
  readonly phase: "load" | "save";
  readonly experimentId: string;
  readonly windowId: string;
  readonly sandbox: SandboxCommandTarget;
  readonly signal: AbortSignal;
  progress(input: { readonly message: string }): void;
  diagnostic(input: {
    readonly code: string;
    readonly message: string;
  }): void;
  fact(key: string, value: string | number | boolean): void;
}

export type StateConsistency =
  | { readonly mode: "pinned"; readonly revision: string }
  | { readonly mode: "rolling" };

export type StateSavePolicy = "after-load" | "attempt-succeeded";

export interface ExperimentStateInput {
  readonly identity: JsonValue;
  readonly consistency: StateConsistency;
  readonly saveOn: StateSavePolicy;
  load(ctx: ExperimentStateContext): Promise<StateCheckpoint>;
  save(ctx: ExperimentStateContext): Promise<StateCheckpoint>;
}

export interface ExperimentStateDefinition {
  readonly identity: JsonValue;
  readonly consistency: StateConsistency;
  readonly saveOn: StateSavePolicy;
  readonly load: ExperimentStateInput["load"];
  readonly save: ExperimentStateInput["save"];
  // 另含作者不可构造、不可读取的私有品牌。
}

export function defineExperimentState(
  input: ExperimentStateInput,
): ExperimentStateDefinition;
```

`ExperimentStateDefinition` 是定义期事实,不是运行时可变对象。
工厂复制并深冻结 JSON identity、冻结定义字段,再挂上不导出的品牌。
原始对象、类型断言或把别的工厂产物作为 `state` 字段传入,都不能冒充合法定义。
`load` / `save` 是声明的一部分,但 Runner 不允许作者替换 phase、deadline、Sandbox 或反馈归属。

`identity` 必须是 JSON 值,并至少写出 `store`、`cohort` 与 `schema` 三项语义身份。
callback 函数体不会自动进入身份;修改 transfer 格式、路径集合或 checkpoint schema 时必须同步改变 `identity`。

## Checkpoint 与上下文

`load()` 返回**实际载入**的 checkpoint,`save()` 返回**成功提交**的新 checkpoint。
两者的 `identity` 都是外部 store 给出的事实,不能用声明的 identity 原样填充来假装核对成功。
`digest` 是完整 ADT:有稳定内容摘要时返回 `{ _tag: "Sha256", value }`,store 无法提供时返回 `{ _tag: "Unavailable" }`。
它不能省略、写 `null`、空字符串、时间戳或随机值。
`facts` 只保存中性 JSON 事实,例如载入来源、checkpoint 字节数与 store revision。

上下文只暴露当前 Sandbox 的命令与 IO 能力。
它没有 `stop()`、Provider SDK、下一条 Attempt、调度器或复用池句柄。
相对路径仍按 Sandbox workdir 解析;宿主 checkpoint 文件由 callback 自己通过普通 Node API 读取,再用 `createCheckpoint()` / `restoreCheckpoint()` 等 Sandbox helper 传输。

`signal` 只覆盖当前 transfer。
`load` 使用 Attempt 的前向 deadline;`save` 使用 Runner 新建的有界收尾 signal,不会复用已经超时或取消的前向 signal。

## 外部 checkpoint 的边界

State 适用于下一条 Attempt 需要从外部 store 读取前一条语义结果的场景。例如中心服务中的用户档案可以声明 rolling checkpoint：

```typescript
import { defineExperimentState } from "niceeval";

export function profileState() {
  return defineExperimentState({
    identity: {
      store: "customer-profile-snapshots",
      cohort: process.env.COHORT?.trim() || "local",
      schema: 1,
    },
    consistency: { mode: "rolling" },
    saveOn: "after-load",
    async load(ctx) {
      return restoreProfileSnapshot(ctx.sandbox, ctx.experimentId);
    },
    async save(ctx) {
      return saveProfileSnapshot(ctx.sandbox, ctx.experimentId);
    },
  });
}
```

`restoreProfileSnapshot()` / `saveProfileSnapshot()` 必须返回前述 checkpoint ADT；宿主写入必须原子提交，例如同目录临时文件写完后 rename。`save()` 返回前外部 store 已经是可读取的新 head；只排队上传就返回不算成功。

如果要保存的只是一个实际 Sandbox 的 `$HOME`、守护进程数据或缓存，其自然边界是 Sandbox 创建到退休，而不是下一条 Attempt 的外部语义序列。此时把初始化或 restore 放入 Experiment `SandboxLayer.setup()`，把 snapshot 或收尾放入 `teardown()`；需要唯一连续实例时以 `maxConcurrency: 1` 限制该 Experiment。MemoryBench 的 mempal 目录属于这一类，不应声明为顶层 `state`。

## `saveOn`

`saveOn` 只决定 load 成功以后是否提交当前状态:

| 值 | Fresh | Reuse |
|---|---|---|
| `after-load` | load 成功后,无论 verdict 是 passed、failed 或 errored,都在 Agent teardown 后尝试 save | 必选;窗口关闭或退休时 save 一次 |
| `attempt-succeeded` | 只有 verdict 为 passed 且 Agent teardown 成功才 save | 非法 |

`after-load` 不是「永远能保存」。
Sandbox 已丢失、Provider 不可达或进程被强杀时,Runner 把 save 记成 unavailable / 未完成,不能伪造 checkpoint。
`attempt-succeeded` 主动跳过 save 时不产生后继;rolling 的下一条 fresh Attempt 仍从本次 load 的 predecessor 开始。

State save 早于作者 command cleanup。
cleanup 失败只追加诊断,不能倒流撤销已经原子提交的 checkpoint。

## 约束错误

约束在 discovery / 规划期聚合,发生在 Provider build、create 或 State I/O 之前:

| code | 非法组合 | 修正 |
|---|---|---|
| `state.invalid-definition` | `state` 不是 `defineExperimentState()` 产物 | 用工厂构造定义 |
| `state.identity-not-json` | identity 含函数、类实例、symbol 或循环引用 | 改成稳定 JSON 身份 |
| `state.pinned-revision-missing` | pinned revision 为空 | 填入外部 store 可核对的稳定 revision |
| `state.requires-sandbox-agent` | Direct Agent 声明了 State | 改用 Sandbox Agent,或移除 State |
| `state.rolling-requires-serial` | rolling Experiment 没有 `maxConcurrency: 1` | 显式设为 1 或拆分 cohort |
| `state.reuse-requires-serial` | State 与 `sandboxReuse: true` 同用但没有 `maxConcurrency: 1` | 显式设为 1,或关闭 State / Sandbox 复用 |
| `state.reuse-requires-after-load` | `sandboxReuse: true` 搭配 `attempt-succeeded` | 改成 `after-load`,或关闭复用 |

运行时 pinned load 返回的 checkpoint 与声明 revision 不一致时报 `state.pinned-revision-mismatch`。
错误同时列出声明 revision 与实际 checkpoint identity;不会继续执行 Agent,也不会调用 save。
