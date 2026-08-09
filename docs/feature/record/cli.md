# Record CLI

`watch` 是旁路观察面，`exp --json` 是发起者的机器事件面，`show` 与 `view` 是固定 revision 的审计面。
它们共享 Observation、Claim、Reducer 和 receipt，不复制生命周期状态机。

## Store root 与 clean

bundled CLI 把项目 root 唯一映射为 `<project>/.niceeval/record`，并把这个绝对路径作为实际
RecordStore root 交给 Library。`.niceeval` 只是 workspace state container；`sandboxes`、`teardowns`、
`sessions` 和 locks 都是其它 owner 的 sibling，不是 RecordStore 内容。

`niceeval clean` 只删除这个 Record-owned root，或调用方明确指定的 Record-derived target。它不扫描或
认领 `.niceeval` 父目录，不触碰任何 sibling。已有用户结果不会被 create、open、clean 或 route switch
自动迁移或删除；删除只作用于被明确选择的 Record-owned target。

CLI 的 `--record` 类输入一律是实际 Store root。传入 `.niceeval` 不会由 CLI 或 Library 补成
`.niceeval/record`；项目默认路径的映射只发生在 bundled CLI 的项目入口。

## watch

```bash
niceeval watch
niceeval watch inv_01ac42f0
niceeval watch --exp compare/codex
niceeval watch --json
niceeval watch --json --once
```

| 形态 | 行为 |
|---|---|
| TTY | 显示 active Attempt、phase、短 detail、elapsed、计数和近期 Diagnostic |
| 非 TTY | 先打印 snapshot，再追加 phase、终态与 Diagnostic 摘要 |
| `--json` | 先输出 snapshot，再 tail LiveRecord NDJSON |
| `--json --once` | 只输出一致 snapshot 后退出 |

`watch` 只读已经存在的 Invocation。
它不启动调度、不更新 Record、不占用被观察进程的 stdin，也不抢发起者的 TTY。

### 附着选择

selector 可以是 Invocation ID 或 `--exp <experimentId>`。
没有 selector 且只有一个 active Invocation 时自动附着。

存在多个候选时，命令列出 Invocation ID、Experiment、启动时间和 active 数，并以非零状态退出。
它不能静默选择最新或最早的一项。

Invocation 已结束时，`watch` 输出 terminal snapshot 和对应 RecordGraphRef，再指向 `show`。
附着失败使用以下结构化错误码：

| 错误 | 条件 | 下一步 |
|---|---|---|
| `no-active-invocation` | 未给 selector，且没有 active Invocation | 先运行 `niceeval exp`，或显式给 Invocation ID |
| `ambiguous-invocation` | 未给 selector，或 `--exp` 同时命中多项 | 从候选列表复制 Invocation ID |
| `invocation-not-found` | 显式 Invocation ID 不存在 | 复核 ID，或省略 selector 查看 active 候选 |
| `live-channel-unavailable` | Invocation 存在，但 live transport 不可连接 | 使用 receipt 中的 RecordGraphRef 运行 `show` |
| `live-permission-denied` | 当前调用方无权读取该 channel | 使用具备该 Invocation 读取权的凭据重试 |

## 机器输出

Live transport 使用 NDJSON。
每行是以下穷尽联合之一：

```ts
type LiveRecord =
  | {
      type: "snapshot";
      reason: "attach" | "resync" | "terminal";
      cursor: string;
      snapshot: LiveSnapshot;
    }
  | {
      type: "observation";
      cursor: string;
      observation: ObservationEvent;
    }
  | {
      type: "claim";
      cursor: string;
      scope: ClaimPayloadV1["scope"];
      claim: Claim;
    }
  | {
      type: "heartbeat";
      cursor: string;
      observedAt: string;
    };

type InvocationMachineRecord =
  | LiveRecord
  | {
      type: "receipt";
      receipt: InvocationReceipt;
    };
```

`watch --json` 只发 LiveRecord。
`exp --json` 与 `Json(path)` reporter 在同一 LiveRecord 序列末尾追加唯一 receipt record。
它们不保存宽结果数组，也不另定义 `attempt_start`、`phase_event` 或 `result_summary`。

