# Eval Group

Eval Group 是一组按声明顺序执行，并在同一时刻只使用一台活跃 Sandbox 的 Eval。
不同 Eval Group 拥有不同 Sandbox，可以在同一个 Experiment Run 中并行推进。

## 解决的问题

`sandboxReuse: true` 把整个 Experiment 放进一个隐式复用池。
MemoryBench 因此必须在“所有 Eval 串行”和“所有 Eval 各用新 Sandbox”之间二选一。
作者无法表达 toggl-cli、Yarn Berry、Yarn Classic、pnpm 与 npm 题组各用一台 Sandbox，同时让这些题组并行。

有序历史与分组复用也不应要求两份成员声明。
Eval Group 同时定义成员维度、组内顺序、Sandbox Layer 与结果沿用策略。
Runner 的规划实体从 `Eval × Experiment` 扩展为 `Eval Group × Eval × Experiment`。

## 核心心智

**每个 Eval Group 的真实派发成员形成一条 Sequence。**
同组成员轮流领取一台活跃 Sandbox，天然形成串行执行顺序。
两类场景的区别不在调度结构，而在本次要真实派发哪些成员：

| `replay` | 本次动作 | 适用场景 |
|---|---|---|
| `"all"` | 从第一步开始真实派发完整成员或显式前缀 | 纵向记忆、迁移演练、必须经历完整历史的评测 |
| `"pending"` | 先做普通结果沿用，只真实派发没有合格历史结果的成员 | 包管理器缓存、工具链缓存与其它性能复用 |

两种策略都按 `evals` 数组顺序派发真实 Attempt，也都在成员之间 reset workdir，并重做每 Attempt 的 prepare 与 Agent Ensure。
`"pending"` 中被结果沿用的成员不进入本轮 Sandbox，因此它不能证明本轮经历了完整前缀。

## `defineEvalGroup()`

Eval Group 直接引用 `defineEval()` 或 `defineScoreEval()` 返回的 definition：

```ts
// eval-groups/toggl-cli.eval-group.ts
import { defineEvalGroup } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import entryStats from "../evals/toggl-cli/01-entry-stats/eval.ts";
import entryBill from "../evals/toggl-cli/02-entry-bill/eval.ts";
import entryBillWeekly from "../evals/toggl-cli/03-entry-bill-weekly/eval.ts";

export default defineEvalGroup({
  evals: [entryStats, entryBill, entryBillWeekly],
  replay: "all",
  sandbox: sandboxLayer().prepare(installRustToolchain),
});
```

性能复用使用同一个 API：

```ts
// eval-groups/react-datepicker.eval-group.ts
import { defineEvalGroup } from "niceeval";
import pr6058 from "../evals/react-datepicker/pr-6058/eval.ts";
import pr6073 from "../evals/react-datepicker/pr-6073/eval.ts";
import pr6092 from "../evals/react-datepicker/pr-6092/eval.ts";

export default defineEvalGroup({
  evals: [pr6058, pr6073, pr6092],
  replay: "pending",
});
```

公开形状为：

