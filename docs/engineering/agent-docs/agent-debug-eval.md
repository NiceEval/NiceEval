# Agent Debug Eval：诊断效果评估

[agent-install-eval.md](agent-install-eval.md) 评估 coding agent 能否接入 NiceEval；本篇评估接入后能否只靠随包文档和公开 CLI，从一份已发布且不再写入的 Record 得到正确诊断。

## 要回答的问题

1. **查得到吗**：能否找出落后的 Experiment、失败的 Eval 和关键执行事实；不存在的信息是否明确说查不到。
2. **走的路对吗**：是否使用 `show/view --run|--latest → --page`，而不是递归翻 `.niceeval/record` 私有文件。
3. **文档起作用了吗**：是否从随包索引进入当前 Record、Sample、Reports 和 CLI 契约，而不是凭旧版 Results 记忆猜 history/locator 命令。

## Fixture

fixture 是一个最小用户项目加一份真实、已发布且不再写入的 `niceeval.record/v1` 目录。它可以包含多个 Experiment/Run、carried/accepted Member、failed/errored Attempt，以及有区分度的 usage、timing、conversation、tool 与 diagnostic channel。

数据按完整 Record root 签入，不再裁剪成旧图模型的引用闭包。为了控制体积，可以只保留题目会显式选择的 Run、这些 Run 的 Member 所引用的 Attempt，以及 owner core 中已声明的 channel/blob；裁剪后必须重新通过 Record reader，并让公开 CLI 的预定页面完整呈现。未知但合法且未请求的 channel 可以保留，用来证明局部读取隔离。

每次评估把 fixture 复制到隔离 workspace，并注入候选 NiceEval package。被测 agent 只能读，不能运行 Experiment、修复数据或绕过 CLI。标准答案从固定 fixture 人工核对后签入。

## 题库维度

| 题型 | 例 | 公开链路 |
|---|---|---|
| 总览 | 哪些 Experiment 需要补跑 | `show --latest` 的 coverage/diagnostic 页面 |
| 横向比较 | 两个方案的通过率与成本谁更好 | 重复 `--run` 后的 comparison page |
| 多跳定位 | 某 Eval 失败的直接断言是什么 | `show --run` → 已计划 Attempt route |
| 深挖 | 失败 Attempt 使用了哪些工具、何时换方案 | 同一 Sample 内的 conversation/tool page |
| 边界 | 询问 fixture 未采集的信息 | 页面显示 unavailable/unsupported，而不是编造 |

示例命令：

```sh
niceeval show --latest --experiment compare --page overview
niceeval show --run <baseline> --run <candidate> --page comparison
niceeval show --run <runId> --page attempt-<attemptId>
```

Attempt route 必须来自已计划页面索引；不能用独立 Attempt selector 越过 Sample 直接打开任意 Attempt。

## 评分

- **答案层**：具名 identity、Verdict、数字、错误 code、工具名和建议命令与 ground truth 一致。
- **路径层**：transcript 使用公开 CLI；若徒手读取 Record 私有文件，单独记为 CLI/文档可发现性缺口。
- **路由层**：从随包索引进入与问题相符的参考页，且没有使用 Results 1–15 的 schema、history 或 session 查询。

对同一题库比较 coding agent/model，并设置有/无随包文档对照组。CLI 或页面改版前后也可各跑一轮，用分数判断可发现性是否退化。

## 归因

- 路径正确但答案错误：页面缺少事实、状态表达有歧义，或 Report Calculation 有问题。
- 不知道重复 `--run`、`--latest --experiment` 或参数化 page：CLI 帮助和随包文档的导航问题。
- 大量翻私有文件：公开 CLI 未交付所需信息；不能把这种绕路写成推荐方案。
- 把 unavailable/unsupported/invalid 当零：Report 状态表达或 agent 理解问题。

## 边界

- 只评信息检索，不实际重跑、接受或修复 Eval。
- fixture 不依赖在线运行；除被测模型外可以离线。
- 产品正确性由 Record/Reports 的真实验收负责，本评估只测诊断旅途对 coding agent 是否可用。
- 题目若需要当前契约没有的页面，应先建立产品缺口条目，不允许测试 harness 直接读取私有 Record 补答案。
