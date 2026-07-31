# 多容器环境 —— 目标

**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) ·
[PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) ·
[PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)

---

## 目的

为「agent 容器 + 若干伴随服务 + 一张网」形态的 eval 选一个
声明与执行形态,让 TB 类任务能在 niceeval 里原生表达,
并把「环境不对等」从静默假 `failed` 变成显式结果。

范围边界:本决策只管环境的**声明形态**与**谁负责构建与启动**;
agent 进程的寿命与退出语义是所有候选方案共同的前提,
在 [Roadmap · Agent 进程契约](../../roadmap/agent-process-contract/README.md)
单独定稿,不参与本对比。

---

## 设计原则

- **核心中立不破**:运行器、评分、报告不出现 provider 名
  分支;服务的构建与启动方式只能住在 provider 侧
  (见[架构边界](../../architecture.md))。
- **`Sandbox` 接口不扩大**:agent 仍活在唯一一个沙箱里,
  workdir、变更分类账、send 窗口归因、留存的锚点不动。
- **既有裁决不推翻**:
  [没有跨 provider 构建 DSL](../../feature/sandbox/library/prebuilt-environments.md#为什么没有跨-provider-构建-dsl)
  与 [环境预置放哪](../../feature/sandbox/library.md#环境预置放哪)
  的分层继续成立;候选方案与它们冲突时要把冲突摊开说清。
- **假结论最小化优先于功能覆盖面**:一个方案若在某些
  provider 上做不到,宁可显式 `skipped`,不许静默降级成
  错误环境里的假 `failed`。
- **provider 原生能力做到最大,不为跨 provider 对齐让步**:
  每个 provider 把自己运行载体的原生能力(Compose 语义、模板
  cache、VM 整组冻结)发挥到最满,而不是收敛到所有家都能
  兑现的最小公倍数。跨 provider 可迁移不是承诺;同一
  profile 在两家 provider 是否可比,由项目自己裁定并记录。

---

## 需求

- **R1 环境可声明**:一条 eval 能声明它的任务环境(含伴随
  服务),声明不指名 provider——写不透明 profile id,或在
  eval 目录里声明 sandbox source;怎么构建并启动由当前
  SandboxSpec 决定。
- **R2 就绪门**:服务未就绪前 agent 不进场;就绪失败按
  环境错误计(`errored`),不产生 agent 预算消耗。
- **R3 判分时服务活着**:服务寿命上界在评分之后,
  「判分时服务已死」这类假 `failed` 从机制上不可能。
- **R4 服务名可解析**:agent 与 `test(t)` 的校验命令都能
  用服务名访问服务;同一次运行里两者看到的解析结果一致。
- **R5 能力协商**:环境需求与 provider 能力在解析期取交集,
  缺能力的组合零成本判 `skipped` 并写明缺项,不进通过率
  分母。
- **R6 指纹可算**:环境定义的任何变化(含服务镜像解析后的
  内容摘要与构建输入)让引用它的 eval 重跑;两次 run 的
  可比性判据仍是一份纯数据。
- **R7 失败证据**:服务日志自动进 attempt artifacts;
  服务启动与就绪等待进 `phases` 时间树。
- **R8 迁移成本有界**:一个已有 compose 定义的 TB 任务,
  compose 保持单一事实源、被支持它的 provider 原生消费,
  不靠人工逐字段转写成 niceeval 词汇;eval 侧只补
  `mainService` 这类 overlay 级声明。
- **R9 泄漏面收口**:服务容器与网络纳入与沙箱同级的
  清理、留存与孤儿核对故事,强杀路径不留无主资源。
- **R10 预算口径完整**:构建所需 image、创建网络、启动 Sandbox 与服务并等待 ready(建网、拉镜像、构建、
  就绪等待)计入 attempt 的计时与并发预算,不存在不受
  超时与并发位约束的阶段。
- **R11 无假绿**:选中集合全部因能力缺项跳过时,run 以
  显式错误结束;`skipped` 永不进通过率分母。

---

## 不是本 doc 的目标

- **agent 进程寿命与非零退出语义** ——
  [Roadmap · Agent 进程契约](../../roadmap/agent-process-contract/README.md)。
- **egress / 网络出口管控** —— 独立能力,不随本决策定稿。
- **跨实验共享、寿命长于一次 run 的外部服务** ——
  维持[环境预置放哪](../../feature/sandbox/library.md#环境预置放哪)
  的「外部编排」行,不进本决策。
- **对导出报告断言环境行为** —— 归
  [E2E 验收 DSL](../../roadmap/e2e-acceptance-dsl/README.md)。