```ts
type EvalSandboxOwnership = "none" | "prepare-only" | "instance";
type SandboxLayerScope = "attempt-only" | "instance-lifecycle";
declare const SANDBOX_LAYER_KIND: unique symbol;
declare const SANDBOX_LAYER_SCOPE: unique symbol;

interface SandboxLayer<
  Kind extends SandboxLayerKind = SandboxLayerKind,
  Scope extends SandboxLayerScope = SandboxLayerScope,
> {
  readonly [SANDBOX_LAYER_KIND]: Kind;
  readonly [SANDBOX_LAYER_SCOPE]: Scope;
  prepare(command: SandboxCommand): SandboxLayer<Kind, Scope>;
  setup(hook: SandboxHook): SandboxLayer<Kind, "instance-lifecycle">;
  teardown(hook: SandboxHook): SandboxLayer<Kind, "instance-lifecycle">;
}

type OwnershipOf<Sandbox> =
  Sandbox extends undefined
    ? "none"
    : Sandbox extends SandboxLayer<"command-only", "attempt-only">
      ? "prepare-only"
      : "instance";

type EvalGroupMember = AnyEvalDefinition<"none" | "prepare-only">;

interface EvalGroupInput<Sandbox extends SandboxLayer | undefined> {
  readonly evals: readonly [EvalGroupMember, ...EvalGroupMember[]];
  readonly replay: "all" | "pending";
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

`defineEval()` 与 `defineScoreEval()` 在返回的 definition 私有标记中保留 `OwnershipOf<Sandbox>`，
`AnyEvalDefinition<Ownership>` 也按这项所有权参数化。
template-bearing Layer，以及调用过 `setup()` 或 `teardown()` 的 command-only Layer，都会得到 `"instance"`。
因此它们不能通过扩大公开 `sandbox` 字段的类型来伪装成合法成员。

`replay` 没有默认值。
作者必须明确选择完整真实派发还是普通结果沿用，因为这项选择同时影响模型成本、Sandbox 副作用与 lineage 强度。

`evals` 非空，不接受字符串、前缀、glob、tag、metadata 选择器或手写 ID。
一条 Eval 最多属于一个 Eval Group，同一 Eval Group 也不能重复引用一条 Eval。
Runner 不从目录、文件名前缀、Layer identity 或包管理器命令自动推导成员。

## 发现与身份

Eval Group 使用独立入口：

```text
eval-groups/toggl-cli.eval-group.ts
  -> Eval Group ID "toggl-cli"

eval-groups/memory/signalbox/eval-group.ts
  -> Eval Group ID "memory/signalbox"
```

同一 ID 的文件入口与目录入口不能并存。
共享 TypeScript 代码放在不匹配 `*.eval-group.ts`、且文件名不是 `eval-group.ts` 的普通模块中。

Eval Group ID 只来自文件路径，不接受手写 `id` 或 `name`。
成员继续使用各自 Eval 文件路径派生的 ID；加入 Eval Group 不创建第二个评分身份。
Runner 先发现 Eval，再导入 Eval Group，并按 definition 对象身份把成员映射回 Eval ID。

`definitionHash` 哈希 Eval Group ID、完整有序 Eval ID 数组、`replay` 与 Group Layer identity。
只把当前 Eval Group 的 ID 和摘要放进其成员 pair 的指纹。
修改另一个 Eval Group 不会让本组或未分组 Eval 的历史结果失效。

link 后再为每个成员计算 `memberBaseFingerprint`。
它包含该成员正常 `Eval × Experiment` 指纹的全部输入与 Group definition、Layer identity，但不包含 selector、attempt 序号、trajectory 或递归 prefix。
`"all"` 的前缀身份按成员语义递归计算：

```text
prefixHash[0] = H(groupDefinitionHash, memberBaseFingerprint[0])
prefixHash[i] = H(prefixHash[i - 1], memberBaseFingerprint[i])
```

第 `i` 步的最终 Attempt 指纹包含 `prefixHash[i]`。
任一前序 Eval、Fixture、prepare、Experiment 条件或物理计划变化，都会让全部后续步骤作废。

## Sandbox Layer 边界

一次物理规划由三方组成：

```text
Eval Group × Eval × Experiment
     │          │        │
     └──────────┴────────┴──▶ one Sandbox owner stack
