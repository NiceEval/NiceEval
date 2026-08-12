# Record → Report 设计地图

这是一张跨决策地图，不是 Design Decision。它没有自己的 PLAN，因为组合关系本身没有额外的互斥选择。
各层只有在存在独立目标、稳定 seam 与真实互斥方案时才单独开题。

已经定稿的组合契约见 [Record → Analysis → Report Roadmap](../roadmap/record-analysis-report/README.md)。产品对外只用
三层心智；本页继续展开 Analysis 内部 seam，方便定位各项 Design Decision。

## 对外三层心智

```text
Record ──► Analysis ──► Report
事实       解释事实       呈现解释结果
```

Sample、Projection、Relations 与 Derivation 都在 Analysis 内。它们拥有不同 correctness seam，但不是要求普通
用户先记住的四层产品模型。

## 依赖方向

```text
Record storage ─→ Record access runtime / FrozenRecordView ─┬─→ reuse planning → ExecutionReusePlan
                                                            │
Record Core ── selection ──→ Sample（固定 population）──────┤
      │                                                     │
      └─ RecordAttachment + layout ─→ package access ───────┤
                                                            ▼
Projection API（在 live handle 上读取并单包解释）
  ↓ closed Sample-aligned local views
Relations API（跨包结构关系决策）
  ↓ closed exhaustive relation values
Derivation（普通纯函数基线）
  ↓ metric / coverage / evidence values
Report authoring（已裁决：static page + ordinary values）
```

Sample 与 package access 是在 Projection 汇合的两条输入。Sample 决定 population，物理 layout 决定怎样
读取 owner package；任何一支都不能独自形成 Report rows。

Reuse planning 与 Report 是两个消费目的，不是两套 Record。它们共用 `FrozenRecordView` 的 Core、Attachment
decoder 与 projector；前者形成当前 target 的 reuse/gap，后者形成历史 Sample 与 closed projections。
[Record access runtime](record-runtime/DECISION.md) 已为 Roadmap 选择统一 root runtime、generation 与 verified
cache 生命周期。

## 各层为什么这样落文档

| 层 | 文档形态 | 理由 |
|---|---|---|
| Record Core | [Feature](../feature/record/README.md) | portable Core、owner 与读取公理已经固定 |
| Record access runtime | [Design Decision](record-runtime/DECISION.md) | 已为 Roadmap 采纳 PLAN-2，统一 root authority、generations 与 verified cache |
| Observability layout | [Design Decision](observability-package-layout/README.md) | 七 family 与 physical packages 是互斥持久布局 |
| Sample | [Feature](../feature/sample/README.md) | selection、四态与 frozen denominator 已固定；fluent/callback 只是语法 |
| Projection | [Design Decision](projection-api/DECISION.md) | 已为 Roadmap 采纳 PLAN-1 direct call；Report 只静态闭合自己的 manifest |
| Relations | [Design Decision](relations-api/DECISION.md) | 已为 Roadmap 采纳 PLAN-1 pure assembler，并保留穷尽 population |
| Derivation | 已采用普通函数形态 | managed graph 会重开失败隔离与共享执行契约，不能为目录对称擅自新增 |
| Report | [既有 Decision](report-authoring/DECISION.md) | 已采纳 static page + ordinary values，不建立第二门查询语言 |

## 合法组合

定稿组合是 Record runtime PLAN-2 × Projection PLAN-1 × Relations PLAN-1 × ordinary Derivation × Report
PLAN-5。下表继续说明候选之间的结构约束，不把未采用组合写成产品契约。

| 上下层组合 | 是否合法 | 原因 |
|---|---|---|
| 任一 layout × 任一 Projection PLAN | 合法 | `LayoutState` 参数隔离候选专属读取状态 |
| 任一 Projection PLAN × 任一 Relations PLAN | 合法 | Relations 只消费 closed local views |
| Relations × ordinary Derivation × report PLAN-5 | 合法 | Report 只消费普通结果值 |
| managed Derivation × 当前 report PLAN-5 | 非法 | 它新增 host dependency、去重与局部失败语义，必须重开 report-authoring |
| lazy Relations query × 当前任一 Relations PLAN | 非法 | lazy filter/group/Measure 已越过结构关系进入 Derivation |
| Report 直接读取 Record/package | 非法 | 绕过 Sample denominator、Projection 状态与官方无特权边界 |

## Attempt detail 的 owner routing

1. Sample 用 Core 选择 logical slots，并查找 exact Attempt 与 origin Run。
2. Projection 按公开 `RecordProjection` declaration 读取 Assertions、Verdict、Score、Sources、OTel 等 owner package。
3. Relations 用 durable anchors 对齐 send、operation、assertion 与 source site；没有 anchor 就保留 unmatched。
4. 普通 Derivation 形成 `AttemptDetailsInput`、coverage 与 evidence values。
5. 参数化 Page 的 render 取得这些 ordinary closed values；官方 standard page 不使用私有 reader 或 legacy evidence。

## 旧复合设计迁移索引

| 原 record-to-report-dx 内容 | 新归属 |
|---|---|
| PLAN-1 static closure | Projection PLAN-2；derive 与 consumer-local failure 属于 managed Derivation |
| PLAN-2 dynamic reads / pure joins | Projection PLAN-1 / Relations PLAN-1；loader 边界链接 report-authoring PLAN-5 |
| PLAN-3 structural relations | Relations PLAN-2；filter、group、Measure 与 planner isolation 会重开 Derivation |
| PLAN-4 三层或四层 | report-authoring 的历史理由；runtime 层数由真实 guarantee 决定 |
| PLAN-5 inventory / lifecycle | observability-package-layout PLAN-2 |
| PLAN-5 static projection graph | projection-api PLAN-2 |
| PLAN-5 relation builder | relations-api PLAN-2 |
| 原 C1～C14 | C1/C5 → Sample；C2/C6/C9/C10 → Projection；C13 → Relations；C3/C4/C7/C8/C12 → report-authoring；C11/C14 → layout 与 reader limits |
