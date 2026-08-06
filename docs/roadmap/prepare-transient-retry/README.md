# Prepare 阶段瞬时失败自愈

**审查状态（ChatGPT Pro，2026-08-05）：定稿方向为候选 A。**  
官方内置 prepare 命令自拥网络瞬时重试；**拒绝**第三条全局 retry 消费点；确定性缺依赖零重试。

[执行失败分类](../../feature/error-classification/README.md)用两轴回答「能不能换个时机再试」与「死因波及多远」。
时间轴 `retryable` 的消费点只有两处：包住 `agent.send` 的重试执行体，以及 sandbox provisioning 内部重试。
`sandbox.prepare` 命令与 `test(t)` 体内的失败，无论分类结果如何，都不进任何重试执行体。

本主题把**可证明瞬时、且重放安全**的 prepare 失败纳入 attempt 内自愈，而不是一律落成 `errored` 再靠整次 invocation 续跑——且**不**把 `retryable` 扩成第三条 Runner 生命周期消费点。

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

| 已定稿点 | 当前纪律 | 本主题裁定 |
|---|---|---|
| [消费点是位置性的](../../feature/error-classification/README.md#消费点是位置性的) | prepare / `test` 无重试执行体 | **不**新增第三条消费点；自愈是**命令内部行为** |
| [已创建 Sandbox 的文件 IO 重试](../../feature/sandbox/architecture.md#已创建-sandbox-的文件-io-重试) | `runCommand` / `runShell` **永远不**隐式重试 | 不推翻；仅官方幂等 prepare 命令自拥重试 |
| [内置 prepare 命令](../../feature/sandbox/prepare-commands.md) | 失败即 `sandbox.prepare.<owner>` | `checkout` / `installTool` 等对网络瞬时失败有界重试 |
| [Provisioning 失败与重试](../../feature/sandbox/architecture.md#provisioning-失败与重试) | 只覆盖 `createSandbox` | 与 prepare **分层独立**；可共享退避形状与词表 |
| [空间轴 scope](../../feature/error-classification/README.md#分类) | 确定性兄弟必死可落闸 | 缺依赖类止损，**不**靠重试 |
| [运行观测协议](../observation-protocol/README.md) | 旁路 phase / 可选 kind | 观察可对齐 `phase` 与既有 reason；**不**为本主题新造 failure kind 词表 |

作者面已有出路：「prepare 里想容忍抖动，自己 try 一次即可」（[error-classification · library](../../feature/error-classification/library.md)）。
本主题给官方最常见网络准备面**零配置自愈**，避免每条 eval 手写相同退避。

## 核心心智

1. **`errored` 仍是基建结论，不改成 `failed`。**  
   自愈成功则结果零痕迹（与 send 重试一致）；耗尽后仍是 `errored`，message 带重试摘要。

2. **时间轴判据仍是重放安全性，不是「看起来像网络」。**  
   能证明「整条 prepare 命令可安全重放」才可重试。  
   半截写过 workdir、装过一半且不可重入的脚本，歧义一律不重试。

3. **空间轴与时间轴继续正交。**  
   瞬时网络先被 attempt 内吸收；确定性缺依赖、坏 fixture、实验共享服务死亡走 scope 闸或修环境。

4. **通用 `runCommand` 默认仍不隐式重试。**  
   自愈挂在「声明了幂等边界」的**官方命令**上，而不是打开所有命令的自动重试。

5. **Prepare 的问题不是「框架不知道什么时候重试」，而是「框架不知道某个 prepare 动作是否安全重放」。**  
   因此重试权限属于命令实现，不属于 Runner 生命周期执行体。

## 主案：内置 prepare 命令自带瞬时重试（原候选 A）

`checkout()` 与 `installTool()` 的 install 步在**命令实现内**对网络瞬时失败做有界退避重试。
Runner / SandboxLayer 协议不变；`runCommand` 公共纪律不变；error-classification 的 `retryable` 消费点仍只有 send 与 provisioning。

| 项 | 契约 |
|---|---|
| 识别 | stderr / exit 形态命中内建瞬时表：GnuTLS recv、early EOF、ECONNRESET、fetch aborted、registry 超时等；确定性失败（ref 不存在、鉴权 401/403、磁盘满、`command not found`）第一次抛出 |
| 重放单元 | **整条**内置命令（checkout 从干净目标或官方镜像缓存语义重来；installTool 的 install 步重跑后复检 probe） |
| 预算 | 与 provisioning / send 同形的小封顶（例如至多 3 次尝试 + 指数全抖动），参数固定、零配置 |
| 观察 | activity：`prepare retry 2/3 (network) — checkout`；耗尽 message 带 `retries exhausted` |
| 副作用边界 | 仅官方命令承诺的幂等语义；作者 opaque `prepare()` callback 与直接调用 `shell("yarn install")` **不**享受 |

优点：改动面最小，直接覆盖 checkout TLS 与 installTool 安装；不打开通用 shell 重试的副作用闸。  
代价：作者手写 `shell("yarn install")` 仍不自愈，除非改写为 `installTool` 或自写 try。

## 否决：候选 B（第三条时间轴消费点）

曾讨论：在 Runner 执行两层 `prepare()` 时，对单条 `StableSandboxCommand` 失败走与 send 同形的分类链 + 有界重试，使 `retryable` 在 prepare 生命周期阶段上有消费点。

**否决理由：**

- 破坏 error-classification「消费点是位置性的、由拥有重放安全知识的执行体消费」。
- Runner 不知道任意 `shell` / 作者命令是否幂等。
- 默认打开会弄脏半状态 workdir；默认关闭则与「作者自己 try」等价，不值得扩契约面。

**1.0 不做 B。** 远期若需要，只能作为**显式 opt-in 的命令级声明**单独设计，且仍不得成为第三条全局消费点；不在本主题 1.0 范围。

## 否决：候选 C（attempt 内永不重试）

仅观察 + 外层补跑不足以覆盖批跑外网抖动的成本诉求；在 A 的有界幂等前提下不采用 C。

## 确定性缺依赖（不进时间轴）

下列失败**禁止**标可重试，**零次**被 A 重试：

- `python3: command not found`、`rustc: command not found` 等基线 / 配方缺口；
- fixture 路径缺失、template 不存在、凭据缺失；
- 包管理器语义错误（lockfile 冲突、peer 依赖无解），非传输层。

处置：

1. **修环境**：官方基线保证 python3；题面需要的编译链进预制产物或 prepare 的显式安装。
2. **空间轴**：同 eval / 同实验必复现时，prepare 抛 `EvalFatalError` / `ExperimentFatalError`，或实验 `classifyFailure` 给出 `scope`。
3. **读数**：报告与补跑工具把此类与网络瞬时分开，避免自动 `--rerun=errored` 把确定性死题刷成重复账单。

## 范围

**包含（1.0）**

- 内置 prepare 命令对网络瞬时失败的 attempt 内自愈；
- 瞬时识别表与「整命令重放」边界（半状态：checkout 失败后清目标或走缓存路径——实现层细节，见下）；
- 观察面：activity 行、耗尽摘要；与 live-run 的 phase 对齐；
- 与续跑 / 指纹：自愈成功不进 `errored`；耗尽后仍不进缓存，续跑语义不变。

**不包含**

- 第三条 `retryable` 全局消费点（原候选 B）；
- 给通用 `runCommand` / `runShell` 打开隐式重试；
- 改 `AttemptError.code` 公开形状或 `failed` / `errored` 判定；
- 用 `attempts` 当基建抖动预算；
- agent send 中途断流的重试纪律；
- 为 prepare 新建平行 failure kind 词表（用既有 reason / message 即可）；
- 领域 `failed` 的重试。

## 实现前仍开放的细节（不改主案）

1. **半状态**：checkout 失败后目标目录半写，重试前强制清目标 vs 仅依赖镜像缓存路径——实现选型，须保证重放等价。
2. **预算数字**：与 send（4）或 IO（3）对齐，还是 prepare 单独更短（外网慢、deadline 紧）。
3. **槽位**：prepare 退避是否释放全局并发位（与 send / provisioning 同形）。
4. **识别表演进**：只认 exit + 有界 stderr 模式；命令级 `classifyPrepareFailure` 非 1.0 必需。

## 成功标准（设计层）

1. 同一次 attempt 内，Git TLS / registry 抖动在预算内可被吸收，结果与一次成功 prepare 无异。
2. `python3: command not found` 类确定性失败**零**次被重试，且文案或 scope 指向修镜像 / 配方。
3. 通用 `runCommand` 公共纪律不被打开；无幂等声明的 opaque prepare 行为与今日一致。
4. 读者能从 message / activity 区分：从未重试、重试耗尽、领域 `failed`。
5. error-classification 文档仍写「retryable 消费点只有两处」。

## 入口

- 本文件：问题、主案 A、否决 B/C、与 error-classification 边界
- 定稿后：补丁进 [error-classification](../../feature/error-classification/README.md)（澄清：命令内部重试不是新消费点）与 [sandbox prepare-commands](../../feature/sandbox/prepare-commands.md) / [architecture](../../feature/sandbox/architecture.md)

## 相关阅读

- [执行失败分类](../../feature/error-classification/README.md) —— 两轴、消费点位置性、自愈阶梯
- [读懂一次 errored](../../feature/error-classification/use-case/reading-errored.md) —— 有无 `retries exhausted` 后缀
- [内置 prepare 命令](../../feature/sandbox/prepare-commands.md) —— `checkout` / `installTool`
- [Sandbox · 命令不自动重试](../../feature/sandbox/library/operations.md) —— 副作用边界
- [跨 provider 基线工具面](../../feature/sandbox/library/prebuilt-environments.md#跨-provider-基线工具面) —— python3 / yarn 基线
- [运行观测协议](../observation-protocol/README.md) —— phase 观察
- [缓存与携带](../../feature/experiments/cache.md) —— `errored` 不进指纹、续跑只补失败
