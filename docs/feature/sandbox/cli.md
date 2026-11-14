# Sandbox —— CLI：准备缓存、留存现场与销毁

跑完的 Sandbox 默认销毁，debug 证据写入 Attempt-owned Observability 的 command、timing 与 diagnostics。
受管命令（各 owner 的 before、after/cleanup、`install` / `install`）经四个公开 `Sandbox.run*()` 方法发出的每一次调用，无论成功还是非零退出，都写成 command 事件。
`niceeval view` 打开固定 Inspection operation 已关闭的详情；用户从页面的 Run/Attempt 导航选择 locator 对应的
Attempt，并按 timing 顺序阅读。
因此「准备链装了什么、成功命令实际输出了什么」不再要求留住活现场。

但仍有两类问题 FileChanges 结构性地回答不了,只能靠留住活现场:

- **agent diff 之外是盲区**——FileChanges 采的是 workdir 内按 send 区间归因的变更;全局装了什么、`$HOME` 下写了什么配置、PATH 实际长什么样,采不到。
- **复现成本是分钟级**——冷启动 + 安装每轮几分钟,每验证一个假设(如换一条命令参数重试)重跑一轮太慢;留下的现场把这个循环压到秒级。

真正没有留下命令证据的宿主运行条件类 `errored` Verdict，仍只有 Observability diagnostics 与 timing。
例如 Agent CLI 进程本身没起来、SDK / 网络传输失败，而不是某条受管命令非零退出。
这类场景仍最需要进现场里手动重跑一遍命令。

为此 CLI 规范留存现场的完整边界：`--keep-sandbox` 或 `--pause-on-failure` 在执行侧**挂起或留下**现场并输出直连指引，开发者或 Coding Agent 在事后通过 **Provider 原生 CLI** 直连排查与销毁它们。

## `--sandbox-before-cache`：选择本次优化路径

`niceeval exp` 接受以下运行 flag：

```bash
niceeval exp <experiment> [eval...] --sandbox-before-cache=use
niceeval exp <experiment> [eval...] --sandbox-before-cache=bypass
niceeval exp <experiment> [eval...] --max-before-cache-concurrency 3
```

