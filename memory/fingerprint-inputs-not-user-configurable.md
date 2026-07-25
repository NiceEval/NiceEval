# 裁决:指纹构成不开放给用户配置,轮换坐标的家是 facts

**裁决**(2026-07-25)。缓存指纹的输入是框架不变量,`ExperimentDef` 上**不提供**任何逐键豁免声明。
值该不该参与可比性,由它落在哪个字段决定,判据是机械的:**你写下的 → 配置(`flags` 整袋进指纹 /
`labels` 不进);跑起来才有的 → `ctx.fact()`**(结构上进不了指纹——携带决策发生在任何 `setup`
之前)。隧道 URL、实例地址这类轮换坐标因此报成 attempt 作用域 fact,换多少次都不作废结果。

**曾选方案:`ExperimentDef.provenanceFlags: string[]`**(键名 deny-list,指纹按抹掉这些键之后的
flags 算,配套对历史落盘做反事实重算 `acceptableFingerprints` 救回声明前的结果)。已落地又整体
撤销。

**否决理由。**

1. **答错的代价不对称且不可见。** 漏声明只是多花钱重跑(吵、看得见);**多**声明——把真改变行为的
   键点名——是静默跨条件携带,报告全绿。文档当时不得不专门警告「`nowledgeVersion` 别点名」,等于
   把框架该守的线交回给用户,还附上了拆掉它的说明书。
2. **它在自己服务的那批结果上撒谎。** `flags` 是**快照级**的、记本轮的值;携带条目产自上一轮却挂进
   本轮快照。MemoryBench 那次 32/36 携带 = 32 条结果在报告里被归到一个它们从没连过的 endpoint 上。
   一个叫 provenance 的字段记录了错的 provenance:出处是 per-attempt 运行时事实,声明是
   per-experiment 静态配置,层级根本对不上。
3. **通道早就有,只是缺落盘。** `docs/feature/experiments/architecture.md` 一直写着「setup 产出的
   运行时值经模块闭包流动……是运行时基础设施坐标,不是实验条件」。用户违反它,是因为闭包里的值**不落盘**——
   想让「这轮连的是哪个实例」进记录,只能把它伪装成实验条件。补 `ctx.fact()` 这条记录通道即可,
   不必动指纹。

**同批删掉的机械。** `fingerprintFlags` / `acceptableFingerprints` 反事实重算(~120 行)、
`loadCarryInputs` 为凑候选 flags 做的全历史快照扫描;携带判定回到「指纹相等」。commit
`e924fd4a` 里唯一保留的是「携带条目合入新快照时重打指纹」——它此时退化成恒等式,正好落成不变量
「快照里每个条目的 fingerprint 都等于本快照配置算出的指纹」。

**保留的一个出口(只在 CLI)。** `--carry-ignoring-flag <key>`:把误写进 `flags` 的坐标搬进 fact
的**那一次**调用用,携带按抹掉该键后的 flags 认账,搬迁不赔一轮重烧,并落一条 `carry-ignoring-flag`
快照 diagnostic。原则:**收紧缓存可以是持久声明,放宽缓存必须一次性且留痕**——放宽是当场的人为决定,
不能写进实验文件此后永远悄悄生效。

**配套要补的能力**(与裁决同批定稿在 docs):报告侧 `fact()` / `numericFact()` 选轴(读
`AttemptRecord.facts`,携带条目带产出它那轮的值,分组不张冠李戴);plan 阶段的 miss 诊断(指出差异
落在 `flags` 的哪个键,并指路 fact)——声明形态可以朴素,前提是走错路当场可见。

相关:[rotating-flag-value-invalidates-whole-cache](rotating-flag-value-invalidates-whole-cache.md)
(起因的现场与实测数据)。
