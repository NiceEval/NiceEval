# judge 慢的治理:有界超时 + 逐条进度,否决 attempt 内并发

**裁决**(2026-07-29):judge 判分调用慢/挂死的治理定为两条——每次调用有界
(`judge.timeoutMs`,缺省 180_000,到点记 `judge-call-failed` unavailable)+ live 面板
scoring 行逐条推进(`judge k/n · <检查方式>`)。attempt 内断言保持按声明顺序串行求值。
契约落点:`docs/feature/judge/library.md#调用预算与执行顺序`、
`docs/feature/experiments/cli.md#attempt-阶段`。

**曾选方案**:finalize 内 judge 并发求值(缩短单 attempt 判分墙钟)。

**否决理由**:attempt 层已并发(默认 20),attempt 内再并发把裁判网关的瞬时并发放大一个
量级;而判分调用**不重试**(非幂等计费读取,暗中重放会为同一条 rubric 产生第二笔模型费用),
一次 429 就把整条 attempt 打成 errored。并发方案缩短的是墙钟,放大的是致错概率,不划算。

**顺带废除**:`runner.scoreJudge` 静态 detail 文案(en「scoring / judge...」/
zh「评分 / judge…」)。它与阶段词重复(面板渲染成 `scoring: scoring / judge...`),又不携带
任何进度信息,且从未进过 docs 契约——scoring 阶段的 detail 契约此次才定,即 judge 推进指示,
无 judge 断言时不带 detail。

**起因现场**:NiceEval-Eval 真跑 4 attempts,全部 attempt 在 `scoring: scoring / judge...`
上停留数分钟不动;判分调用当时无显式超时,吃 openai SDK 缺省 10 分钟,材料是整段 9 分钟
install 会话,串行逐条,面板上读不出卡在哪一条。
