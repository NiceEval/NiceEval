# Judge 用例

| API | 用例 |
|---|---|
| `defineJudge(...)`、`t.judge(value, definition)`、`t.check(value, definition)`、`defineConfig({ judgeProvider })` | [接上兼容网关并确认真实判分](verify-judge.md) |
| `defineExperiment({ judge })`、裁判模型对照 | [用 Experiment 做裁判 A/B](experiment-ab.md) |
| `binaryJudge(...)`、`.gate(1)`、`.score(points)` | [用是或否的判据给回复打分](binary-criteria.md) |

<!-- niceeval.docs-index/v1:start -->
## Use Case 索引（生成）

- [用 Experiment 做裁判 A/B](experiment-ab.md)
- [使用现成裁判并复核判分依据](inspect-judge-score.md)
- [Judge：接上兼容网关并确认真实评估](verify-judge.md)
<!-- niceeval.docs-index/v1:end -->
