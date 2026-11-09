# State —— Library

`defineState()`、`StateInput`、`StateDefinition` 与 `StateBinding` 从 `niceeval` 根入口导出。

## 定义

```ts
interface StateInput {
  readonly name: string;
  readonly version: string;
  readonly paths: readonly [string, ...string[]];
  readonly initialize?: SandboxAction;
}

declare const stateDefinitionBrand: unique symbol;
declare const stateBindingBrand: unique symbol;

interface StateDefinition {
  readonly [stateDefinitionBrand]: true;
  readonly name: string;
  bind(options: { readonly cohort: string }): StateBinding;
}

interface StateBinding {
  readonly [stateBindingBrand]: true;
}

declare function defineState(input: StateInput): StateDefinition;
```

品牌不导出；只有工厂能建立 definition 与 binding。工厂复制并冻结输入，运行期校验品牌；手写对象、spread 与 JSON 不能构造 binding。

| 字段 | 规则 |
| --- | --- |
| `name` | 项目内唯一，匹配 `[a-z0-9]+(-[a-z0-9]+)*` |
| `version` | 匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`；改变它就开始新 lineage |
| `paths` | 非空的 Sandbox 绝对路径或 `~/` 路径；安全规则见下节 |
| `initialize` | 仅接受声明式 SandboxAction；无 checkpoint 时真实执行一次，不读写 before 缓存 |
| `cohort` | 匹配 `[a-z0-9][a-z0-9._-]{0,63}`；写入 Run，不包含凭据 |

`initialize` 不接受 callback、StableSandboxCommand 或生命周期登记。只允许 command、shell、writeText、writeBytes、uploadFile、uploadDirectory 与 gitCheckout action。
它使用所选 Sandbox 用户、物理实例的 signal 与 deadline，诊断关联 State execution，不伪造 Attempt。完整 action identity 进入条件身份；其 DAG 元数据必须为空。

初始化命令必须只修改 State 路径，不留下后台写入者；工具在镜像中准备好。有 checkpoint 时不重新初始化，安装步骤不能依赖每次执行 `initialize`。
普通 SandboxLayer 与 Plugin before 仍逐 Attempt 执行，必须保留 State 内容；不能用它们清空记忆目录。

## 路径边界

Runner 在规划期拒绝空段、`.`、`..`、NUL、根目录与词法重复；`~/` 只能由目标 Sandbox 的用户 home 定位，不能使用宿主 HOME。
取得实例后、任何删除前，核对全部有效 binding 的实际路径：

- 不同 State 的路径也不能相等或互相包含。
- 路径与 workdir、Runner 内部目录不能双向包含。
- 路径及现有祖先不得是 symlink；归档不接受 symlink、hardlink、设备、socket、FIFO。
- 路径必须位于受管可写文件树；只有不存在可以记为缺席，权限与读取错误必须失败。

运行期路径 resolution 由 Sandbox 文件操作 owner 负责。删除、打包、解包使用不跟随链接的目录句柄与逐成员白名单，拒绝绝对归档成员、`..` 与重复成员。
验证后路径仍可能变化，执行每个文件操作时继续验证；不能先检查一次再执行不受约束的 tar。

checkpoint 保留排序后的逻辑根及实际绝对根 manifest。任何根、home 或布局变化都在删除前报 `state-layout-mismatch`，要求改 `version`；不把旧目录解包到新路径。
State 只支持可静默复制的文件树。所有写入者必须随 Attempt 命令与 cleanup 结束；持续后台数据库不在支持范围。

## 挂载

| 挂载点 | 写法 | 作用范围 |
| --- | --- | --- |
| Experiment | `defineExperiment({ state: [binding, ...] })` | 选中的全部 Eval Group |
| Plugin | `definePlugin({ state: [binding, ...] })` | 挂到 Experiment 或 Eval Group 后的范围 |

Eval 与 Eval 上的 Plugin 不接受 `state`。同一 Attempt 的 binding 中 `name` 不重复；同项目同名 definition 必须具有相同的 version、paths 与 initialize identity。
State 必须配合 Eval Group，所有成员的有效 binding 集合一致。未分组、不同 binding 或不支持安全文件操作的 Provider 均在创建前拒绝。

同台实例的全部 State 一起恢复、一起提交；一项失败不推进任何 lineage。需要独立保存时使用不同 Group。
运行不会因历史结果复用跳过 State Attempt，但仍服从选择范围、预算、early exit 与取消。

## 错误

| code | 时机 | 条件 |
| --- | --- | --- |
| `state-invalid` | 定义期 | 字段、action、品牌或词法路径不合法 |
| `state-duplicate` | 加载期 | binding 重名或同名 definition 不一致 |
| `state-requires-eval-group` | 规划期 | 选中未分组 Eval |
| `state-provider-unsupported` | 规划期 | Provider 不能兑现安全文件树操作与写入静默验证 |
| `state-path-in-workdir` | 规划或 acquire 后 | 与 workdir 双向包含 |
| `state-path-conflict` | 规划或 acquire 后 | 根重叠、内部路径重叠或链接逃逸 |
| `state-layout-mismatch` | 恢复前 | checkpoint 根 manifest 与声明不一致 |

能够静态确定的错误在任何 build、Hook 或 Sandbox 创建前拒绝。依赖远端 home 的校验在 acquire 后、删除前拒绝。
成员的 binding 不一致使用 Group 的 `eval-group-incompatible`。运行失败与退出码见 [CLI](cli.md)。

## 结果形状

State execution 是一台 Group 物理 Sandbox 的状态生命周期；Runner 为它生成一次 `executionId`，替代实例生成新 ID。
以下只读类型由 `niceeval/run` 导出，同一 Schema 用于 Run 与 Inspection，不接受额外字段。

```ts
interface StateLineage {
  readonly name: string;
  readonly version: string;
  readonly cohort: string;
  readonly experimentId: string;
  readonly evalGroupId: string;
}
interface StateCheckpoint {
  readonly checkpointId: string;
  readonly digest: string; // sha256:<64 lowercase hex>
  readonly bytes: number; // nonnegative safe integer
}
type StateOrigin =
  | { readonly kind: "fresh" }
  | { readonly kind: "checkpoint"; readonly checkpoint: StateCheckpoint };
