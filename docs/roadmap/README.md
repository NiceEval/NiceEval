# Roadmap

这里放已经定稿、尚未被产品采用为当前契约的方向。
Roadmap 与 Feature 使用相同的最终状态体裁；两者区分采用状态，不区分设计成熟度或源码进度。

讨论过程、候选比较与待裁决分歧放进 [`../design/`](../design/README.md)，翻案历史放进 [`../../memory/`](../../memory/INDEX.md)。
方向被采用为唯一当前目标时并入 [`../feature/`](../feature/)，不在正文保留迁移时间线。

## 结构

Roadmap 与 Feature、Design 候选共用 [Feature Design Package](../_template/feature-design/README.md):

- `README.md` 必备，写问题、最终心智与范围。
- `library.md`、`cli.md`、`architecture.md`、`lifecycle.md` 与 `use-case/` 按需使用,体裁与 Feature 完全相同。
- Roadmap 正文不写`审查状态`、候选方案、开放问题、`实现进度`或“定稿后”清单。

一个方向出现多个需要正式比较的候选时,移入 [`../design/`](../design/README.md),让每个候选成为独立 `PLAN-N/`。

- [Admission Health](admission-health/README.md) —— 在 Agent 进入前验证 producer occurrence，不为不可用资源创建 Attempt。
- [发现边界](discovery-boundaries/README.md) —— 让目录入口明确拥有递归发现范围，并由 CLI 解释截止原因。
- [Eval Trajectory](eval-trajectories/README.md) —— 让有依赖的 Eval DAG 按 immutable Run 与 exact Checkpoint 暂停和恢复。
- [Experiment Authoring](experiment-authoring/README.md) —— 统一展示名与具名 Experiment 族的身份边界。
- [Experiment Pilot 抽样](experiment-pilot-sampling/README.md) —— 用共同 Eval ID、固定 seed 与 non-final coverage 运行可复现小样本。
- [Judge Runtimes](judge-runtimes/README.md) —— 收拢 Agent Judge 与原生 LLM Judge 的材料、权限和结果边界。
- [Multi-Agent](multi-agent/README.md) —— 多 Agent Eval 场景。
- [Report 图表语义内核](report-chart-kernel/README.md) —— 让 terminal、web 与 static 从同一组闭合图表事实投影。
- [Record 库存](record-inventory/README.md) —— 盘点 receipt 交付前中断留下的 Run。
- [可重评分 Eval](replayable-grading/README.md) —— 分离多轮 Execution 与只读 Grading，并对 sealed Record 独立重判。
- [Sandbox Materialization](sandbox-materialization/README.md) —— 统一 Docker Image 声明与 Provider Cache 生命周期。
- [Sandbox Prepare](sandbox-prepare/README.md) —— 收拢 checkout、Fixture 内容传输与官方命令的瞬时重试。
- [Sandbox 默认停驻与回收](sandbox-retention/README.md) —— 失败类 Sandbox 的有界停驻、明确销毁、持久管理与安全 GC。
- [Sandbox 复用反馈](sandbox-reuse-feedback/README.md) —— 补齐 Sandbox 物理复用的运行级摘要。
- [持久状态](state/README.md) —— 用 provider-issued Cohort 与 exact Checkpoint 管理可比较状态。
- [Workspace 访问证据](workspace-access-evidence/README.md) —— 采集 Agent 进程树的可信文件操作，并提供 Attempt-scope Assertion。

## Adapter 准入目标

NiceEval 只为拥有稳定程序化驱动面和结构化事件契约的上游提供官方 Adapter。Adapter 必须通过受支持的 CLI、SDK 或 API 驱动，不使用 GUI 自动化或私有逆向接口；已经满足准入条件的对象在 [Adapter SDK](../feature/adapters/sdk/README.md) 定义完整契约。

| 对象 | 准入契约 |
|---|---|
| Cursor Agent SDK | 稳定 API 涵盖 session、HITL 与 usage；真实示例证明这些能力；转换器不强制消费方安装完整 SDK 包 |
| vm0 | 官方接口提供稳定结构化事件与会话恢复契约 |

Alma 只有 GUI 或非公开驱动面，因此不属于官方 Adapter 目标。任何上游都必须先满足同一套受支持接口条件，不能用专属自动化旁路降低准入标准。
