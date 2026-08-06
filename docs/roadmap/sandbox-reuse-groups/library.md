# 分组 Sandbox 复用 —— Library

契约总纲见 [README](README.md)。
评估作者在 `evals/` 中声明哪些 Eval 必须共用一台 Sandbox。

## `defineSandboxGroup()`

```ts
import { defineSandboxGroup } from "niceeval";
import capacityPolicy from "./01-capacity-policy/eval.ts";
import capacityWeekly from "./02-capacity-weekly/eval.ts";
import capacityPolicyUpdate from "./03-capacity-policy-update/eval.ts";

export default defineSandboxGroup({
  evals: [
    capacityPolicy,
    capacityWeekly,
    capacityPolicyUpdate,
  ],
  onUnavailable: "stop-group",
});
```

`evals` 接受 `defineEval()` / `defineScoreEval()` 的原始产物，不接受字符串 id。
成员类型保留 Eval 的 Sandbox 所有权：

```ts
type EvalSandboxOwnership = "none" | "prepare-only" | "instance";

type AnyEvalDefinition<
  Ownership extends EvalSandboxOwnership = EvalSandboxOwnership,
> =
  | EvalDefinition<"pass", TestContext, Ownership>
  | EvalDefinition<"points", ScoreTestContext, Ownership>;

type SandboxGroupMember = AnyEvalDefinition<
  "none" | "prepare-only"
>;

interface SandboxGroupInput {
  readonly evals: readonly [SandboxGroupMember, ...SandboxGroupMember[]];
  readonly onUnavailable: "stop-group" | "replace-sandbox";
}

declare const SANDBOX_GROUP_DEFINITION: unique symbol;

interface SandboxGroupDefinition extends SandboxGroupInput {
  readonly [SANDBOX_GROUP_DEFINITION]: true;
}

function defineSandboxGroup(input: SandboxGroupInput): SandboxGroupDefinition;
```

没有字段拥有隐式默认值。
`evals` 非空，不接受字符串、前缀、glob、函数、tag 或 metadata 选择器。
导入语句同时让成员来源和目录关系对用户可见；数组顺序不参与调度，发现后按 Eval id 排序成成员集合。

## Eval Layer 的类型边界

Sandbox Layer 增加实例所有权 type-state：

```ts
type SandboxLayerScope = "attempt-only" | "instance-lifecycle";

interface SandboxLayer<
  Kind extends "command-only" | "template-bearing",
  Scope extends SandboxLayerScope,
> {
  prepare(command: SandboxCommand): SandboxLayer<Kind, Scope>;
  setup(hook: SandboxHook): SandboxLayer<Kind, "instance-lifecycle">;
  teardown(hook: SandboxHook): SandboxLayer<Kind, "instance-lifecycle">;
}
```

`defineEval()` 与 `defineScoreEval()` 用条件类型把作者输入保留到产物：

```ts
type OwnershipOf<Sandbox> =
  Sandbox extends undefined
    ? "none"
    : Sandbox extends SandboxLayer<"command-only", "attempt-only">
      ? "prepare-only"
      : "instance";

function defineEval<const Sandbox extends SandboxLayer | undefined>(
  input: EvalInput<Sandbox>,
): EvalDefinition<"pass", TestContext, OwnershipOf<Sandbox>>;
```

`defineScoreEval()` 使用同一份 `OwnershipOf`，只把 evaluation kind 与 test context 换成计分制。
因此跨文件 default import 不会把精确状态扩大成普通 `SandboxLayer`。

作者可见的结果是：

- 省略 `sandbox` → `"none"`，可以加入组；
- `sandboxLayer().prepare(...)` → `"prepare-only"`，可以加入组；
- template-bearing Layer → `"instance"`，不能加入组；
- command-only Layer 一旦调用 `setup()` 或 `teardown()` → `"instance"`，不能加入组。

因此错误直接落在组定义处：

```ts
import ownsTemplate from "./owns-template/eval.ts";

defineSandboxGroup({
  evals: [ownsTemplate],
  //     ^ TypeScript: template-bearing Eval cannot join a Sandbox reuse group
  onUnavailable: "stop-group",
});
```

不把整个 Eval Layer 禁掉，因为每题仍需要自己的 prepare。
边界只禁止成员拥有跨 Attempt 的物理实例或生命周期。

## 文件发现与身份

组入口与 Eval 入口采用相同的文件、目录对称形状：

```text
evals/toggl-cli-evolution.sandbox-group.ts
  -> Sandbox group id "toggl-cli-evolution"

evals/toggl-cli-evolution/sandbox-group.ts
  -> Sandbox group id "toggl-cli-evolution"

evals/memory/northstar.sandbox-group.ts
  -> Sandbox group id "memory/northstar"
```

