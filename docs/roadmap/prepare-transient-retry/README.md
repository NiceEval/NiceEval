# Prepare 阶段瞬时失败自愈

官方内置 prepare 命令自拥网络瞬时重试；**拒绝**第三条全局 retry 消费点；确定性缺依赖零重试。

[执行失败分类](../../feature/error-classification/README.md)用两轴回答「能不能换个时机再试」与「死因波及多远」。
时间轴 `retryable` 的消费点只有两处：包住 `agent.send` 的重试执行体，以及 sandbox provisioning 内部重试。
`sandbox.prepare` 命令与 `test(t)` 体内的失败，无论分类结果如何，都不进任何重试执行体。

本主题把**可证明瞬时、且可安全重新执行**的 prepare 失败纳入同一 Attempt 内的命令自愈，而不是一律形成
`errored` Verdict Claim 后再靠整次 invocation 续跑——且**不**把 `retryable` 扩成第三条 Runner 生命周期消费点。
本页的 `passed`、`failed`、`errored` 与 `skipped` 都是 Verdict Claim token；Attempt lifecycle 始终只有
`active`、`completed`、`abandoned`。

## 解决的问题

批跑里大量 Attempt 在 agent 真正做题之前形成 `errored` Verdict Claim：沙箱已创建，`prepare` / 依赖安装撞外网抖动后直接封口。
观察面能看到 `sandbox.prepare.*` 或 install 阶段的 stderr，也能看到 skill / session 注入已发生，但没有「框架试过自愈没有」的摘要——因为这里从未重试。

prepare 失败按处置路径分成三类：

| 类型 | 数量级 | 阶段 | 错误本质 | 与两轴关系 |
|---|---|---|---|---|
| Git checkout TLS 断流 | 3–4 | `sandbox.prepare` / eval 检出 | `curl 56 GnuTLS recv error` → early EOF / invalid index-pack | 时间轴：重新执行检出通常安全；空间轴：单条 attempt 网络，默认 `attempt` |
| 包管理器 registry 网络 | ~3 | install | yarn/pnpm `ECONNRESET`、fetch aborted | 同上；重新执行 `install` 通常可收敛 |
| 起点 Sandbox 缺 `python3` | ~5 | `sandbox.prepare.eval`（如 rustup 后脚本） | `python3: command not found` | **不可重试**；确定性缺依赖，应修镜像/配方或声明 scope，重试只会全灭 |

领域判分失败仍是 `failed`，不进入本主题的重试面。

第二类浪费与 error-classification 的动机同构：瞬时故障被放大成终局 `errored` Verdict Claim，唯一外层恢复是[重跑同一条命令只补失败 attempt](../../feature/experiments/cache.md)。
该路径正确但粗：又付一次沙箱创建与前面已成功的 prepare 步骤。

第三类则是反例：缺 `python3` 再试仍挂。
官方 Sandbox 已裁决[保证 python3](../../feature/sandbox/library/prebuilt-environments.md)；本主题不把它纳入可重试面。

## 与相邻契约的边界

