# Prepare 阶段瞬时失败自愈

[执行失败分类](../../feature/error-classification/README.md)用两轴回答「能不能换个时机再试」与「死因波及多远」。
时间轴 `retryable` 的消费点只有两处：包住 `agent.send` 的重试执行体，以及 sandbox provisioning 内部重试。
`sandbox.prepare` 命令与 `test(t)` 体内的失败，无论分类结果如何，都不进任何重试执行体。

本主题讨论是否、以及怎样把**可证明瞬时、且重放安全**的 prepare 失败纳入 attempt 内自愈，而不是一律落成 `errored` 再靠整次 invocation 续跑。

## 解决的问题

批跑里大量 `errored` 死在 agent 真正做题之前：沙箱已创建，`prepare` / 依赖安装撞外网抖动后直接封口。
观察面能看到 `sandbox.prepare.*` 或 install 阶段的 stderr，也能看到 skill / session 注入已发生，但没有「框架试过自愈没有」的摘要——因为这里从未重试。

真实批跑样本（`compare/codex-gpt-5.6-luna--obelisk`，2026-08-05 快照：24 passed · 1 failed · 11 errored）里，11 条 `errored` 全部落在沙箱准备或依赖安装，可按处置路径分成三类：

| 类型 | 数量级 | 阶段 | 错误本质 | 与两轴关系 |
|---|---|---|---|---|
| Git checkout TLS 断流 | 3–4 | `sandbox.prepare` / eval 检出 | `curl 56 GnuTLS recv error` → early EOF / invalid index-pack | 时间轴：重放检出通常安全；空间轴：单条 attempt 网络，默认 `attempt` |
| 包管理器 registry 网络 | ~3 | install | yarn/pnpm `ECONNRESET`、fetch aborted | 同上；重放 `install` 通常可收敛 |
| 基线环境缺 `python3` | ~5 | `sandbox.prepare.eval`（如 rustup 后脚本） | `python3: command not found` | **不可重试**；确定性缺依赖，应修镜像/配方或声明 scope，重试只会全灭 |

同一批里唯一真正的 `failed`（非 `errored`）是领域判分（judge `includes` 未命中）。
那是记忆 / 任务条件有效性信号，不在本主题。

第二类浪费与 error-classification 的动机同构：瞬时故障被放大成终局 `errored`，唯一外层恢复是[重跑同一条命令只补失败 attempt](../../feature/experiments/cache.md)。
该路径正确但粗：又付一次沙箱创建与前面已成功的 prepare 步骤。

