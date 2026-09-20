---
format: concord.document/v1
id: live-raw-stderr-write-desyncs-redraw
title: 独立诊断行绕开 live 表格直写 stderr,回跳量错位导致每帧越滚越多
createdAt: 2026-07-11T19:40:44+08:00
createdAtSource:
  kind: first-recorded
  path: memory/live-raw-stderr-write-desyncs-redraw.md
  commit: ddddcb3c7285296cdbad3b26aae40472dbf80316
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
    statement: "- 已修 [live-raw-stderr-write-desyncs-redraw](live-raw-stderr-write-desyncs-redraw.md) — sandbox teardown 失败/budget 不可执行/reporter 抛错等独立诊断行绕开 live 表格裸写 stderr,回跳量与实际光标错位,每帧越滚越多刷屏(行数不超屏也会触发,和 live-overflow-redraw-appends-frames 是两条不同根因);修为新增 `src/tty-line.ts` 统一诊断行出口,live.ts 订阅后先清显示再放行(`tty-line.ts` + `sandbox/registry.ts` + `runner/run.ts` + `runner/report.ts` + `sandbox/docker.ts` + `sandbox/vercel.ts` + `runner/reporters/live.ts`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 独立诊断行绕开 live 表格直写 stderr,回跳量错位导致每帧越滚越多

## 现象

大批量并发跑(见到过 45 行 × concurrency 19)时,live 状态表偶发不再原地刷新,表现和之前
`live-overflow-redraw-appends-frames` 那次几乎一样:同一份表头/行反复整份往下追加,几秒内
刷出几十份重复副本。但这次行数并不超终端高度,`live.ts` 里那次修复的截断逻辑没起作用。

## 根因

`src/runner/reporters/live.ts` 的 `draw()` 靠 `drawnLines` 记住上一帧写了几行,每帧
`\x1B[{drawnLines}A` 回跳到表格起点再清行重写。这个回跳量成立的前提是"stderr 这块屏幕在
两次 draw() 之间只有它自己在写"。

但下面几处诊断消息完全绕开 `LiveReporter.progress()`/`onEvalComplete()`,在 live 表格激活
期间直接裸写 stderr/stdout:

- `src/sandbox/registry.ts` 的 `stopSandbox()`:每个 attempt 的沙箱 teardown 是 Effect
  scope finalizer(挂在 `src/sandbox/resolve.ts`),`sb.stop()` 失败或超过 8s 超时就直接
  `process.stderr.write`。并发 19、e2b API 一忙,这类超时并不罕见。
- 同文件 `stopAllSandboxes()` 的 forceCleanup 提示。
- `src/runner/run.ts` 的 `budgetUnenforceable` 提示(budget 配了但拿不到成本样本时,per-attempt
  触发)。
- `src/runner/report.ts` 的 `runReporter()` 兜底:任意 reporter 抛错都裸写一行。
- `src/sandbox/docker.ts` 的镜像拉取提示、`src/sandbox/vercel.ts` 的 session rotate 提示
  (`console.log`/`console.error`,provider 专属,但终端上 stdout/stderr 共享同一块屏幕和光标,
  一样会把 live 表格挤歪)。

这类写一旦插进两次 `draw()` 之间:下一帧按旧的 `drawnLines` 回跳,已经够不到表格真正的起点
(实际光标比记录的多了插进来的那几行),"清行重画"变成"往下多写一份",且这个偏移量被记进新
的 `drawnLines`——此后每帧都在上一帧错位的基础上继续错位,越滚越多。跟行数超屏是两条完全不同
的根因,行数再少也会触发。

## 修法

commit 待定(本次修复),新增 `src/tty-line.ts`:核心模块要打一条独立诊断行时统一走
`writeStderrLine()`/`beforeExternalTerminalWrite()`,不再直接 `process.stderr.write` /
`console.log` / `console.error`。`live.ts` 在 `onRunStart` 订阅
`onBeforeExternalTerminalWrite()`,回调里调用已有的 `clearDisplay()`(清掉已画内容、
`drawnLines` 归零),下一帧就当全新起点重画,不再累积;`onRunComplete` 里退订。已迁移的
调用点:`sandbox/registry.ts`(两处)、`runner/run.ts` budgetUnenforceable、
`runner/report.ts` runReporter 兜底、`sandbox/docker.ts` 镜像拉取提示、`sandbox/vercel.ts`
session rotate 提示。

适用场景:任何"假设自己独占一块终端区域做原地重画"的 TTY 渲染,都要给所有可能在渲染期间
触发的、绕开它自身回调路径的裸写(不只是同模块内,也包括依赖树上更底层的模块)设一个统一
出口——否则每加一个新的裸写点就是一个新的潜在越滚越多的坑,光靠行数截断堵不住。
