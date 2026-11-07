# 已修:live 表格行永久卡在"waiting for a slot",总数却在涨

## 现象

`niceeval exp <name>` 跑有 `experimentId` 的实验(所有 `defineExperiment` 跑法都会有)时,
live 状态表**每一行**永远显示 "waiting for a slot..." 和 `0/1`,不管实际跑了多久、
sandbox 里产出了多少 trace(用 `.niceeval/<run>/<eval>/<agent>/<model>/<experimentId>/a*/`
下的 events.json / trace.json 时间戳能确认 attempt 早已在跑甚至跑完);但表头的总计数
(`16/45 done`)是准的、按预期推进。误导性极强——像是"sandbox 在跑但界面不更新",
容易被诊断成 e2b/budget/并发调度问题,实际是纯展示层 bug。

## 根因

[live-rows-fold-experiment-variants](live-rows-fold-experiment-variants.md) 那次修复把
`runWho()`(有 `experimentId` 时取其 basename,如 `dev-e2b/bub-e2b` → `bub-e2b`)定为
"行聚合 key 的唯一同源函数",`attempt.ts` 的 progress 上报和 `cli.ts` 建 `liveRows` 都改
成调用它了。但 `live.ts` 自己两处消费事件的地方当时没跟着改,继续手写
`event.model ? \`${event.agent.name}/${event.model}\` : event.agent.name`
(`onEvent` 的 `eval:start` 分支)和
`result.model ? \`${result.agent}/${result.model}\` : result.agent`
(`onEvalComplete`)——完全没看 `experimentId`。只要实验设了 `experimentId`(恒真),
这两处算出来的 who(`"bub/gpt-5.4-mini"`)就和建表时 `runWho()` 算出来的 key
(`"bub-e2b"`)对不上,`stateMap.get(...)` 恒为 `undefined`,`state.started` 永远
不会被置 true,`state.completed` 也永远不会 +1——即便 attempt 真的开始/完成了。
`onEvalComplete` 的 `totalCompleted`(表头总数)在 `else` 分支里无条件 +1,所以
总数走得准,只有分行的状态是假的。

## 修法

- `src/runner/types.ts`:`runWho()` 签名从 `Pick<AgentRun,"agent"|"model"|"experimentId">`
  改成 `{ agentName: string; model?: string; experimentId?: string }`,不再要求整个 `Agent`
  对象,方便 `EvalResult`(`agent` 本就是字符串)也能调用同一个函数。
- `src/runner/attempt.ts`、`src/cli.ts`:两处调用点相应改传 `{ agentName: run.agent.name, ... }`。
- `src/runner/reporters/live.ts`:`onEvent` 的 `eval:start` 分支和 `onEvalComplete` 都改成调用
  `runWho()`,不再手写重复逻辑。

## 适用场景

以后凡是"live 进度行 who 怎么算"的地方,只能调用 `runWho()`,不能在别处手写等价逻辑——
这是第二次因为手写副本漏改而回归同一类 bug(第一次见
[live-rows-fold-experiment-variants](live-rows-fold-experiment-variants.md))。
排查"live 表不更新但总数在涨"这类症状时,先看 `.niceeval/<run>/.../a*/` 下有没有产出
文件、mtime 是不是在变,能立刻排除"真的卡住"(sandbox/budget/并发问题),
定位到是 live.ts 展示层的 key 不匹配。
