# 断言证据与完整性

作用域断言只消费 `Turn`、标准事件及其派生事实。Adapter 不实现断言，但其数据来源决定结论能否成立。

| 证据 | 支撑的结论 | 缺失风险 |
|---|---|---|
| 真实 Turn status | succeeded、parked | 恒 completed 会静默假通过 |
| assistant message | reply、messageIncludes | 正断言失败 |
| Turn data | output 断言 | 正断言失败 |
| 完整 action 生命周期 | 工具正负断言、顺序、失败 | 未声明缺口时负断言假通过；声明后记 unavailable |
| skill.loaded | loadedSkill | 正断言失败 |
| 完整事件流 | event / notEvent / order | 未声明缺口时 notEvent 假通过；声明后记 unavailable |
| usage | token/cost 上限 | 未声明缺失时按零聚合假通过；声明后记 unavailable |

## 完整性不变量

正断言在数据缺失时通常失败；负断言与上限断言在空流或半空流上可能成立。因此漏掉部分事件比完全没有事件更危险。

官方 SDK 完整事件流、完整 steps/output 和经过生命周期 fixture 验证的 transcript 可以形成完整性证据。最终自然语言、只采成功事件的埋点、内容可脱敏的 OTel span，以及未覆盖并发/失败的手写映射不能单独证明完整。

Adapter 无法完整采集时必须用下面的 coverage 声明说出来，不能用空数组表达“确认没有发生”。OTel 始终属于时间轨，不补写行为事件。

## 覆盖声明（EvidenceCoverage）

完整性不是口头承诺，是随数据走的声明：

```ts
type CoverageStatus = "complete" | "partial" | "unavailable";

interface EvidenceCoverage {
  /** 完整事件流（event / notEvent / order 的依据）。 */
  events?: { status: CoverageStatus; reason?: string };
  /** action 生命周期（工具正负断言、顺序、失败的依据）。 */
  actions?: { status: CoverageStatus; reason?: string };
  /** assistant / user message（reply、messageIncludes 的依据）。 */
  messages?: { status: CoverageStatus; reason?: string };
  /** usage（token / cost 上限断言的依据）。 */
  usage?: { status: CoverageStatus; reason?: string };
  /** Turn status 的真实性（succeeded / parked 的依据）——恒 completed 的映射必须声明非 complete。 */
  status?: { status: CoverageStatus; reason?: string };
  /** Turn.data（outputEquals / outputMatches 的依据）。 */
  data?: { status: CoverageStatus; reason?: string };
}
```

声明分两层，**省略 = unknown，不是 complete**——旧的或偷懒的 Adapter 不会因为什么都没写就被当成完整采集：

- **Agent 级默认**：`defineAgent` / `defineSandboxAgent` 的 `coverage` 字段声明该 Adapter 的常态覆盖。官方 SDK 适配器显式声明全通道 complete（可用 `completeCoverage` 常量）；手写映射按实际情况声明。整个 Agent 不声明时，全部通道视为 **unknown**。
- **Turn 级降级**：`Turn.coverage` 只用于相对 Agent 默认值**降级**（这一轮流断了、这一轮拿不到 usage）；不能在 Turn 上把 Agent 未声明的通道升格成 complete。
- unknown 在消费侧与 `unavailable` 同样保守处理；区别只在展示（unknown = 「Adapter 没说」，unavailable = 「Adapter 说了拿不到」）。
- attempt 级聚合取各 turn 的最差值（unknown/unavailable < partial < complete），随判定落进 `result.json` 的 `coverage` 字段（见 [Results](../../results/architecture.md#resultjson)），报告据此展示证据覆盖。

消费规则单点定义在 [Severity 与 Verdict](../../scoring/architecture/severity-and-verdict.md)，核心是**三值逻辑对正负断言都成立**：

- 正断言在非 complete 通道上**找到匹配即通过**（证据存在就是证据）；**没找到记 `unavailable`**，不判失败——「没采到」不能算成「Agent 没做」。complete 通道上没找到才是失败。
- 负断言与上限断言在所需通道非 complete 时一律 `unavailable`——空流证明不了「没发生」，缺 usage 不能按零聚合。

CI 因此拿到「证据链断了」和「agent 答错了」两个不同信号。

## 状态不变量

Turn completed 表示一轮正常结束，不表示每个工具成功；Turn failed 表示本轮运行失败；waiting 表示停在结构化输入请求。Action rejected 是人或策略拒绝，不能计作工具故障。