cursor 是 live channel 的不透明续读位置。
客户端只能原样回传，不能解码 cursor 来猜 stream、sequence 或 Store 路径。

## LiveSnapshot

```ts
interface LiveSnapshot {
  invocationId: string;
  status: "active" | "complete" | "incomplete" | "interrupted";
  observedAt: string;
  elapsedMs: number;
  basis: readonly {
    streamId: string;
    throughSequence: number | null;
  }[];
  counters: {
    total: number;
    reused: number;
    running: number;
    elsewhere: number;
    queued: number;
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
  };
  active: readonly {
    runId: string;
    experimentId: string;
    attemptId: AttemptId;
    evalId: string;
    ordinal: number;
    phase: LifecyclePhase;
    detail?: string;
    elapsedMs: number;
    locator: AttemptLocator;
  }[];
}
```

计数满足：

```text
total = reused + running + elsewhere + queued
      + passed + failed + errored + skipped
```

snapshot 由共享 Reducer 产生。
Invocation 索引、TTY、`watch` 和 `exp --json` 不能各自维护 counters 或 active Attempt。

snapshot 是有界 transport 状态，不是 Record fact 或 Projector 缓存。
为了恢复而落盘时，它必须同时保存 reducer 版本和 basis；不匹配就从 durable event 重建。
`watch --json --once` 不更新 Layout、committed root、lease 或 pin。

## 一致附着与重连

附着操作原子返回 snapshot 与对应 cursor。
服务端随后只发送 cursor 之后的 record，避免 snapshot 与 tail 之间漏项。

live channel 可以只保留有界历史。
cursor 落出观测保留时段时，服务端发送 `reason: "resync"` 的新 snapshot 与 cursor，再从新位置继续。
它不能用当前状态伪造已经丢失的事件。

重复 Observation ID 或 Claim ID 按幂等处理。
同一 ID 对应不同规范字节是协议错误。

## 默认公开的 live 内容

| record | 时点 | 用途 |
|---|---|---|
| `niceeval.attempt.started` | identity reservation 已 durable，Attempt 开始外部工作 | 建立 active Attempt |
| `niceeval.attempt.phase.changed` | LifecyclePhase 改变 | 更新 phase 与短 detail |
| `niceeval.attempt.finished` | required stream、terminal Claim 与 Attempt checkpoint 已收敛 | 移除 active Attempt |
| `niceeval.sandbox.release.finished` | 物理资源释放收敛 | 更新 resource completion |
| `niceeval.diagnostic.observed` | durable Diagnostic 形成 | 显示近期问题 |
| Verdict Claim | 当时判定形成 | 更新 passed、failed、errored 或 skipped |

`attempt.finished` 不复制 Verdict。
它引用 Claim ID 或 AttemptReceiptSnapshot；Hub 保证依赖先于引用在同一连接上出现。

`progress` 进入独立 ephemeral channel。
它可以被合并或丢弃，不占 durable sequence，也不改变 snapshot 的权威计数。

全文 message、thinking、工具 input/output、stdout、stderr 和 workspace diff 默认不进入 live。
这些证据保存在 Record，并由 `show @<locator>` 的具名 Projector 读取。

## AttemptLocator

locator 的 canonical CLI 形状是 `@` 加 26 个 Crockford Base32 字符：

```text
@01J8ZK3M6P4T7V9X2C5N8QW0RY
```

它编码完整 128-bit attemptId。
locator 不编码目录、Run、时间或 Graph digest；对外可见后永不改变。

```bash
niceeval show @01J8ZK3M6P4T7V9X2C5N8QW0RY
```

单一 Record 内的 locator 查找使用 locator index。
显式打开多份 Record 时，同 locator 多命中会返回 ambiguous，并要求加 source recordId：

```bash
niceeval show rec_01J8ZK:@01J8ZK3M6P4T7V9X2C5N8QW0RY
```

参数是一段连续的 `recordId:@locator`。

三种失败分开反馈：

