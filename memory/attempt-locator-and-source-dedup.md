# attempt-locator-and-source-dedup

裁决(2026-07-12):把独立设计好的 `AttemptLocator`(`src/results/locator.ts`)与 eval 源码捕获/
标注(`src/runner/eval-source.ts`、`src/results/annotated-source.ts`)接进真实的 writer/open/copy
持久化层,`RESULTS_SCHEMA_VERSION` 4 → 5。两处集成都有一个"看起来更简单但是错的"捷径,记下来
避免后续阶段(CLI、AttemptEvidence assembler)重踩。

## locator:携带条目的 locator 只能原样复制,不能在读取时按当前快照重算

`AttemptLocator` 由 `{experimentId, 快照 startedAt, evalId, attempt}` 四元组确定性派生。这个
"快照 startedAt" specifically 是 `SnapshotMeta.startedAt`,不是 attempt 自己的 `startedAt`。

`--resume` 携带条目(`artifactBase` 分支)把一条 attempt 原样搬进新快照——它的 `evalId` /
`attempt` 不变,但它现在物理上住在一个 `startedAt` 完全不同的新快照里。如果读取面图省事,
用"当前 attempt 所在快照的 startedAt"重新 `encodeAttemptLocator()`,会给同一个 attempt 算出
一个**不同**的 locator 字符串——任何早先发布出去的 `@<locator>` 链接(报告页、`niceeval show
@<locator>`)瞬间失效,而且是静默失效(新字符串一样合法,只是指向"错的"或者压根不存在)。

修法:**writer 在非携带写入时把 `locator` 算好落进 `result.json`;携带条目(`writeAttemptFor`
的 `artifactBase` 分支)绝不重算,只是不把 `locator` 字段从 `...rest` 解构掉,原样透传**——
它本来就来自上一轮 `openResults()` 读回的记录,那条记录的 `locator` 早就是对的。读取面
(`open.ts` 的 `record.locator ??= encodeAttemptLocator(...)`)只在**真缺失**(第三方 harness
没实现 locator)时才现算,现算的产物不保证跨未来的 `--resume` 稳定,但优于完全没有。

同理:`buildLocatorIndex`(`locator.ts` 自带的批量建索引工具)设计上对每条输入的 `identity`
都调用 `encode(identity)`,这个假设在携带链路下不成立(见上)。`open.ts` 的 `openResults()`
**没有**复用 `buildLocatorIndex`——它直接读每个 `AttemptHandle.locator`(已经按上述规则解析
好)建索引,碰撞检测靠比较 `{experimentId, evalId, attempt 序号}` 三元组(不含 snapshotStartedAt,
因为携带条目的"真实" snapshotStartedAt 在读取时已经不可靠地恢复不出来)。`buildLocatorIndex`
本身仍然导出、仍然有 22 个单测,只是不是这条集成路径的调用方——它更适合"确定有干净身份元组"
的场景(比如未来 writer 侧的预检)。

## sources:去重是快照级的两层存储,不是"看谁先写谁赢"的单文件技巧

最初设想的省事写法:检测到内容重复就跳过写第二份 `sources.json`,attempt 目录下没有文件时
`sources()` 就"猜"着去别的 attempt 目录找同名文件——被否决,因为:
1. 猜"该去哪个 attempt 目录找"本质上还是要一份索引,不比显式引用简单;
2. 不 orthogonal 于既有的 `artifactBase` 回退语义(携带条目已经占用了"文件不在本地找别处"
   这条路径,两套隐式查找规则会互相打架)。

改为显式两层:attempt 级 `sources.json` 只存 `{path, sha256}[]`(小,引用,不含内容);内容按
`sha256` 存进**快照根**的 `sources/<sha256>.json`(不是 attempt 目录、也不是实验目录——必须是
快照根,因为去重的作用域是"这一次跑",不是"这个实验的全部历史")。`AttemptHandle.sources()`
的公开返回形状不变(`SourceArtifact[] | null`),两层解析对调用方透明。

`copySnapshots` 不能简单 `copyFile` 引用文件了事(那样目的地会有一份指向"哪都不存在的 hash"
的孤儿引用)。修法是复制时**不**直接 `copyFile` 源文件,而是调已经会做两层解析(含
`artifactBase` 回退)的 `attempt.sources()` 拿到解引用后的完整内容,在目的快照按内容重新算
哈希去重落盘——天然吸收"携带条目复制后原快照可能不在目的地里"的情形,不需要在 `copy.ts` 里
重新实现一遍候选目录探测。代价是丢了"copyFile 原字节"这条通用不变量(仅对 `sources` 这一种
artifact 例外,其余四类仍是原字节复制)。

## 涉及文件

- `src/runner/types.ts`(`RESULTS_SCHEMA_VERSION` 4→5、`EvalResult.locator`、
  `DiscoveredEval.source`)
- `src/results/writer.ts`(非携带写入算 locator、`sources/<sha256>.json` 去重仓库)
- `src/results/open.ts`(locator 回填 + 索引 + `resolveLocator`/`LocatorNotFoundError`/
  `MalformedLocatorError`、两层 `sources()` 懒加载)
- `src/results/copy.ts`(`sources` 复制改走 `attempt.sources()` 重新去重,不再是单文件 `copyFile`)
- `src/runner/discover.ts` / `src/runner/attempt.ts`(discovery 时捕获源码,`collectSources`
  命中 eval 自身文件时用捕获好的内容,不重新读盘)
- `src/results/attempt-source.ts`(打通链路的薄封装 `loadAnnotatedEvalSource`,不是最终的
  AttemptEvidence assembler)
- `docs/results-format.md` 已同步这一版的磁盘契约(`result.json.locator`、两层 `sources.json`)
