# niceeval show 总览在发生身份失配时将全部指标置为 0 和 unavailable，缺少历史结果摘要

## 观察与期望
在多次迭代的项目中，当 Experiment 依赖的包版本小幅更新（如 canary 升级或候选构建指纹变化）导致当前身份失配（`identity-mismatch`）时，运行 `niceeval show` 得到的终端总览面板会直接清空全部指标：
```text
Current results
  Totals
  Covered   0/14
  Gaps      14
  Verdicts  0 passed; 0 failed; 0 errored; 0 skipped
  Score     unavailable
```
尽管在下方输出了每个 Eval 的 `Previous result @<locator>`，但顶层的汇总区域完全丢失了项目整体的历史状态（直接显示 0 passed、Score unavailable）。

对于刚进入仓库的开发者、CI 看板或 Coding Agent，第一眼总览会产生严重的误导，误以为本项目“从未成功运行过”或“数据已全部丢失”。

期望：
1. `niceeval show` 顶层总览在存在 Gap / 失配时，应保留并展示「最近一次完整 Run 的基线摘要」（例如标注 `Last completed baseline: 10 passed, 2 failed, score 73/95`）；
2. 提供显式的查看选项（如 `niceeval show --previous` 或 `niceeval show --history`），允许直接查看最近一次有效发布批次的完整统计面板，而不被当前的未运行 Gap 完全遮蔽。

## 公开入口证据
- 项目：NiceEval-Eval（消费 niceeval@0.19.1-canary.117）
- 本地 record 数据库中已存在此前完整跑出的 14 个 Attempt 历史数据；
- 在终端直接运行公开命令：
  ```sh
  pnpm exec niceeval show
  ```
- 结果：
  `Covered 0/14`、`Gaps 14`、`Verdicts 0 passed; 0 failed`、`Score unavailable`；下方虽然逐行罗列了 `Previous result @1EM9AT9SZYR96` 等定位符，但顶层总览完全失效，无法获知历史整体通过率和得分。

## 影响
- **心智负担与误判**：每次版本升级或微调代码后，开发者无法直接了解上一次的基线水平是什么，必须手动挑选单个 locator 逐个 show，丧失了全局视角的对比能力。
- **误导自动化诊断**：Coding Agent 在开始诊断时读取总览，会误判为全新空白项目，无法形成“对比上一次修复前状态”的反馈闭环。

## 建议方案
1. 在总览面板的 `Totals` 区域增加 `Previous Completed Baseline` 统计栏，当当前格子有 `Previous result` 时，汇总显示最近一次对应 Attempt 的综合状态（Verdicts 分布与得分）；
2. 增加 CLI 参数 `niceeval show --latest` 或 `niceeval show --baseline`，直接将总览焦点对准历史已发布的最新 Run 集合。

## 环境与来源
2026-11，Linux，Node.js 24，pnpm 11.12.0；项目：NiceEval-Eval。观察来自真实项目版本演进与总览排查体验。
