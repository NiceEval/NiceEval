# State —— CLI

Sandbox State 不增加独立命令。`niceeval exp` 报告恢复与保存，`show` 与 `query` 读取 Run 事实。下列输出均为预期输出。

## 状态反馈

每条人读事件都包含 Experiment、Group 与 State 名称；失败显示安全原因，不打印归档内容或私有路径。

| 事件 | 人读输出示例 |
| --- | --- |
| `restored` | `state mempal · codex / react-hook-form restored sha256:… (1.4 MB)` |
| `initialized` | `state mempal · codex / react-hook-form initialized` |
| `empty` | `state mempal · codex / react-hook-form empty` |
| `restore-failed` | `state mempal · codex / react-hook-form restore failed: layout-mismatch` |
| `saved` | `state mempal · codex / react-hook-form saved sha256:… (1.4 MB)` |
| `save-skipped` | `state mempal · codex / react-hook-form save skipped: interrupted` |
| `save-conflict` | `state mempal · codex / react-hook-form save rejected: lineage changed` |
| `save-failed` | `state mempal · codex / react-hook-form save failed: capture-failed` |
| `save-unknown` | `state mempal · codex / react-hook-form save unknown: storage-failed` |

失败使用 `state-<event>` diagnostic；save-skipped/no-attempts 仅为 info。其余失败产生 execution error 并非零退出，不改写 Attempt Verdict。
中断按现有中断退出规则；Assertion failed 仍可保存，但不会因此变成成功。

## JSON 事件

`--json` 的 NDJSON state 事件使用下列严格联合；引用类型见 [结果形状](library.md#结果形状)。

```ts
interface StateEventIdentity {
  readonly type: "state";
  readonly runId: string;
  readonly executionId: string;
  readonly lineage: StateLineage;
}
type StateEvent = StateEventIdentity & (
  | { readonly event: "restored" | "saved"; readonly checkpoint: StateCheckpoint }
  | { readonly event: "initialized" | "empty" }
  | { readonly event: "restore-failed" | "save-skipped" | "save-failed";
      readonly reason: StateFailureReason }
  | { readonly event: "save-conflict";
      readonly expected: StateCheckpoint | null;
      readonly actual: StateCheckpoint | null }
  | { readonly event: "save-unknown"; readonly reason: "storage-failed" }
);
```

saved 事件只在全部 binding 提交后发送，每个 binding 一条。NDJSON 是进度，不是持久回执；进程在 commit 后退出可能尚未输出，query 仍能读到已提交事实。
一项恢复失败时对失败项发 restore-failed，整个集合发 save-skipped；其它项不能输出 saved。

## `--dry`

`niceeval exp <selector> --dry` 只读当前 HEAD，不取得租约、不创建 Sandbox、不建立 Run、不预约起点。
真实运行拿到全部租约后重新读取；两次看到的起点可能不同。只有确定不存在 HEAD 才显示 fresh，不可读或损坏时非零退出。

```text
state mempal · codex / react-hook-form cohort 2026-11 · from sha256:3f9a…c21e
state mempal · codex / downshift cohort 2026-11 · no checkpoint (initialize)
```

`--dry --json` 在每个 Group plan 的 `state` 数组中给出 `{ lineage: StateLineage, origin: StateOrigin }`，按 lineage 排序；未绑定时为空数组。
它是观察值，不包含 executionId 或 lease token；不能证明远端路径校验、初始化或恢复能成功。

## 读取状态起点

```text
State mempal cohort 2026-11 · from sha256:3f9a…c21e · 3 earlier attempts in this sandbox
```

`show <attempt>` 根据 context.executionId 联结同 cutoff 的 State execution，展示起点与该实例的保存结果。
`attempt.get` 的 `attempt.sandboxState` 与 `run.get` 的 `run.value.sandboxState` 使用 [Library 结果形状](library.md#结果形状)，全部物理世代保留；unknown 或 unavailable 不能显示成 saved。
固定 Run 的历史读取不要求当前 State 定义仍存在，也不读取 checkpoint 字节。

## 中断后恢复

`niceeval exp <selector> --after --recover-shared-state <key>` 只读展示整个自动 State 租约集合的 owner evidence。
操作员确认原 owner 终止、远端写入静默后，使用该入口既有的 token 与双确认参数恢复；不支持 JSON recovery。
纯 State 自动集合仅在没有已登记 after 义务时不要求作者 after；Runner 先调用 Run recovery 对账，再释放集合。混有作者 sharedState 时仍执行作者 after；失败不释放任何 key。
完整参数与拒绝规则由 [Experiment recovery](../experiments/cli/README.md#协调等待与恢复) 拥有。
