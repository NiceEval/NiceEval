# Roadmap

这里放仍有开放分歧、尚未定稿的候选设计。
Roadmap 表示设计成熟度，不表示代码是否实现；正文讨论希望解决的问题、候选契约和待裁决分歧，不用 `未实现` 描述代码状态。

设计定稿后按目标形态重写并移入 [`../feature/`](../feature/)，不在原文追加 `现已定稿` 一类的时间线说明。

## 结构

Roadmap 与 Feature、Design 候选共用 [Feature Design Package](../_template/feature-design/README.md):

- `README.md` 必备,写问题、候选心智、范围与待裁决分歧。
- `library.md`、`cli.md`、`architecture.md`、`lifecycle.md` 与 `use-case/` 按需使用,体裁与 Feature 完全相同。
- 开放分歧只改变契约成熟度,不改变文件职责,也不另建 Roadmap 专用模板。

一个方向出现多个需要正式比较的候选时,移入 [`../design/`](../design/README.md),让每个候选成为独立 `PLAN-N/`。

- [Multi-Agent](multi-agent/README.md) —— 多 agent eval 的三种场景
- [Adapters](adapters/README.md) —— Cursor Agent SDK、vm0 与其它等待上游稳定的候选接入
- [NiceEval 测试体系重构](testing/README.md) —— 统一的 Portfolio / Recipe / World 方案；`dsl/`、`e2e/`、`unit/`、历史证据与完整 TypeScript Example 分层组织
- [结果携带与 Sandbox 复用反馈](reuse-feedback/README.md) —— 消除 `reused` 一词两义，并补齐 Sandbox 复用的运行级反馈
- [运行中观察](live-run-observation/README.md) —— `watch` + 增强 `exp --json`；**Pro：v1 收紧事件，可定稿**
- [实验改名与结果重绑](experiment-rename/README.md) —— 文件名即 experimentId 时显式迁移历史结果（如 TB `codex` → `codex-5.6-luna`），与 accept 的指纹重锚分工
- [现刻水位贡献：物理优先](sample-contribution-physical/README.md) —— 物理 attempt 贡献；selected 降为审计；**Pro：拟定稿 + SampleIssue**
- [报告收窄靠前置选择器](report-pre-selector/README.md) —— 删 web 切口径；fresh 仅宿主前置；**Pro：主案可定稿**
- [Record v2](record-v2/README.md) —— 权威三类 + 非权威投影；**Pro：分阶段，禁磁盘大爆炸**
- [注入凭据的转写脱敏](credential-redaction/README.md) —— 已知值精确替换；**Pro：归属 Record 写盘边界**
- [Prepare 阶段瞬时失败自愈](prepare-transient-retry/README.md) —— 内置 prepare 命令自拥瞬时重试；**Pro：定稿 A，否决第三条消费点**
