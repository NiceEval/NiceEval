# Lifecycle

本页固定 Capture、Analysis、Report 与 migration 的资源时序。公开类型见 [Library](library.md)。

## 一次 fresh Attempt

```text
Invocation planning
  → resolve Eval + Plugin occurrences
  → freeze Capture definitions and Producer identities
  → open Attempt Scope
      → register obligations as pending
      → acquire Plugin child resources
      → execute test
      → domain SDK seals each obligation exactly once
      → release Plugin child resources
      → verify no pending obligation remains
      → validate fixed envelopes and blob closure
  → close Attempt Scope
  → publish Attempt only after every barrier succeeds
```

### 次数

| 动作 | 每个 actual Attempt 的次数 |
|---|---:|
| Capture token registration | 每个声明 token 一次 |
| producer resource acquire | 每个 mounted occurrence 一次 |
| seal | 每个 obligation 恰好一次 |
| producer release | 每个成功 acquire 的 occurrence 一次 |
| Attempt publication | 最多一次 |

完整 carried Attempt 不重新打开 Scope，不运行 Plugin，也不重新 seal。历史事实是否满足新 target 的 reuse policy，由 reuse planning
单独裁决。

## Setup、test 与 release

Capture producer 可以在 setup 前读取初始值，在 release 前读取终值：

```text
Plugin eval setup
  → read initial value
  → t.send / test activity
Plugin eval release
  → read final value
  → seal obligation
  → release device handle
```

SDK 必须在 acquire 资源前登记可执行 cleanup。test 抛错后仍运行 release；producer 可以封口 `failed`，但不能把异常吞成 missing。

release 出现以下情况时 Attempt 失败：

- required obligation explicit failed；
- 任何 obligation 未封口；
- 重复或 late seal；
- coordinate / rubric 不完整；
- blob closure 写入失败；
- cleanup 破坏了 publication barrier。

`required: false` 只允许 explicit failed / unavailable 成为可分析事实，不允许 producer 不履行 obligation。

## 同一个 SDK 挂载多次

每个 Plugin occurrence 拥有独立 Producer identity 与 Capture token occurrence：

```ts
plugins: [
  gpuEnergy({ meter: nvmlEnergyMeter({ device: 0 }) }),
  gpuEnergy({ meter: nvmlEnergyMeter({ device: 1 }) }),
]
```

SDK 必须通过 labels 或不同 Metric identity 让 coordinate 集合保持唯一。两个 occurrence 不能向同一个 obligation seal，也不能靠
调用顺序区分 producer。

## Invocation 写后读取

```text
open RecordAccessRuntime
  → snapshot facet: freeze reuse-planning view
  → invocation facet: open write session
      → execute gaps
      → publish complete Runs
  → close write session
  → snapshot facet: open fresh Analysis view
      → build frozen Sample
      → execute Analysis / Report
  → close Analysis view
  → close RecordAccessRuntime
```

写后 Report 不复用写前 frozen view。fresh Analysis view 只在 write session 完全释放后打开，因此不会与自己的写锁形成死锁，也
不会漏掉刚发布的 Run。

## Analysis call

```text
analyze(sample, fields)
  → bind exact frozen Sample
  → validate one nominal population or explicit relations
  → compile requested field DAG
  → reject cycle / identity collision / producer mismatch
  → read fixed envelopes through host readers
  → calculate Dimension and Measure values
  → return closed rows with MetricValue and refs
```

同一次 Analysis execution 对 exact field dependency identity 去重。一个 call 的失败不改写 Record；`unsupported`、`unavailable`、
`invalid` 与 `missing` 形成不同 issue / state。

## Report request

```text
show / view / static request
  → select frozen Sample
  → create ReportExecution
  → resolve requested Page instance
  → call Page render once with ReportSample
      → aggregate A
          → compile A field DAG
          → calculate or reuse cached results
          → return closed rows
      → optional branch on rows
      → optional aggregate B
      → compose semantic nodes
  → validate closed tree
  → render requested face
  → release Record view and execution cache
```

Page callback 不做 discovery run。调用几次 `aggregate()`，就闭合几张本次实际需要的有限 DAG。相同 field dependency 在同一次
execution 中只计算一次。

### 本机 view

每次页面请求可以建立新的 `ReportExecution`。不同请求不承诺共享 field cache；它们各自冻结 Sample，并在页面完成后释放资源。

### Static export

static export 在一次 `ReportExecution` 中枚举目标 Page 与 PageFamily instances：

```text
freeze one Sample
  → enumerate target pages
  → execute each instance once
  → share exact field cache across instances
  → close every semantic tree
  → publish target directory atomically
```

任一目标 Page 失败时，不发布半成品目录。已经生成的临时内容留在 host 临时目录并按失败 cleanup 规则删除。

## Migration

```text
niceeval migrate
  → obtain maintenance lock
  → freeze exact source snapshot
  → inspect Core + all fixed envelopes + blob closure
  → build opaque plan
  → print plan and release lock

niceeval migrate --yes
  → obtain maintenance lock
  → revalidate exact plan identity
  → create recovery point
  → run platform converters in staging snapshot
  → carry unknown envelopes and blobs byte-for-byte
  → validate complete staged snapshot
  → atomically publish
  → write receipt
```

计划与授权只对 exact source snapshot 有效。source 改变后必须重新 plan。无法无损携带 unknown envelope 或 blob closure 时，
staging 失败，source 不变，也不产出 receipt。

迁移不加载领域 package converter。package 缺失只影响 typed Analysis；generic Metric / Score / Artifact 仍可迁移和检查。

## Failure ownership

| 失败 | owner | 后果 |
|---|---|---|
| Capture definition 不合法 | definition load | Eval / Plugin 无法进入 planning |
| producer contract violation | Attempt | Attempt 不发布 |
| optional producer explicit failed | Capture fact | Attempt 可结束；Analysis 保留 failed state |
| field cycle / population mismatch | Analysis request | 该 Analysis / Page 失败 |
| Page callback 失败 | Page instance | 其它 Page 可继续；static export 整体不发布 |
| renderer 失败 | requested face | closed tree 保留为诊断输入；不改 Record |
| migration preflight 失败 | plan | 不产生 authorization |
| converter / validation 失败 | staging snapshot | source 不变，不产出 receipt |

失败不能跨层伪装：Capture failure 不是 Analysis missing，Analysis defect 不是 Report empty state，renderer failure 也不改变
MetricValue。