```

三方中恰好一方提供 template-bearing Layer，其余已声明 Layer 必须是 command-only。
Template ownership 只决定谁提供 Provider 起点，不决定谁可以拥有物理生命周期。
Eval Group 与 Experiment 的 Layer 无论是哪一种 kind，都可以声明 `setup()`、`teardown()` 与 `prepare()`；Eval 只保留本题专属 prepare。

每条 link 先求出唯一的 `resolvedOwnerOrder`：

- Experiment 提供 template：`Experiment → Eval Group → Eval`；
- Eval Group 提供 template：`Eval Group → Experiment → Eval`。

setup 与 prepare 都按这个 owner 顺序执行，每个 owner 内保持声明顺序。
teardown 与逐 Attempt command cleanup 分别按实际登记顺序全局 LIFO，同一个 Layer 不会执行两次。

这个限制由 `defineEval()` 返回值的 Sandbox ownership type-state 表达：

- Eval 省略 `sandbox` 得到 `"none"`，可以加入 Eval Group；
- Eval 使用 `sandboxLayer().prepare(...)` 得到 `"prepare-only"`，可以加入 Eval Group；
- Eval 拥有 template 或调用 `setup()` / `teardown()` 时得到 `"instance"`，不能加入 Eval Group；
- Eval Group 与 Experiment 的 `sandbox` 可以是任意 kind 与 lifecycle scope。

TypeScript 在 `defineEvalGroup()` 调用处指出不合法 Eval 成员。
发现阶段仍复核 JavaScript、类型断言与自定义 Provider，不能把类型逃逸当作权限。

Runner 对每个 Group × Eval × Experiment link 检查 template 数量。
零个 template 报 `sandbox.template-missing`，多于一个报 `sandbox.template-conflict`，并逐项列出三个 owner 的 Layer kind。

同一 Group × Experiment 下的全部成员必须得到相同的 Provider physical plan identity、Agent Ensure identity 与 `resolvedLifecycleStackIdentity`。
不一致时规划失败并列出 Eval Group ID 与相关 Eval，不自动拆组，也不降级成每 Attempt 新 Sandbox。

Direct Agent 没有可复用 Sandbox，因此不能运行 Eval Group。
`localSandbox()` 没有安全的题间 reset 边界，也不能运行 Eval Group。

## 默认运行与多 Eval Group 并行

Eval Group 是签入的题集执行契约，不是 CLI 临时模式。
普通命令自动规划当前 Experiment 选中的全部 Eval Group：

```sh
niceeval exp compare/codex-gpt-5.6-luna--mempal
```

每个 `(invocationId, experimentId, evalGroupId)` 拥有独立队列和至多一台活跃 Sandbox。
不同 Eval Group、未分组 Eval 与其它 Experiment 共同竞争 Invocation 和 Experiment 的并发位。
每个 Eval Group 同时最多占一个并发位；Sandbox 在步骤之间空闲时不占并发位，但仍占 Provider 资源。

`maxConcurrency: 4` 表示一个 Experiment 最多同时推进四个 Eval Group 或 fresh Attempt。
它不让一个 Eval Group 创建四台 Sandbox，也不要求所有成员共用一台全实验 Sandbox。

Runner 使用公平调度波次。
持有 Sandbox 的 Eval Group 不能连续抢占全部并发位；其它 Eval Group 与 fresh Attempt 必须有机会推进。

未被 Eval Group 引用的 Eval 保持普通语义：独立结果沿用，真实派发时使用全新 Sandbox。
框架不建立隐式的“其它”Eval Group，也不因多个 Eval 使用相同工具链而自动共享实例。

若 Experiment 的有效选择与任一 Eval Group 相交，同时声明了 `sandboxReuse: true`，Runner 在 Provider I/O 前报 `eval-group-sandbox-reuse-conflict`。
Runner 不让旧复用池包住 Eval Group、不让它只作用于剩余 Eval，也不静默忽略该字段。
没有命中 Eval Group 时，`sandboxReuse` 暂时保持原有语义。

## `replay: "all"`

`"all"` 表示本轮历史必须由真实 Attempt 建立：

1. Experiment 选择必须包含完整 Eval Group，或包含 `--through` 指定的完整前缀；
2. Runner 不消费这些成员的历史结果沿用；
3. 第一步封口并完成 Attempt 收尾后，Runner 才派发第二步；
4. `passed` 与领域 `failed` 都表示步骤已经发生，可以继续；
5. `errored`、`skipped`、中断或 Sandbox 不可继续时停止该 Eval Group；
6. 下一次运行仍从第一步开始，不从中断位置续跑。

Sandbox 不可继续时，`"all"` 不创建替代实例。
替换会让后续步骤进入一台没有前序物理状态的 Sandbox，却仍声称拥有连续 lineage。
Runner 把尚未派发成员纳入 incomplete completion，并报告 `eval-group-history-incomplete`。

`"all"` 要求求值后的 `attempts` 为 1。
多条独立轨迹需要各自的状态起点、Sandbox 与外部状态身份，不能把 `attempts: N` 隐式解释成 N 条安全轨迹。

## `replay: "pending"`

`"pending"` 先对每个成员执行普通结果沿用规划：

- carried 成员不领取 Sandbox，也不执行 lifecycle、reset、prepare 或 Agent；
- 需要真实派发的成员按声明顺序进入同一个 Eval Group 队列；
- 全部成员都 carried 时不创建 Sandbox；
- CLI 位置参数和 Experiment selector 可以只选择其中部分成员；
- `--rerun` 继续按普通规则决定哪些成员必须真实派发。

carried 成员的历史副作用不会进入本轮 Sandbox。
因此读取面可以展示声明位置与 carried producer，但不能把 `"pending"` 描述成完整执行前缀，也不生成完整前缀摘要。
结果若依赖所有前序交互或物理状态，作者必须使用 `"all"`。

Sandbox 不可继续时，`"pending"` 关闭旧实例，并为下一条尚未开始的 Attempt 槽位创建新实例；该槽位可能仍属于同一 Eval。
实例 lifetime check 或题间 reset 在 Attempt 槽位打开前失败时，Runner 可以先替换实例，再派发同一个尚未开始的槽位。
槽位一旦打开，create、setup、prepare、Agent 或收尾失败都会封口这条 Attempt；替代实例只服务下一条尚未开始的槽位，绝不重跑同一个 attempt number。
运行事实递增 Sandbox 编号，并明确显示后续成员不再享有旧实例缓存。

`attempts > 1` 时，`"pending"` 先按成员展开 Attempt 槽位，再逐槽位执行普通结果沿用、`--rerun` 与 `earlyExit`。
队列按 `(成员声明位置, attempt number)` 的字典序推进，不按重复序号创建隐藏 lane。
需要隔离的重复运行应使用独立 Experiment。

## 生命周期

一个有真实派发成员的 Eval Group 按以下顺序运行：

```text
sharedState lease -> Group lock -> pending carry replan
  -> Experiment host setup
  -> each Eval Group may run concurrently:
       create / ready
       -> Experiment and Eval Group Layer setup in resolvedOwnerOrder
       -> establish reset anchor
       -> each real Attempt:
            lifetime check -> reset to anchor
            -> prepare in resolvedOwnerOrder -> agent.ensure
            -> Agent -> test -> Agent teardown -> command cleanup
       -> final reset for a normal instance
       -> Layer teardown in global reverse order
       -> Provider finalizer
  -> Experiment host teardown
