# Vercel agent-eval 的 ExperimentConfig

## 它是什么

agent-eval 用 `ExperimentConfig` 把 Agent、模型、尝试次数、题目选择与运行 Hook 组织成一次实验。它证明“题目定义”和“可复现运行矩阵”值得分层。

## NiceEval 学了什么

- 一个 Experiment 文件固定一个 Agent / model 配置，跨文件形成比较矩阵；
- `attempts`、`earlyExit`、eval selection、timeout 与 sandbox 都属于运行条件；
- 实验级 setup 可以管理每个 Experiment 一份的宿主侧资源；
- 通用参数通过 `flags` 进入运行时，`budget`、`maxConcurrency` 与 `sandboxReuse` 补足批跑成本和生命周期声明；
- `judge` 作为裁判**执行配置**进入 Experiment，使裁判 A/B 可签入且可复现，但不改变题目的评分规则。

## NiceEval 没跟什么

| agent-eval 字段 | NiceEval 处置 | 边界 |
|---|---|---|
| `agent`、`model`、`attempts`、`earlyExit`、`evals`、`timeout`、`sandbox` | 保留（`timeout` → `timeoutMs`） | 运行矩阵本体 |
| `setup` | 收窄并与 `teardown` 成对 | 只管整场一次的宿主资源；沙箱内准备归 `SandboxLayer` |
| `validation`、`scripts` | 删除 | rubric、校验命令与 severity 归 Eval |
| `brands` | 删除 | 产品业务字段，不进入通用框架 |
| `editPrompt` | 删除 | prompt 归 Eval 或 Agent，不由 Experiment 隐式重写 |
| `onRunComplete` | 拆分 | 分析归 Reporter，资源回收归 `teardown` |
| `modelPolicy` | 删除 | `model` 省略即 Agent 原生默认 |
| `copyFiles` | 删除 | 产物与 agent diff 已有明确读取面 |
| `webResearch` / `agentOptions` | 合并为 `flags` | 一个 JSON 参数袋，整袋进入配置身份 |

最终边界是：Experiment 决定**怎样运行与怎样执行裁判**，但不定义**什么答案算对**。评分材料、rubric、阈值与 severity 始终留在 Eval。
