# 分组 Sandbox 复用 —— Library

契约总纲见 [README](README.md)。
评估作者在 `evals/` 中声明哪些 Eval 可以共用一台 Sandbox。

## `defineSandboxGroup()`

```ts
import { defineSandboxGroup } from "niceeval";

export default defineSandboxGroup({
  evals: [
    "./01-capacity-policy",
    "./02-capacity-weekly",
    "./03-capacity-policy-update",
  ],
  onUnavailable: "stop-group",
});
```

公开形状只有显式成员与实例失效策略：

```ts
interface SandboxGroupInput {
  readonly evals: readonly [string, ...string[]];
  readonly onUnavailable: "stop-group" | "replace-sandbox";
}

declare const SANDBOX_GROUP_DEFINITION: unique symbol;

interface SandboxGroupDefinition extends SandboxGroupInput {
  readonly [SANDBOX_GROUP_DEFINITION]: true;
}

function defineSandboxGroup(input: SandboxGroupInput): SandboxGroupDefinition;
```

没有字段拥有隐式默认值。
`evals` 非空且只接受完整 Eval 引用；不接受前缀、glob、函数、tag 或 metadata 选择器。

以 `./` 开头的引用相对组模块所在目录解析；不以 `./` 开头的引用是从 `evals/` 起算的完整 Eval id。
相对引用不能包含 `..`，完整 id 不能包含 `.` 或 `..` 路径段。
两种写法都必须精确解析到一个既有 Eval；新增同目录 Eval 不会自动加入组。
`"./"` 可以精确引用组模块同目录的 `eval.ts` 入口。
数组顺序不参与调度；发现结果按 Eval id 排序成成员集合，重排声明不会改变定义身份。

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

组文件中的 `evals: ["./run-existing", "./repair-failing"]` 是完整边界；第三道题不会因共址而入组。

## 分组校验

发现期完成以下校验：

- 每个引用精确解析到一条 Eval；
- 同一组内不重复引用；
- 一条 Eval 不被两个组引用；
- 相对引用不越出组模块目录，完整 id 仍限制在本项目 `evals/` 根；
- 组定义不包含 template、Provider、prepare、Agent 或 Experiment 配置。

运行规划再校验每个已启用组中本次选中成员的物理复用身份一致。

## 选择与未分组 Eval

Experiment 与 CLI 继续使用普通 Eval id 选择题目，不增加“运行组”的第二套选题命令。
Experiment 另用完整组 id 启用已经定义好的复用边界：

```ts
export default defineExperiment({
  evals: ["toggl-cli-evolution/", "react-hook-form/"],
  sandboxReuse: {
    groups: ["toggl-cli-evolution"],
  },
  // agent、model、sandbox layer 等保持原样
});
```

公开形状不接受 `true`、成员数组或选择器：

```ts
interface SandboxReuseInput {
  readonly groups: readonly [string, ...string[]];
}

interface ExperimentConfig {
  readonly sandboxReuse?: SandboxReuseInput;
}
```

`groups` 每项都是完整 Sandbox group id，不接受前缀或 glob，也不自动启用同目录的其它组。
每个 id 必须精确命中定义，并至少覆盖本 Experiment 选中的一个 Eval；重复 id 是配置错误。
数组顺序不参与调度或身份；规划时按 group id 排序成启用集合。

Experiment 的 `evals` 仍是付费范围。
组里未被选中的成员不运行，也不会被组引用自动补入选择；选中且属于已启用组的成员才进入共享队列。

未被任何组引用的 Eval，以及属于未启用组的 Eval，都保持 fresh。
框架不建立隐式的“其它”组，也不因为多个 Eval 解析出相同 Layer 就共享实例。

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

Experiment 的 `attempts` 大于 1 时，已启用成员的每个真实 Attempt 都进入同一个组队列，不按 Attempt 序号隐式拆出多台 Sandbox。
需要互相隔离的重复轨迹时，应使用各自拥有实例与状态身份的 Experiment，而不是把复用组解释成隐藏的 lane 池。

组内 Sandbox 在两个 Attempt 之间空闲时不占并发位。
它仍占用 Provider 资源，直到该组完成、中止或 Invocation 收尾。
