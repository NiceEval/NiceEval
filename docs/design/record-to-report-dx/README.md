# 从 Record 到 Report 的端到端 DX

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) ·
[EVALUATION](EVALUATION.md) ·
[PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md)
· [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md)

当前 Record Core 已经落地。它保存 immutable Runs、精确 Attempt 引用、owner 与通用 owner-local
Attachment closure；这些公理不在候选范围。PLAN-1～4 不修改现有 Attachment bytes，PLAN-5 单独挑战未来
官方 package inventory/schema，因此若胜出也不等于 Record major。

需要重新比较的是它上面的整条作者路径：怎样打开 frozen Record、选择 Runs、建立 logical
slots、读取 Attachments、计算指标，并形成终端、网页和静态报告。只改 Report 最后一层会把前面
几层的 ceremony 原样传给作者，因此每个候选都必须给出完整端到端 API。

## 作者 API 候选

| 候选 | 主要心智 | 最突出的 DX |
|---|---|---|
| [PLAN-1](PLAN-1/README.md) | Consumer-local opaque query graph | 每个 consumer 声明 `data`，宿主静态闭合、去重与隔离 |
| [PLAN-2](PLAN-2/README.md) | Scoped loader + ordinary TypeScript | 一个 loader 直接 `await` 分析数据，再返回普通 report model |
| [PLAN-3](PLAN-3/README.md) | Typed semantic relations | 用 fields、dimensions、measures 与 relations 描述查询和聚合 |

三套作者 API 候选共享 Record bytes 与最终 `ReportExecution` 交付目标，但不共享上层公开对象。这里
不把任何一套标成推荐，也不建立 `DECISION.md`；选择前先用 [Evaluation](EVALUATION.md) 对照可裁决
场景与候选代价。

## 横切拓扑轴

[PLAN-4](PLAN-4/README.md) 不是能独立替代前三套 API 的第四个候选。它裁决宿主责任应为三层还是
四层，并明确区分架构责任与作者可见的 convenience API。实际选择空间是“PLAN-1/2/3 作者语法 ×
3/4 层 runtime topology”。

| 作者 API | 可成立的责任拓扑 | 原因 |
|---|---|---|
| PLAN-1 | 四层 | opaque DAG 本身就是 managed Derivation |
| PLAN-2 | 三层 | 派生是 loader 内普通函数，host 看不见其依赖 |
| PLAN-3 | 四层 | semantic Query 由 planner 调度，base Relation 留在 Analysis |

这不是完整笛卡尔积。若把 PLAN-1 改成三层或把 PLAN-2 改成四层，其作者契约也会变化，必须另写 API
变体，不能只替换架构标签。

## 每层怎样重做

| 作者层 | PLAN-1 | PLAN-2 | PLAN-3 |
|---|---|---|---|
| Record open | `openRecord()` 返回 scope-bound capability | `withRecord()` / `runReport()` 管理 callback scope | `openAnalysis()` 直接形成 semantic database |
| Run selection | `selectRuns(record, selection)` | `runReport({ selection })` 由 host 完成 | `openAnalysis({ selection })` 同时完成 |
| Attachment access | finite grain `ReportQuery` constructors | `AnalysisSession` 上立即执行的 async reads | Relation + typed Field logical plan |
| Derivation | `derive()` 形成 opaque query | loader 内普通 TypeScript 函数 | Dimension + Measure + relational operators |
| Report composition | consumer-local `data` | 一个 loader model + pure consumers | Query 直接进入 dashboard 或 consumer `data` |

[PLAN-4](PLAN-4/README.md) 的当前映射是：PLAN-2 的纯函数派生采用三层；PLAN-1 的受管派生采用
四层；PLAN-3 把 base relations 留在 Analysis，把 semantic Query 交给受管 Derivation，因此也采用
四层。顶层 `runReport()` 可以隐藏 Record 或 Analysis 对象，但不会减少宿主内部责任层数。

因此区别不是同一 API 换名字：PLAN-1 让宿主看到静态 query DAG，PLAN-2 让作者拥有普通控制流，
PLAN-3 则把查询和统计语义提升成公开 relational language。

## Physical package 轴

[PLAN-5](PLAN-5/README.md) 挑战前三套 API 共同假设的 Attachment 粒度。当前 Observability Feature
按 conversation、commands、usage、timing 与 diagnostics 等逻辑消费面拆 durable families。

PLAN-5 改为按 producer、owner 与 atomic seal 保存 physical fact packages。Projection 解释单包，
Relations 建立跨包关系。

这条轴与 PLAN-4 正交。若采用它，完整责任链是：

```text
Record → Sample → Projection → Relations → [Derivation] → Report
```

Sample 先从 Core 选择 population，Projection 才知道应读取哪些 package owner。作者 API 可以隐藏
Projection 与 Relations，但 Record 的物理包不能因某个 Page 想单独查询 usage 而提前变成 Report table。
PLAN-5 不改变 Record Core 或通用 Attachment closure；它会改变官方 Attachment inventory 与上层
projectors，因此尚未成为 Feature 契约。
