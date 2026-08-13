# Record → Analysis → Report —— Architecture

## 三层依赖方向

```text
domain producer
      │
      ▼
Record ───────── frozen view ─────────► Analysis ── closed values ──► Report
 facts + lifecycle                         │                            │
                                          ├─ selection                 ├─ pages
                                          ├─ projection                ├─ components
                                          ├─ relations                 └─ renderers
                                          └─ derivation
```

依赖只向右。Analysis 不把派生指标写回 Record；Report 不绕过 Analysis 读取 package；Record 不认识通过率、关系图或
页面组件。

## Record 屏蔽机制，不屏蔽事实状态

Record 对上层屏蔽 durable layout、path、locks、snapshot generation、schema decode、blob closure 与 commit 顺序。
它不能把这些机制的结果压成 `undefined` 或空数组。

上层必须看见：

- exact owner 与 schema identity；
- available、unavailable、migration-required、migration-unavailable、unsupported 与 invalid；
- incomplete Run warning 与 typed I/O / permission failure；
- 一个 view 所属的固定 snapshot generation。

普通 read/write 不自动 migrate。`migration-required` 是数据状态；只有 maintenance facet 能执行 converter 与 durable
commit。

## 一套 substrate，不是一把万能 client

```text
openRecordAccessRuntime(root)
  ├─ snapshots ───── withSnapshot ─────► Analysis / Report host
  ├─ invocation ──── withWriteSession ─► Invocation coordination
  │                                      └─ owner-local ctx.record
  └─ maintenance ─── plan / migrate ───► maintenance host
```

三种 facet 共享 canonical root、runtime registry、lock authority、generation allocator、verified material cache 与
底层 validators。它们不共享调用权限；nominal capability 决定谁能发起哪一种 operation。

Invocation facet 继承 snapshot 能力，但官方 Invocation→Report 路径不在 write session 内直接分析刚发布的事实。
它先关闭 writer，再开 fresh snapshot，避免延长 exclusive writer lock，也避免把 draft 混进分析分母。

## 两种 cache 不合并

| 名称 | 回答什么 | 是否公开 | owner |
|---|---|---|---|
| verified-read cache | exact envelope、payload bytes 与完整 blob closure 是否已经验证 | 否；hit、miss、大小与 eviction 不可观察 | Record runtime |
| reuse planning | 当前 ExecutionTarget 的某个 Slot 是否可采用历史 Attempt | 是；形成 `ExecutionReusePlan` | Experiment domain |

verified-read cache 不能缓存 Run enumeration、path 到 current content 的映射、owner handle、read state、draft、lease 或
migration 中间态。reuse planning 不能直接访问该 cache，也不能把 cache hit 当作事实可采用的理由。

## 中立写入核

```text
Assertions adapter ── package-private ctx.recordEffect ─┐
File Diff adapter ─── package-private ctx.recordEffect ──┤
third-party author ── public ctx.record ─────────────────┘
                                                        │
                                                        ▼
      admission → reservation → snapshot → closure → poison-on-failure → sink → publication
```

中立性只承诺机械路径相同，不承诺 schema、owner、领域 adapter 或 authority 相同。

| 维度 | Evidence / Assertions | File Diff | 第三方事实 |
|---|---|---|---|
| durable family | `niceeval.assertions`；Evidence 是 entry material | `niceeval.diff` | reverse-domain `com.example.*` |
| owner | Attempt | Attempt | definition 声明的 Attempt 或 Run |
| domain adapter | Assertions package | Sandbox / Evaluation adapter | 第三方 package |
| writable definition | package-private official definition | package-private official definition | public opaque definition |
| facade | `ctx.recordEffect()` | `ctx.recordEffect()` | `ctx.record()` |
| command kernel | 同一套 | 同一套 | 同一套 |

official definition 仍是私有的。第三方不能使用 `niceeval.*` namespace，也不能把 official reader 当成 writable
definition。中立写入核不会消除事实权威。

## Analysis 是一层，内部有四步

| 步骤 | 责任 | 输入 → 输出 | 不负责 |
|---|---|---|---|
| Selection | 固定 Run、logical slots 与 Sample-wide denominator | frozen view → `AnalysisSampleHandle` | package decode、reuse planning |
| Projection | 解释一个明确 owner 的一个 Attachment family | live handle + `RecordProjection` → closed `ProjectedSample` | 跨 package join、聚合 |
| Relations | 用 durable anchors 对齐多份 closed projections | SameSample projections → exhaustive relation cells | heuristic agreement、metric |
| Derivation | 计算带明确口径的业务值 | closed projection / relation values → ordinary closed values | Record I/O、页面呈现 |

这四步共享一份 Sample identity。Projection 不重新开 snapshot；Relations 拒绝来自不同 Sample 的输入。Derivation
若返回统计读数，其普通结果类型必须保留 observed、denominator、state、issues 与 refs。

PLAN-1 让领域 package 自己解释 relation edge 与 cardinality。host 只验证输入同源、population 对齐与输出穷尽；
领域 package 必须保留 unmatched、ambiguous 与 input state。

## Report 只静态约束自己的读取

Report definition 用 `reportInputs()` 列出自身需要的有限 projections。Report host 在 callback 前执行它们，并形成
host-owned problem inventory。Page、Calculation 的输入阶段之后及 renderer 都只消费 closed values。

这不是 Projection PLAN-2。普通 Analysis 脚本仍能根据已经读取的值决定下一次 direct call；Report callback 内没有
这种逃生口，因此 Report 自己仍能提供一次 execution、输入去重与不可关闭 problems surface。

Calculation 在文件组织上属于 Report definition，在语义上属于 Analysis 的 Derivation seam。它调用普通纯函数并
返回普通 closed value；Page 只决定怎样呈现该值和 `ReportCalculationResult` 的状态。

## 不变量

1. 一个 Analysis execution 的 selection 与所有 Projection 使用同一 snapshot generation。
2. `RecordWriteSession.view` 只服务 reuse planning；新发布的 Run 只在 write session 关闭后的 fresh snapshot 可见。
3. producer 只能提交 exact write grant 中的 definition，并且只能写当前 owner。
4. 一个 Attachment 的 blob ref 只能指向自己的 closure；Assertions evidence 不能借用 Diff 的 blob/path/ref。
5. Report author callback 不能取得 reader、root runtime、maintenance facet 或 writable definition。
6. host-owned read states、migration problems 与 execution problems 不能被页面过滤掉。
7. Relation output 少一个 population cell 是 typed output error，不是较小分母。
8. Report render 不重新采证、不迁移 Record，也不把 Report result 写成第二份 Record。
