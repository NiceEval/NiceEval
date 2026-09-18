---
format: concord.document/v1
id: live-overflow-redraw-appends-frames
title: live 状态表行数超过终端高度时每帧追加整表刷屏
createdAt: 2026-07-07T21:01:27+08:00
createdAtSource:
  kind: first-recorded
  path: memory/live-overflow-redraw-appends-frames.md
  commit: 09c2cde818de75b9cccb4161765e1734ddd6cd87
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
      [live-overflow-redraw-appends-frames](live-overflow-redraw-appends-frames\
      .md) — live 状态表行数超终端高度时 `\\x1B[nA` 回跳被屏顶截断,每帧追加整表刷屏;修为按 `stderr.rows` 截断 +
      隐藏行折叠成摘要(修在 `src/runner/reporters/live.ts`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# live 状态表行数超过终端高度时每帧追加整表刷屏

## 现象

大批量运行(如 54 个 attempt 行)时,live 进度不再原地刷新,而是每帧(80ms)往下追加一份完整状态表,终端被同一张表的重复副本刷满。行数少、一屏放得下时正常。

## 根因

`src/runner/reporters/live.ts` 的 `draw()` 用 `\x1B[{drawnLines}A` 回跳到上一帧起点再重画。但 ANSI 光标上移在屏幕顶端会被截断:当 `drawnLines`(表头 + 每行一条)超过终端高度时,光标只能回到可视区顶端,回跳量不足,剩余行数就以"追加"形式落在下方——每帧产出一份新表。终端矮、行数多时必现。

## 修法

commit `e01f912`,修在 `src/runner/reporters/live.ts`:

- `draw()` 按 `process.stderr.rows` 截断每帧行数(预留表头 1 行 + 尾部换行 1 行),保证回跳量永不超过屏高;
- 放不下时优先显示运行中的行(其次等待、最后已完成),但仍按原始顺序渲染避免行跳动,被隐藏的折叠成一行 `… 其余 N 项(X 运行中 · Y 等待 · Z 已完成)` 摘要(i18n key `live.more`);
- 帧变短(行完成折叠、终端拉高)时用 `\x1B[2K` 清掉下方残留旧行再回跳。

适用场景:任何"原地重画多行"的 TTY 渲染都要假设行数可能超过屏高——`\x1B[nA` 的 n 必须以当前 `rows` 为上限,否则溢出即变追加。
