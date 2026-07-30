# 读懂一次 errored:框架重试过没有,为什么

## 解决什么问题

attempt `errored` 了,排查的第一个问题是「框架试过自愈没有」。
答案就写在错误 message 里:带 `retries exhausted` 后缀 = 已重试到预算耗尽仍失败;没有后缀 = 被判为不可重试、从未重试。
两种 `errored` 的下一步完全不同,本篇教你分别读懂——不需要写任何代码,自愈行为是零配置的内建面。

## 全流程

1. **取证**。
   `niceeval show` 或 `view` 打开该 attempt,看结构化错误的 message 有没有重试摘要后缀,进对应分支。

2. **有后缀:重试耗尽的失败**。
   典型是高并发批跑撞限流——`--max-concurrency 12` 时十几个 attempt 同时开 turn,几个撞上入场拒绝(`Concurrency limit exceeded for user, please retry later`)。
   回退分类器从文本认出限流关键字 → 可重试(reason `rate_limit`),自动退避重试,批跑时 activity 行如实显示:

   ```text
   ⠸ onboarding/greet#2  turn retry 2/4 (rate_limit) — waiting 8s
   ```

退避中的 attempt 让出全局并发槽位给排队中的其它 attempt,整批吞吐不塌;大多数情况下第二三次尝试就过,**重试成功的 attempt 在结果里零痕迹**——你根本不会走到本篇。
你看到的耗尽摘要(`… · retries exhausted (4 attempts, rate_limit)`)意味着限流持续压过了整个重试预算(单次 send 封顶 4 次尝试,attempt 另有加总上限):并发本身超出配额,把 `--max-concurrency` 降下来才是对因下药,重试只兜抖动不兜超卖。

3. **无后缀:被判不可重试的失败**。
   典型是响应中途的流中断 / 连接重置:

   ```text
   This send returned failed (turn status = failed): stream reset mid-response
   after 3 tool calls
   ```

看起来是基建抖动,框架却没重试——这不是遗漏,按[自愈阶梯](../README.md#自愈阶梯与止损阶梯)逐层读:

   - **agent 内层已经放弃**:codex 这类 CLI 断连会带着会话现场自动重连、从断点接着跑,你根本看不到失败;它浮出流中断,说明它自己重试过并放弃了。
     bub 这类没有内层自愈的 agent 断一次浮一次——那是 agent 侧的能力缺口,框架代偿不了:会话现场在 agent 手里,框架没有断点。
   - **框架不整段重发**:流断在响应中途,无法证明 agent 未开始处理——上例里已跑了 3 次工具调用、可能写了 workspace。
     重发同一段 user text 会让 agent 把做过的操作再做一遍,产出被污染的判定,比一次诚实的 `errored` 更糟。
     即使文案里混着限流字样,失败 Turn 里已有 agent 产出事件时[受理证据门](../architecture.md#分类链)也会拦下重试。

4. **恢复路径(两分支同一条)**:`errored` 不进指纹缓存,**重跑同一条命令即是续跑**——只补跑失败的 attempt,已 `passed` / `failed` 的照常携带;新 attempt 从干净沙箱起,没有上一次半途现场的污染,这正是「重发 turn」给不了的。
   偶发抖动用一次续跑吸收即可。

5. **频繁复现时按层对因下药**:限流反复耗尽 → 降 `--max-concurrency`(或实验级 `maxConcurrency`,路由见[并发用例手册](../../experiments/use-case/并发/));流中断频繁 → 先调 agent 的原生重连配置,没有这层能力的 agent 给上游提 FR,再往下查 adapter 与网络路径。
   这是要修的问题,不是要重试的问题。

## 边界

- **重试参数固定,不可调。**
  两层预算与基数 5 秒是[非目标](../README.md#非目标)里定死的值(数值见 [Architecture · 退避与槽位](../architecture.md#退避与槽位))。
- **不要把 `attempts` 当重试预算。**
  `attempts` 是通过率的分母,拿它对冲基建抖动会污染分布;瞬时故障的自愈已在 send 层内建。
- **「大概率能过」不等于「安全重试」。**
  分类判据是重试安全性,不是复发概率;歧义错误宁可判死一个 attempt,不产出不可信的 verdict。
- **同一个死因刷屏几十条,不是本篇的场景。**
  限流全实验共享但**自愈**,被重试吸收的失败到不了止损闸;几十条 attempt 报同一个**不会自愈**的死因(探活失败、对共享 host 的拒连、fixture 缺失)时,走声明通道:[抛出点声明](declare-fatal-scope.md)或[写分类器](write-a-classifier.md)。
- **想要断点续传,只能在 agent 侧**;adapter 也不该在 `send` 里自己整段重发来伪装这层能力。
  你的协议能证明某个文案只在受理前出现时,走[写分类器](write-a-classifier.md)把它归入可重试。
- **中断安全。**
  Ctrl-C 或外层超时能干净打断退避睡眠,attempt 走正常收尾,不会挂在 sleep 里。

## 相关阅读

- [README](../README.md) —— 两轴判据全文、自愈阶梯与止损阶梯。
- [Architecture · 退避与槽位](../architecture.md#退避与槽位) —— 精确参数与槽位契约。
- [Runner](../../../runner.md) —— fail-fast、缓存与续跑语义。
- [错误与警告反馈](../../../error-feedback.md) —— 报错必带下一步的总纪律。
