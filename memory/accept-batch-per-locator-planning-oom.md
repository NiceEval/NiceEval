# 批量 `accept` 逐 locator 各自重跑完整 discovery + sandbox planning,137 条撑爆 4GB 堆

**现象**:下游一次 `niceeval accept @a @b …`(137 条 locator,对应 toggl-cli 一次系统性改动后
要重新接受的全部结果)在 Node 默认 4GB 堆上 OOM 崩溃,没有跑到写盘那一步。

**根因**:`acceptLocators` 曾是 `Promise.all(options.locators.map((locator) =>
prepareAcceptLocator({ ...options, locator })))`——每条 locator 独立调用
`prepareAcceptLocator`,而后者在没有收到 `config`/`evals`/`experiments` 注入时,各自
`loadConfigFile` + `discoverEvals` + `discoverExperiments` 一遍,再各自调一次
`Effect.runPromise(prepareRunSandboxes(...))` 做 physical planning。137 条 locator 并发
展开,等于 137 份并发的项目全量 discovery 结果与 137 次独立的 sandbox physical planning
同时活在内存里;discovery 本身对整个项目只需要算一次,同一个 experiment 内的多条 locator
也不需要各自重新走一遍 `linkRunSandboxes`/`planLinkedRuns`。

**修法**(`src/runner/accept.ts`):

- `acceptLocators` 入口把 `loadConfigFile`/`discoverEvals`/`discoverExperiments` 只 hoist
  一次,注入给批内全部 locator 共享,不再让每条各自 import。
- sandbox planning 按 experimentId 记忆化:先扫一遍全部 locator 解析出的 `(experimentId,
  evalId)`,按 experiment 汇总出这一批要接受的全部 eval id;每个 experiment 只调一次
  `prepareRunSandboxes`(用汇总后的 eval id 集合做 `cliPatterns`),同一 experiment 的多条
  locator 共享同一次 Promise(`Map<string, Promise<readonly PreparedRunPair[]>>`)。这与
  `planCarry`(`fingerprint.ts:535`)在正常 `exp` 流程里本来就把整批 evals/runs 一次性喂给
  `prepareRunSandboxes` 是同一种用法,不是新引入的批处理模式。
- 指纹计算共享一个 `sourceCache`(`fingerprintWithManifest` 第二参),与 `planCarry` 同一
  用法——同一份 eval 源码/数据文件不再被多条 locator 各自读一遍、哈希一遍。
- prepare 阶段(discovery/planning 之后仍有逐 locator 的指纹/manifest IO)加一个手写的
  8 并发小池(`mapWithConcurrency`),不放开到无限并发。

**注意事项**:批量入口的 sandbox planning 是按 experiment 汇总的 eval 集合规划的,单条
locator 拿到的 `prepared` 数组可能包含同 experiment 本批其它 eval 的 pair;每条结果自己的
`currentExperiment.sandboxPlansByEval` 只能收自己那个 eval 的 plan,不能遍历整个 `prepared`
数组——否则会把批内其它 locator 的 sandbox plan 混进这条结果的快照字段(`prepareAcceptTarget`
里已按此收窄,规则见代码内注释)。

**适用场景**:任何「批量入口把单条入口的准备逻辑原样 `Promise.all` 展开」的写法都要检查——
判据是这条准备逻辑里有没有「对整个项目只需要算一次」的部分(discovery)、以及有没有「同一个
上级作用域内可以合并成一次」的部分(同 experiment 的 sandbox planning);两者都不做记忆化时,
批量吞吐量会随并发规模线性放大内存占用,而不是随批量大小做合理的常数级或对数级增长。与
[[accept-cross-experiment-batch-ruling]] 同批修复——放开跨 experiment 批量之后,单批
locator 数量会明显变大,这条 OOM 若不修,新契约在真实规模下不可用。
