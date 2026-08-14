# Record（事实持久化层）

Record（事实持久化层）保存一次运行已经发生、已经封口且可供离线复核的事实。它不解释统计口径，
不组织页面，也不决定用户从哪里查看结果。

三层固定为 Record（事实持久化层）→ Analysis（分析层）→ Report（报告层）。
Record 只回答“发生了什么”。Analysis 决定怎样解释，Report 决定怎样组织并呈现到终端、网页或静态站。

```text
普通作者、Adapter、领域 SDK
            │ 受限采集
            ▼
Record（事实记录层）──当前 sealed Record──▶ Analysis（分析层）
```

`sealed Record`（已封口的 Record）是唯一可供上层读取的事实集。运行中的写入、未完成目录、
缓存和本地锁不属于它。Analysis 与 Report 既不观察半写入状态，也不把临时数据当成事实。

## 心智模型

Record 以完整 Run（已完成运行）为发布单位。Run 拥有本次实际执行的 Attempt（一次独立执行），
并在全部事实通过验证后原子封口。封口后的 Run 不可修改；需要表达新的事实时，写入新的 Run。

Record 不增加一个面向作者的平级层。普通作者只使用 Assertion-first（断言优先） API：在观察到结果时
直接登记 Assertion（断言）。Assertion runtime（断言运行时）把已完成的 AssertionResult（断言结果）
交给受限采集面，作者不会获得 writer、文件路径、模式身份或迁移能力。

每一份 RecordAttachment（Record 附件）都挂在一个精确的 Run 或 Attempt owner（归属者）下。附件带有
SchemaId（模式身份），它冻结 payload 的 shape（形状）、owner 与语义。相同名字但不同语义必须使用新的
SchemaId，不能让 reader 用同一身份猜测两种解释。

host（宿主）在 seal（封口）前同时绑定 owner、definition（定义）、producer（生产者）与 cardinality（基数）。
它验证每个声明的采集义务恰好完成一次、所有引用闭合且同属本次运行。任何一项不成立时，Run 不会发布。

## Record Model 与 Record Host SDK

Record Model（Record 数据模型）定义什么能成为已封口事实。`niceeval/record/host` 导出的 Record Host SDK（Record 宿主开发工具包）让 Application Host 安全地打开、写入与维护这些事实。

| 内部边界 | 拥有的对象与规则 | 不拥有的职责 |
|---|---|---|
| Record Model | SchemaId、identity（身份）、已封口事实、RecordAttachment、Artifact 与它们的引用闭包 | 锁、恢复流程、缓存和 Analysis 计算 |
| Record Host SDK | snapshot（冻结快照）、write（写入）、capture（采集）、maintenance（维护） | 新的产品层、普通作者 API、Analysis 的执行缓存 |
| SDK 内部实现 | 锁、迁移 staging（暂存区）、恢复与 verified cache（已验证缓存） | 对外 API 或跨层状态容器 |

Record Host SDK 服务于事实持久化层，不构成第四层。Application Host 是唯一能够取得其 facet 的对象。
普通应用、CLI、Adapter 和 Report callback 都不会获得写入 capability，也不会获得 `ProgramStateSDK`、`LockSDK` 或 `niceeval/lock`。

SDK 的三个 facet（分权能力面）由 Scope（资源作用域）拥有：

| facet | 自动取得的内部资源 | 返回的能力 |
|---|---|---|
| `snapshot()` | shared maintenance lock（共享维护锁） | 当前 sealed Record 的冻结快照 |
| `write()` / `capture()` | shared maintenance lock 与 exclusive writer lock（独占写入锁） | Run draft、Attempt Capture 与原子封口 |
| `maintenance()` | exclusive maintenance lock（独占维护锁） | 格式检查、迁移、恢复与维护 receipt |

调用者从不直接 acquire（取得）或 release（释放）锁。Scope finalizer（作用域收尾器）在能力关闭时释放资源；
普通读取和写入因此不需要也不能协调锁的生命周期。

verified Record cache 由 SDK 内部实现管理。它只保存已按精确内容身份验证的 Core、附件与 Artifact bytes，
不保存 live writer、Capture、锁或 migration authority（迁移授权）。Analysis execution cache 属于 Analysis，
不进入 Record Host SDK。