type StateFailureReason =
  | "path-invalid" | "layout-mismatch" | "checkpoint-invalid"
  | "initialize-failed" | "restore-failed" | "reset-failed"
  | "prepare-failed" | "cleanup-failed" | "resource-failed"
  | "not-quiescent" | "provider-lost" | "interrupted"
  | "timeout" | "capture-failed" | "storage-failed" | "owner-lost"
  | "no-attempts" | "recovered";
interface StateExecutionBinding {
  readonly lineage: StateLineage;
  readonly origin: StateOrigin;
}
type StateRestore =
  | { readonly status: "pending" }
  | { readonly status: "ready" }
  | { readonly status: "failed"; readonly reason: StateFailureReason };
type StateSave =
  | { readonly status: "pending" }
  | { readonly status: "saved"; readonly checkpoints: readonly StateCheckpoint[] }
  | { readonly status: "skipped" | "failed"; readonly reason: StateFailureReason }
  | { readonly status: "conflict"; readonly actual: readonly (StateCheckpoint | null)[] }
  | { readonly status: "unknown"; readonly reason: "storage-failed" };
interface StateExecution {
  readonly executionId: string;
  readonly runId: string;
  readonly experimentId: string;
  readonly evalGroupId: string;
  readonly generation: number; // positive instance ordinal within this Run/Group
  readonly bindings: readonly StateExecutionBinding[];
  readonly restore: StateRestore;
  readonly save: StateSave;
}
interface AttemptState {
  readonly executionId: string;
  readonly earlierAttempts: number; // nonnegative safe integer
}
type RunSandboxState =
  | { readonly status: "unavailable" }
  | { readonly status: "known"; readonly executions: readonly StateExecution[] };
type AttemptStateResult =
  | { readonly status: "unavailable" }
  | { readonly status: "known"; readonly context: AttemptState | null };
```

数组按 lineage 五元组排序；保存的 checkpoints 与 conflict 的 actual 逐项对应 bindings，不允许部分数组或乱序。`null` 表示该 lineage 没有 HEAD。
`checkpointId` 与 `executionId` 是 Runner 生成的随机 128-bit 小写 hex，不由作者提供；同内容重复保存可以 digest 相同，但 checkpointId 必须不同。

所有新增字段命名为 `sandboxState`；生命周期的 `RunState` 与 `state` 字段保持原含义。精确嵌套位置如下。

| 公开值 | 字段路径 | 类型 |
| --- | --- | --- |
| Run Host `RunResult` | `run.sandboxState` | RunSandboxState |
| `RunGetDocument` | `run.sandboxState` | RunSandboxState |
| Inspection `run.get` 成功 document | `run.value.sandboxState` | RunSandboxState |
| Inspection `attempt.get` 成功 document | `attempt.sandboxState` | AttemptStateResult |

这些是现有严格 shape 的必填新增字段；wrapper 的其它字段由各自协议 owner 定义，不另加顶层 state。
历史缺事实为 unavailable，正式无 State 为 known 空数组或 null。
Attempt 仅在 restore ready 后发布 context。`earlierAttempts` 计本实例此前已进入 Agent 阶段且已结束的 Attempt，包括失败题，不表示成功写入数。

active Run 可以读到 pending；替代实例、零 Attempt 的恢复失败也保留在 executions。Attempt context 与执行事实用 executionId 关联，禁止只返回最后一代。
所有字段按同一 PublicationCutoff 读取；保存发生在 Attempt 发布后，不回写其 context 或 Verdict。完整存储与恢复规则见 [Architecture](architecture.md#run-事实)。

## 与 Plugin 组合

```ts
import { defineState } from "niceeval";
import { definePlugin } from "niceeval/plugin";
import { shell } from "niceeval/sandbox";

const mempalState = defineState({
  name: "mempal",
  version: "0.9.0",
  paths: ["~/.mempal"],
  initialize: shell({ command: "mempal init ~/.mempal" }),
});

export const mempal = definePlugin((options: { cohort: string }) => ({
  name: "mempal",
  key: options.cohort,
  identity: { version: "0.9.0", cohort: options.cohort },
  requires: { evalGroup: true },
  agent: { skills: [{ kind: "local", path: "./skills/mempal" }] },
  state: [mempalState.bind({ cohort: options.cohort })],
}));
```

Plugin 的其余字段见 [Plugins Library](../plugins/library.md)。