```

每条 Attempt 保持独立的 Assertion、Verdict、usage、diff、事件与 locator。
共用 Sandbox 不合并评分事实或 Agent Session。

Experiment host `setup` / `teardown` 仍是整场至多一次的宿主机生命周期；零条真实 Attempt 时不执行。
Experiment 与 Eval Group 的 Layer Hook 则按每台实际 Sandbox 执行一次。
setup 中途失败时，只对已经进入 setup 的 owner 执行已登记 teardown，再运行 Provider finalizer。
替代 Sandbox 必须重新执行完整 Layer setup，并建立新的 reset anchor。

Layer context 提供只读 `evalGroup.id`、`evalGroup.replay` 与 `evalGroup.definitionHash`。
这些字段在 Group Sandbox lifecycle 与 grouped Attempt 中必定存在，在可同时处理 grouped / ungrouped 工作的公共 context 中为显式可选字段。
每条真实 Attempt 都重做三方 prepare 与 Agent Ensure。
正常实例在退休前最后 reset 到 anchor；不安全实例不再 reset。

Invocation 中断时，Runner 停止派发新 Attempt，终止在飞命令，完成有界 Attempt 收尾，再执行每台实例的 lifecycle teardown 与 physical finalizer。
中断收尾不为 `"pending"` 创建替代实例，也不给未派发成员伪造 Attempt。

Eval Group 实例退出调度 owner 后，按 [Sandbox 默认停驻与回收](../sandbox-retention/README.md)求值 physical release policy。
正常实例与不安全实例使用不同 retention checkpoint；不安全实例不再执行题间 reset。

## 执行锁与外部状态身份

Eval Group 也是跨 Invocation 的执行认领边界。
分组 Eval 使用 `(experimentId, evalGroupId)` 用例锁，未分组 Eval 继续使用 `(experimentId, evalId)`。
Group 锁在创建 Sandbox 前取得，并持有到本组全部 Layer teardown 与 Provider finalizer 完成。
`"pending"` 取锁后逐 Attempt 槽位重做结果沿用；全部 carried 时直接释放锁，不执行 host setup，也不创建 Sandbox。
`"all"` 取锁后仍完整真实派发，不消费等待期间产生的结果。

所有路径使用同一取得顺序：先取适用的 `sharedState` 租约，再取 Group 锁，最后重做 `"pending"` 规划；释放顺序相反。
等待租约时不能持有 Group 锁、Sandbox 或并发位。
Experiment 级租约包住各 Group 锁，`scope: "eval-group"` 的每把租约只包住对应 Group 锁。

Eval Group 只隔离运行中的 Sandbox，不会自动分割 Mempal checkpoint、Nowledge namespace、共享数据库或其它外部状态。
并行 Eval Group 若读写同一份外部状态，会重新引入不确定交错，并让后写内容替换先写内容。

Sandbox lifecycle、Agent runtime 与 prepare context 都必须能读取 `evalGroup.id`。
作者用它派生每个 Eval Group 的外部状态身份，例如：

```ts
const checkpoint = `.cache/mempal/${ctx.evalGroup.id}.tgz`;
const cohort = `${baseCohort}/${ctx.evalGroup.id}`;
```

多个 Invocation 读写同一个 Eval Group checkpoint 时，仍用 `sharedState` 声明跨 Invocation 独占边界。
Experiment 用 `scope: "eval-group"` 让 Runner 在基础 key 后追加 Eval Group ID：

```ts
sharedState: {
  key: `mempal/codex/${cohort}`,
  scope: "eval-group",
}
```

省略 `scope` 时保持 Experiment 级租约。
Runner 在 Experiment host setup 和任何 Sandbox create 前取得基础 key，随后重做全部 `"pending"` 规划；租约一直持有到所有 Provider finalizer 与 host teardown 完成。
它适合所有 Eval Group 确实共用一份外部状态的场景，但也会让多个 Invocation 的整个 Experiment 互斥。

`scope: "eval-group"` 时，Runner 分别租用 `baseKey/evalGroupId`。
每把租约在本组 Sandbox create 前取得，随后重做本组 `"pending"` 规划，并持有到本组最后一台实例 finalizer 完成。
这只让相同 Group 互斥，不让无关 Group 彼此等待。
该 scope 不接受未分组 Eval，也不接受 Experiment host `setup` / `teardown`；需要按 Group 恢复与回存状态时，使用 Experiment 或 Eval Group 的 Sandbox Layer Hook。

`replay: "all"` 只证明 NiceEval 在同一台 Sandbox 中依次真实派发了完整前缀。
它不检查远端记忆内容，也不证明作者选择的 cohort 已回到约定起点。
正式运行必须把新 cohort identity 作为显式 Experiment 配置输入，或由 lifecycle 恢复声明过的固定 revision。
该 identity 进入 Attempt 指纹、Run Record 与 `sharedState.key` 的基础部分；`evalGroup.id` 只是隔离维度，不能冒充新起点。

## CLI 与计划输出

CLI 不提供把整次 Invocation 切成单 Eval Group 模式的 `--group`。
普通 Experiment 命令一次运行全部命中的 Eval Group。

调试 `"all"` Eval Group 的合法前缀时使用带 Eval Group ID 的 `--through`：

```sh
niceeval exp compare/codex-mempal \
  --through toggl-cli=toggl-cli/04-billing-doc
