# Record → Analysis → Report

NiceEval 的运行、读取与报告需要共享同一份持久事实，但不应要求使用者先理解锁、generation、
Projection graph、关系 runtime 与页面 loader。写入、读取和 migration 如果各自打开 Record，也会产生三套
root identity、缓存与生命周期语义。

本方向把产品心智收成三层，并让它们共用一套 `niceeval/record` 子系统与实现内核。这里的“一套”不是一个
万能 client；host、producer、Analysis 和 Report 仍只拿与职责相符的最小 capability。

具体形态是：写入、snapshot 读取与 maintenance migration 有三个分权调用面，但不各自实现 Record。它们在同一个
root runtime、validators、lock authority 与 durable kernel 上会合。

## 核心心智

```text
Record                    Analysis                         Report
发生了什么                 这些事实说明什么                  怎样让人看懂

写入并冻结事实      →      选范围、解释、关联、计算     →     页面、终端与静态站
```

| 层 | 输入 | 输出 | 它屏蔽什么 | 它必须保留什么 |
|---|---|---|---|---|
| Record | producer 形成的领域事实，或一个 canonical Record root | immutable Run、Attempt、RecordAttachment 与 frozen view | path、portable layout、锁、generation、blob closure、verified-read cache 与 durable commit | owner、schema identity、完整读取状态、migration 要求与事实出处 |
| Analysis | 同一 frozen view 上的已发布事实 | Sample-aligned projection、穷尽关系、metric、coverage 与 evidence value | owner lookup、decode、reader 生命周期与跨 package 的机械对齐 | Sample 分母、slot 状态、Attachment 六态、unmatched、ambiguous、coverage 与 refs |
| Report | closed projected / derived values | terminal、web 与 static export 共用的闭合语义树 | Record I/O、迁移、重新采证与双面 renderer 细节 | host-owned problems、数值口径、coverage 与下钻引用 |

Sample、Projection、Relations 与 Derivation 是 Analysis 内部的四个步骤，不是四层产品心智。用户只需先问：
事实是否已经进入 Record、Analysis 怎样解释它、Report 怎样呈现解释结果。

## 一套 Record 子系统，三种 host capability

一个 canonical root 只打开一个 `RecordAccessRuntime`。runtime 统一 root identity、lock authority、snapshot
generation allocator、runtime registry、校验器与不可观察的 verified-read cache，再 mint 三种 nominal facet：

| Facet | 能做什么 | 谁持有 |
|---|---|---|
| `RecordSnapshotSource` | 在 child Scope 内取得一个 frozen snapshot | Analysis / Report host |
| `RecordInvocationAccess` | snapshot 能力，加上 `withWriteSession()` | Invocation coordination |
| `RecordMaintenanceAccess` | inspect、clean、plan migration 与 migrate | maintenance CLI / host |

Invocation 再从 write session 派生 Attempt 或 Run owner-local context。第三方 `ctx.record()` 与内建
`ctx.recordEffect()` 只在同一个 RecordAttachment command kernel 汇合；producer 从不拿 root runtime。

## 选定的 Design PLAN

| 决策 | 采用 | 本方向取得的保证 |
|---|---|---|
| [Record access runtime](../../design/record-runtime/DECISION.md) | [PLAN-2](../../design/record-runtime/PLAN-2/README.md) | 同一 root 的资源 owner、facets、generation 与 verified-read cache 统一 |
| [Projection API](../../design/projection-api/DECISION.md) | [PLAN-1](../../design/projection-api/PLAN-1/README.md) | 普通 TypeScript / Effect direct call；一个调用返回一个 closed `ProjectedSample` |
| [Relations API](../../design/relations-api/DECISION.md) | [PLAN-1](../../design/relations-api/PLAN-1/README.md) | package-owned pure assembler；host 只守同一 Sample 与穷尽 population |
| [Report authoring](../../design/report-authoring/DECISION.md) | [PLAN-5](../../design/report-authoring/PLAN-5/README.md) | static page、普通函数、普通结果值与按显示形状命名的组件 |

Report 的 `reportInputs()` 是这个 consumer 自己的有限输入清单。它不把 Projection 升级成静态 graph：没有公共
node、edge、`dependsOn`、graph brand、全图调度或任意 Analysis 程序的闭包保证。

[Observability package layout](../../design/observability-package-layout/README.md) 不由本方向裁决。物理 family
布局与三层心智、root runtime 和中立写入核彼此正交。

## 范围

本方向包含：

- 一个 root runtime 下的 snapshot、invocation 与 maintenance capability；
- 从 write session 关闭到 fresh Analysis snapshot 的固定时序；
- Analysis 内 selection、Projection、Relations 与 Derivation 的责任边界；
- Report 专属静态 input manifest 与 closed author callback；
- Assertions evidence、File Diff、Assertions 与第三方事实共用写入核的完整用例；
- verified-read cache、ExecutionReusePlan 与 migration 的分权。

本方向不重新定义 [`RecordAttachment` 作者 API](../record-attachment-authoring/README.md)，也不决定某个领域应有
几个 Attachment family。它不增加通用 Evidence Attachment、Evaluation migration group、managed Derivation
graph 或第二套 Report 查询语言。

## 入口

- [Library](library.md) —— runtime facets、Projection direct call、Relations 与 Report handoff。
- [Architecture](architecture.md) —— 每层责任、共享内核、能力边界与中立性不变量。
- [Lifecycle](lifecycle.md) —— Invocation 写入、fresh snapshot、Analysis、Report 与显式 migration 时序。
- [Use Case](use-case/README.md) —— Assertions evidence、File Diff、Assertions 与第三方事实怎样进入同一 Record。
