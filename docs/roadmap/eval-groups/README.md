# Eval Group

Eval Group 是一个性能原语：同组 Attempt 串行复用 Sandbox，不同 Group 并行。
它只改变本次真实派发的规划，不改变 Experiment 的结果沿用、重复执行或停止规则。

## 核心心智

`evals` 数组同时定义成员和唯一队列顺序。
Runner 先按既有 Experiment 规则为每个 Eval 展开 Attempt 槽位，再确定每个槽位是 run、carried、excluded 或 early-exit。
只有 run 槽位进入 Group 队列，并按成员数组位置和 attempt number 的顺序真实派发。

同一 Group 同时只派发一条 Attempt，并复用至多一台活跃 Sandbox。
不同 Group、未分组 Eval 与其它 Experiment 共同竞争 Invocation 和 Experiment 的并发位。
carried 槽位不进入本轮 Sandbox，也不执行 reset、prepare、Agent Ensure 或 Agent。

Eval Group 不表达任务依赖或执行历史。
结果 carry、`--rerun all`、`attempts` 与 `earlyExit` 全部使用既有 Experiment 规则。

## `defineEvalGroup()`

Eval Group 直接引用 `defineEval()` 或 `defineScoreEval()` 返回的 definition：

```ts
import { defineEvalGroup } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import entryStats from "./01-entry-stats/eval.ts";
import entryBill from "./02-entry-bill/eval.ts";

export default defineEvalGroup({
  evals: [entryStats, entryBill],
  sandbox: sandboxLayer().setup(installRustToolchain),
});
```

公开形状为：

```ts
type EvalGroupMember = AnyEvalDefinition;

interface EvalGroupInput<Sandbox extends SandboxLayer | undefined> {
  readonly evals: readonly [EvalGroupMember, ...EvalGroupMember[]];
  readonly sandbox?: Sandbox;
}

declare const EVAL_GROUP_DEFINITION: unique symbol;

interface EvalGroupDefinition extends EvalGroupInput<SandboxLayer | undefined> {
  readonly [EVAL_GROUP_DEFINITION]: true;
}

function defineEvalGroup<const Sandbox extends SandboxLayer | undefined>(
  input: EvalGroupInput<Sandbox>,
): EvalGroupDefinition;
```

`evals` 非空，只接受真实 definition 对象。
它不接受 string、ID、prefix、glob、tag 或 selector，也不从目录、文件名、Layer identity 或命令推导成员。
一条 Eval 最多属于一个 Eval Group，同一 Group 不能重复引用一条 Eval。

## 发现与身份

Eval Group 与其成员共址：

```text
evals/toggl-cli/eval-group.ts
  -> Eval Group ID "toggl-cli"

evals/memory/signalbox/eval-group.ts
  -> Eval Group ID "memory/signalbox"
```

只发现 `evals/**/eval-group.ts`，不支持 `*.eval-group.ts` 文件入口；根目录 `evals/eval-group.ts` 会因 Group ID 为空而在发现阶段报错。
Eval Group ID 只来自文件路径，不接受手写 `id` 或 `name`。
成员保留各自 Eval ID；Runner 按 definition 对象身份把成员映射回已发现的 Eval。

Group 文件是成员次序、组级 Sandbox Layer 与该 Eval 家族辅助代码的内聚入口。
它不按目录隐式收集成员；成员仍必须逐个 import 为真实 TypeScript definition，所以增加、删除或调整顺序都会形成可审查的 diff。

`definitionHash` 包含 Eval Group ID、完整有序 Eval ID 数组和 Group Layer identity。
当前 Group 的 ID 与摘要进入成员的正常 `Eval × Experiment` 指纹输入。
它不包含 Attempt 前缀或物理执行历史。

## Sandbox Layer 边界

一次规划由 `Eval Group × Eval × Experiment` 三方组成，并共用一份 Sandbox owner stack。
三方中恰好一方提供 template-bearing Layer，其余已声明 Layer 必须是 command-only。

这三个 owner 表达的是正交贡献，不要求 Group 独占完整镜像：

- Experiment 通常提供随 Agent 条件变化的 template，例如 Codex、Claude Code 或 Bub；
- Eval Group 用 `setup()` 提供组内物理 Sandbox 只需执行一次的工具链，用 `prepare()` 提供每条 Attempt 都要恢复的组级 fixture；
- Eval 用 `prepare()` 补充题目专属的 checkout、项目依赖与公开 starter。

