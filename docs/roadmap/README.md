# Roadmap

这里放仍有开放分歧、尚未定稿的候选设计。
Roadmap 表示设计成熟度，不表示代码是否实现；正文讨论希望解决的问题、候选契约和待裁决分歧，不用 `未实现` 描述代码状态。

设计定稿后按目标形态重写并移入 [`../feature/`](../feature/)，不在原文追加 `现已定稿` 一类的时间线说明。

- [环境层](environment-model/README.md) —— 重环境的一等声明:层(identity + check + apply)统一 agent 与条件工具,预制产物退为缓存,制品矩阵消失
- [Multi-Agent](multi-agent/README.md) —— 多 agent eval 的三种场景
- [Adapters](adapters/README.md) —— LangGraph、OpenClaw 与其它候选接入
- [E2E 验收断言 DSL 与 vitest 验收库](e2e-acceptance-dsl/README.md) —— 终端/HTML 语义结构断言 DSL、容差 golden 与 vitest 宿主的候选契约
- [Evidence 复用政策](evidence-reuse/README.md) —— 比较证明优先与复用优先两套默认；用角色声明、精确授权和冲突用例设计历史 Evidence 何时仍算数
- [复用与携带的可观察性](reuse-observability/README.md) —— `carried` 改词、复用反馈维度、生效并发显示、配额自查与 `--reuse-verify`
- [Agent 进程契约](agent-process-contract/README.md) —— 进程寿命唯一边界是沙箱、agent 非零退出记 `errored`;多容器环境决策的先行前提
