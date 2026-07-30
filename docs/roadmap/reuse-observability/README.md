# 复用与携带的可观察性

2026-07 下游 dogfooding 暴露出一组同根问题:结果携带与 Sandbox 复用是两个正交机制,但反馈面把它们挤在同一个词和同一组面板里,复用几乎不可见,配额占用无法自查。
本篇收集候选契约,定稿后按条重写 [Experiments CLI](../../feature/experiments/cli.md)、[Sandbox 复用](../../feature/sandbox/reuse.md) 与 [Sandbox CLI](../../feature/sandbox/cli.md) 的对应小节。

## 问题一:`reused` 一词两义

live 面板首行与机器输出 JSONL 里的 `reused` 指结果携带;attempt 记录的 `sandbox.reused`指 Sandbox 复用。
[缓存与携带](../../feature/experiments/cache.md)的正文词已经统一为「携带」,`PLAN` 面板也已用 `carried in from cache`,只剩 live 面板与 JSONL 停在 `reused`。

候选契约:首行与 JSONL 的携带计数改名 `carried`;`reused` 从此只属于 Sandbox 复用。
待裁决:JSONL `schemaVersion` 要不要随字段改名递增;`docs/cli.md` reducer 恒等式同批改名。

## 问题二:Sandbox 复用没有自己的反馈维度

一场全程复用的 Run,首行 `0 reused`(携带口径)之外没有任何复用信息:看不到建了几个实例、每个实例承接了多少条、有没有实例被淘汰更换。

候选契约:声明 `sandboxReuse` 的 Experiment,live 面板与结束反馈追加复用维度——实例数、总承接数、淘汰更换次数;逐实例明细归 `niceeval view` / `show`,不占 scrollback。

## 问题三:`PLAN` 面板的并发数可能误导

`PLAN` 首行的 `concurrency` 显示全局 config 值;实验声明了更小的 `maxConcurrency` 时,实际生效的是后者,面板却不显示。
操作者据此误判派发速率与配额占用。

候选契约:`PLAN` 按 Experiment 列生效并发(解析后的实际值);多实验并发上限不同时逐行给出,不再只给一个全局数。

## 问题四:「我现在占了几个实例」无法回答

撞 provider 实例上限(如 E2B 并发 20)产生 rate-limit errored 时,操作者需要知道自己账号当前的活跃实例构成:本次 Run 占几个、历史留存占几个、孤儿占几个。

候选契约:`niceeval sandbox list` 增加 provider 侧活跃实例视图,把「注册表已知的」与「provider 报告的」并排给出,差集即孤儿候选。
待裁决:Vercel 没有按元数据检索实例的通道,这一档如何如实降级。

## 问题五:`--reuse-verify` 复用前提的机械验证

[Sandbox 复用](../../feature/sandbox/reuse.md#复用污染的可观察性)的收尾诊断是被动信号,只有污染已经造成失败时才发声。
候选的主动验证:`--reuse-verify` 在首个实例上把同一条 Eval 连跑两次,两次判定不一致即判定该 Experiment 不满足复用前提,整场报错退出。
待裁决:验证用哪条 Eval(首条选中的,还是作者指定);验证成本要不要计入预算。