```

`--through` 不越过 Experiment 的 Eval 选择自动增加付费范围。
Experiment 必须已经选择目标前缀中的全部成员；CLI 也不提供 `--from` 或只跑一个后置步骤的选项。

`--dry` 按 Eval Group 展示策略、真实派发数、carried 数、Sandbox 行为和并行上限：

```text
eval groups

group                          replay    actions                 sandbox
toggl-cli                      all       6 run                   shared · stop on loss
react-hook-form                pending   3 run · 5 carried       shared · replace on loss
react-datepicker               pending   7 run                   shared · replace on loss
react-tooltip                  pending   2 run · 4 carried       shared · replace on loss
downshift                      pending   6 run                   shared · replace on loss
yet-another-react-lightbox     pending   3 run                   shared · replace on loss

effective concurrency: 4
```

`--dry --json` 在现有矩阵旁增加：

```ts
type AllEvalGroupPlanStep =
  | {
      readonly index: number;
      readonly evalId: string;
      readonly action: "run";
      readonly requiresIndex: number | null;
      readonly prefixHash: string;
    }
  | {
      readonly index: number;
      readonly evalId: string;
      readonly action: "excluded";
      readonly prefixHash: string;
    };

type PendingEvalGroupPlanStep =
  | {
      readonly index: number;
      readonly evalId: string;
      readonly selection: "excluded";
    }
  | {
      readonly index: number;
      readonly evalId: string;
      readonly selection: "selected";
      readonly attempts: readonly (
        | { readonly attempt: number; readonly action: "run" }
        | {
            readonly attempt: number;
            readonly action: "carried";
            readonly producerLocator: AttemptLocator;
          }
        | { readonly attempt: number; readonly action: "early-exit-unstarted" }
      )[];
    };

