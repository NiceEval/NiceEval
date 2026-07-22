# 流中断不重试:读懂一次「诚实的 errored」

## 解决什么问题

attempt `errored`,message 是响应中途的流中断或连接重置——看起来明明是基建抖动,框架却没有重试。这不是遗漏:message 里**没有** `retries exhausted` 后缀,说明这个错误被判为不可重试、从未进入重试。这篇讲怎么读这个结果、为什么设计如此(关键是自愈分层:断连的正确自愈层在 agent 内部,不在框架)、下一步做什么。

## 全流程

1. 从结果里取证。`niceeval show` 或 `view` 打开该 attempt,看结构化错误的 message:

   ```text
   This send returned failed (turn status = failed): stream reset mid-response
   after 3 tool calls
   ```

   没有重试摘要后缀 = 判了不可重试;有后缀 = 框架已重试到预算耗尽仍失败。两种 `errored` 的下一步不同,先分清是哪种。

2. 理解浮出的失败意味着什么——按[自愈阶梯](../README.md#在自愈阶梯里的位置),断连的第一自愈层是 agent 自己:codex 这类 CLI 断连会带着会话现场自动重连、从断点接着跑,你根本看不到失败;它浮出流中断,说明**它自己已经重试过并放弃了**。bub 这类没有内层自愈的 agent,断一次就浮一次——但这是 agent 侧的能力缺口,不是框架能代偿的:会话状态在 agent 手里,框架没有断点,能做的只有整段重发。
3. 理解框架为什么不整段重发:流断在响应中途,无法证明 agent 未开始处理——上例里 agent 已经跑了 3 次工具调用、可能写了 workspace。重发同一段 user text,agent 会把做过的操作再做一遍,产出一个被污染的判定,比一次诚实的 `errored` 更糟(判据全文见 [README · 分类](../README.md#分类))。即使错误文本里混着限流字样,失败 Turn 里已有 agent 产出事件时[受理证据门](../architecture.md#分类链)也会拦下重试。
4. 走最外层恢复路径——**重跑 eval**:`errored` 不进指纹缓存,重跑同一条命令即是续跑,只补跑这个 attempt,已 `passed` / `failed` 的照常携带。新 attempt 从干净沙箱起,没有上一次半途现场的污染——这正是「重发 turn」给不了的。偶发抖动用一次续跑吸收即可。
5. 同一形状的错误频繁出现时,它就不是抖动,按层对因下药:agent 有原生重连配置(重试次数、超时)先调它;没有内层自愈的 agent(如 bub)考虑给上游提重连能力的 FR;再往下才是查 adapter 与网络路径(代理、超时配置、服务端稳定性)。这是要修的问题,不是要重试的问题。

## 边界

- **「大概率能过」不等于「安全重试」。** 分类判据是重试安全性,不是复发概率;歧义错误宁可判死一个 attempt,不产出不可信的 verdict。
- **想要断点续传,只能在 agent 侧。** 框架层不存在「接着上次的会话跑」——那需要会话现场,而现场在 agent 手里;adapter 也不该在 `send` 里自己整段重发来伪装这层能力。
- **adapter 作者的例外通道。** 若你的协议能证明某个流中断文案只在受理前出现(如固定的入场拒绝短语),给 adapter 写分类器把它归入可重试——流程见[给 adapter 写分类器](adapter-classifier.md);eval 作者侧没有、也不会有强制重试的开关。

## 相关阅读

- [README · 在自愈阶梯里的位置](../README.md#在自愈阶梯里的位置) —— agent 内层自愈 → turn 级重试 → 重跑 eval 的分层契约。
- [Architecture · 分类链](../architecture.md#分类链) —— 受理证据门为什么压过一切分类器。
- [Runner · 缓存](../../../runner.md#缓存指纹去重) —— errored 不缓存、重跑即续跑。
- [错误与警告反馈](../../../error-feedback.md) —— 报错必带下一步的总纪律。
