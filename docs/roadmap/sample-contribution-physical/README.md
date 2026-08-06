# 当前结果集贡献：物理结果优先于 selectedEvalIds

**审查状态（ChatGPT Pro，2026-08-05）：主案可定稿（breaking semantic），定稿前三条契约已收口。**  
`currentSample` 按可比 Run 上的物理 attempt 贡献；`selectedEvalIds` 降为规划/审计元数据；Reports/CLI 禁止二次 selected 过滤。

[Sample](../../feature/sample/README.md) 的 `currentSample` 回答「每道题当前可用的判定」。
一个 experiment 的结果集通常由**多次** `exp` / `accept` 落盘共同形成：全量跑、局部补跑、携带合入、指纹重锚。
本主题把读面贡献规则从「按 Run 的 `selectedEvalIds` 过滤」改为「可比 Run 上的物理 attempt 原样取新」，把 `selectedEvalIds` 降为规划与审计元数据。

Feature 里的现行契约仍以 [`selectedEvalIds` 过滤贡献](../../feature/record/architecture.md) 为准；本页是**拟定稿翻案**，迁入 Feature 前实现与单测仍以现行为准。

## 解决的问题

### 产品事实：结果集是多轮落盘的合成

合法路径包括：

| 轮次 | 典型动作 | 盘上形态 |
|---|---|---|
| R1 | 全量 `exp` | 36 题终态 |
| R2 | 只补 3 题 | 新 Run 物理 3 + 携带 33，或残缺最新 Run + 旧 Run 可拼 |
| R3 | 批量 `accept` | 新 snapshot 重锚多题 |
| R4 | 再只重跑 1 题 | 最新 Run 声明可能极窄 |

读者问的是「现在每题什么水平」，不是「最后一次 invocation 的 CLI 选择器返回了谁」。

### 现行契约的错位

现行读面（`currentSample` 与报告里同源的 `selectedEvalIdsOf` 投影）：

```text
对每个可比 Run（新 → 旧）:
  只收  eval ∈ selectedEvalIds  且  物理有 attempt  的题
```

`selectedEvalIds` 在 Record 上的名义是「这份快照**声明覆盖**的题集」（本次选择 ∪ 携带）。
读面再把它当作**贡献闸**：声明里没有的 eval，即使 `result.json` 在盘上也不进结果集。

后果：

1. **声明写窄 → 静默丢数**。写入面任一路把 `selectedEvalIds` 收成单题（例如批量 accept 误用 groupFirst 的 prepare 口径），view / 默认 show 塌成 1/36，而 `exp --dry`、`--stats`、`--history` 仍满——同一盘数据三套观感。
2. **正确写入时过滤几乎是恒等**。纪律正确时，凡写出的 result 的 eval 本应 ⊆ 声明；此时 `物理 ∩ 声明 ≈ 物理`。滤声明只在「声明 ⊂ 物理」时改变答案，而那正是写入 bug 或脏盘，用静默丢掉合法物理结果当防护，攻防比不对。
3. **与 Record「忠实磁盘」拧着**。事实层承诺返回值能指回字节；选择层用声明把已落盘终态藏起来，读者无法从「盘上有 result」推出「结果集里有数」。
4. **分母与贡献职责搅在一起**。缺口本该由 `knownEvalIds` / `coverage` 表达；用 selected 砍掉已有 attempt 是在用「规划元数据」做「删证据」。

### 触发复盘的现场形状

MemoryBench 一类仓库：批量 accept 或携带合入后，最新 Run 物理 36 条 `result.json`（含 `acceptedFrom` / `artifactBase`），`run.json` 的 `selectedEvalIds` 只有 1 个 id。
规划面 36 carried；默认首页 1 通过。根因分析见对话与写入侧修复（accept 封口扩成整组 selected）；本主题追问的是：**读面是否根本不该依赖那份声明做贡献过滤**。

## 核心心智

三层分工不变：Record 无判断，Sample 有口径，Reports 有呈现。
本主题只改 Sample 的**贡献集合**怎么从 Run 上取 attempt。