第三类则是反例：缺 `python3` 再试仍挂。
官方基线已裁决[保证 python3](../../feature/sandbox/library/prebuilt-environments.md#跨-provider-基线工具面)；本主题不把它纳入可重试面。

## 与已定稿契约的关系

| 已定稿点 | 当前纪律 | 本主题要动哪里 |
|---|---|---|
| [消费点是位置性的](../../feature/error-classification/README.md#消费点是位置性的) | prepare / `test` 无重试执行体；分类链在这些位置不产时间轴 | 是否新增第三条消费点，或把重试收进命令自身 |
| [已创建 Sandbox 的文件 IO 重试](../../feature/sandbox/architecture.md#已创建-sandbox-的文件-io-重试) | `runCommand` / `runShell` **永远不**隐式重试（副作用未知） | 不推翻通用命令纪律；只讨论有界、幂等的官方面 |
| [内置 prepare 命令](../../feature/sandbox/prepare-commands.md) | `checkout` / `installTool` 有检查与 identity，失败即 `sandbox.prepare.<owner>` | 是否由命令自己拥有网络瞬时重试（它最清楚幂等边界） |
| [Provisioning 失败与重试](../../feature/sandbox/architecture.md#provisioning-失败与重试) | 只覆盖 `createSandbox` | 不扩展到 prepare；两层只共享词表与退避形状 |
| [空间轴 scope](../../feature/error-classification/README.md#分类) | 确定性兄弟必死可落闸 | 缺依赖类可用 `EvalFatalError` / `ExperimentFatalError` 或 `classifyFailure`，**不**靠重试 |
| [运行中观察](../live-run-observation/README.md) | 候选把 `infra.network` 等 kind 标在旁路面 | 观察词表可对齐；自愈策略仍归本主题 / error-classification |

作者面已有出路：「prepare 里想容忍抖动，自己 try 一次即可」（[error-classification · library](../../feature/error-classification/library.md)）。
本主题问的是：**官方是否应对最常见的网络准备面给出零配置自愈**，避免每条 eval 手写相同退避。

## 核心心智

1. **`errored` 仍是基建结论，不改成 `failed`。**
   自愈成功则结果零痕迹（与 send 重试一致）；耗尽后仍是 `errored`，message 带重试摘要。

2. **时间轴判据仍是重放安全性，不是「看起来像网络」。**
   能证明「整条 prepare 命令可安全重放」才可重试。
   半截写过 workdir、装过一半且不可重入的脚本，歧义一律不重试——与 send 的受理证据门同向。

3. **空间轴与时间轴继续正交。**
   瞬时网络先被 attempt 内吸收；确定性缺依赖、坏 fixture、实验共享服务死亡走 scope 闸或修环境。
   可重试失败耗尽后默认仍不扩 scope（与 provisioning 瞬时耗尽一致）。

4. **通用 `runCommand` 默认仍不隐式重试。**
   框架不知道作者 shell 的副作用。
   自愈挂在「声明了幂等边界」的面上，而不是打开所有命令的自动重试。

## 候选方案

### 候选 A：内置 prepare 命令自带瞬时重试（推荐起点）

`checkout()` 与（可选）`installTool()` 的 `install` 步在命令实现内对网络瞬时失败做有界退避重试。
Runner / SandboxLayer 协议不变；`runCommand` 公共纪律不变。

| 项 | 候选契约 |
|---|---|
| 识别 | stderr / exit 形态命中内建瞬时表：GnuTLS recv、early EOF、ECONNRESET、fetch aborted、registry 超时等；确定性失败（ref 不存在、鉴权 401/403、磁盘满、`command not found`）第一次抛出 |
| 重放单元 | **整条**内置命令（checkout 从干净目标或官方镜像缓存语义重来；installTool 的 install 步重跑后复检 probe） |
| 预算 | 与 provisioning / send 同形的小封顶（例如至多 3 次尝试 + 指数全抖动），参数固定、零配置 |
| 观察 | activity：`prepare retry 2/3 (network) — checkout`；耗尽 message 带 `retries exhausted` |
| 副作用边界 | 仅官方命令承诺的幂等语义；作者 opaque `prepare()` callback 不享受 |

优点：改动面最小，直接覆盖 checkout TLS 与「用 installTool 包住的安装」；不打开通用 shell 重试的副作用闸。
代价：作者手写 `shell("yarn install")` 仍不自愈，除非改写为 `installTool` 或自写 try。

### 候选 B：prepare 链级重试执行体（第三条时间轴消费点）

在 Runner 执行两层 `prepare()` 时，对**单条** `StableSandboxCommand` 失败走与 send 同形的分类链 + 有界重试。
`retryable` 在生命周期阶段失败链上开始有消费点。

| 项 | 候选契约 |
|---|---|
| 谁可重试 | 仅 `StableSandboxCommand`（`command` / `shell` / `defineSandboxCommand` / 内置命令）；opaque callback 仍不重试 |
| 分类 | 命令失败文本过保守瞬时分类器；作者可在命令 identity 旁声明 `retryPolicy: "network-idempotent"`（名字待裁）才打开，**默认关闭** |
| 重放 | 失败命令整段重跑；已成功的前序 prepare 不重放 |
| 与 IO 重试 | 仍不碰 `runCommand` 包装层；重试在 prepare 调度层 |

优点：覆盖 MemoryBench 一类 `shell("yarn install --immutable")` 惯用法。
代价：默认关闭则作者仍要声明；默认打开则半装失败的 shell 可能把 workdir 弄得更脏，需严格「仅瞬时 + 作者背书幂等」。

### 候选 C：仅观察与补跑策略，attempt 内不重试

不新增 prepare 重试。强化：

- 终态 / 运行中把 `infra.network` 与 `env.missing` 分开（对齐 [live-run-observation](../live-run-observation/README.md)）；
- 文档与 CLI 明确「网络 `errored` 可 `--rerun` 补跑，缺依赖先修镜像」；
- 确定性缺依赖在 prepare 用 `EvalFatalError` 停同 eval 剩余 attempt。

优点：零副作用风险，契约面不动。
代价：批跑外网抖动继续按 attempt 粒度付冷启动；与用户「有些应该允许再试」的诉求不对齐。

## 确定性缺依赖（不进时间轴）

下列失败**禁止**标 `retryable: true`，无论候选 A/B 还是 C：

- `python3: command not found`、`rustc: command not found` 等基线 / 配方缺口；
- fixture 路径缺失、template 不存在、凭据缺失；
- 包管理器语义错误（lockfile 冲突、peer 依赖无解），非传输层。

处置：

1. **修环境**：官方基线保证 python3；题面需要的编译链进预制产物或 prepare 的显式安装，不靠重试撞运气。
2. **空间轴**：同 eval / 同实验必复现时，prepare 抛 `EvalFatalError` / `ExperimentFatalError`，或实验 `classifyFailure` 给出 `scope`，避免 5 次 attempt 同因全灭。
3. **读数**：报告与补跑工具把此类与 `infra.network` 分开，避免自动 `--rerun=errored` 把确定性死题刷成重复账单。

## 范围

**包含（待裁决）**

- prepare 相位网络瞬时失败是否 attempt 内自愈，以及挂在内置命令还是链级执行体；
- 瞬时识别表与「重放安全」边界（整命令重跑 vs 禁止半状态续跑）；
- 观察面：activity 行、耗尽摘要、与 `FailureClass.reason`（如 `network`）对齐；
- 与续跑 / 指纹的关系：自愈成功不进 `errored`；耗尽后仍不进缓存，续跑语义不变。

**不包含**

- 改 `AttemptError.code` 公开形状或 `failed` / `errored` 判定；
- 给通用 `runCommand` / `runShell` 打开隐式重试；
- 用 `attempts` 当基建抖动预算（仍是通过率分母）；
- agent send 中途断流的重试纪律（仍归受理证据门）；
- 官方基线是否装 python3 / 是否预装 yarn（已在预制环境契约定稿）；
- 领域 `failed`（judge、gate）的重试或自动补跑。

## 待裁决分歧

1. **挂载点**：只做候选 A（内置命令），还是 A + 可选 B（声明幂等的 Stable 命令）？
2. **默认开还是声明开**：`checkout` 是否默认重试；作者 `shell("pnpm i")` 是否必须 opt-in。
3. **识别权威**：只认 exit + 有界 stderr 模式，是否允许命令声明 `classifyPrepareFailure`？
4. **半状态**：checkout 失败后目标目录半写，重试前是否强制清目标 / 仅依赖镜像缓存路径？
5. **预算数字**：与 send（4）或 IO（3）对齐，还是 prepare 单独更短（外网慢、deadline 紧）？
6. **槽位**：prepare 退避是否释放全局并发位（与 send / provisioning 同形）？
7. **词表**：耗尽后 `FailureClass` 是否携带 `reason: "network"` 供 reading / live 使用，且仍 `retryable: false`（已耗尽）？

## 成功标准（设计层）

1. 同一次 attempt 内，Git TLS / registry 抖动在预算内可被吸收，结果与一次成功 prepare 无异。
2. `python3: command not found` 类确定性失败**零**次被重试，且文案或 scope 指向修镜像 / 配方。
3. 通用 `runCommand` 公共纪律不被打开；无幂等声明的 opaque prepare 行为与今日一致。
4. 读者能从 message / activity 区分：从未重试、重试耗尽、领域 `failed`。

## 入口

- 本文件：问题、与 error-classification 的缺口、候选与分歧
- 定稿后：补丁进 [error-classification](../../feature/error-classification/README.md)（消费点与自愈阶梯）与 [sandbox prepare-commands](../../feature/sandbox/prepare-commands.md) / [architecture](../../feature/sandbox/architecture.md)；不另立平行词表

## 相关阅读

- [执行失败分类](../../feature/error-classification/README.md) —— 两轴、消费点位置性、自愈阶梯
- [读懂一次 errored](../../feature/error-classification/use-case/reading-errored.md) —— 有无 `retries exhausted` 后缀
- [内置 prepare 命令](../../feature/sandbox/prepare-commands.md) —— `checkout` / `installTool`
- [Sandbox · 命令不自动重试](../../feature/sandbox/library/operations.md) —— 副作用边界
- [跨 provider 基线工具面](../../feature/sandbox/library/prebuilt-environments.md#跨-provider-基线工具面) —— python3 / yarn 基线
- [运行中观察](../live-run-observation/README.md) —— `infra.network` 观察候选
- [缓存与携带](../../feature/experiments/cache.md) —— `errored` 不进指纹、续跑只补失败
