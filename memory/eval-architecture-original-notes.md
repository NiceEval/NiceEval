---
format: concord.document/v1
id: eval-architecture-original-notes
title: Eval 架构的原始设计笔记(从 docs/feature/eval/architecture.md 原样迁入)
createdAt: 2026-07-14T22:32:51+08:00
createdAtSource:
  kind: first-recorded
  path: memory/eval-architecture-original-notes.md
  commit: 28047ab511ebcfdaa2360058794e2b294e9aec50
kind: memory
memoryKind: insight
state: captured
epoch: 0
promotions: []
history: []
---
# Eval 架构的原始设计笔记(从 docs/feature/eval/architecture.md 原样迁入)

2026-07-14 按裁决把 `docs/feature/eval/architecture.md` 里的手动维护笔记原样迁到这里,正文重写为正式架构文档;本条目是出处,正文引用它、不复述叙事。原文如下(含原维护标记,未删改):

---

<--手动维护,不允许删改本段内容,只允许添加-->
# 核心原因
1. API应该容易理解,不会有二义性
1.1 负面例子,`t.messageIncludes(token)` 和 `t.calledTool(name, opts?)` 其它同样的断言API应该都是有同样语义的(比如同指是最后一次t.send,返回的消息,而不是有的是全部,有的是单轮)。如果用户想对整个消息进行评估,可以自己拼接、保存每轮的回复。
1.2 API唯一,如无必要,不应该有两个做一样事的API。

2. 给用户自组织的能力,而不是约定大于配置。用户不想学太多约定。
2.1 比如能不能把fixture、workspace(拷文件。通过基本API让用户自己去处理,而不是我们给一个值,让过程黑箱)
2.2 用户在用 langfuse、promptfoo 这种传统的 prompt 评估,有一些问题,像 dataset、golden,不是很适用于 Agent 的 case。 Agent eval可能更关注多轮对话、同时可能不同case的评估内容也不一样。所以统一的dataset。input与execpt output不太行。
2.2.1 如果用户真的需要dataset,可以通过for来实现这个功能
eve是怎么做到这个的
```ts
import { defineEval } from "eve/evals";
import { loadYaml } from "eve/evals/loaders";
import { equals } from "eve/evals/expect";
const doc = await loadYaml("evals/data/cases.yaml");
const rows = doc.evals as readonly { task: string; prompt: string; sql: string }[];
export default rows.map((row) =>
  defineEval({
    description: row.task,
    async test(t) {
      await t.send(row.prompt);
      t.succeeded();
      t.check(t.reply, equals(row.sql));
    },
  }),
```
<--end-->

---

## 当时的 eve 源码核对记录(同样是过程材料)

核对 eve 源码(本机 `/Users/ctrdh/Code/eve/packages/eve/src/evals/`),把 1.1 说的"作用域"坐实成经验证的设计:

- `assertions/scoped.ts` 的 `createScopedAssertions` 是一份实现,导出 `succeeded` / `messageIncludes` / `calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `calledSubagent` / `noFailedActions` / `event` / `notEvent` / `eventOrder` / `eventsSatisfy` / `parked` 一整套,靠调用时绑定的 `scope` 决定读哪份数据。
- `context.ts:77`:`t` 绑 `{ timing: "final", select: (result) => result }`;`runner/execute-task.ts:98`(`buildTaskResult`)把全部 session 的全部轮次拍平合并,`collector.finalize(result)` 时才求值。
- `session.ts:73-83`:`t.newSession()` 的 session 绑同一套断言,snapshot scope。
- `session.ts:298-308`:`t.send()` 的 turn 绑 `{ timing: "snapshot", select: () => this.#assertionSubject() }`,只读这一轮自己的 events。

结论:eve 靠「位置决定作用域、每个位置给全套词汇」解决 1.1 的不一致,不是靠取消聚合;niceeval 对齐这个设计。这份结论的定稿形态在 `docs/feature/eval/architecture.md` 的接收者模型一节。
