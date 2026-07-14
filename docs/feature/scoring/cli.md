# Scoring —— CLI 预期反馈

## `--strict`

`--strict` 改变 soft Assertion 对 Verdict 的影响；判定规则单点定义在 [Severity 与 Verdict](architecture/severity-and-verdict.md)，这里只给用法。

```sh
npx niceeval exp compare --strict
```

Gate Assertion 不受 `--strict` 影响，任何模式下不通过都 failed。

## 退出与展示

- failed 表示评分未通过。
- errored 表示执行、环境、超时或作者错误。
- skipped 表示显式跳过且此前没有更高优先级失败。
- passed 表示没有触发上述条件。

终端和报告必须分别统计 failed 与 errored，不能把基础设施故障展示成 Agent 答错。多 runs 展示通过率和各 attempt 分数，不把多个 Verdict 合并成新的状态。

Judge 缺少模型或 API key、以及证据覆盖缺口导致断言评不了时，对应 Assertion 记录为 `outcome: "unavailable"`：非 optional 断言的 unavailable 按 errored 报（归入基础设施 / 配置问题，不是 Agent 答错，不分 gate / soft）；`.optional()` 断言的 unavailable 在断言列表里如实显示状态与原因、不影响判定。终端与报告展示 unavailable 时必须带 `reason`，让「证据链断了」一眼可诊断。
