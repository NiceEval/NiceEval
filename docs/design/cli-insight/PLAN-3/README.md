---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# PLAN-3：固定 Inspection Operations

Record Host 向固定的第一方 Inspection operations 提供 sealed facts。`niceeval query` 给 AI 与自动化
machine document；`niceeval show` 给人英文终端投影；`niceeval view` 给人固定 browser View。
它们只共享 operation 的 request/result、selector、sealed cutoff、partial、missing、issues、Evidence 与 comparison 语义。

```text
operational Store or RecordSnapshot
              ↓
       Record Host
              ↓
 fixed Inspection operations
       ↙          ↓          ↘
query codec     show formatter   View revision
```

query codec、show formatter、View 的 view model、route、component、renderer、theme 与 presentation schema
没有共享契约。Inspection operations 不是公开分析 DSL；用户不能注册 Population、Measure、Relation、
SQL、表达式或 projection。

## 产品面

| 入口 | 用户 | 稳定责任 | 不拥有 |
|---|---|---|---|
| `niceeval query` | Agent 与自动化 | protocol discovery、版本化 request/result、correction | 人类 UI、网页 transport、任意 SQL |
| `niceeval show` | 终端用户 | 固定 overview、Run、Attempt source/execution 人读投影 | machine JSON、重算聚合、作者呈现面 |
| `niceeval view` | 人类 | 固定 overview/detail、刷新与 loopback browser lifecycle | machine document、可定制呈现、静态文件 |
| `niceeval record snapshot` | 分享者 | 形成 sealed-only、可验证 portable artifact | reader capability、业务脱敏判断 |

## Operation catalog

V1 的具名 catalog 为 `runs.list`、`run.get`、`run.summary`、`attempt.get`、`attempt.trace`、`attempt.diff`、`attempt.sources`、`attempt.artifacts` 与 `runs.compare`。每个 operation 拥有穷尽 request/result；新问题增加具名 operation 或扩展 union。

## 读取 source

没有 `--record` 时，Host 按项目定位 operational Store。每次 operation 只读取当前 sealed cutoff；View 可以观察新 sealed publication 并在用户确认时建立新 revision。`--record` 只接受 Host 导出的 `RecordSnapshot`；它固定 content identity、logical closure identity 与 exact Seal，View 不 watch、不 refresh。

## 范围

本候选不提供：

- `show --json`、`show --report` 与 history/stats/free statistics；
- `insight`、static Preview、`view --out`、anonymous URL 与 offline site；
- Page、theme、component、route、renderer、公共 browser API 或通用 Report/Analysis 作者面。

- [Architecture](architecture.md)
- [CLI](cli.md)
- [Lifecycle](lifecycle.md)