type EvalGroupPlan =
  | {
      readonly id: string;
      readonly definitionHash: string;
      readonly replay: "all";
      readonly throughEvalId?: string;
      readonly steps: readonly AllEvalGroupPlanStep[];
    }
  | {
      readonly id: string;
      readonly definitionHash: string;
      readonly replay: "pending";
      readonly steps: readonly PendingEvalGroupPlanStep[];
    };
```

`EvalGroupPlan` 的 `replay` 判别具体 step 类型；`"all"` 只允许单 Attempt 的 `AllEvalGroupPlanStep`。
`requiresIndex` 只出现在它的真实派发步骤；第一步为 `null`，其余步骤必须指向前一位置。
`"pending"` 按 Attempt 槽位保留 carried producer locator，不能假装它在本轮 Sandbox 中执行过。
dry、live 与结束反馈的 run / carried 数都统计 Attempt 槽位，不统计 Eval 成员数。

## Record 与 lineage

Run 保存本次命中的全部 Eval Group，而不是只保存一个可选 Group：

```ts
interface EvalGroupRunInfo {
  readonly id: string;
  readonly definitionHash: string;
  readonly replay: "all" | "pending";
  readonly evalIds: readonly string[];
  readonly selectedEvalIds: readonly string[];
  readonly throughEvalId?: string;
}

type AttemptEvalGroupInfo =
  | {
      readonly replay: "all";
      readonly id: string;
      readonly definitionHash: string;
      readonly index: number;
      readonly memberBaseFingerprint: string;
      readonly trajectoryId: string;
      readonly prefixHash: string;
    }
  | {
      readonly replay: "pending";
      readonly id: string;
      readonly definitionHash: string;
      readonly index: number;
    };

