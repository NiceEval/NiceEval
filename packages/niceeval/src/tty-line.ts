// 独立诊断行的 bootstrap 终端出口:只服务 run 启动前的 argv/config 错误,以及崩溃兜底/
// 尚无活跃 coordinator 时的兜底(见 src/runner/feedback/sink.ts 的 no-active-coordinator 分支)。
//
// run 激活之后的全部反馈(dashboard、durable event、heartbeat)由
// src/runner/feedback/coordinator.ts 统一排序;它通过 sink.ts 的模块级 coordinator 栈直接接管
// reportXxx() 调用的目的地(显式路由,不是广播-订阅),所以这里不再需要"写之前先广播、订阅方
// 自己清屏"的机制——那套机制是为已删除的 live.ts 的 ANSI 回跳重画设计的(见
// memory/live-raw-stderr-write-desyncs-redraw.md),新 coordinator 的 clear → append → redraw
// 顺序由 sink.ts 的显式路由保证,不依赖本文件。

/** process.stderr.write 的替代:文本需自带换行(沿用现有 i18n 字符串的约定)。 */
export function writeStderrLine(text: string): void {
  process.stderr.write(text);
}
