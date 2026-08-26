# Agent Debug Eval：诊断效果评估

[agent-install-eval.md](agent-install-eval.md) 评估 coding agent 能否接入 NiceEval；本篇评估接入后能否只靠随包文档和公开 CLI，从一份已发布且不再写入的 Record 得到正确诊断。

## 要回答的问题

1. **查得到吗**：能否找出落后的 Experiment、失败的 Eval 和关键执行事实；不存在的信息是否明确说查不到。
2. **走的路对吗**：是否先用 `query discover` 再发送固定 versioned request，或在人类深读时使用 `view`，而不是递归翻 `.niceeval/record` 私有文件。
3. **文档起作用了吗**：是否从随包索引进入当前 Record、Inspection、query/View 和 CLI 契约，而不是凭旧版 Results 记忆猜 history/locator 命令。

## Fixture

fixture 是一个最小用户项目加一份真实、已发布且不再写入的 `RecordSnapshot`。它可以包含多个 Experiment/Run、带 carried/accepted action 的 reference Member 和 failed/errored Attempt。

fixture 还应含有有区分度的 usage、timing、conversation、tool 与 diagnostic RecordAttachment。

数据按 sealed-only `RecordSnapshot` 签入。为了控制体积，可以只保留题目会显式选择的 Run、这些 Run 的 Member 所引用的 Attempt，以及已声明的 RecordAttachment/Content；裁剪后必须重新通过 Snapshot 验证，并让固定 Inspection operation 完整返回。未知但合法且未请求的 RecordAttachment 可以保留，用来证明局部读取隔离。

每次评估把 fixture 复制到隔离 workspace，并注入候选 NiceEval package。被测 agent 只能读，不能运行 Experiment、修复数据或绕过 CLI。标准答案从固定 fixture 人工核对后签入。

## 题库维度

| 题型 | 例 | 公开链路 |
|---|---|---|
| 总览 | 哪些 Experiment 需要补跑 | `query discover` → `run.summary` request |
| 横向比较 | 两个方案的通过率与成本谁更好 | `runs.compare` request |
| 多跳定位 | 某 Eval 失败的直接断言是什么 | `run.get` → `attempt.get` request |
| 深挖 | 失败 Attempt 使用了哪些工具、何时换方案 | `attempt.trace` request 或固定 View detail |
| 边界 | 询问 fixture 未采集的信息 | result 显示 `not-recorded` / `unsupported`，而不是编造 |

示例命令：

```sh
niceeval query discover --record ./fixture.record-snapshot
niceeval query explain --record ./fixture.record-snapshot --request request.json
niceeval query run --record ./fixture.record-snapshot --request request.json
niceeval view --record ./fixture.record-snapshot @<attempt-locator>
```

Attempt locator 必须来自固定 operation 的可继续读取 identity；request 不能绕过 selector 直接打开未选中的任意 Attempt。

## 评分

- **答案层**：具名 identity、Verdict、数字、错误 code、工具名和建议命令与 ground truth 一致。
- **路径层**：transcript 使用公开 CLI；若徒手读取 Record 私有文件，单独记为 CLI/文档可发现性缺口。
- **路由层**：从随包索引进入与问题相符的参考页，且没有使用 Results 1–15 的 schema、history 或 session 查询。

对同一题库比较 coding agent/model，并设置有/无随包文档对照组。CLI 或页面改版前后也可各跑一轮，用分数判断可发现性是否退化。

## 归因

- 路径正确但答案错误：页面缺少事实、状态表达有歧义，或 Report Calculation 有问题。
- 不知道重复 `--run`、当前项目命令的 `--experiment` 或参数化 page：CLI 帮助和随包文档的导航问题。
- 大量翻私有文件：公开 CLI 未交付所需信息；不能把这种绕路写成推荐方案。
- 把 unavailable/unsupported/invalid 当零：Report 状态表达或 agent 理解问题。

## 边界

- 只评信息检索，不实际重跑、接受或修复 Eval。
- fixture 不依赖在线运行；除被测模型外可以离线。
- 产品正确性由 Record/Reports 的真实验收负责，本评估只测诊断旅途对 coding agent 是否可用。
- 题目若需要当前契约没有的页面，应先建立产品缺口条目，不允许测试 harness 直接读取私有 Record 补答案。
