---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Inspection

Inspection 通过固定 query 读取并解释已封存 Record 事实。每个 query 把 selection、
已封口 cutoff 与业务聚合关闭为可复现的结果；它不是开放给调用方的存储查询层。

```text
sealed Record → shared fixed Inspection query
              ├── node:sqlite adapter → niceeval query
              └── sqlite-wasm adapter → Insight View
```

## `query` 承接的查看结果

`niceeval query` 承接原本由终端查看任务提供的读取、筛选、比较与解释。它交付可供
Agent 和自动化消费的固定结果，不建立第二个终端 renderer。`niceeval show` 不是命令，也不是
`query` 的别名。

| 用户要查看什么 | 固定 query 怎样承接 |
| --- | --- |
| 已封口 Run 的范围、层级和概览 | `runs.list`、`run.get` 与 `run.summary` 读取 Run、Attempt、Verdict、score、coverage、usage 和已知限制。 |
| 一个精确 Attempt 的依据与调试事实 | `attempt.get`、`attempt.trace`、`attempt.diff`、`attempt.sources` 与 `attempt.artifacts` 读取其 Evidence、source、轨迹、diff、artifact 与 diagnostics。 |
| 收窄查看范围 | 每个 operation 的穷尽 request 只接受其声明的 Run、Attempt 或 comparison selection；`--record` 只选 source，不能成为筛选条件。 |
| 两组 Run 的质量与成本 | `runs.compare` 以 `side-by-side`、`exact` 或 `paired` 返回成员、分母、missing、Evidence 与可比性。 |
| 一个请求会读取什么、怎样解释 | `discover` 给出可问的 operation；`explain` 给出 source、selection、comparison mode 与 fact kinds；`run` 给出同一语义下的结果。 |

终端协议不会把这些结果压缩成未经说明的文字摘要。结果始终保留 selection audit、denominator、
limits、issues 与 Evidence，使调用方不能用标量重新计算业务判断。

## 固定 query 边界

Inspection catalog 只接受具名 operation 与其穷尽 request/result。它涵盖 Run、Attempt、比较、
`sources`、trace、diff、artifacts、diagnostics，以及 score、coverage 和 usage 等已封存事实。
调用方不能提交 SQL、JSON path、公式或临时统计。

同一份 query definition 固定 operation、参数边界、SQLite row codec 与 result meaning。Node 的
`node:sqlite` adapter 和浏览器的 `sqlite-wasm` adapter 都执行这份定义；它们不得各自建立
Node-only projection、浏览器 DTO 或第二套聚合。每次读取先确定 source、selection 和 exact sealed
cutoff，再交付带 limits、issues 与 Evidence 的结果。任何 consumer 都不能重选成员、补配结果，
或从标量重新计算业务聚合。

人读浏览器体验、语言与 Preview 由 [Insight](../insight/README.md) 拥有。它在完整
`RecordSnapshot` 上经 sqlite-wasm 调用同一固定 query definition；组件不写 SQL，也不从 raw runs
猜算事实。Inspection 不拥有 View UI、Snapshot transport、session、Preview 或 Playground 写入。

- [Architecture](architecture.md)
- [CLI](cli.md)
- [Use cases](use-case/README.md)
