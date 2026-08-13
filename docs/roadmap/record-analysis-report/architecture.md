# Record → Analysis → Report —— Architecture

## 依赖方向

```text
domain API → sealed value → RecordAttachment adapter → Record
                                                     │ frozen view
                                                     ▼
                                                  Analysis
                                                     │ closed values
                                                     ▼
                                                   Report
```

依赖只向右。Analysis 不把派生指标写回 Record；Report 不绕过 Analysis 读取 package；Record 不认识通过率、GPU 汇总或
页面组件。

## 每层屏蔽什么

Record 屏蔽 durable layout、path、locks、snapshot generation、schema decode、blob closure 与 commit 顺序。它不屏蔽
owner、schema identity、读取六态、incomplete warning 或 migration 要求。

Analysis 屏蔽 reader lifecycle、owner lookup、decode 与跨 package 的机械对齐。它不屏蔽 Sample denominator、每 slot
状态、unmatched／ambiguous、coverage、issues 或 refs。

Report 屏蔽 Record I/O、migration、重新采证与 renderer 机制。它不屏蔽 host problems、数值口径、coverage 与下钻引用。

## 领域 API 在 Record 之上

普通作者调用 `t.check`、`t.sandbox.*`、tracing 配置或 third-party Plugin。他们不声明 Attachment family，也不取得 owner
writer。领域 SDK 拥有两道边界：

1. producer lifecycle 把多次领域 input 封成一份 sealed value；
2. RecordAttachment adapter 把 sealed value 纯转换为 current payload，并把 available payload 投影回领域 view。

这两道边界不能合并。collector 可以有资源、clock 或 provider；adapter 必须纯、确定且不读取宿主运行条件。

## 一套 substrate，不是一把万能 client

```text
openRecordAccessRuntime(root)
  ├─ snapshots ───── withSnapshot ─────► Analysis / Report host
  ├─ invocation ──── withWriteSession ─► Invocation coordination
  │                                      └─ host-internal owner leases
  └─ maintenance ─── plan / migrate ───► maintenance host
```

三种 facet 共享 canonical root、runtime registry、lock authority、generation allocator、verified cache 与 validators，但不
共享调用权限。

Invocation 的 `session.view` 只做 reuse planning。本次新发布的 Run 要在 write session 关闭后，通过 fresh snapshot 才能
进入 Analysis。这样不会延长 exclusive writer lock，也不会把 draft 混入分母。

## 两种 cache 不合并

| 名称 | 回答什么 | owner |
|---|---|---|
| verified-read cache | exact envelope、payload 与 blob closure 是否已验证 | Record runtime；物理 hit 不可观察 |
| reuse planning | 当前 ExecutionTarget 的 Slot 能否采用历史 Attempt | Experiment domain；形成公开 `ExecutionReusePlan` |

verified cache 不缓存 Run enumeration、draft、lease、read state 或 migration intermediate。reuse planner 不能把 cache hit
当作可采用证据。

## 中立写入核

```text
Assertions binding ─┐
Diff binding ───────┤
Timing binding ─────┼─ total obligation → sealed value → adapter target
GPU SDK binding ────┘                                      │
                                                           ▼
              admission → reservation → snapshot → closure → tracked command
                         → poison-on-failure → sink → publication
```

| 维度 | Assertions／Evidence | File Diff | third-party GPU |
|---|---|---|---|
| durable family | `niceeval.assertions` | `niceeval.diff` | `com.example.gpu-energy` |
| domain API | `t.check`／scoped Assertions | `t.sandbox.fileChanged`／automatic diff | `gpuEnergy({ meter })` |
| adapter | package-private official | package-private official | SDK-private reverse-domain |
| binding | package-private Attempt | package-private Attempt | Plugin Attempt |
| total obligation | actual Attempt 一份 | actual Attempt 一份 | mounted actual Attempt 一份 |
| command kernel | 相同 | 相同 | 相同 |

中立性只承诺机械路径相同，不承诺 namespace、schema、领域算法或 installation authority 相同。official adapter 也没有 raw
draft 或 parallel facade。

## Plugin 双 occurrence

Experiment Plugin 的一个 mount 可以贡献 Run 与 Attempt bindings，但 link 必须拆开：

```text
mount provenance
  ├─ Run occurrence: recordAdapters.run
  └─ pair/Attempt occurrence: recordAdapters.attempt
```

两者分别拥有 exact internal grant、behavior identity、Scope、open／closed state、accepted events 与 seal barrier。Hosted
Hooks 属于 Attempt occurrence；setup／teardown 属于 Run occurrence。Group 没有 Record owner。

## Analysis 内部四步

| 步骤 | 输入 → 输出 | 不负责 |
|---|---|---|
| Selection | frozen view → `AnalysisSampleHandle` | package decode、reuse planning |
| Projection | live handle + SDK declaration → closed domain `ProjectedSample` | 跨 package join、聚合 |
| Relations | same-Sample projections → exhaustive relation cells | heuristic agreement、metric |
| Derivation | closed projections／relations → ordinary closed values | Record I/O、页面呈现 |

四步共享 Sample identity。Projection 不重新开 snapshot；Relations 拒绝不同 Sample；Derivation 的统计结果保留 observed、
denominator、state、issues 与 refs。

SDK 可以把 private projector 包装成 `projectGpuEnergy()` 等领域 API。隐藏 schema 与 reader，不等于可以丢掉 host-owned
read states 或 Sample population。

## Report 只静态约束自己的读取

Report definition 用 `reportInputs()` 声明有限领域 inputs。Report host 在 callback 前执行 Projection，形成 closed values
与不可删除 problem inventory。

Calculation 在文件上属于 Report，在语义上位于 Analysis Derivation seam。它调用普通纯函数。Page 只呈现 calculation
result，不打开 Record、不迁移、不重新采证，也不把 Report result 写成第二份 Record。

## 不变量

1. 普通 `TestContext`、Plugin Hook context 与 Eval／Experiment definition 没有 Record command 或 write grant。
2. 一个 actual owner 的每个 mounted binding accepted exactly once 或令 owner 失败。
3. producer session 只住在 binding child Scope；carry／reuse 不打开它。
4. binding behavior identity 与 schema identity 分离，并进入正确 fingerprint、manifest 与 provenance。
5. 一个 Analysis execution 的 selection 与所有 Projection 使用同一 snapshot generation。
6. 新发布 Run 只在 write session 关闭后的 fresh snapshot 可见。
7. 一个 Attachment 的 blob ref 只能引用自己的 closure。
8. Report callback 不能取得 reader、root runtime、Sample handle、maintenance 或 adapter。
9. host-owned read states、migration problems 与 execution problems 不能被页面过滤掉。
10. official facts 使用同形 adapter binding；官方特权止于 namespace construction 与 installation package owner。
