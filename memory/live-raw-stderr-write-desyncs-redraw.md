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
