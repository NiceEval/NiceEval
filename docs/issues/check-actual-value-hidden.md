# Failed equals checks hide the actual value in show

## 观察

`t.check(value, equals(expected))` 失败时，`niceeval show @<attempt> <assertion-id> --full` 只显示 `Reason condition not met` 与 `Diagnostic equals(value) did not match`，不显示实际值与期望值。Concord RSI 的受保护文件 gate 失败（Attempt `@1AGKST3G6HM90`），CLI 无法看出是哪些路径变化，只能改用 `diff` 切片反推。

## 期望

`--full` 与 `--json` 给出该断言的实际值与期望值（受预算截断并标明截断），失败可直接定位。
