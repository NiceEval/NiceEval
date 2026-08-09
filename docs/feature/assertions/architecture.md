# Assertions —— 架构

## 一张 Fact/use 图

每个 Attempt 有一个由 collector 所有的图。Fact producer 不决定 verdict 或分数；use 才是消费证据的唯一入口。

```text
value / scope / sandbox / Judge
              │
              ▼
        BooleanFact / ScoreFact
          │              │
          ├─ assert ─────┤ verdict use
          ├─ require ────┤ verdict use + control flow
          └─ score ──────┘ score use
              │
              ▼
    factResults + factUses + Attempt terminal
```

同一 Fact 可以有最多一个 verdict use 和一个 score use。两个 use 共用同一个 memoized evaluator promise，不会重复读文件、运行 matcher 或调用 Judge。

Fact 只在可达时求值。创建后没有任何 `assert`、`require` 或 `score` use 的 Fact 是同步 author error，且不启动 evaluator。依赖 Fact 会随消费它的根 Fact 可达。

## Fact 与 use 的结果

`factResults` 逐条保存 producer 结果：

- Boolean Fact 是 `passed`、`failed`、`unavailable`、`errored` 或未到达状态。
- Score Fact 是 `scored`（带有限 `[0,1]` 的 `normalizedScore`）、`unavailable`、`errored` 或未到达状态。
- `explanation` 是 evaluator 的人读解释，例如 Judge rationale。
- `evidence` 只承载裁剪和脱敏后的判分材料，不承载 rationale。

`factUses` 逐条保存 consumer 结果。verdict use 保存 `assert`、`require` 或受限的 `assertIfCovered`；score use 保存 Fact score 或 direct score。use 保留稳定 `key`、人读 `label` 和 consumer source location。

普通 evaluator transport 失败落为 Fact `unavailable`。非结构化 evaluator 返回值、越界分数和 evaluator defect 落为 Fact `errored`。这些状态不被 clamp 或伪造为分数。

## Verdict 与 Score Attempt

通过制 Eval：

- 任一被消费 Fact 的 evaluator error 或 ordinary unavailable 使 Attempt `errored`。
- 任一 failed verdict use 使 Attempt `failed`。
- 所有 verdict use 都是 `notApplicable` 时为 `skipped`。
- 其余正常图为 `passed`。

计分 Eval 先累加 score uses。若有 failed verdict use，结果为 `invalid`，`creditedScore` 固定为 0；evaluator error 为 `errored`；ordinary unavailable 为 `unavailable`；显式 skip 为 `skipped`；其余为 `scored`。`earnedScore` 始终是诊断值，只有成功或 invalid 的 `creditedScore` 进入聚合。

`require` 是唯一立即控制流 consumer。它先登记 verdict use，再立即开始 `now` Fact 求值。达到阈值才继续；未通过、unavailable 或 evaluator error 结束依赖路径。作者必须 await 或观察返回 Promise，未观察或仍 pending 的 requirement 在下一受管边界是 author error。

## 持久化边界

schemaVersion 17 与 `evaluationAlgorithm: "fact-use/v2"` 原子启用。每个 `result.json` 直接含 `factResults`、`factUses`，且计分 Eval 含 `scoreResult`。

读取面只接受这份形状。旧 schema 整份是 unsupported；Reader 不按字段猜测、迁移或拼接旧 artifact。Attempt trace、Judge sidecar、专用 Assertion handle、ScoreEntry 与 adapter 都不在持久化协议中。

## Judge runtime metadata

Judge 只在内存 Fact node 上附带 runtime metadata，用于在可达的 serial batch 中报告 `judge · <check>` 和已耗时。metadata 不进入另一套持久化 union。

Judge Fact 和所有其它 ScoreFact 一样由 `factResults`、`factUses`、`scoreResult` 驱动报告、source、failure feedback 与 exporter。
