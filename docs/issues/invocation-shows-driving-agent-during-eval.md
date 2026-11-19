# invocation show reports driving agent while eval code runs

## 观察

Eval 的 `test(t)` 在第一次 `t.send` 之前执行自己的长步骤（例如 Concord RSI 外层先跑 `exp local` 测量约 3 分钟）时，`niceeval invocation show` 显示 `eval.run` 并写 `driving agent...`，但此时被测 agent 尚未开始。运行中无法区分 eval 自身的准备与 agent 驱动。

## 期望

`invocation show` 在 eval 自身执行阶段显示 eval 报告的 progress（`t.progress`）或明确的“eval 执行中”，只有 send 之后才显示 driving agent。