因此不另设 fixture API。共享事实直接写在 Group 的 Sandbox Layer；必须防止前题污染后题的事实保留在 Eval prepare。
即使 template 来自 Experiment，物理 Sandbox 仍由 `(Experiment, Eval Group)` 队列持有和复用，Group 不是 template ownership 的别名。
隐藏判据与其它私有材料仍在 Agent 回合结束后由 `test(t)` 传入，绝不属于 Agent 之前执行的 prepare。

owner order 只有两种：

- Experiment 提供 template：`Experiment → Eval Group → Eval`；
- Eval Group 提供 template：`Eval Group → Experiment → Eval`。

setup 与 prepare 按 owner order 执行，每个 owner 内保持声明顺序。
teardown 与逐 Attempt command cleanup 分别按实际登记顺序全局 LIFO，同一个 Layer 不执行两次。

成员资格由发现阶段按真实 Sandbox Layer 复核：

- Eval 省略 `sandbox` 时可以加入 Group；
- Eval 只有 `prepare()` 时可以加入 Group；
- Eval 拥有 template 或调用 `setup()` / `teardown()` 时不能加入 Group；
- Eval Group 与 Experiment 的 `sandbox` 可以拥有任意 Layer kind 和 lifecycle scope。

发现阶段复核 JavaScript、类型断言与自定义 Provider。
Runner 对每个三方 link 检查 template 数量，并要求同一 Group × Experiment 的全部成员具有相同物理计划、Agent Ensure 和 lifecycle stack identity。
Direct Agent 与 `localSandbox()` 不能运行 Eval Group。

## 调度与实例替换

每个 `(invocationId, experimentId, evalGroupId)` 拥有独立队列和至多一台活跃 Sandbox。
`maxConcurrency: 4` 最多同时推进四个 Group 或未分组 fresh Attempt，但一个 Group 仍只占一个并发位。
调度波次保证其它 Group 与未分组 Attempt 有机会推进。

未分组 Eval 保持普通语义，真实派发时使用全新 Sandbox。
Experiment 的有效选择若命中 Group，`sandboxReuse: true` 会在 Provider I/O 前触发 `eval-group-sandbox-reuse-conflict`。

Sandbox 不可继续时，Runner 关闭旧实例，并为下一条尚未开始的槽位创建替代实例。
槽位打开前的寿命确认或题间 reset 失败，可以先替换实例再派发该槽位。
槽位一旦开始，任何阶段失败都封口该 Attempt；替代实例只服务下一槽位，绝不自动重跑已开始的 Attempt。

## 生命周期

一个含 run 槽位的 Group 按以下顺序运行：

```text
sharedState lease -> Group lock -> carry replan
  -> create / ready
  -> Experiment and Eval Group Layer setup in owner order
  -> establish reset point
  -> each run slot:
       lifetime check -> reset
       -> prepare in owner order -> agent.ensure
       -> Agent -> test -> Agent teardown -> command cleanup
  -> final reset for a normal instance
  -> Layer teardown in reverse order
  -> Provider finalizer
```

每条 Attempt 保持独立的 Assertion、Verdict、usage、diff、事件与 locator。
每条真实 Attempt 都重新执行三方 prepare 与 Agent Ensure。
替代 Sandbox 重新执行完整 Layer setup，并建立自己的题间重置点。

Layer context 提供只读 `evalGroup.id` 与 `evalGroup.definitionHash`。
这些字段在 Group lifecycle 与 grouped Attempt 中必定存在，在兼容 grouped 和 ungrouped 工作的公共 context 中为显式可选字段。

Invocation 中断时停止派发新 Attempt，并对在飞 Attempt 做有界收尾。
中断期间不创建替代实例，也不给未派发槽位伪造 Attempt。
实例退出调度 owner 后，按 [Sandbox 默认停驻与回收](../sandbox-retention/README.md)求值 release policy。

## Group lock 与外部状态身份

分组 Eval 使用 `(experimentId, evalGroupId)` 用例锁，未分组 Eval 使用 `(experimentId, evalId)`。
Group lock 在创建 Sandbox 前取得，并持有到本组全部 Layer teardown 与 Provider finalizer 完成。
取锁后逐槽位重做结果沿用；全部 carried 时释放锁，不创建 Sandbox。

取得顺序是 shared-state lease、Group lock、carry replan，释放顺序相反。
Experiment 级租约包住各 Group lock；`scope: "eval-group"` 的每把租约只包住对应 Group lock。

Eval Group 只隔离 Sandbox，不分割 checkpoint、namespace、共享数据库或其它外部状态。
Sandbox lifecycle、Agent runtime 与 prepare context 都能读取 `evalGroup.id`，作者用它派生外部状态身份。

