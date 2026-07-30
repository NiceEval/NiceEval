# 如何调试评估

按缺少的证据选择入口：

| 问题 | 选择 |
|---|---|
| 先把失败整理成可修复清单 | [从失败清单开始](../../reports/use-case/调试/整理失败清单.md) |
| 需要查看某次 Attempt 的源码、执行、耗时与 diff | [按定位符下钻](../../reports/use-case/调试/按定位符下钻.md) |
| 一道 Eval 时好时坏 | [查看历史 Attempt](../../reports/use-case/调试/查看不稳定历史.md) |
| setup 或 Agent 启动时就报错 | [留存并进入 Sandbox](../../sandbox/use-case/留存现场/环境启动错误.md) |
| 怀疑 Agent 修改了 workdir 之外的状态 | [检查现场全局环境](../../sandbox/use-case/留存现场/检查工作目录外状态.md) |
| 一个失败有多个假设，冷启动太慢 | [在同一现场反复验证](../../sandbox/use-case/留存现场/现场验证假设.md) |
| 让 coding agent 自动跑、读、改、复验 | [使用 JSON 运行流](../../experiments/use-case/机器输出/AI修复循环.md) |

`--keep-sandbox` 保留的是一次真实 Attempt 的现场；它不替代落盘证据，也不能用于声明了 `sandboxReuse: true` 的 Experiment。
