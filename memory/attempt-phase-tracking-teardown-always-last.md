# attempt phase 追踪:teardown 在 finally 无条件触发,取「最后一次 phase」必须排除它

**现象**:给 `reportFailure()`(`src/runner/run.ts`)补 `phase` 字段时,第一版实现直接把
`runAttemptEffect` 每次 `onPhase` 回调收到的最新值当作 `lastPhase`。集成测试立刻反证:
一条在 `evalDef.test()` 里显式 `throw` 的 errored 用例,`lastPhase` 稳定显示成 `"teardown"`,
不管真实异常抛在哪个阶段——`run.test.ts` 原本手写的期望值 `"running"` 反而是错的,真实运行结果
是 `"scoring"`(见下方根因),但即便改成 `"scoring"`,只要不排除 teardown,这个值仍会被
`enterPhase("teardown")` 的调用覆盖成 `"teardown"`。

**根因**:两层叠加。第一层(不算 bug,只是需要认识到的既有行为):`test()` 抛出的普通异常
被 `runAttemptBody` 内层 `try/catch` 收作 `result.error`,不设置 `skipReason`——所以 diff/scoring
两个阶段的跳过条件(`!skipReason`)不成立,attempt 仍会依次跨入 `diff`→`scoring`,`lastPhase`
在到达 teardown 之前的真实值是 `"scoring"`,不是异常抛出时所在的 `"running"`。第二层(真正的
bug 根因):`attempt.ts` 的 `enterPhase("teardown")` 在 `runAttemptBody` 的 `finally` 块里
**无条件**触发——不区分成功/失败,是 body 返回前的最后一次 phase 转换;而 teardown 自身的失败
只落 diagnostic、从不改变 verdict(见该文件 `finally` 块的注释)。所以对一个 verdict 已经确定为
`failed`/`errored` 的结果而言,真正决定判定的阶段必然发生在 teardown **之前**,但「取最后一次
`onPhase` 调用」这种朴素实现会被随后无条件触发的 teardown 覆盖掉,把几乎所有失败通知的 phase
拍平成同一个没有信息量的值——这个值在 100% 的失败/errored 场景下都会出现,不是偶发误判,
问题极隐蔽:类型检查、单个 mock 断言都会通过,只有在断言具体 phase 字符串时才会暴露。

**修法**:`run.ts` 的 `onPhase` 回调显式排除 `"teardown"`(`if (phase !== "teardown") lastPhase = phase;`),
`lastPhase` 因此稳定停在「失败判定成立时」的真实阶段(`sandbox-provision`/`agent-setup`/`scoring`/……,
按真实执行到的最后一步)。落点:`src/runner/run.ts`(`lastPhase` 的 `onPhase` 回调,排除逻辑只在这里,
因为"要不要把 teardown 算进最后阶段"是这一个消费方的语义判断,不是通用规则)+ `src/runner/attempt.ts`
(`runAttemptEffect` 新增可选的第五个参数 `onPhase`,忠实转发 `enterPhase` 的**每一次**调用、
包括 teardown 本身,不做任何过滤——过滤属于消费方决定,回调本身应该是无损的原始信号源)。
`attempt.test.ts` 新增的 `onPhase` 序列单测直接锁死了这个事实:teardown 是记录到的最后一个 phase,
`run.ts` 必须自己剔除,不能假设回调已经帮它剔除了。

**适用场景**:任何"记录一个状态机的最后阶段/最后步骤"模式,只要状态机里有一步是无条件的
收尾/cleanup(teardown、`finally`、测试框架的 `afterEach` 之类),朴素的"取最后一次转换"就会被
这类收尾步骤污染——收尾步骤本身几乎从不是问题的根因,除非能独立证明它会导致对应的失败判定
(此仓库里 teardown 恰好被显式设计成从不改变 verdict,所以答案是否定的),否则应该从"最后阶段"
的候选里显式排除,而不是默认信任"最后一次事件 = 出问题的那一次"。