| 契约面 | 保持的纪律 | prepare 自愈行为 |
|---|---|---|
| [消费点是位置性的](../../feature/error-classification/README.md#消费点是位置性的) | prepare / `test` 无重试执行体 | **不**新增第三条消费点；自愈是**命令内部行为** |
| [已创建 Sandbox 的文件 IO 重试](../../feature/sandbox/architecture.md#已创建-sandbox-的文件-io-重试) | `runCommand` / `runShell` **永远不**隐式重试 | 不推翻；仅官方幂等 prepare 命令自拥重试 |
| [内置 prepare 命令](../../feature/sandbox/prepare-commands.md) | 失败即 `sandbox.prepare.<owner>` | `checkout` / `installTool` 等对网络瞬时失败有界重试 |
| [Provisioning 失败与重试](../../feature/sandbox/architecture.md#provisioning-失败与重试) | 只涵盖 `createSandbox` | 与 prepare **分层独立**；可共享退避形状与词表 |
| [空间轴 scope](../../feature/error-classification/README.md#分类) | 确定性共享失败可停止同范围派发 | 缺依赖类失败，**不**靠重试 |
| [Record · phase 事实](../../feature/record/architecture.md) | 旁路 phase / 可选 kind | 观察可对齐 `phase` 与既有 reason；**不**为本主题新造 failure kind 词表 |

作者自定义 prepare 需要容忍抖动时自行声明并实现重试边界（[error-classification · library](../../feature/error-classification/library.md)）。
官方常用网络准备面提供零配置自愈，避免每条 Eval 手写相同退避。

## 核心心智

1. **`errored` 仍是基建 Verdict Claim，不改成 `failed`。**
   自愈成功不形成终局 `errored` Claim，但每次物理命令重试仍以 Observation 保存；耗尽后形成 `errored` Verdict Claim，
   并引用带重试摘要的执行错误 Observation。

2. **时间轴判据仍是重新执行安全性，不是「看起来像网络」。**
   能证明「整条 prepare 命令可安全重新执行」才可重试。
   半截写过 workdir、装过一半且不可重入的脚本，歧义一律不重试。

3. **空间轴与时间轴继续正交。**  
   瞬时网络先被 attempt 内吸收；确定性缺依赖、坏 fixture、实验共享服务失败时按 scope 停止派发，或直接修复 Sandbox。

4. **通用 `runCommand` 默认仍不隐式重试。**  
   自愈挂在「声明了幂等边界」的**官方命令**上，而不是打开所有命令的自动重试。

5. **Prepare 的问题不是「框架不知道什么时候重试」，而是「框架不知道某个 prepare 动作是否可安全重新执行」。**
   因此重试权限属于命令实现，不属于 Runner 生命周期执行体。

## 内置 prepare 命令自带瞬时重试

`checkout()` 与 `installTool()` 的 install 步在**命令实现内**对网络瞬时失败做有界退避重试。
Runner / SandboxLayer 协议不变；`runCommand` 公共纪律不变；error-classification 的 `retryable` 消费点仍只有 send 与 provisioning。

| 项 | 契约 |
|---|---|
| 识别 | stderr / exit 形态命中内建瞬时表：GnuTLS recv、early EOF、ECONNRESET、fetch aborted、registry 超时等；确定性失败（ref 不存在、鉴权 401/403、磁盘满、`command not found`）第一次抛出 |
| 重新执行单元 | **整条**内置命令（checkout 从干净目标或官方镜像缓存语义重来；installTool 的 install 步重跑后复检 探测） |
| 预算 | 总计至多 3 次尝试；两次重试前分别等待 `uniform(0, 1s)` 与 `uniform(0, 2s)`；参数固定、零配置 |
| 观察 | 每次命令发送与 activity 形成 Observation：`prepare retry 2/3 (network) — checkout`；耗尽的执行错误 Observation 带 `retries exhausted` |
| 副作用边界 | 仅官方命令承诺的幂等语义；作者 opaque `prepare()` callback 与直接调用 `shell("yarn install")` **不**享受 |

这条边界直接涵盖 checkout TLS 与 installTool 安装，不打开通用 shell 重试。
作者手写 `shell("yarn install")` 不自动自愈；作者必须改用 `installTool`，或在自己的 callback 内实现重试。

Runner 不消费 prepare 的 `retryable` 分类，也不重新执行任意 `StableSandboxCommand`。
Runner 无法证明 opaque callback 或通用 shell 是否幂等，自动重新执行会把半状态工作目录变成新的失败出处。

## 确定性缺依赖（不进时间轴）

下列失败**禁止**标可重试，**零次**被 A 重试：

- `python3: command not found`、`rustc: command not found` 等起点 Sandbox / 配方缺口；
- fixture 路径缺失、template 不存在、凭据缺失；
- 包管理器语义错误（lockfile 冲突、peer 依赖无解），非传输层。

处置：

1. **修 Sandbox**：官方 Sandbox 保证 python3；题面需要的编译链进预构建输出或 prepare 的显式安装。
2. **空间轴**：同 eval / 同实验必复现时，prepare 抛 `EvalFatalError` / `ExperimentFatalError`，或实验 `classifyFailure` 给出 `scope`。
3. **读数**：报告与补跑工具把此类与网络瞬时分开，避免自动 `niceeval exp --rerun failed` 把确定性死题刷成重复账单。

## 范围

**包含**

- 内置 prepare 命令对网络瞬时失败的 attempt 内自愈；
- 瞬时识别表与整命令重新执行边界；
- 观察面：activity 行、耗尽摘要；与 live-run 的 phase 对齐；
- 与续跑 / 指纹：自愈成功不形成 `errored` Verdict Claim；耗尽后仍不进缓存，续跑语义不变。

**不包含**

- Runner 级的第三条 `retryable` 全局消费点；
- 给通用 `runCommand` / `runShell` 打开隐式重试；
- 改执行错误 Observation 的 reason/code 形状，或 `failed` / `errored` Verdict Claim 的判定；
- 用 `attempts` 当基建抖动预算；
- agent send 中途断流的重试纪律；
- 为 prepare 新建平行 failure kind 词表（用既有 reason / message 即可）；
- 领域 `failed` 的重试。

## 重新执行、槽位与识别

- `checkout()` 每次尝试写入命令私有的 staging 目录。失败只删除该 staging 目录；成功后才把完整 checkout 原子放到目标位置。
- `installTool()` 只重新执行官方声明为幂等的安装步骤，并在每次尝试后重新执行 探测。无法保证幂等的安装器第一次失败即抛出。
- 退避睡眠释放全局并发位，醒来后重新排队；Experiment `maxConcurrency` 的名额仍由 Attempt 持有。这与 send 和 provisioning 的槽位语义同形。
- 识别器只读取 exit 形态与有界 stderr，并使用命令内部的固定瞬时错误表。未知形态、401 / 403、磁盘满、ref 不存在和缺命令都不重试。
- Attempt deadline 涵盖全部尝试与等待，不因重试延长；中断可取消退避睡眠。

## 不变量

1. 同一次 attempt 内，Git TLS / registry 抖动在预算内可被吸收，结果与一次成功 prepare 无异。
2. `python3: command not found` 类确定性失败**零**次被重试，且文案或 scope 指向修镜像 / 配方。
3. 通用 `runCommand` 不自动重试；无幂等声明的 opaque prepare 行为第一次失败即抛出。
4. 读者能从执行错误 Observation / activity 投影区分：从未重试、重试耗尽、领域 `failed` Verdict Claim。
5. error-classification 文档仍写「retryable 消费点只有两处」。

## 契约分工

- 本文件定义内置 prepare 命令的自愈边界、重新执行预算与不变量。
- [Error Classification](../../feature/error-classification/README.md)定义全局时间轴消费点；命令内部重试不是新的消费点。
- [Sandbox prepare commands](../../feature/sandbox/prepare-commands.md)与[Sandbox Architecture](../../feature/sandbox/architecture.md)定义命令形状、失败阶段和通用命令不隐式重试的纪律。

## 相关阅读

- [执行失败分类](../../feature/error-classification/README.md) —— 两轴、消费点位置性、自愈阶梯
- [读懂一次 errored](../../feature/error-classification/use-case/reading-errored.md) —— 有无 `retries exhausted` 后缀
- [内置 prepare 命令](../../feature/sandbox/prepare-commands.md) —— `checkout` / `installTool`
- [Sandbox · 命令不自动重试](../../feature/sandbox/library/operations.md) —— 副作用边界
- [跨 provider 工具契约](../../feature/sandbox/library/prebuilt-environments.md) —— python3 / yarn 的统一约束
- [Record · Architecture](../../feature/record/architecture.md) —— phase 观察
- [缓存与携带](../../feature/experiments/cache.md) —— `errored` 不进指纹、续跑只补失败
