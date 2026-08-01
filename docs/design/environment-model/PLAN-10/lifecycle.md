# PLAN-10 —— Lifecycle

**相关文档**：[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md)

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| Eval layer | 可选 root、按 Attempt 的 SandboxCommand、test | 题目起点、题目准备、Agent 交互与判分 |
| Experiment layer | 可选 root、按 Attempt 的 SandboxCommand | 实验起点或实验准备 |
| Agent layer | extension-only AgentProvisioner | CLI identity、payload、平台、安装与复检 |
| Provider Case | root planner、build、start、ready、finalizer | 创建、观测、复用并清理完整资源组 |
| State Feature | load、save、临界区与窗口状态 | 外部或跨 Attempt 实验状态 |

Eval 与 Experiment 的 `sandbox` 字段使用同一个 `SandboxLayer` 类型。
Agent layer 只共享排序位置，不把 AgentProvisioner 降格成普通命令。

## Run 级 discovery 与 link

Runner 先加载 Eval、Experiment、config 与 Agent，再解析所有 selector 和 CLI filter。
随后对实际选择图中的每一条 `Eval × Experiment` 边执行 root XOR：

```text
discovery
  -> selection graph
  -> normalize omitted sandbox as empty extension layer
  -> link every selected edge
  -> aggregate root conflict / missing / Direct Agent errors
```

这一步允许整个矩阵出现多个 root identity，但不允许任一 cell 出现零个或两个 root。
只要一条边非法，整个 Run 在 Provider 文件读取、网络、build 和 Sandbox create 前失败。

`niceeval check <experiment>` 在 pure link 后停止。
`--dry` 与正常运行继续消费同一份 linked matrix，不重新选择 root。

## Physical planning

每个合法 pair 把自己的 root 交给它绑定的 Provider planner：

```text
linked pair
  -> resolve local Compose / Dockerfile inputs
  -> resolve target platform and provider locator
  -> validate Agent capability requirements
  -> PlannedSandboxCase
  -> fingerprint
```

planner 可以做只读文件与网络读取，但不 build、不创建资源。
不同 pair 的 root 可以被规划成不同 Provider；相同物理输入则按 BuildKey 共享构建工作。

## Eval root 路径

```text
Eval root + Experiment extension + Agent layer
  -> Eval root 选择 Provider
  -> build / start / ready Sandbox Case
  -> 每条 Attempt：
       reset 到已知 Case 起点
       -> Eval prepare commands（声明顺序）
       -> Experiment prepare commands（声明顺序）
       -> AgentProvisioners（Adapter 声明顺序）
       -> State load
       -> 建立 Agent 可归因起点
       -> Agent runtime setup / send / test
       -> Agent teardown / State save
       -> Experiment registered cleanup（逆序）
       -> Eval registered cleanup（逆序）
  -> Provider Case finalizer
```

Terminal-Bench 走这条路径。
Compose Eval 自己选择 Docker Compose Provider；同一 Experiment 不需要知道 Eval 是 Compose、Dockerfile 还是 E2B。

## Experiment root 路径

```text
Experiment root + Eval extension + Agent layer
  -> Experiment root 选择 Provider
  -> build / start / ready Sandbox Case
  -> 每条 Attempt：
       reset 到已知 Case 起点
       -> Experiment prepare commands（声明顺序）
       -> Eval prepare commands（声明顺序）
       -> AgentProvisioners（Adapter 声明顺序）
       -> State load
       -> 建立 Agent 可归因起点
       -> Agent runtime setup / send / test
       -> Agent teardown / State save
       -> Eval registered cleanup（逆序）
       -> Experiment registered cleanup（逆序）
  -> Provider Case finalizer
```

MemoryBench 走这条路径。
Experiment 的 E2B root 与 mempal ensure 先执行；Eval 的 checkout 随后执行；Agent CLI 最后收敛。

## 为什么 Agent 固定最后

Agent CLI 与 Adapter 配置可以依赖 root 提供的系统能力，也可以依赖 Experiment / Eval 准备的证书、runtime 或目录。
普通题目准备不应依赖某个 Agent Adapter 的私有安装路径，否则同一 Eval 无法替换 Agent。

因此 AgentProvisioner 是准备链最后一道强制屏障。
Adapter 完成 inspect / install / reinspect 后，Runner 才进入 State 与 Agent runtime。
作者不能把 Agent 提前，也不能让 Agent Adapter 暗中替换 root。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| pair root link | Run 规划期 | Run 规划期 |
| Provider physical plan / fingerprint | Run 规划期 | Run 规划期 |
| Case create / ready | 每 Attempt | 每复用窗口 |
| reset | 唯一 Attempt 进入前 | 每 Attempt 进入前 |
| root / extension prepare commands | 每 Attempt | 每 Attempt 重放 |
| AgentProvisioner inspect / install / reinspect | 每 Attempt | 每 Attempt重检，命中可快速返回 |
| State load / save | 每 Attempt，按 State 契约 | 每 Attempt或窗口，按 State 契约 |
| Agent runtime / test | 每 Attempt | 每 Attempt |
| command registered cleanup | 每 Attempt逆序 | 每 Attempt逆序 |
| Provider finalizer | 每 Attempt | 每复用窗口 |

