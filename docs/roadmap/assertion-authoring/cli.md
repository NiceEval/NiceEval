# Assertion 作者面 —— CLI

`niceeval exp`、show、view、JUnit 和 JSON 都从同一份 Fact/use 结果读取。CLI 不提供会改写作者 use 的 `--strict`。

```text
Unknown option: --strict
Express required facts with t.check(...) or await t.require(...) in the Eval source.
```

## Attempt terminal 与退出码

| Eval kind | terminal | CLI/JUnit |
|---|---|---|
| pass | `passed` | success |
| pass | `failed` | failure |
| pass | `errored` | error |
| pass | `skipped` | skipped |
| score | `scored` | success |
| score | `invalid` | failure |
| score | `unavailable` | error |
| score | `errored` | error |
| score | `skipped` | skipped |

一次完整 invocation 中，只要折叠后的 Eval 有 `failed`、`invalid`、`errored` 或 `unavailable`，退出码为 1。全为 `passed`、`scored` 或 `skipped` 时为 0。

## 摘要

CLI history、任务列表和 report entity list 使用同一份 Fact/use 摘要。它先显示非成功 score terminal，再显示失败或不可用的 use。
随后它显示已消费 Fact 的 unavailable/error，最后显示成功 ScoreFact 或成功 score terminal。

```text
unavailable · earned 0 · credited unavailable · judge-model-unresolved
Judge clarity · unavailable · judge-model-unresolved
```

没有可归因 Fact/use 时，才显示结构化 execution error 或 skip reason。Judge 不拥有另一套摘要规则。

## JSON 与 Record

schema 18 的 JSON 直接公开 `evaluationAlgorithm: "fact-use/v3"`、`factResults`、`factUses` 和计分 Eval 的 `scoreResult`。旧 schema 是 unsupported，CLI 不转换、拼接或部分读取它。