## 数据 family（数据族）

数据 family（数据族）各自拥有明确的 owner、SchemaId 与封口规则。它们共享 Record 的原子发布、
快照读取和显式迁移机制，却不共享任意可扩张的持久化形状。

| 数据族 | owner | 保存的事实 | 进入方式 |
|---|---|---|---|
| Assertions | Attempt | AssertionResult、subject snapshot（对象快照）、Evidence（证据）与完整度 | Assertion runtime 的受限 Capture（采集能力） |
| Observability | Attempt 或 Run | OTel（OpenTelemetry 可观测性协议）时序、调用、用量与诊断 | 官方 Adapter（适配器）采集面 |
| Third-party capture | Attempt | Metric（数值事实）、Score（评分事实）或 Artifact（附属材料） | 领域 SDK（软件开发工具包）的已注册 token |
| File diff | Attempt | 文件身份、变更种类、字节计数、完整度与可选 patch | 官方文件差异采集面 |
| Artifact | Attempt 或 Run | 大文本、二进制、图片、表格及其它需保留的材料 | 内建数据族或已注册 Artifact token |

Evidence 与 Artifact 都由精确引用连接到所属附件。它们不会成为任意 JSON 袋，也不会让另一附件取得
本附件的存储路径或可写能力。

### Assertion-first

普通作者在 `t.check(value, match)`、scope 方法或 Judge recipe（裁判配方）处登记 Assertion。handle 只配置同一条
Assertion，例如 label、threshold 或 score contribution；它不会创建第二条持久化项目。

AssertionResult 保存当时的 subject、evaluator、evaluation、Evidence、限制与封口结果。它不保存 matcher 对象、
作者回调、未执行代码或当前工作目录。这样作者 API、Adapter 实现和 Analysis 算法可以分别演进，已封口事实仍保持原义。

### OTel、第三方数据与文件差异

OTel 由官方 Adapter 归一为受限 Observability 附件。Adapter 只能提交规范化的 span、事件、用量和诊断输入；
不能借此选择附件路径、注册 converter（转换器）或扩张持久化信封。

第三方只通过领域 SDK 声明 Metric、Score 或 Artifact definition，并在已注册 token 对应的 Attempt 中封口。
SDK 可以表达有限标签、固定 rubric（评分维度）、状态和 Evidence 引用。它不能声明任意持久化 JSON schema，
不能安装自定义 reader，也不能提供 converter。

`file diff`（文件差异）的 metadata（元数据）始终内联。一个小型、完整且为 UTF-8 的单文件 patch 可以内联其文本。
大型、二进制或多文件差异把材料写入 Artifact 的 blob（字节内容），metadata 保留精确引用。

`partial`（部分采集）表示采集范围或材料不完整，必须携带 limitation（限制原因）。`elided`（明确省略）表示内容按
保留规则未内联或未保存，同样必须给出原因、受影响文件和已知字节信息。两者不能被空 patch、零字节或不存在的附件掩盖。

## 当前格式与显式迁移

Record runtime（Record 运行时）只向上层提供 current Record（当前格式 Record）的冻结快照。它不会在普通读取时
执行历史 converter，也不会把旧格式组成类型联合交给 Analysis。

```text
旧格式 Record ── Application Host `maintenance.migrate()` ──▶ 当前 sealed Record ──▶ Analysis
```

已知旧格式返回 `migration-required`，并指向 Application Host 的 `maintenance.migrate(request, authorizationPort)`。它先形成计划并释放独占锁，经宿主授权后重新取得锁、检查计划未过期，再原子应用。不存在无损路径时返回
`migration-unavailable`，保留原始字节并明确说明不能形成当前形状。迁移中断返回
`migration-interrupted`；普通读取不会猜测、回滚或静默改盘。

新 Query、Measure、组件、页面和 renderer（渲染器）不推动 Record 升版。只有无法从既有事实恢复的持久语义、
附件形状或 Record 发布公理发生变化时，才定义新的 SchemaId 或相邻格式迁移。

## 入口

- [Library](library.md) —— Record Host SDK、Capture、状态与迁移错误。
- [Use Case](use-case/README.md) —— 一次 Attempt 如何成为当前 sealed Record。
