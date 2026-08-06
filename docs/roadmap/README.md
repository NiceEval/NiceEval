# Roadmap

这里放已经定稿、尚未落地的目标功能契约。
Roadmap 与 Feature 使用相同的最终状态体裁；两者只区分是否已经完成实现与验收，不区分设计成熟度。

讨论过程、候选比较与待裁决分歧放进 [`../design/`](../design/README.md)，翻案历史放进 [`../../memory/`](../../memory/INDEX.md)。
目标落地并验收后并入 [`../feature/`](../feature/)，不在正文保留迁移时间线。

## 结构

Roadmap 与 Feature、Design 候选共用 [Feature Design Package](../_template/feature-design/README.md):

- `README.md` 必备，写问题、最终心智与范围。
- `library.md`、`cli.md`、`architecture.md`、`lifecycle.md` 与 `use-case/` 按需使用,体裁与 Feature 完全相同。
- Roadmap 正文不写审查状态、候选方案、开放问题、实现进度或“定稿后”清单。

一个方向出现多个需要正式比较的候选时,移入 [`../design/`](../design/README.md),让每个候选成为独立 `PLAN-N/`。

- [Multi-Agent](multi-agent/README.md) —— 多 agent eval 场景
- [Adapters](adapters/README.md) —— Cursor Agent SDK、vm0 与其它适配器接入
- [NiceEval 测试体系重构](testing/README.md) —— 真实场景 Repo + 原生 Result / Journey；含 Unit、E2E、本地 / Docker / CI、历史问题对账与可读 TypeScript Example
- [结果携带与 Sandbox 复用反馈](reuse-feedback/README.md) —— 消除 `reused` 一词两义，并补齐 Sandbox 复用的运行级反馈
- [运行观测协议](observation-protocol/README.md) —— Agent 事件流、Live、Record、OTel 与 Report 投影共用一份事实协议
- [注入凭据的转写脱敏](credential-redaction/README.md) —— 已知凭据值的精确替换
- [Prepare 阶段瞬时失败自愈](prepare-transient-retry/README.md) —— 内置 prepare 命令的瞬时重试
