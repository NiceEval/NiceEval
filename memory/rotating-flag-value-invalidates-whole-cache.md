# flags 里放轮换型坐标(隧道 URL),换一次全部缓存作废

**现象。** MemoryBench 的 `compare/codex-gpt-5.6-luna--nowledge` 跑到一半被止损闸停掉
(远程 mem 实例 503),已经落盘 24 条 passed。修好服务端、`vim .env` 换掉 quick tunnel URL 后重跑,
PLAN 头变成裸的 `36 attempts`——**一条都没携带**,连这次中断前的 24 条和更早几轮的结果一起丢。
第一反应会怀疑「中途退出的 run 不能 reuse」,查下来完全不是:那个快照 26 条 `result.json`
都在,`completedAt` 也补上了,携带本来就不要求快照收尾。

**根因。** `nowledgeFlags()` 把隧道 URL 塞进了实验 `flags`(`nowledgeEndpoint: <tunnel url>`),
而 `flags` 整袋进 eval fingerprint(`src/runner/fingerprint.ts` 的 payload)。cloudflared quick tunnel
每次重启换一个 URL,于是**每换一次隧道 = 全部 36 条指纹全变 = 已完成结果全部作废**。
`--dry` 两次对照实锤:`NMEM_URL=<旧 URL>` 跑出 `24 of 36 carried in from cache`,用 .env 里的新 URL 跑出 0。

这类值的共性是「运行时要读、报告要看,但值变了不改变 attempt 里发生什么」:隧道 / 反向代理 URL、
服务端实例地址、跑批时刻。`labels` 不进指纹但也不透传运行时,接不住这类值;
放 `flags` 又被整袋哈希——修改前的 niceeval 没有第三种位置,这是设计缺口不是用法失误。

**修法。** 第一版修法(`ExperimentDef.provenanceFlags` 键名 deny-list + 反事实重算,commit
`e924fd4a`)当日验证有效,次日整体推翻——它在携带条目上记了错的出处,而且把「哪些值算条件」这条线
交回给用户。定稿的修法见裁决条目
[fingerprint-inputs-not-user-configurable](fingerprint-inputs-not-user-configurable.md):

1. 指纹构成不开放配置,`flags` 整袋进、无逐键豁免。
2. 轮换坐标不写 `flags`——它是 `setup` 跑起来才有的值,经工厂闭包给 agent / sandbox 钩子用,
   要进记录就在 **attempt 作用域**(sandbox 钩子 / agent setup)`ctx.fact()` 上报,
   随携带条目原样携带,报告按 `fact()` 选轴分组。
3. 已经写进 `flags` 的搬迁那一次带 `--carry-ignoring-flag <key>`,不赔一轮重烧。

**适用场景与判据。** 往 `flags` 里放值之前先问:**这个值是我写下的,还是跑起来才知道的?**
跑起来才知道的一律不进 `flags`——否则表现出来是「缓存莫名其妙全失效」,而 PLAN 头只会少掉一行
carried,不会告诉你是哪个 flag 变了。服务端版本号两种角色都成立:实验声明「我要 0.10.39」是条件,
进 `flags`、变了就该作废;跑起来问服务端「你是哪个版本」是观测,进 fact。

**留下的口子。** 携带落空目前没有可诊断性:0 carried 与「本来就没跑过」在输出上长得一样,
定位只能靠人肉 `--dry` 对照两次。落点是 plan 阶段——指出「差异面在 flags 的哪个键 / 在 eval 源码 /
在 sandbox」,并对每轮都在变的键直接指路 fact。