```ts
sharedState: {
  key: `mempal/codex/${cohort}`,
  scope: "eval-group",
}
```

`scope: "eval-group"` 分别租用 `baseKey/evalGroupId`，只让相同 Group 互斥。
该 scope 不接受未分组 Eval 或 Experiment host `setup` / `teardown`。

## Dry plan 与 Record

`--dry` 按 Group 展示 run、carried、excluded、early-exit 槽位数、Sandbox 行为与并行上限。
dry、live 与结束反馈都统计 Attempt 槽位，不统计 Eval 成员数。

```ts
type EvalGroupAttemptSlot =
  | { readonly attempt: number; readonly action: "run" }
  | {
      readonly attempt: number;
      readonly action: "carried";
      readonly producerLocator: AttemptLocator;
    }
  | { readonly attempt: number; readonly action: "early-exit-unstarted" };

type EvalGroupPlanStep =
  | {
      readonly index: number;
      readonly evalId: string;
      readonly action: "excluded";
    }
  | {
      readonly index: number;
      readonly evalId: string;
      readonly attempts: readonly EvalGroupAttemptSlot[];
    };

interface EvalGroupPlan {
  readonly id: string;
  readonly definitionHash: string;
  readonly steps: readonly EvalGroupPlanStep[];
}
```

Run 保存本次命中的 Group 及有序成员。
每条 grouped Attempt 保存 Group 归属、声明位置、Sandbox 编号与实例承接序号。
carried 槽位通过 `producerLocator` 指向生产它的 Attempt，不表示该 Attempt 进入了本轮 Sandbox。

```ts
interface EvalGroupRunInfo {
  readonly id: string;
  readonly definitionHash: string;
  readonly evalIds: readonly string[];
  readonly selectedEvalIds: readonly string[];
  readonly steps: readonly EvalGroupPlanStep[];
}

interface AttemptEvalGroupInfo {
  readonly id: string;
  readonly definitionHash: string;
  readonly index: number;
  readonly sandboxNumber: number;
  readonly assignmentNumber: number;
}
```

## 失败反馈

以下错误在派发任何 Attempt 前报告，并列出 Eval Group ID、相关 Eval 与修正方向：

| code | 条件 |
|---|---|
| `eval-group-member-unresolved` | definition 没有恰好对应一条已发现 Eval |
| `eval-group-member-overlap` | 一条 Eval 重复出现或属于多个 Eval Group |
| `eval-group-member-layer` | Eval 成员拥有 template 或实例 lifecycle Hook |
| `eval-group-direct-agent` | Experiment 使用 Direct Agent |
| `eval-group-incompatible` | 成员的最终物理复用 identity 不一致 |
| `eval-group-sandbox-reuse-conflict` | 有效选择命中 Group，同时 Experiment 声明 `sandboxReuse` |
| `eval-group-shared-state-scope` | `scope: "eval-group"` 与未分组 Eval 或 Experiment host Hook 组合 |

实例替换不是 diagnostic，但会进入运行事实与结束反馈。

## MemoryBench

MemoryBench 按兼容的 Sandbox 状态划分 Group。
toggl-cli、signalbox、react-hook-form、react-datepicker、react-tooltip、downshift 与 yet-another-react-lightbox 都使用同一种 Group。
toggl-cli 与 signalbox 不具有特殊执行模式；它们与其它 Group 一样受结果沿用和 Experiment 选择约束。

Yarn Berry 与 Yarn Classic 分属不同 Group。
Downshift 与 Lightbox 也分属不同 Group，因为后者会切换全局 Node 版本。
Mempal checkpoint 与 Nowledge namespace 按 `ctx.evalGroup.id` 隔离。

## 范围

首个实现切片包含：

- `defineEvalGroup()`、文件发现、成员 type-state 与重叠检查；
- 每个 Group 单 Sandbox 串行、不同 Group 并行；
- Eval Group、Eval 与 Experiment 的三方 Layer link；
- 复用现有 pool 的题间 reset 与实例替换；
- Sandbox lifecycle、prepare 与 Agent context 的只读 Group 身份；
- dry 每行的 Group ID 与成员位置，以及成员 fingerprint 中的 Group 身份。

首个实现切片不扩展以下能力：

- Record schema、Group lock 与 shared state scope；
- live 与结束反馈；
- selector、任务依赖与额外 CLI 范围控制。

这些是后续契约，不应从当前代码推断为已经可用；当前 Record 仍只保存既有 Attempt 事实。
结果沿用与 Sandbox 复用的用词和运行级计数见[结果沿用与 Sandbox 复用反馈](../reuse-feedback/README.md)。