| 错误 | 含义 | 下一步 |
|---|---|---|
| `malformed-locator` | alphabet、长度或高位不合法 | 复制完整 `@` locator |
| `locator-not-found` | 当前 Record 没有该身份 | 检查 Record root 或打开对应 Record |
| `ambiguous-locator` | 多份显式输入命中 | 使用 `recordId:@locator` |

CLI 不能截短 locator 作为默认寻址，也不能任选一个 ambiguous candidate。

## show 与 view

`show` 先固定 RecordGraphRef，再按 locator 查找并固定 adopted Attempt revision。
execution、timing、trace、usage、diff、Assertion 与 Verdict 都通过 Projector 读取。

Projector 返回 available 时，CLI 同时显示 verification：

- full 不附加警告；
- limited 列出 incomplete、truncated 或 redacted 等实际 issue；
- unverified 明确说明历史值仍存在，但依据无法完整复核。

unavailable 显示全部 causes，并按 Record Library 的稳定顺序选择主因。
CLI 不把 unavailable 渲染为 0、空数组或失败 Verdict。

`view` 与 `show` 使用同一 Projector、Sample 和 Calculation。
Web 页面不能因为懒加载而打开计划外 Record 查询，也不能把页面字段写回 Record。

## 镜像命令边界

`watch`、`show` 与 `view` 不执行 mirror。任何把 Record mirror 暴露为 CLI 的 integration 都必须先
capture source snapshot，或先 parse 用户提供的 snapshot，再把已经 typed 的 snapshot 传给
`mirrorRecord()`；它不能把原始 token 直接交给 mirror。

capture/parse 的失败只显示 `RecordMirrorSnapshotError.failure.code`。mirror 的失败只显示
`RecordMirrorError.failure.code`，并保留 source/target、component 或 phase。resource-limit 还保留
`limit` / `observed`；首次 `expected: null` conflict 还保留 actual Layout。CLI 不得把这些结果压成
“同步失败”、`*-failed` 或 unknown cause。

## 镜像后的单一路由

完整 mirror 是 route switch 的前置条件。source 与 target 都通过完整 committed-root history 和每个
Graph 的 strong closure 验证后，Runner、读取命令和交付物才可以切到 target。部分复制、只复制 head 或
只验证 target Layout 都不能切换 route。

一次 route switch 必须在同一个固定 GraphRef 上审计以下可观察面：

- Runner 的 `InvocationReceipt`、Reporter 与机器输出；
- `src` 的公开类型与 exports；
- Sample、Reports、`show` 与 `view`；
- rename、copy、reuse 与 fingerprint。

这些入口只保留一条读写 route。它们不双写、不在失败时回退到旧 Store，也不提供兼容适配器。
旧 `publish` 面从 CLI、Library exports 与 route 中删除，不改名为 mirror 或其它命令。

## Invocation receipt 与退出状态

`exp` 建立 Invocation 后，无论完整、部分还是中断，都在机器输出末尾产生 InvocationReceipt。
preflight 阶段失败时没有 receipt，因为 durable Invocation 尚未建立。

退出状态同时读取两类事实：

1. terminalSnapshot 中 Verdict Claim 的计数；
2. InvocationReceipt 的 completion 与 RecordCommit。

receipt 不是 complete，或 Record required sink 是 partial / not-recorded 时，命令必须非零退出。
receipt complete 时，既有 Verdict CLI 政策决定通过与失败退出码；它不能从 Diagnostic 文案或 phase 猜 Verdict。

人读收尾显示：

- terminal counters；
- receipt completion；
- complete 或 partial 的 RecordGraphRef；
- `show` 与 `view` 的下一步。

not-recorded 没有 GraphRef。
partial 必须显示 durableThrough 与 write failure，不能只打印一个“保存失败”并丢掉仍可复核的 checkpoint。

## 安全边界

Live 使用和 Record 相同的 transformation 后 envelope。
默认 channel 不发送 secrets、完整 transcript、命令原始输出或 diff。

OTel exporter 是 supplemental sink。
它失败时产生 Diagnostic，不改变 Attempt、Verdict 或 RecordCommit；Record required sink 失败则必须进入 partial 或 not-recorded。
