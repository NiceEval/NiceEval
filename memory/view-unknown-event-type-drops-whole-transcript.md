---
format: concord.document/v1
id: view-unknown-event-type-drops-whole-transcript
title: view 源码视图 send 行「无回复」:guard 全有全无判空 + 原生回显抢走整轮回复
createdAt: 2026-07-16T19:19:28+08:00
createdAtSource:
  kind: first-recorded
  path: memory/view-unknown-event-type-drops-whole-transcript.md
  commit: 6dc7b8618c7e933e4ec4fd3c4c840cefc45032b8
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [view-unknown-event-type-drops-whole-transcript](view-unknown-event-type-drops-whole-transcript.md) — 源码视图 send 行「无回复」的两个前端根因:`asEvents` 全有全无校验被一条 `skill.loaded` 整体判空(修为逐条过滤+补词汇);原生 transcript 的同文本回显把整轮回复抢进不渲染的 noloc 轮(修为轮归属按 loc 判定,`src/view/app/lib/{guards,transcript-data}` 等,记得 `pnpm run view:build`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# view 源码视图 send 行「无回复」:guard 全有全无判空 + 原生回显抢走整轮回复

## 现象

Attempt 详情的源码视图里,带 `loc` 的 `.send(` 行看不到回复,两种形态:

1. send 行连对话图标和「回复」入口都没有,点不开(coding-agent-memory-evals 的 `@1wmuk390`);
2. send 行能展开,但内容只有「(无回复)」(同 repo 的 `@11x69uie`)。

两种情况下盘上 `events.json` 都完整:user message(带 loc)、thinking、assistant message、
几十条 action.called/result 都在,artifact 经 HTTP 也全部 200。是前端两个独立 bug,不是采集丢数据。

## 根因

**其一(入口消失):guard 全有全无。** `src/view/app/lib/guards.ts` 的 `asEvents()` 用
`value.every(isTranscriptEvent) ? value : null` 做全有全无校验,而 `isTranscriptEvent` 的
switch 落到 `default: return false`。事件词汇加了 `skill.loaded`(一等事件,`src/o11y/types.ts`
的 StreamEvent 和 docs 都已声明,`show` 的渲染也已支持),但 view 前端这份 guard 漏同步——
于是**一条**不认识的事件把**整份** transcript 判成 null,`indexTurns` 聚不出任何轮。

**其二(展开无回复):原生回显开新轮。** 同一条 send 在事件流里出现两次:runner 的
`SessionManager.send()` 记带 `loc` 的一条,claude-code 原生 transcript 又回显同文本、无 `loc`
的一条(见 `events-user-message-and-source-loc.md`——user message 必须留在流里)。旧
`indexTurns` 把**每条** user message 都当新轮的开始,回显轮把后续全部回复抢走,而 noloc 轮
在 CodeView 里根本不渲染——带 `loc` 的 send 行于是只剩「(无回复)」。轮中段注入的 user
消息(stop-hook 反馈、skill 注入)同理会把其后回复挂空。

深层教训与 `view-sources-artifact-serving-not-dereferenced.md` 同类:StreamEvent 词汇/形状在
core(types/docs/show)演进时,view 前端的手写 guard 与聚合是独立的「读取面」,不改就静默
断链;且失败模式都是「整体判空/挂空」而非「逐条降级」,把局部不认识放大成全局丢失。

## 修法

三层,落在同一次提交:

- **容错语义**(治本):`asEvents()` 从全有全无改为逐条判定,未识别或形状不合的条目包成
  `view.raw` 原样呈现(摘要行带原始 type,展开是完整 JSON;`RawEventBlock`),不静默丢弃
  ——用户裁决:raw 展示比丢弃好,新词汇在界面上可被发现、后续补一等呈现。只有非对象条目
  丢弃,非数组载荷仍整体拒绝。以后词汇再演进,旧前端以 raw 形态露出新事件,不会再黑掉
  整个对话面。
- **词汇同步**:`isTranscriptEvent` 补 `skill.loaded` 分支;`indexTurns` 聚成
  `kind: "skill"` 回复;`ReplyPanel` / `Transcript` 以一等条目显示 Skill 名(与 `show` 的
  `SKILL · <name>` 对齐),i18n 补 `transcript.skillLoaded`。
- **轮归属按 loc 判定**(`src/view/app/lib/transcript-data.tsx` 的 `indexTurns`):无 `loc`
  的 user 消息不再开新轮——与当前轮 sent 同文本且回复未开始的是回显,直接吃掉;其它作为
  `kind: "user"` 回复留在当前轮。流首无 loc 的 user 消息(旧工件)仍开 noloc 轮,不回归。

契约落 `docs/feature/reports/view.md`「Attempt 详情」(按条目校验、按条目容错 + 轮归属规则);
场景行登记在 `docs/engineering/testing/unit/reports.md`,测试在
`src/view/app/lib/guards.test.ts`。改完记得 `pnpm run view:build` 重建 client-dist,否则本地
server 仍吐旧 bundle。
