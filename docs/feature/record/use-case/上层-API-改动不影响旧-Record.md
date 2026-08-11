# 上层 API 改动不影响旧 Record

本用例证明 producer API、持久 schema 与 normalized FactRequirement 是三层边界。matcher、collector、memoization 或求值算法可以重构；Record reader 不需要跟随每次 TypeScript API 改名。

本页的“旧 Record”只指首个正式 `niceeval.record/v1` writer 之后，由较早 NiceEval 写出的 Record v1。旧 Results `schemaVersion` 1–18 不进入本用例，也不由 Record reader 打开。

## 两种演进

第一代 producer 使用 API A 运行 Eval，并写出 `niceeval.assertions/v1`。后续版本改成 API B：

1. 若 API B 仍能逐字段产生同一个精确 Assertions document，它继续写 `niceeval.assertions/v1`；
2. 若持久 bytes shape 必须改变，它写 `niceeval.assertions/v2`，新 decoder 再归一到稳定 `assertionsFact`；
3. 若业务语义已经不是 Assertions，则发布新的 channel name 与新的 FactRequirement，不复用 `niceeval.assertions`。

不能给同一个 schema ID 增加另一种合法形状，也不能让 decoder 通过字段探测猜 v1/v2。

## 显式读取旧 Run

用户升级 NiceEval 后显式选择早期 Run。reader 从 frozen candidateSet 取得 Member，再沿 `{ originRunId, attemptId }` 建 dependency closure，最后按 descriptor 的 schema ID 选择永久 decoder：

```text
显式选择旧 Run
    ↓
Member → origin Run / Attempt
    ↓
niceeval.assertions/v1 bytes
    ↓
永久 v1 decoder
    ↓
assertionsFact normalized value
    ↓
同一 ReportExecution → show / view / 当前 exporter
```

这不是 carry 场景。eligibility 或 `reuseContract` 不满足未来 policy，只会阻止采用为新 Run Member；它不能阻止用户显式读取旧 Attempt。

## 兼容矩阵

| reader | durable fact | 保证 |
|---|---|---|
| 较早 Record v1 reader | `niceeval.assertions/v1` | 读取并展示 v1 Assertions。 |
| 后续 Record v1 reader | `niceeval.assertions/v1` | 永久 v1 decoder 归一到 `assertionsFact`，标准 detail 继续工作。 |
| 较早 Record v1 reader | `niceeval.assertions/v2` | core 与其它已知 facts 继续读取；Assertions requirement 得到 unsupported。 |
| 后续 Record v1 reader | `niceeval.assertions/v2` | v2 decoder 归一到同一或新的具名 requirement。 |

“旧 reader 读取新 writer”不承诺自动拥有新功能。局部 unsupported 是刻意的前向兼容结果；它不能升级成整个 Record format invalid，也不能被显示成空 Assertions。

## 为什么 API 改名不进 core

Record 不保存以下 producer 实现细节：

- public matcher/function 名称；
- collector、memoization、Fact 使用图或 evaluation algorithm；
- matcher 默认线怎样求值；producer 保存最终 normalized value；
- `stopOnFailure` 或其它控制流；
- strict policy 怎样折叠；Attempt Verdict 使用独立 schema。

Run、Member、Attempt 与 ChannelDescriptor 只保存 owner、identity、schema ID 和 payload 入口。新增业务字段因此不会重演旧 Results 从全局 schema 15 推到 16、17、18 的连锁。

## Carry 的额外前向栅栏

展示 decoder 的兼容范围不能直接当作 carry accept set。每个 execution projector 仍需显式列出接受的 eligibility schema 与 `reuseContract.domain`。

例如未来 Assertions 加入 required human-review gate。新 writer 切换 reuse domain，必要时同时写新的 eligibility schema，且不保留旧 gate 能通过的 legacy eligibility descriptor。旧 CLI 读取这个新 Attempt 时必须得到 schema unsupported 或 domain mismatch，结果为 gap；它不能因为自己没请求 human-review fact 就错误 carried。

## 验收 fixture

每个正式 built-in channel schema 第一次发布时保存 writer 实际生成的 raw fixture bytes。以后不能用当前 writer 重新生成旧 fixture，否则测试只证明当前 reader 能读取自己。

后续 reader 至少验证：

1. 用当前 reader 打开 v1 fixture 所在的完整 Record；
2. 显式选择旧 Run，并沿 Member 建立 origin closure；
3. `niceeval.assertions/v1` 通过永久 decoder 形成预期 normalized value；
4. 标准 definition 形成预期 PageModel 与 text alternative；
5. `show`、`view` 与当前 exporter 消费同一 ReportExecution。

已经生成的静态报告站不读取 Record，所以不能替代这项兼容验收。

## 相关阅读

- [Record channel registry](../architecture.md#built-in-channel-registry)
- [Assertions 持久投影](../../assertions/architecture.md#稳定落盘投影)
- [Reports FactRequirement](../../reports/library.md#factrequirement)
- [历史 schema 存档](../../../../memory/results-schema-version-history.md)
