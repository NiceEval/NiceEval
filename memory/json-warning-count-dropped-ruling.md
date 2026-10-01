---
format: concord.document/v1
id: json-warning-count-dropped-ruling
title: "`--json` 的 warning 事件不带折叠计数"
createdAt: 2026-07-24T20:37:22+08:00
createdAtSource:
  kind: first-recorded
  path: memory/json-warning-count-dropped-ruling.md
  commit: 344febe01e561a3b4bc2f2e35c81c5a4e7f4976e
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
# `--json` 的 warning 事件不带折叠计数

- **裁决**(2026-07-24):`WarningEvent` 删掉 `count` 字段。诊断按 dedupeKey 去重后只在首次出现时追加一行,append-only 事件流承载的是「这件事发生过」;折叠次数是会被后续出现改写的状态,只活在 human 的诊断行(`! <code> (12 attempts)`)与 `snapshot.json` 的持久化诊断——要终值走 `show --json` 读快照。契约落在 `docs/feature/experiments/cli.md`(`WarningEvent` 形状 + 「`--json` 固定满足」的诊断条目)。
- **起因**:`count` 是一个永远输不出来的字段。`src/runner/feedback/json.ts` 只在 `isFirstOccurrence(state, event.key)` 时写事件,那一刻计数恒为 1,再按 docs 自己的「省略等于 1」规则被略掉。docs 承诺的「同一 dedupeKey 折叠后的出现次数」与同一页承诺的「去重后只追加一次」在一条 append-only 流里不可兼得,这是既有问题,不是某次改动引入的。
- **曾选方案**:流里保留首次追加,收尾再追加一条带终值 `count` 的 warning。**否决理由**:同一个 `code` 会在流里出现两次且语义不同(首条是事实、末条是统计),消费方得维护状态机才能读懂单行事件,违背「一行一个自足 JSON 对象」;而且收尾那条也给不出真正的终值——止损闸的诊断在整个运行期随未派发数不断刷新,收尾只是取了某一时刻的快照。事件流不承担第二份结果 schema 是 cli.md 的既有原则,计数属于快照面。
- **实现落点**:零代码改动。json renderer 从来没有写过这个字段,删除只发生在 docs 的类型形状上;`DiagnosticNotice.count`(reducer 折叠、human 诊断行读它)照旧保留,它服务的是 human 与快照,不是事件流。
