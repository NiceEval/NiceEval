# Record v2 —— 可审计记录模型

**审查状态（ChatGPT Pro，2026-08-05）：方向接受，必须分阶段；禁止磁盘格式大爆炸。**  
Record 内部分 `InputSnapshot / Observation / Verdict`（或等价命名）；**Projection 不进 Record 权威事实**；先内部语义重构，再 schema bump。

Record / Sample / Reports 已经把“盘上有什么”“选择哪些记录”“怎样呈现”分成三层。
这次重设计不撤销该边界，而是继续拆开 Record 内部混在一起的信息。

当前 Record 把运行观测、运行输入、当时裁决和可重算投影都视为持久化事实。
它们共同进入 `EvalResult`，再由同一个 `schemaVersion` 决定整份 Run 能否读取和携带。
字段命名、聚合算法或报告需求变化因此会升级成事实格式变化。

## 为什么已有 Record / Sample 仍会出问题

Record / Sample 解决的是**记录之间**的选择问题，不是**一条记录内部**的信息分类问题。

Sample 负责选择最新 Run、建立比较口径、计算覆盖缺口和去重历史 Attempt。
它默认 Record 给出的每个字段已经是正确的持久化输入，不会判断 `verdict`、`evidenceCoverage` 或 `estimatedCostUSD` 是否能从更基础的信息重算。

Record 又把“磁盘上确实有这个字节”当成“这个值就是基本事实”。
这两个命题并不等价：一个聚合值可以真实存在于 `result.json`，同时仍是 events、配置与算法的派生结果。

更直接的工程原因是 `EvalResult` 同时承担五项职责：

1. Runner 的运行时返回值。
2. `result.json` 的持久化形状。
3. 结果携带的复制单位。
4. Record 的公开读取值。
5. Reports 的便利输入。

消费便利因此反向决定落盘字段。
Record / Sample 的领域改名发生在该类型形成之后，只移动了模块边界，没有重新裁决每个字段属于观测、输入、裁决还是索引。

## v1–v14 暴露的模式

历史变化分成三组：

| 变化类型 | 版本 | 判断 |
|---|---|---|
| 身份、并发安全与不可重建观测 | v4、v5、v6、v11、v13 | 必须持久化，格式变化有真实理由 |
| 领域裁决与运行结论 | v7、v8、v10 | 应保存为带依据和算法身份的 Claim，不应伪装成原始事实 |
| 命名、聚合与消费投影 | v2、v3、v9、v12、v14 | 不应让无关观测和整个 Run 一起失效 |

v9 已经删除过 `o11y.json` 中与 `result.json` 重复的 usage、cost 和 duration。
这证明重复权威会漂移，但修正只处理了当时发现的几个字段，没有形成通用的信息分类规则。

v14 更能说明问题。
`evidenceCoverage` 是各证据通道覆盖状态的聚合；字段改名和必填约束变化不应使源码、events、命令证据与身份全部不可读。
真正应该稳定保存的是各通道的观测与声明，聚合状态由带版本的规则计算。

## 新的核心心智

Record 是一份审计记录，不是一张方便报告直接消费的宽表。

**权威落盘**只保留三类（命名可在 architecture 细化，语义固定）：

| 类别 | 含义 | 丢失后能否重建 |
|---|---|---|
| Input / Provenance | 解释观测与裁决所需的输入、环境和算法身份 | 不能靠当前配置替代 |
| Observation | 运行中实际发生且无法重新取得的观测 | 不能 |
| Verdict / Claim | 当时根据输入和观测作出的判定 | 可以复核，但不能冒充原始观测 |

**Projection**（通过数、行表、hash 缓存、报告便利字段）**不属于 Record 权威事实**：

- 默认在 Sample / Reports **内存**重算；
- 若落盘仅作缓存，删除后不损失语义，**不**参与事实兼容判断，也不应单独升级整份 Run 的事实 schemaVersion。

Sample 仍只负责跨 Run 的选择与比较。
它消费 Record 的 Input / Observation / Verdict，不把投影磁盘形状当权威，也不重新执行 judge。

完整形状与阶段路线见 [Architecture](architecture.md)。

## 分阶段路线（已裁决）

| 阶段 | 内容 | 不做 |
|---|---|---|
| Phase 1 | 冻结语义边界；`EvalResult` **内部**拆分类型/模块；Projection 出权威 | 不改磁盘目录布局 |
| Phase 2 | 必要时 schema bump；Claim 带 evaluator / basedOn；legacy decoder | 不一次重写全部历史盘 |
| Phase 3 | 可选投影缓存目录；携带规划只认权威三类 | 不改 carry 语义、不四套平级 schemaVersion |

## 范围

本候选包含：

- 权威三类信息的持久化边界和精确形状。
- Claim / Verdict 如何引用依据、声明算法与保留当时结论。
- Projection 如何重建、失效（缓存可选）。
- Record、Sample、Reports 与结果携带的新依赖方向。
- 分阶段过渡边界。

本候选不改变 Sample 的选择口径，不把聚合写成权威事实，也不要求从原始 events 重新调用 judge。

## 已裁决

1. **Projection 不进 Record 权威四分类平级持久化**——避免「报告便利字段」驱动事实 schema。
2. **必须分阶段**；禁止「Record v2 一次性磁盘格式大爆炸」。
3. **carry / accept / fresh 语义不因 v2 改写**；accept 保留 provenance，fresh 仍由 Input identity 决定。
4. 不引入「四类信息四套互不关联的 schemaVersion」作为 1.0 目标。

## 仍开放

1. 确定性 assertion 的 Claim 是否也永久保存，还是仅保存规则版本并在读取时重算。
2. provider 返回的实际账单与 NiceEval 估算成本分别使用 Observation 和 Claim，公开 API 是否需要同时呈现。
3. 第三方 writer 是否必须声明每个 Claim 的 evaluator，还是允许一个明确标记为 opaque 的导入形态。
4. 可选 Projection 缓存保存在 Run 内，还是统一放进记录根下可整体删除的索引目录。
5. v14 转换时无法补齐的依据应产生 `opaque-claim`，还是让对应消费能力不可用。
