# 跨 Attempt 按判据比较得分与状态分布

## 期望工作流

校准评分判据时，评估作者需要把同一评估的多个 Attempt（可以来自不同实验）按 Assertion key 排成矩阵，比较各条判据的得分和状态分布，发现恒零、恒满或没有区分度的判据。

希望通过 Inspection 读面输入一组 Run 或 Experiment 加一个评估，取得 key × Attempt 的 score / state 矩阵和每个 key 的分布摘要。CLI show 切片与公开 query operation 均应支持这个工作流，具体接口待定。

## 当前缺口与影响

NiceEval-Eval 的作者只能逐个 locator 调用 `niceeval show <locator> --assertions`，再自行编写脚本拼表。一次真实校准对比了 5 个 Attempt × 46 条判据，发现 `install.eval.core-input` 五次全部得 0 分，`install.docs.no-online-main` 五次全部得满分。单个 Attempt 的列表不易揭示这种分布，影响 rubric 校准效率。

## 用法示例

选择同一评估在若干实验中的 Run，按 Assertion key 比较每次 Attempt 得分；查看每个 key 的最小值、最大值和状态分布，筛出没有区分度的判据。此例仅表达工作流，不预定 CLI 参数名或协议字段。

## 来源与身份

来源：NiceEval-Eval dogfood，由父 agent 核实后提供本轮任务；NiceEval main 的第三批作者 API 工作，Feature 基线 `8b7e32505`，包开发版本 `0.0.0-development`，Linux、Node 24、pnpm 11。公开观察已脱敏，不含 credential、私有文件内容或漏洞细节。

搜重：2026-11-12 完整枚举 GitHub open 与 closed Issues（51 条）及本地 drafts。未发现相同工作流；#196 是通用可移植结果导出，范围不同。

建议标签：enhancement、area:report、area:cli、needs-triage。
