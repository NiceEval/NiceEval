---
format: concord.document/v1
id: capabilities-diff-conflates-artifact-with-changes
title: "`capabilities.diff` 不是「有 diff 证据」,拿它当投影的门会误报缺证据"
createdAt: 2026-07-30T10:40:41+08:00
createdAtSource:
  kind: first-recorded
  path: memory/capabilities-diff-conflates-artifact-with-changes.md
  commit: 2b81795f51e24d5130ccc06b4ea2fce48ccfb2c1
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [capabilities-diff-conflates-artifact-with-changes](capabilities-diff-con\
      flates-artifact-with-changes.md) — `capabilities.diff` 含「有文件被改过」这一层,拿它当
      attemptDiffData 的门,「跑了但零改动」被误报成 diff unavailable(真机 MemoryBench 复现);修为投影只按
      artifact 在不在开门,空清单与无证据分成两态"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# `capabilities.diff` 不是「有 diff 证据」,拿它当投影的门会误报缺证据

## 现象

`niceeval show @<locator> --diff` 对一个 `diff.json` 明明存在、内容是「一个窗口、零改动」的
attempt 输出：

```
diff unavailable (no diff recorded for this attempt: remote agent, or diff artifact not
published; expected: .../a0/diff.json)
```

路径就在那儿、文件也在那儿,却说没有证据。真机复现:MemoryBench
`toggl-cli/04-billing-doc`(errored 的 attempt,agent 没来得及改文件)。

## 根因

`src/record/attempt-evidence.ts` 的 `capabilities.diff` 是
`diff !== null && Object.keys(diff.files).length > 0`——它回答的是「值不值得推荐 `--diff`
这条命令」,不是「这次 attempt 有没有 diff 证据」。把 `attemptDiffData` 写成
`if (!evidence.capabilities.diff || evidence.diff === null) return null`,
两件事就被并成一件:**跑了但一个文件都没改** 和 **压根没有 diff 证据** 都回落成 `null`,
渲染面只能打「证据缺失」。

老代码没露馅是因为 `show --diff` 当时直接吃 `evidence.diff`(非 null),自己有
「(no file changes by the agent in any send window)」这条分支;把 text 面改成走
`attemptDiffData` 这一份投影时,那条分支就被上游的 `null` 短路了。

## 修法

投影只按 artifact 在不在开门(`src/report/components/attempt-detail/compute.ts`
的 `attemptDiffData`):

- `evidence.diff === null` → 返回 `null`,渲染面说「没有 diff 证据」并给期望路径。
- 有 artifact、净改动为空 → 返回 `{ locator, files: [] }`,text 面打「no file changes」,
  web 面零输出。

`capabilities.diff` 保持原语义(给 attempt 首页的 `available` 列表用),不动。
契约见 [attempt-diff.md「可用性」](../docs/feature/reports/components/attempt-detail/attempt-diff.md)。

适用场景:任何把 `capabilities.*` 当成「证据在不在」的地方。这一族字段是
**推荐哪条命令** 的判断,含「内容值不值得看」的成分;投影层要区分三态
(没有证据 / 有证据但空 / 有内容)时必须自己读 artifact,不能借这个布尔值。