PLAN-10 不在 Layer 中建立 reset anchor 后跳过 command。
复用只复用 Provider Case 与允许保留的状态；准备链仍然是每条 Attempt 的可观察事实。

如果某个 ensure 的已安装内容在 reset 后仍然存在，它的 inspect 会命中。
如果 reset 删除了该内容，当前 Attempt 会重新安装；这是正确性结果，不是缓存失败。

## 准备、State 与 baseline

两层 author command 和 AgentProvisioner 都属于 Agent 开始前的基础设施活动。
State load 在 Agent CLI 已可用后执行；Runner 随后建立本条 Attempt 的 Agent 可归因起点。

因此：

- root / extension command 写入的题目材料不算 Agent 修改；
- Agent CLI 安装不得把工具文件写进任务 workdir；
- State load 的实验条件不算 Agent 修改；
- `test(t)` 在 `send` 窗口外上传的 verifier 仍按 Eval 活动归因；
- 只有 Agent turn 窗口内的变化进入 Agent diff。

Runner 仍记录各活动的实际文件变化，不能靠延后 baseline 隐藏测试泄漏。

## Cleanup

SandboxCommand 在运行中取得临时资源后调用 `context.onCleanup()`。
只清理本条 Attempt 实际取得的资源，顺序为全局 LIFO：

```text
Agent runtime teardown
  -> State save
  -> extension layer cleanup（命令逆序）
  -> root layer cleanup（命令逆序）
  -> reset / retire decision
  -> window close 时 Provider Case finalizer
```

AgentProvisioner 默认不卸载 CLI；其临时 payload handle 由 Adapter / Runner 专用 finalizer 处理。
Case service、watcher、日志和 volume 不用 `onCleanup()`，由 Provider Case finalizer 整组关闭。

cleanup 使用独立 budget 与 signal，不复用已经 abort 的前向 signal。
cleanup 失败保留原结果、记录诊断，并在无法证明可恢复时退休复用窗口。

## 多 root matrix 的执行

链接结果是一张 pair plan 表，不是一个 Run 级全局 root：

```text
pair(A, X) -> Docker Compose root A -> Docker Provider
pair(B, X) -> E2B root B           -> E2B Provider
pair(C, Y) -> Docker image root Y  -> Docker Provider
```

调度器可以并行不同 pair，也可以按 Provider exclusive / concurrency 能力限流。
构建共享只由 BuildKey 决定；运行复用只由 CaseKey、完整 layer / Agent identity 和 State 边界决定。

某个 pair 的 root 不会成为同一 Experiment 其它 pair 的 fallback。
missing cell 必须通过补 root 或修改 selector 修复，不能借相邻 cell 的 template。

## 反向依赖与融合 root

固定顺序下，root command 不能等待 extension command，extension command 也不能等待 Agent 安装。
发现反向依赖时按下面顺序修正：

1. 条件本来属于后一个 owner：移动 command 所有权。
2. 条件是完整起点的一部分：放入唯一 root factory 或预制 Case。
3. 只有部分 Eval / Experiment 组合兼容：拆 selector，形成各自合法的 pair 图。
4. 两方条件无法现场组合：为该组合提供融合 root，并让另一方保持 extension。

PLAN-10 不引入动态优先级或 dependsOn，因为它们会让同一 layer 在不同 pair 中拥有不同含义。

## Cases

| Case | PLAN-10 路径 |
|---|---|
| C1 | Eval root 直接解析完整 Compose / Dockerfile Case |
| C2 | Experiment root 或 extension command 表达实验条件，逐 Attempt 实际检查 |
| C3 | Eval root → Experiment commands → AgentProvisioner 固定串行 |
| C4 | 同 owner 的 command 按源码顺序串行，无自动并行 |
| C5 | 预装只让 ensure command 检查命中，不删除声明 |
| C6-C7 | State 保持独立；Layer prepare 每 Attempt 重放 |
| C8 | Experiment root → Eval checkout → Agent |
| C9 | 不兼容组合使用融合 root 或拆 selector，不合并两份 root |
| C10 | root 按 pair 选择；同一 Run 可含多个 Provider/template |
| C11 | `test(t)` 继续使用普通上传并记录 transfer manifest |