同一 id 的两种入口不能并存。
组 id 只来自入口路径，不接受手写 `id` 或 `name`。
一个目录可以放多个具名 `*.sandbox-group.ts`，不要求为了定义多个组而移动 Eval。

`*.sandbox-group.ts` 与 `sandbox-group.ts` 是发现入口，不是普通共享模块。
组成员继续使用原来的 Eval id、Assertion、Attempt 与报告语义；加入组不会产生第二个评分身份。

例如 `evals/experiment/` 可以同时拥有三道 Eval 与一个具名组：

```text
evals/experiment/run-existing.eval.ts
evals/experiment/repair-failing.eval.ts
evals/experiment/migrate-0.9.eval.ts
evals/experiment/current-project.sandbox-group.ts
```

组文件显式导入 `runExisting` 与 `repairFailing`，再写 `evals: [runExisting, repairFailing]`。
第三道题不会因共址而入组。

## 分组校验

Runner 先发现所有 Eval，再导入 Sandbox Group 模块。
它用 definition 对象身份把成员映射回路径派生 Eval id；这样 Eval 顶层 loader capture 不会因组模块提前 import 而丢失。

TypeScript 先拒绝不合类型的成员；发现期再为 JavaScript、类型断言与手写逃逸完成以下运行时复核：

- 每个 definition 恰好对应一条已发现 Eval；
- 同一 definition 没有被多个 Eval id 复用；
- 同一组内不重复成员；
- 一条 Eval 不被两个组引用；
- 成员没有 template-bearing Layer；
- 成员的 command-only Layer 没有 `setup()` 或 `teardown()`；
- 组定义不包含 template、Provider、prepare、Agent 或 Experiment 配置。

运行规划要求配对 Experiment 使用 Sandbox Agent，并提供 template-bearing Layer。
同一 Experiment 的 template、Agent ensure identity 与 lifecycle owner 对组内成员天然相同；Runner 仍保留物理 plan identity 断言，防守自定义 Provider 的不透明规划。

## 选择与未分组 Eval

Experiment 与 CLI 继续只用普通 Eval id 选择题目，不增加“运行组”的第二套选择配置或命令。
选中的 Eval 若属于 Sandbox Group，就自动进入该组队列；Experiment 不能关闭、覆盖或重新分组。

Experiment 的 `evals` 仍是付费范围。
组里未被选中的成员不运行，也不会被组定义自动补入选择。

未被任何组引用的 Eval 保持 fresh。
框架不建立隐式的“其它”组，也不因为多个 Eval 解析出相同 Layer 就共享实例。

组定义没有“仅允许复用”的弱语义。
若某个 Experiment 必须让同一 Eval fresh，该 Eval 就不能属于强制复用组；框架不提供 Experiment 侧 opt-out 来掩盖这项冲突。

## 实例不可用策略

`onUnavailable` 是题组作者必须填写的决策：

| 值 | 行为 | 适用边界 |
|---|---|---|
| `stop-group` | 中止该组尚未派发的 Attempt，不创建替代实例 | 结果依赖同一物理实例中的连续状态 |
| `replace-sandbox` | 关闭旧实例，创建并准备新实例后继续该组 | 复用只用于节省准备成本，状态可丢失 |

两种策略都不静默重跑已经产生模型成本的 Attempt。
策略只处理 reset、寿命或实例健康无法继续的情况，不把普通领域 `failed` 改成基础设施故障。

## 顺序与结果携带

复用组只保证互斥使用同一活跃实例，不保证组内 Eval 的业务顺序。
需要完整有序历史时使用 `defineSequence()`；组定义不解析文件名前缀来猜步骤。

普通运行继续逐 Attempt 使用结果携带。
被携带结果不会在 Sandbox 中重放副作用，因此仅靠复用组不能建立跨历史 Run 的状态轨迹。

Sequence Invocation 每一步都真实派发，并禁止结果携带。
它与 `stop-group` 组合后，同时得到完整执行历史和同一物理实例。

## 与并发的关系

Experiment `maxConcurrency` 与 Invocation 全局并发共同形成总有效宽度。
每个活跃组同时最多运行一条 Attempt；不同组与 fresh Attempt 竞争总并发位。

Experiment 的 `attempts` 大于 1 时，组成员的每个真实 Attempt 都进入同一个组队列，不按 Attempt 序号隐式拆出多台 Sandbox。
需要互相隔离的重复轨迹时，应使用各自拥有实例与状态身份的 Experiment，而不是把复用组解释成隐藏的 lane 池。

组内 Sandbox 在两个 Attempt 之间空闲时不占并发位。
它仍占用 Provider 资源，直到该组完成、中止或 Invocation 收尾。
