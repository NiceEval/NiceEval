# Roadmap

这里放已经定稿、尚未落地的目标功能契约。
Roadmap 与 Feature 使用相同的最终状态体裁；两者只区分是否已经完成实现与验收，不区分设计成熟度。

讨论过程、候选比较与待裁决分歧放进 [`../design/`](../design/README.md)，翻案历史放进 [`../../memory/`](../../memory/INDEX.md)。
目标落地并验收后并入 [`../feature/`](../feature/)，不在正文保留迁移时间线。

## 结构

Roadmap 与 Feature、Design 候选共用 [Feature Design Package](../_template/feature-design/README.md):

- `README.md` 必备，写问题、最终心智与范围。
- `library.md`、`cli.md`、`architecture.md`、`lifecycle.md` 与 `use-case/` 按需使用,体裁与 Feature 完全相同。
- Roadmap 正文不写`审查状态`、候选方案、开放问题、`实现进度`或“定稿后”清单。

一个方向出现多个需要正式比较的候选时,移入 [`../design/`](../design/README.md),让每个候选成为独立 `PLAN-N/`。

- [Multi-Agent](multi-agent/README.md) —— 多 agent eval 场景
- [Agent-as-Judge](agent-as-judge/README.md) —— 用独立 Direct 或 Sandbox Agent 调查证据并执行 Judge Assertion
- [原生 LLM Judge Runtime](llm-judge-runtime/README.md) —— 统一判分配方、规范化材料、Provider、多模态与静态判分图
- [Adapters](adapters/README.md) —— Cursor Agent SDK、vm0 与其它适配器接入
- [NiceEval 测试体系重构](testing/README.md) —— 真实场景 Repo + 原生 Result / Journey；含 Unit、E2E、本地 / Docker / CI、历史问题对账与可读 TypeScript Example
- [结果携带与 Sandbox 复用反馈](reuse-feedback/README.md) —— 消除 `reused` 一词两义，并补齐 Sandbox 复用的运行级反馈
- [分组 Sandbox 复用](sandbox-reuse-groups/README.md) —— Eval 侧显式列出必须共用 Sandbox 的成员，选中即生效，组外 Attempt 保持 fresh 并行
- [Sandbox 默认停驻与回收](sandbox-retention/README.md) —— 失败类 Sandbox 的有界停驻、明确销毁、持久管理与安全 GC
- [Docker 执行配置](docker-profiles/README.md) —— 官方 Docker Sandbox 的可验证执行 profile、rootless privileged 单容器 DinD、跨进程硬配额与故障回收
- [Provider Cache 生命周期](materialization-cache/README.md) —— 让 NiceEval 创建的 provider cache 可盘点、可解释并可安全回收
- [运行观测协议](observation-protocol/README.md) —— Agent 事件流、Live、Record、OTel 与 Report 投影共用一份事实协议
- [注入凭据的转写脱敏](credential-redaction/README.md) —— 已知凭据值的精确替换
- [Prepare 阶段瞬时失败自愈](prepare-transient-retry/README.md) —— 内置 prepare 命令的瞬时重试
- [有序 Eval 序列](ordered-sequences/README.md) —— 用独立 Sequence 声明现有 Eval 的顺序、完整重新执行与执行 lineage
- [Chart 语义内核与报告交互控制器](report-chart-kernel/README.md) —— 双面语义模型、精确值 HTML、键盘焦点与 Table 渐进增强
- [Assertion 作者面](assertion-authoring/README.md) —— 显式 Match domain、typed require、有数据的行为顺序与结构化 scope
