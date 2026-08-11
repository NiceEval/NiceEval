# 断言证据与完整性

作用域断言只消费 `Turn`、标准事件及其派生事实。
Adapter 不实现断言，但其数据出处决定判定能否成立。

| 证据 | 支撑的判定 | 缺失风险 |
|---|---|---|
| 真实 Turn status | succeeded、parked | 恒 completed 会静默假通过 |
| assistant message | reply、messageIncludes | 正断言失败 |
| Turn data | output 断言 | 正断言失败 |
| 完整 action 生命周期 | 工具正负断言、顺序、失败 | 未声明缺口时负断言假通过；声明后记 unavailable |
| skill.loaded | loadedSkill | 正断言失败 |
| 完整事件流 | event / notEvent / order | 未声明缺口时 notEvent 假通过；声明后记 unavailable |
| usage | token/cost 上限 | 未声明缺失时按零聚合假通过；声明后记 unavailable |

## 完整性不变量

正断言在数据缺失时通常失败；负断言与上限断言在空流或半空流上可能成立。
因此漏掉部分事件比完全没有事件更危险。

官方 SDK 完整事件流、完整 steps/output 和经过生命周期 fixture 验证的 transcript 可以形成完整性证据。
最终自然语言、只采成功事件的埋点、内容可脱敏的 OTel span，以及未涵盖并发/失败的手写映射不能单独证明完整。

Adapter 无法完整采集时必须用下面的 evidence coverage 声明说出来，不能用空数组表达“确认没有发生”。
OTel 始终属于时间轨，不补写行为事件。

## 完整性声明（EvidenceCoverage）

完整性不是口头承诺，是随数据走的声明：

```ts
type EvidenceCoverageStatus = "complete" | "partial" | "unavailable";

type EvidenceCoverageEntry =
  | { readonly status: "complete"; readonly reason?: never }
  | {
      readonly status: Exclude<EvidenceCoverageStatus, "complete">;
      readonly reason: string;
    };

interface EvidenceCoverage {
  /** 完整事件流（event / notEvent / order 的依据）。 */
  readonly events: EvidenceCoverageEntry;
  /** action 生命周期（工具正负断言、顺序、失败的依据）。 */
  readonly actions: EvidenceCoverageEntry;
  /** assistant / user message（reply、messageIncludes 的依据）。 */
  readonly messages: EvidenceCoverageEntry;
  /** usage（token / cost 上限断言的依据）。 */
  readonly usage: EvidenceCoverageEntry;
  /** Turn status 的真实性（succeeded / parked 的依据）——恒 completed 的映射必须声明非 complete。 */
  readonly status: EvidenceCoverageEntry;
  /** Turn.data（outputEquals / outputMatches 的依据）。 */
  readonly data: EvidenceCoverageEntry;
}

type TurnEvidenceCoverage = Partial<EvidenceCoverage>;
```

声明分两层。Agent 层必须把六个通道逐一说清，不能靠省略表达“不知道”：

- **Agent 级默认**：`defineAgent` / `defineSandboxAgent` 的 `evidenceCoverage` 是必填字段，声明该 Adapter 的常态完整性。
  官方 SDK 适配器可以用全通道 complete 的 `completeEvidenceCoverage` 常量；手写映射必须为每个通道选择 complete、partial 或 unavailable，并为后两者写原因。
- **Turn 级降级**：`Turn.evidenceCoverage?: TurnEvidenceCoverage` 只列本轮相对 Agent 默认值的降级（这一轮流断了、这一轮拿不到 usage）。省略整个字段表示本轮沿用 Agent 声明；省略其中某个通道表示该通道沿用，不能升格。
- attempt 级聚合取各 turn 的最差值（unavailable < partial < complete），随判定提交进 Record 的必填 `evidenceCoverage` 事实（见 [Record](../../record/architecture.md)），报告据此展示证据完整性。

这种强制显式声明不是 capability 问卷：它不启用功能，只阻止“Adapter 什么都没说”被持久化成含糊的第四种状态。JavaScript 输入漏字段同样在 Agent 构造期报错。

消费规则单点定义在 [Severity 与 Verdict](../../verdict/architecture.md)，核心是**三值逻辑对正负断言都成立**：

- 正断言在非 complete 通道上**找到匹配即通过**（证据存在就是证据）；**没找到记 `unavailable`**，不判失败——「没采到」不能算成「Agent 没做」。
  complete 通道上没找到才是失败。
- 负断言与上限断言在所需通道非 complete 时一律 `unavailable`——空流证明不了「没发生」，缺 usage 不能按零聚合。

CI 因此拿到「证据链断了」和「agent 答错了」两个不同信号。

## Command projection

每笔 tool `operation.started` 都由 Adapter 在协议边界分类为 command 或 not-command。
原生协议直接提供单一 invocation 的 structured argv 时，Adapter 从 `niceeval/adapter` 调用同一个构造器：

```ts
import { commandProjection } from "niceeval/adapter";

const command = commandProjection({
  state: "available",
  executable: "pnpm",
  args: ["exec", "niceeval", "show", "weather"],
});
```

`commandProjection()` 保留 original tokens，并调用公开的 `normalizeLogicalCommand()` 生成 `logical-command/v1` 投影。
上例的 logical executable 是 `niceeval`，args 是 `["show", "weather"]`，因此能给 `commandMatch("niceeval", { argsStart: ["show"] })` 提供 definite-positive 证据。

协议只给 shell source、内容已截断或脱敏时，Adapter 使用 `opaqueCommandProjection(reason)`。
能确认这笔 tool operation 不是 command 时使用 `notCommandProjection()`。
不能确认分类时必须降低 actions coverage；core 不从 tool name、input 或 shell text 补造 command。

## 状态不变量

Turn completed 表示一轮正常结束，不表示每个工具成功；Turn failed 表示协议已经完整结束并给出可信、可评分的任务失败；waiting 表示停在结构化输入请求。进程异常、transport 中断与无法确认终态属于 `SendFailure`，不伪造成 Turn。
Action rejected 是人或策略拒绝，不能计作工具故障。
