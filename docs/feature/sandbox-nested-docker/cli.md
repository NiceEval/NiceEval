# Nested Docker —— CLI

nested Docker 的公开诊断入口是 `niceeval sandbox provider doctor incus`。
它默认检查 reference domain，不把 development 绿灯当成 reference 通过。
doctor 只读，不 create、不 destroy allocation。

## `doctor incus`

公开语法：

```bash
niceeval sandbox provider doctor incus [--development]
```

```bash
niceeval sandbox provider doctor incus
niceeval sandbox provider doctor incus --development
```

Doctor 同时报告 runtime allocation 与 prepared artifact 两种容量；artifact `0 free`
必须使整体结果为 `FAIL`，即使已有 warm artifact 仍可命中。

Doctor 的 artifact 容量分成两项，任何一项不足都使整体 `FAIL`：

- `artifact-capacity`：非 released intent 数相对 `artifactMaxInstances` 的余量；
- `artifact-storage`：artifact pool 当前空闲字节相对 `artifactStorageReserveBytes` 与一份新副本的
  估算字节（见 [Lifecycle · 字节容量准入](architecture/lifecycle.md#字节容量准入)）。读不到 pool 字节时显示 `unknown` 并
  `FAIL`，不把数量余量当成空间余量。

`artifact-inventory` 逐项核对 committed intent 与 Provider 对象，而不是只比较数量。intent 存在但
virtual-machine type instance 或 custom storage volume 缺失时报告 `dangling`，并给出
`sandbox provider gc incus` 作为下一步；对象存在但无 committed intent 时报告 `orphan`。只有一一对应时才
`PASS`，PASS 的保证范围写在输出里：`N committed intents, N verified object pairs`。

自动回收的范围只有已被同一 replacement scope 的新 generation 取代、consumer hold 已归零且 provider 对象双向
metadata 仍精确匹配的 artifact。内容变化产生新 lineage，不会让旧 lineage 被自动替代；其余回收全部走下面的
显式两阶段 GC，不做后台删除。

provider 对象使用 Incus 官方命名：virtual-machine type instance 与 custom storage volume。
replacement head、consumer hold 与 absence receipt 由 NiceEval repository 拥有。

若满容量时全部 artifact 都是当前 head 或仍被引用，doctor 与 reservation 明确报告有效
working set 容量不足，绝不按年龄删除仍有效缓存。

默认只读检查 reference：execution domain、dedicated block-backed attested capacity、trusted image 与 inventory。
它不执行 cleanup，也不操作 Eval allocation。

`--development` 是另一条命令面，只检查 development domain 与 `storagePool` `niceeval-sandbox-dev`。
两条命令各自给出自己的通过或失败。
development 通过不能遮住 reference 失败；reference 通过也不暗示 development 可用。
`--development` 通过也不把容量写成 attested，或把结果标成 reference comparable。

doctor 发现损坏时只登记 exact quarantine 建议。
只有 reconciler 能根据 durable ownership 执行 destroy。
doctor 自身不通过顺手 cleanup 改变被诊断现场。

## `inventory incus` 与 `gc incus`

prepared artifact 的公开维护入口与 doctor 同在 `sandbox provider` 下，按 domain 分开：

```bash
niceeval sandbox provider inventory incus [--development] [--json]
niceeval sandbox provider gc incus [--development] [--unused-for <duration>] [--json]
niceeval sandbox provider gc incus [--development] --apply <plan-id> [--json]
```

两条命令都不加载项目 config、Eval 或 Experiment，只读 descriptor、Incus repository 与 Provider inventory。
用户不需要、也不应该直接 `incus delete` 托管实例；手删之后的悬空 intent 也由 `gc incus` 收回。

### inventory

只读列出该 domain 的每份 prepared artifact。每项显示短 artifact digest、execution domain revision、state、
generation、是否当前 head 与 consumer hold 数。每项另显示创建时间、最后成功 hold 时间、估算字节与对象核对结果
（`verified` / `dangling` / `metadata-drift`）。另列 orphan 对象与 pool 字节摘要。

JSON 使用
[Docker cache inventory](../../roadmap/sandbox-cache-lifecycle/cli.md#domain-库存) 的同一
库存形状，`backendKind: "incus-artifacts"`；即时输出不带版本 envelope。估算字节标 `estimate`，不能相加的数字标
`not additive`。

### 两阶段 GC

`gc incus` 不带 `--apply` 只生成预览，并把 immutable GcPlan 持久化到 Incus repository；`--apply <plan-id>`
只执行该 plan 列出的候选，只会因事实漂移缩减集合，不重新规划。plan 形状、15 分钟有效期、整单拒绝条件、
outcome 文档和退出码全部沿用 [Docker 两阶段回收](../../roadmap/sandbox-cache-lifecycle/cli.md#两阶段回收)，
这里只定义 Incus 的候选规则：

| ruleId | 条件 | 是否需要 flag |
| --- | --- | --- |
| `dangling-intent` | intent 非 released，但 instance 与 volume 都已确认 absent | 否 |
| `superseded-domain-revision` | intent 属于同一 repository 的旧 execution domain revision，当前 lookup 不可能再命中 | 否 |
| `superseded-generation` | 已被同 lineage 新 head 取代，但自动回收被中断 | 否 |
| `unused` | 当前 domain revision 的 committed artifact，最后成功 hold 早于 `--unused-for`；从未被 hold 的按创建时间 | `--unused-for` |

所有规则都要求 hold 为零。`unused` 允许回收仍是 head 的 artifact：这是用户以显式时长换空间的决定，
下次运行只会 miss 并重新 prepare，不影响正确性。没有 `--unused-for` 时不产生 `unused` 候选，NiceEval 不替
用户猜 LRU 阈值。

已按某一 plan invalidated 的中断 retirement 可以由新 preview 沿用原 rule 和保护时点
继续，不属于重新选择 committed `unused` 候选，也不要求再次指定时长。新 plan 仍有自己的 15 分钟有效期，
并重新核对 hold、generation 与所有现存对象的 metadata；原 plan 过期或已有失败 outcome 不阻断接管。
orphan、`metadata-drift` 和 quarantine 对象只在 inventory 中展示，永远不是候选。

apply 对每个候选重新核对 intent state、generation、hold 与双向 metadata，然后走既有状态机：
`committed → invalid → retiring`，两类对象分别落 absence receipt 后写 `released`。`dangling-intent` 不调用
delete，直接以已确认的 absence receipt 走同一条 `retiring → released`，不绕过 fenced 状态机。
preview 摘要给出估算可回收字节；apply 结束后重新读取 pool 字节并输出前后对比。

## 默认 reference

未带 `--development` 时，doctor 只接受 dedicated block-backed、可 attestation 的 reference capacity。
loop-backed pool、目录伪装、共享可写 Docker data 都失败。
pathname 或 `findmnt` 文本单独不构成通过。

`--development` 只证明本机开发例外存在。
它不是 reference，也不能让未写 `acceptDevelopmentDomain: true` 的 Experiment 过 planning。

## `--dry` 与 identity

```bash
niceeval exp <experiment> --dry
```

`--dry` 显示 exact Docker requirement、Incus capability receipt、execution domain 与
`acceptDevelopmentDomain`。
省略该字段时输出按默认 `false` 呈现，并与显式 `false` 使用同一 identity。
写出 `true` 时，dry run 必须显示 `capacity._tag === "Unattested"`，并把 development domain 标成 non-comparable。

`--dry` 不调用模型，不创建 Eval allocation。
requirement 与 capability 不匹配时，在 fingerprint 前以 `sandbox-capability-unsatisfied` 失败。

## 不提供的命令

nested Docker V1 不提供：

- `niceeval docker profile list|doctor|exec` 作为 adopted nested-Docker 诊断；
- 用 development doctor 替代 reference doctor；
- doctor 的 create / destroy allocation；
- 跳过 hold、metadata 或 orphan 门的 `gc incus --force`；
- 后台或运行中自动按年龄删除有效 artifact；
- `--keep-sandbox` 与 `incusSandbox()` 的组合；
- 让 CLI 在宿主上 mount、loop、nft、sudo、build、import 或 pull image。

`niceeval docker profile *` 不属于支持目标；迁移方式见[从 Docker Profile 迁移](README.md#docker-profile-migration)。
