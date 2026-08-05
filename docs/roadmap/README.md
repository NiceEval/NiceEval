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
- [NiceEval 测试体系重构](e2e-acceptance-testing/README.md) —— 统一 Behavior 主证明、机制 unit、旧测试退役、数量预算、evidence world 与历史缺陷题库；路径沿用早期 E2E 设计名，review 完成前不迁入 Engineering
- [E2E 验收 DSL](e2e-acceptance-dsl/README.md) —— 把 stdout、PTY、JSON、HTML 与浏览器变成领域读面的媒介词表与 vitest 装配
- [Repo 验收](repo-acceptance-testing/README.md) —— 上两项在组织机制上的替代候选：加题走消费方仓库，断言同时读过程与结果；继承题库、准入门槛与分层归属
- [结果携带与 Sandbox 复用反馈](reuse-feedback/README.md) —— 消除 `reused` 一词两义，并补齐 Sandbox 复用的运行级反馈
- [运行中观察](live-run-observation/README.md) —— 给旁路 agent / 非 TTY 补齐 attempt phase 与 `watch` 附着面，消除「只能 docker exec 或读盘」的盯跑路径
- [实验改名与结果重绑](experiment-rename/README.md) —— 文件名即 experimentId 时显式迁移历史结果（如 TB `codex` → `codex-5.6-luna`），与 accept 的指纹重锚分工
- [Record v2](record-v2/README.md) —— 将运行观测、输入溯源、当时裁决与可重算投影拆开，建立可审计记录模型
- [注入凭据的转写脱敏](credential-redaction/README.md) —— 对全部落盘转写面做已知值精确替换，堵住 agent 转写把注入凭据带进 `events.json` 的落盘面
- [Prepare 阶段瞬时失败自愈](prepare-transient-retry/README.md) —— 网络抖动死在 `sandbox.prepare` 时是否 attempt 内重试；对齐 error-classification 第三条消费点与确定性缺依赖止损