| 概念 | 归谁 | 职责 |
|---|---|---|
| 物理 attempt | Record | 某 Run 的 **合法 AttemptHandle / attempt registry** 上存在的终态（不是任意路径扫盘） |
| 可比性 | Sample | 仅 `configHash` 与基准相等的历史 Run 可参与拼接（现行缝合前提保留） |
| 现刻贡献 | Sample | 每个 experiment × eval：在可比 Run 上**按时间新→旧取第一条物理 attempt**，不看 `selectedEvalIds` |
| 覆盖分母 | Sample | 仍用 `knownEvalIds` 并集；缺物理结果的题进 `missingEvalIds` |
| `selectedEvalIds` | Record 元数据 | 记录「这次 invocation / 这份声明本意盖了谁」；供调试、dry、审计；**不决定**某条物理 result 是否进入结果集 |
| `fresh` | Sample | 仍排除携带与跨 Run 拼入；与 selected 无关 |

一句话：**结果集跟物理终态与可比性走；选择声明跟规划与审计走。**

## 拟定稿契约

### 贡献规则（替代现行 selected 过滤）

`currentSample`（及报告中凡「从 Sample.attempts 计票」的路径）：

1. 按 experiment 取可比 Run 序列（最新 configHash 为基准；缺失 configHash 的 Run 只与自己可比——现行前提保留）。
2. 每个 Run 对其 **attempt registry 中每一个**有 attempt 的 eval 均可贡献（不再查 `selectedEvalIds`）。
3. 同一 eval 只保留最先遇到的（即最新可比来源上的）attempt 集合。
4. `latestRunSample` 与 `currentSample` **同一贡献规则**：只收该 Run 上的物理 attempt，同样不按 selected 再滤一层。

第三方 harness 未写 `selectedEvalIds` 时，现行已退化为「实际 evals」；拟定稿下与本方 writer **同一规则**，退化分支消失。

### 条款 1：物理优先的来源等级

> Sample 只消费 Record 暴露的合法 `AttemptHandle` / attempt 注册表，**不**递归扫描磁盘上任意 `result.json`。  
> 「物理优先」指 **registry 上的物理 attempt 优先于声明字段**，不是 filesystem walk。

夹带脏文件的防线是 writer 校验与 registry，不是读面静默丢证据。

### 条款 2：声明 ⊂ 物理时发 warning 级 SampleIssue

落盘字段 `selectedEvalIds` 不删。写入面仍宜诚实：

- exp：本次选择 ∪ 携带合入的 eval id。
- accept：封口时本组全部接受的 eval（prepare 单题收窄只用于指纹，不污染快照声明）。

读面**不再**因声明缺 id 而丢弃物理 result。

| 情况 | 行为 |
|---|---|
| 物理有、声明无 | 贡献收物理；发 **warning** 级 SampleIssue（如 `selected-narrower-than-physical`），带 experimentId 与差集，避免写入漂移不可见 |
| 声明有、物理无 | 不贡献 attempt；若该题在 known 分母内则进 `missingEvalIds` |

Issue **不**升级为 error（结果仍可用）；不阻塞 show/view。

### 条款 3：禁止二次 selected 过滤

- 分母：`knownEvalIds` 并集，不改为「最新 Run 的 selected」。
- `toExperimentRows` / `standardOverviewResult` 等凡今日二次读 `selectedEvalIdsOf` 砍 attempt 的，与 `sample.attempts` 对齐为同一贡献集。
- 默认 show / view / `--stats` 在「有哪些题进入当前结果集」上同源；`--fresh` 仍可故意变窄（fresh 是 Sample 变换，不是 selected）。
- `exp --dry` 等**规划面**继续用 selected 描述「本意跑谁」——与结果集贡献分离。

### 明确不改

- 指纹、携带六道门、`accept` 资格与 `acceptedFrom` 留痕。
- configHash 缝合前提与「不可比旧结果不填缺口」。
- `attempt.carried` / 时效呈现 / `fresh` 语义。
- 用 `selectedEvalIds` 描述**本次规划选题**的 CLI / dry 矩阵。

## 与现行 Feature 的差分