interface Run {
  readonly evalGroups: readonly EvalGroupRunInfo[];
}
```

每条真实 Attempt 另保存 Sandbox 编号与该实例承接序号。
`"pending"` 在替换实例后递增 Sandbox 编号；`"all"` 的同一 `trajectoryId` 只能对应一台 Sandbox。

`trajectoryId` 是每次实际 `Group × Experiment` 的 `"all"` 执行身份，同次真实派发的成员共用它，但它不充当外部 cohort identity。
Reader 仅凭 sealed Record 验证 index 连续、递归 prefix、前序真实封口、同一 trajectory 与单 Sandbox，不重新读取当前源码猜测旧结果。

`"pending"` 的类型中不存在 trajectory 或 prefix，只保存 Eval Group 归属、声明位置和真实 Sandbox assignment。
读取面不得从数组位置、carried 结果或相同 Eval Group ID 推导完整 lineage。

## 失败反馈

以下错误都在派发任何 Attempt 前报告，并列出 Eval Group ID、相关 Eval 与修正方向：

| code | 条件 |
|---|---|
| `eval-group-member-unresolved` | definition 没有恰好对应一条已发现 Eval |
| `eval-group-member-overlap` | 一条 Eval 重复出现或属于多个 Eval Group |
| `eval-group-member-layer` | Eval 成员拥有 template 或实例 lifecycle Hook |
| `eval-group-direct-agent` | Experiment 使用 Direct Agent |
| `eval-group-incompatible` | 成员的最终物理复用 identity 不一致 |
| `eval-group-sandbox-reuse-conflict` | 有效选择命中 Eval Group，同时 Experiment 声明旧 `sandboxReuse` |
| `eval-group-selection-incomplete` | `"all"` 命中后缺少完整成员或合法前缀 |
| `eval-group-attempts-unsupported` | `"all"` 求值后的 attempts 不是 1 |
| `eval-group-shared-state-scope` | `scope: "eval-group"` 与未分组 Eval 或 Experiment host Hook 组合 |

运行中 `"all"` 断裂时使用 `eval-group-history-incomplete`。
`"pending"` 的实例替换不是 diagnostic，但必须进入运行事实与结束反馈。

## MemoryBench

MemoryBench 按真正兼容的 Sandbox 状态划分 Eval Group，而不是把所有 Eval 放进一条全实验队列：

| Eval Group | `replay` | 共享状态 |
|---|---|---|
| `toggl-cli` | `"all"` | Rust 工具链、Cargo 缓存与纵向任务历史 |
| `signalbox` | `"all"` | 九步产品规则演化历史 |
| `react-hook-form` | `"pending"` | pnpm 10 与 package store |
| `react-datepicker` | `"pending"` | Corepack 与 Yarn Berry cache |
| `react-tooltip` | `"pending"` | Yarn Classic v1 cache |
| `downshift` | `"pending"` | npm 与 Node 20 状态 |
| `yet-another-react-lightbox` | `"pending"` | npm 与 Node 22 状态 |

Yarn Berry 与 Yarn Classic 不能因为都使用 Yarn 而合并。
Downshift 与 Lightbox 也不能因为都使用 npm 而合并，因为后者会切换全局 Node 版本。
Eval Group 成员必须共享同一组安全的物理计划与全局工具状态。

Memory Experiment 删除 `sandboxReuse: true`，也不再用 `maxConcurrency: 1` 模拟一条全实验轨道。
`maxConcurrency: 4` 可以让四个 Eval Group 同时推进，而每个 Eval Group 内仍只有一条 Attempt 在飞。

Mempal checkpoint 与 Nowledge namespace 按 `ctx.evalGroup.id` 隔离。
否则多台 Sandbox 仍会同时写同一个 checkpoint，后写内容会替换先写内容。
React PR 题也可能与 toggl-cli 纵向历史互相穿插。

## 范围

本功能包含：

- `defineEvalGroup()`、文件发现、成员 type-state 与重叠检查；
- `"all"` 和 `"pending"` 两种真实派发策略；
- 每个 Eval Group 单 Sandbox 串行、不同 Eval Group 并行；
- Eval Group、Eval 与 Experiment 的三方 Layer link；
- 题间 reset、实例停止或替换，以及外部状态 identity context；
- `--dry`、live、结束反馈、Record 与完整 lineage 验证。

本功能不包含：

- 从 tag、metadata、目录或命令文本自动推导 Eval Group；
- 分支、条件步骤、循环或 DAG；
- 跨 Invocation 共享运行中的 Sandbox handle；
- 自动创建、检查或回滚第三方 memory cohort；
- 让 template-owning Eval 共享运行中的 Sandbox；
- 根据 `maxConcurrency` 自动决定 Eval Group 数或成员归属。

结果沿用与 Sandbox 复用的用词和运行级计数见[结果沿用与 Sandbox 复用反馈](../reuse-feedback/README.md)。