取值只有 `use | bypass`。优先级固定为 CLI flag → Experiment 的 `sandboxCache.before` → `niceeval.config.ts` 的 `sandboxCache.before` → 默认 `use`。Eval 与 Eval Group 没有同名字段；完整配置形状见 [Library](library/README.md#before-cache-配置)。

`bypass` 禁止 Before cache lookup 与 publication，并真实 replay 全部 eligible before。BuildKey 的 lookup/build 仍照常执行；该选择不改变 BuildKey、BeforeCacheKey、CaseKey、Attempt fingerprint 或 result identity。该 flag 只用于冷路径验收、排障与绕开本机 cache，不是强制重跑历史结果的入口。

`--dry` 无论取值都只计算计划和 identity，固定显示 `cacheLookup: "not-probed"`。运行反馈在 bypass 时显示 `replay · bypass`。Before cache 只管理 NiceEval 创建并登记的 Docker image、远端 snapshot（E2B、OpenSandbox、Instabox）与 Incus prepared artifact。它不接管用户声明的 image、template、snapshot 或 trusted base。

`--max-before-cache-concurrency <n>` 是正整数，只临时替代本次 Invocation 的[准备图](../../concepts.md#before-cache-preparation-graph)并发上限；省略时使用 Config 的 `maxBeforeCacheConcurrency`（默认 `2`）。它不改变 Attempt 并发或任何身份；某 provider lane 另有 `scheduling.lane.limit` 时，prepare 的实际并发取两个上限的交集。

## `--keep-sandbox`:跑完留下现场

`--keep-sandbox` 是 `niceeval exp` 的运行 flag,不是独立命令——留存是"这次怎么跑"的一部分,挂在唯一会创建沙箱的命令上:

```bash
niceeval exp local onboarding/tool-first --keep-sandbox        # = --keep-sandbox=failed
niceeval exp local onboarding/tool-first --keep-sandbox=all    # passed 也留,调环境用
```

- 两档语义：`failed`（默认值，单独使用 `--keep-sandbox` 等价）留 Verdict 为 `failed` / `errored` 的 Attempt。
  它包括被硬超时打断后形成 `errored` Verdict 的现场，这是最高价值的现场。
  `all` 连 `passed` Verdict 也留，用于调 before action、核对通过现场的真实状态。
  默认（不带 flag）全部销毁；CI、并发与云资源管理不允许无主现场，留存永远是显式选择。
- debug 流程的典型形态是「这条失败,重跑这一条」,配合 eval 前缀位置参数收窄范围,天然不会一次留下几十个容器。
- 符合 CLI 输入模型:位置参数选 experiment 路径与 eval,flag 说怎么跑。
- 留存只跳过销毁这一步：Agent teardown 与已登记 cleanup 照常执行，留下的现场是收尾完成后的状态。
  对应地，timing decoding 的 `phases` 以 `sandbox.suspend` 结尾而没有 `sandbox.stop` 条目。
  留存提交后现场转入 provider 的休眠形态（docker 停驻容器、e2b pause、vercel stop 后可恢复），不白烧资源。
  suspend 失败时现场保持运行并写入诊断通道，仍被注册表管理。
  语义见 [Architecture · 各 provider 的留存语义](architecture/README.md#留存keep与注册表)。
- 被中断的 Run 不留存:留存授予发生在 Verdict 与 receipt 收敛的收尾点,Ctrl+C 时还没有 Verdict 的 Attempt 走正常销毁;此前已完成并授予留存的 Sandbox 不被中断收回。
- 留存与 [project-target policy](../experiments/architecture/cache.md#复用资格) 不相容：带 carried action 的 reference Member 没有本次 Sandbox，无从留存。
  因此 `--keep-sandbox` 运行里，满足当前留存档的已有 Attempt 不参与携带，照常派发重跑拿现场。
  `failed` 档下上一轮 `failed` Attempt 重跑；`errored` Attempt 本就不具备携带资格。
  `passed` Attempt 可由 reference Member 沿用并写出 carried action；`all` 档下全部重跑。
  要现场就给一次真实执行，不需要为此再配一次 [`--rerun`](../experiments/use-case/README.md#--rerun)。
  两个 flag 的档位词表同构，`--keep-sandbox` 各档自带对应口径的重跑。
- `--keep-sandbox` 与 Experiment 的 [`sandboxReuse: true`](library/reuse.md) 互斥。
  复用的 Sandbox 由多条 Attempt 共享，最终现场不只属于其中一条；组合在创建 Sandbox 前报错。
  Sandbox 预热行为不变,未领用的预创建实例照常销毁。
- `incusSandbox()` 是 DestroyOnly，与 `--keep-sandbox` 组合在创建资源前报错。nested Docker 的只读诊断入口是 [`niceeval sandbox provider doctor incus`](../sandbox-nested-docker/cli.md)，默认检查 reference domain。

### run 收尾输出

留存发生时，run 摘要后追加输出原生直连指引。两种输出形态（Human 与 JSON）均遵循高信噪比原则：

Human 面板直接展示底层 Provider 的原生接入与销毁命令模板：

```text
╭─ KEPT SANDBOXES ─────────────────────────────────────────────────── 1 kept ─╮
│ @1VE05BR7061YN  onboarding/tool-first #1  errored  docker · a3f9c2d1        │
│            debug: docker exec -it a3f9c2d1 /bin/bash                       │
│            clean: docker rm -f a3f9c2d1                                    │
╰────────────────────────────────────────────────────────────────────────────╯
```

`niceeval exp --json` 在事件流追加 `kept` 事件，直接包含底层 Provider 的原生直连命令字段 `nativeCommand` 与销毁命令 `cleanCommand`：

```json
{"event":"kept","locator":"@1VE05BR7061YN","evalId":"onboarding/tool-first","attempt":1,"verdict":"errored","provider":"docker","sandboxId":"a3f9c2d1","nativeCommand":"docker exec -it a3f9c2d1 /bin/bash","cleanCommand":"docker rm -f a3f9c2d1"}
```

面向人类终端给出开箱即用的直连命令；面向 Coding Agent 给出可直接执行的单次非交互命令。

## 原生 CLI 现场接入与资源管理

NiceEval 保持 core 中立并恪守职责边界：**NiceEval 拥有沙箱的生命周期调度权（何时销毁、何时挂起），而将所有的命令执行、终端交互、文件比对与资源回收彻底委托给底层成熟的工具链。**

### 1. 现场进入与交互调试（用 Provider 原生 CLI）

NiceEval 不自建中间终端代理、伪终端（PTY）隧道或 WebShell 反代。开发者或 Coding Agent 依据收尾指引直接使用底层 Provider 经工业级验证的成熟 CLI：

- **Docker Sandbox**：
  - 开发者交互调试：`docker exec -it <sandboxId> /bin/bash`（直接利用原生的 PTY、信号穿透与快捷键支持）；
  - Coding Agent 非交互排查：`docker exec <sandboxId> <command>`（单次执行、拿到结构化 stdout/stderr，不阻塞挂起）。
- **Instabox Sandbox**：
  - 开发者交互调试：`instabox ssh <sandboxId>`；
  - Coding Agent 非交互排查：`instabox exec <sandboxId> -- <command>`。
- **Kubernetes / 微 VM**：
  - 直接调用 `kubectl exec -it <pod> -- /bin/sh` 或对应 Provider 的原生客户端。

### 2. 现场变更回放与代码比对（用 Git 与 NiceEval 落盘事实）

NiceEval 不自建私有的变更历史回放命令：

- **现场工作区比对**：在通过原生 CLI 接入现场后，直接在工作区目录执行标准 **`git status`** 与 **`git diff`**，利用 Git 工业级 diff 能力查看代码与文件修改；
- **排查工作区之外的状态**：直接通过原生 shell 运行标准检查命令（如 `cat ~/.npmrc` 查看全局配置，`npm ls -g --depth=0` 查看全局安装，`ps aux` 查看残留后台进程）；
- **已发布结构化历史**：利用 NiceEval 已落盘的 Attempt 事实，通过 `niceeval show run:<id>`、`niceeval show @<locator> execution` 或 `niceeval view` 查看已被封口的事实闭包。

### 3. 沙箱状态查看、批量销毁与孤儿回收（用 Provider 原生管理命令）

NiceEval 不在项目内部维护脆弱的私有注册表或自研孤儿轮询机制。所有实例的生命状态与资源回收动作均委托给 Provider 原生管理工具：

- **Docker 容器**：
  - 查看全部存活/留存沙箱：`docker ps -a --filter "label=niceeval"`；
  - 销毁特定沙箱：`docker rm -f <sandboxId>`；
  - 批量销毁所有留存/残留容器：`docker rm -f $(docker ps -aq --filter "label=niceeval")`；
  - 强杀或异常中断后的孤儿回收：`docker container prune -f` 或 `docker system prune`。
- **Instabox 实例**：
  - 查看实例列表与状态：`instabox list`；
  - 销毁特定实例：`instabox rm <sandboxId>`；
  - 暂停或恢复实例：`instabox pause <sandboxId>` / `instabox resume <sandboxId>`。

由于使用的是底层 Provider 的原生 CLI，即使 `niceeval.config.ts`、测试集代码损坏或出现语法错误，开发者也能直接运行 `docker ps` 或 `instabox list` 排查并销毁资源，绝不会被上层配置错误阻断。

### 4. 线上沙箱异常中断防护（Server-Side TTL 与原生保底）

当本地进程遭遇 `kill -9`、CI 超时强杀或宿主断电时，客户端任何生命周期 Hook 都无法执行。对于按时长计费的线上沙箱（Instabox、E2B、云端 VM），NiceEval 绝不在客户端试图自建脆弱的保活守护进程，而是彻底利用 Provider 的服务端原生防护：

- **服务端硬超时（Server-Side TTL）**：创建线上沙箱时强制注入云端生效的生命周期上限（`ttlMs`），超时后由 Provider 控制平面直接物理销毁；
- **原生空闲挂起（Idle Auto-Pause）**：启用 Instabox 等 Provider 的自动空闲暂停机制，客户端中断失联后沙箱在数分钟内自动休眠停计费；
- **CI 流水线 Always 步骤**：在持续集成流水线中，通过 CI 编排的 `always()` 步骤直接调用原生 CLI 进行批销毁，确保哪怕评测任务被中断，线上云资源也能被可靠收回。

## 运行期现场连接与原生调试指引

NiceEval 不自建中间终端代理或伪终端转发服务，保持 core 中立并交由底层 Provider 的成熟 CLI 负责接入。
实例就绪后，Human 面板与事件流直接展示对应 Provider 的原生命令指引（如 Instabox 的 `instabox ssh <id>`、`instabox exec <id> -- <cmd>` 或 Docker 的 `docker exec -it <id> bash`）。

## 断点调试与暂停机制：--breakpoint 与 --pause-on-failure

为支持精确定位准备或执行异常，NiceEval 提供运行期断点与失败暂停能力：

- `--pause-on-failure`（等价于 `--breakpoint=failure`）：当受管动作失败或发生意外错误时，挂起当前 Attempt。沙箱不触发自动销毁并展示原生直连指引。挂起属于 Attempt 隔离状态，立即释放并发调度许可；非 TTY（Agent、CI 与自动化管道）或并发执行（`maxConcurrency > 1`）场景下自动退化为非阻塞现场保留，不阻塞标准输入。仅在单任务交互 TTY 终端下等待用户回车后继续收尾。
- `--no-pause`：显式关闭失败挂起，优先级高于项目配置。
- `--breakpoint=before-agent`：在初始化与全部 Before 动作完成、被测 Agent 正式接管前暂停，便于检查初始工作区与依赖状态。

项目可在 `niceeval.config.ts` 中声明 `pauseOnFailure: !process.env.CI`，实现本地开发默认挂起、CI 流水线自动非交互销毁。
优先级固定为 CLI 参数（`--pause-on-failure` / `--no-pause`）→ `niceeval.config.ts` 的 `pauseOnFailure` → 默认 `false`。

## 与九个固定运行事实 family 的分工

留存现场不替代 Record：

- Assertions 保存判定与 Evidence refs；File Changes 保存 agent 归因文件变化。
- Agent Turns、Turn Contexts、Sandbox Commands、Runner Activities 与 Runner Diagnostics 分别保存各自 capture authority 的 receipt。
- Sources 保存源码闭包；Artifacts 只保存已声明的大型具类型对象。source navigation 在读侧连接 Turn Contexts、Runner Activities 与 Sources，不另落 family。

它们都经固定 Inspection operation 读取。现场只回答落盘之外的问题，例如命令当时怎样失败、Agent 向 workdir 外写了什么。

留存的 Sandbox 不是可续跑状态，也没有续跑或重评语义。Provider 的休眠唤醒只恢复现场供人检查，不恢复 eval 运行。

## 相关阅读

- [CLI 用例](use-case/README.md) —— `--keep-sandbox` 三类问题各自的全流程展示。
- [Nested Docker CLI](../sandbox-nested-docker/cli.md) —— `doctor incus`、`--development` 与 `--dry` identity。
- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Architecture](architecture/README.md) —— 留存决策在 attempt 收尾链里的位置、注册表、各 provider 的留存语义。
- [Record · Architecture](../run/architecture/README.md) —— `sandbox` 字段(provider、实例 id、是否留存)。
- [CLI 内部架构](../../cli.md) —— 命令分派、中断路径与「不留无主沙箱」。

## Docker image cache inventory

`niceeval docker cache inventory` 只读展示同一 `verified-managed` Docker images Domain 中由 NiceEval 登记的两类 entry：`task-build` 与 `sandbox-before-cache`。JSON 的 `entries` 是以 `kind` 判别的联合；每项稳定显示自身 identity、当前 state、lease 与 hold 数、创建时间、最后成功使用时间与保护截止时间。Domain 摘要另按两种 kind 给出计数。Human 输出逐项显示同一组安全字段，不输出声明正文、holder identity、operation id 或其它内部恢复资料。

Before cache 进入 inventory 只授予可见性，不把它纳入 `docker cache gc`：现有 preview/apply 仍只产生和回收 `task-build` 候选。共享 BuildKit 仍是独立的 `unverified` Provider observation。