| 点 | Feature 现行 | 本拟定稿 |
|---|---|---|
| 贡献闸 | `selectedEvalIds`（缺则退化为物理 evals） | 仅物理 attempt（registry）+ configHash |
| 声明 ⊂ 物理 | 多出的物理不进结果集（有单测锁） | 多出的物理进结果集；warning issue 暴露不一致 |
| 声明 ⊃ 物理 | 缺口 / 不贡献 | 同左（靠 known / missing） |
| accept 必须写全 selected | 读面正确性依赖 | 降为元数据诚实；读面不依赖 |
| 防「夹带」脏 result | 靠 selected 静默丢 | 靠 writer + registry；issue 暴露不一致 |
| 语义变更性质 | — | **breaking**：selected 从「声明 + 贡献闸」变为「仅声明」 |

定稿迁入时需改写的 Feature 锚点（不在本页改 Feature 正文）：

- [`docs/feature/record/architecture.md`](../../feature/record/architecture.md) · `selectedEvalIds`
- [`docs/feature/sample/library.md`](../../feature/sample/library.md) · 贡献与覆盖
- [`docs/engineering/testing/unit/sample.md`](../../engineering/testing/unit/sample.md) · 「夹带不进结果集」类 case 翻案
- 报告侧 `selectedEvalIdsOf` 二次过滤（`shared-compute` 等）

## 范围

**包含**

- Sample 贡献规则翻案与报告同源投影对齐。
- `selectedEvalIds` 角色重划（元数据 vs 贡献闸）。
- SampleIssue（声明窄于物理）。
- 与多轮 exp / accept / 携带并存时的读面一致性目标。

**不包含**

- 是否删除 `selectedEvalIds` 字段（默认保留）。
- Record v2 整体重划（见 [record-v2](../record-v2/README.md)）；本主题可独立定稿。
- 实验改名 / 跨 experimentId 搬家（见 [experiment-rename](../experiment-rename/README.md)）。
- 写入面 accept 整组 selected 的修补（与本翻案正交；翻案后仍建议保留作诚实元数据）。

## 否决（本主题内）

- **读面 `selected ∪ 物理` 并集当长期语义**  
  两套规则搅在一起，测试与文档无法单源；要么声明优先（现行），要么物理优先（本主题）。
- **删掉 `selectedEvalIds` 落盘**  
  规划审计与「这次本意盖了谁」仍有用；先解除贡献耦合，再谈字段去留。
- **用重新跑全量实验代替读面修正**  
  不回答「多轮合成结果集」的模型问题。
- **静默收物理、不报 mismatch**  
  写入 bug 会从「用户看到错误结果」变成「内部悄悄漂移」；必须 warning issue。

## 验收场景（定稿后实现用）

1. 最新 Run `selectedEvalIds=[a]`，物理有 `a,b,c` 三条 result → `currentSample.attempts` 含 a,b,c，并有 warning issue。  
2. 最新 Run 物理仅 `a`，旧可比 Run 有 `b` → 结果集 a 来自最新、b 来自旧 Run（与今日缝合一致，且不要求最新 selected 列出 b）。
3. 批量 accept 36 题但声明误写 1 题 → 结果集仍 36（不依赖写入补丁，但写入仍应写全声明）。
4. 声明含 `d`、物理无 `d`、known 含 `d` → `d` 在 missing，不进 attempts。  
5. `fresh: true` 仍排除 carried 与跨 Run 拼入；与 selected 无关。  
6. 报告首页通过数 / eval 数与 `sample.attempts` 一致，不再出现「散点 86% · 摘要 1 eval」。  
7. `latestRunSample` 与 `currentSample` 对 selected 的态度一致（均不滤）。

## 相关阅读

- [Sample · Library](../../feature/sample/library.md) —— 现行选择器与覆盖
- [Record · selectedEvalIds](../../feature/record/architecture.md) —— 现行声明语义
- [缓存与携带 · accept](../../feature/experiments/cache.md) —— 重锚与快照封口
- [局部补跑用例](../../feature/sample/use-case/partial-rerun.md) —— 多 Run 合成动机
- [Reading](../../feature/reading/README.md) —— 三层分工
- [报告收窄靠前置选择器](../report-pre-selector/README.md) —— 正交：Reports 不二次切口径
