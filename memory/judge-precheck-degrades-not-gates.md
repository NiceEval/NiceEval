# 裁决:judge 预检失败降级为只作废含 judge 的 eval,不拦整次运行

## 现象

真机跑 36 题实验(仅 1 题用 judge)时,判分网关因同账号其它流量占满并发而对
预检超时,整次运行一条 attempt 都不派发——35 条与 judge 无关的题陪葬。
连带发现 `probeJudge` 的「重试一次」对超时是死代码:`AbortSignal.timeout`
建在重试循环外,第一次超时耗尽 20s 预算后,第二次 fetch 拿到的是已 abort 的
signal,0ms 即败(最小复现:attempt 1 TimeoutError after 2003ms →
attempt 2 TimeoutError after 0ms)。

## 根因(设计)

判分预检整个机制是 docs 黑户,且行为与 judge 已定稿契约冲突:
`docs/feature/judge/library.md`「校验时点」声明失败粒度是逐断言
unavailable → 逐 attempt errored,预检失败却按 run 级门闸处理,没有任何
契约依据。「run 门闸」把一个 judge 配置问题放大成整批无结果,正好违背
verify-judge 用例强调的「裁判失败和 agent 失败在报告上长得不一样」。

## 修法(设计裁决,2026-07-30)

- **降级不拦批**:预检失败只作废含 judge 断言的 eval——它们的计划 attempt
  不派发、不建沙箱,逐条 `errored`(`judge-precheck-failed`,
  `error.phase: "judge.precheck"`,LifecyclePhase 新成员),与
  `experiment-setup-failed` 的派发前确定性失败同构;其余 eval 照常派发。
- **重试修成逐次独立预算**:`AbortSignal.timeout` 挪进循环,每次探测各
  20s。预检可重试与「判分调用不重试」不冲突:后者防的是非幂等重放的第二笔
  模型费用,探测无判分语义。理由已写进契约正文。
- **超时 fix 文案换首选**:先查「同账号其它流量占满网关并发」,再查
  baseUrl——两种错症状一样,前者更常见也更难想到。
- **PLAN 行加实验附注**:`concurrency 19 · mempal ≤1`,只印全局值会被读成
  「要开 19 路」;`--json` start 事件加 `experimentConcurrency`(仅收声明
  了 maxConcurrency 的实验)。
- 契约落点:`docs/feature/judge/library.md#派发前预检`(单源)、
  `docs/runner.md`、`docs/feature/experiments/cli.md#判分预检的显示`、
  `docs/feature/record/architecture.md`(LifecyclePhase)、concepts 立词
  「判分预检」并修 fail-fast 词条悬空的「预检」。

`.optional()` 不豁免预检的边界也一并裁决:optional 允许运行期单条证据
缺席;端点整体不可用时继续派发只会烧 agent 成本再产出同样的缺席记录。
无判分端点的环境按「不配置 judge」走运行期 unavailable 路径。

未修尾巴:连接被拒时探测失败消息只有 `fetch failed`——Node fetch 把
`ECONNREFUSED` 藏在 `error.cause` 里,「失败原因」这一半对该场景偏薄;
要补就在 `errorSummary` 里摘 `cause`(端点与超时场景的消息是完整的)。

另一处同批裁决:非 2xx 不重试(端点已回应即确定性答案),只有传输失败
(超时、连接失败)才吃第二次探测——docs 与 `probeJudge` TSDoc 已按此
措辞,别再把「非 2xx」写回重试清单。

相关:[[judge-precheck-run-level-line-not-transient]](预检升格为运行级
生命周期行 + 20s 超时的上一次裁决)、
[[judge-config-precheck-hard-fails-without-key]](预检范围收窄到「实际要
跑且源码含 judge」)。
