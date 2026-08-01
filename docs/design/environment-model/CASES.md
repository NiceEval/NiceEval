**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [PLAN-9](PLAN-9/README.md) · [PLAN-10](PLAN-10/README.md) · [PLAN-11](PLAN-11/README.md)

# 环境模型 Cases

这里固定所有候选都要面对的输入与验收结果。
本页不使用 Provision、Layer、Addon 等候选专用概念;每个 PLAN 的 `use-case/` 负责展示自己的公开调用与运行路径。

## 共同验收条件

下面十一个 Case 都遵守同一组底线:

- Eval、Experiment 与 Agent 三方准备声明在起点 link planning 前都存在；Agent 不因预装在 template 中而失去独立检查。
- 每条 Attempt 由唯一 template 自带的 Provider 解析一个完整 Sandbox Case；template 声明与 Provider 实现的边界必须明确。
- 对 Sandbox Agent，每个实际 Eval × Experiment pair 恰好一方声明起点；冲突、缺失与非法 factory 在任何 Provider 网络或 Sandbox 创建前按全矩阵聚合失败。
- Experiment 与 Eval 的 SandboxCommand 和 Agent 安装按 owner 与候选规定的顺序执行，任一来源不能覆盖另一个来源。
- image、template、snapshot、产物名与受管 manifest 都不能单独代替实际检查。
- 可预装条件由领域 helper 检查实际状态,并在安装后复检。
- Agent 安装保留平台探测、宿主侧 payload 准备、安装模式和逐 Attempt 事实,不能被较弱的通用安装接口吞掉。
- 复用同一个 Sandbox 时，候选必须明确哪些准备会逐 Attempt 重检、哪些状态属于窗口；跨 Attempt 会变化的条件不能靠旧 manifest 假装仍然满足。
- Sandbox 声明、command、所选 Case、实际 facts、活动与耗时进入各自的 configHash、fingerprint 或运行记录。

## C1:评估环境较重

**输入:**每道 Eval 自带 Dockerfile 或 Compose。
系统包、服务、ready 条件、主执行位置和 Provider 都是题意的一部分,Experiment 只选择 Agent 与模型。

**验收:**Experiment 不枚举题目环境、不选择 Provider，也不注册逐题转换器。
同一构建输入可以复用构建产物;不同环境身份不能共用同一个运行实例。

## C2:实验环境较重

**输入:**所有 Eval 使用相同基础环境,工具、运行时、证书或模型 cache 随 Experiment 变化。
对照实验不需要这些条件。

**验收:**Experiment 能独立声明、检查并记录这些条件。
身份变化使旧安装不命中;安装完成后重新检查,但默认仍为每条 Attempt 创建全新 Sandbox。

## C3:评估与实验环境都较重

**输入:**每道 Eval 有自己的 Compose,Experiment 还要加入共享工具。
部分题目不能访问外网,宿主必须按目标平台准备离线 payload。

**验收:**两条变化轴不展开成逐题乘实验变体的手工预制环境矩阵。
Experiment 准备 command 作用于每道题最终的主 Sandbox；离线 payload 的准备、上传、安装和复检有明确错误归属。

## C4:组合多个条件

**输入:**一个 Experiment 同时需要证书、内部 registry、运行时和工具。
它们存在语义依赖、共享资源冲突,后安装项还可能破坏先安装项。

**验收:**作者按阅读顺序写 Experiment 准备 command 链。
第一期保守串行;只有领域 helper 掌握内部独立性时才自行并行,不要求作者维护依赖图与资源图。

## C5:预装稳定条件

**输入:**某项工具每次安装和预热都很慢,维护者把它预装进 image、template 或 snapshot。

**验收:**预装只把现场安装优化成 setup helper 的检查命中。
声明仍保留,过期或缺失时可以补齐或明确失败;更换起点产物改变环境身份,不会假装与旧结果等价。

## C6:新 Sandbox 载入外部状态

**输入:**每条 Attempt 都使用全新 Sandbox,但实验需要从外部存储载入状态,结束后再回存。
载入到回存形成同一 Experiment 的临界区。

**验收:**安装状态与实验运行状态分开建模。
state load 在工具和 Agent CLI 就位后运行,并有独立 identity、activity 与失败语义。
逐 Attempt 的 Agent runtime 可以在 load 后收敛;串行边界明确,不需要开启 Sandbox 复用。

## C7:复用 Sandbox 活状态

**输入:**跨 Attempt 累积状态本身就是实验变量,多条 Attempt 需要在同一复用窗口内观察同一份活状态。

**验收:**复用必须显式开启并限制有序实验的并发。
每个窗口有独立身份与载入、回存记录；Experiment / Eval 准备 command 与 Agent 安装按候选声明的频次执行。

## C8:Experiment template 主导起点

**输入:**Experiment 已有一个预制 template,它预期满足实验条件。
某个 Eval 没有 template,但仍要 checkout 仓库或安装项目依赖。

**验收:**该 Attempt 从 Experiment 显式 template 创建 Sandbox。
候选必须明确 Experiment 条件、Eval checkout、reset 与 Agent 安装的相对顺序；每条 Attempt 进入 Agent 前都恢复到已知题目起点。
任一 command 失败都在 Agent 开始前归入自己的 phase。

## C9:Eval template 需要融合条件

**输入:**Eval 提供题目 template，Experiment beforeEach command 声明逐 Attempt 的实验条件。
该条件可能需要 template 不具备的平台能力，但 Runner 不能从任意 shell 内容推断它能否现场安装。

**验收:**Runner 不合并两个起点，也不允许 Experiment 再声明一份显式 template。
只有 command 显式声明 capability 要求，template / Provider factory 也暴露对应能力元数据时，Runner 才能在资源创建前报告不兼容。
否则 Runner 只校验恰好一个 template 的结构约束；启动后执行 Experiment beforeEach，checked command 返回非零时将当前 Attempt 按该 command phase 记为 `errored`。
作者若已知无法现场组合，必须让恰好一侧改用已融合条件的完整 template，并用 selector 形成合法 pair。

## C10:混合批次

**输入:**同一批 Eval 中既有 Compose 多容器题，也有 E2B 单机题。
Experiment 不声明 template，只选择 Agent、模型与这批 Eval。

**验收:**每条 Eval 自己的 template 同时选择 Provider；同一 Experiment 可以混跑，不按 Docker / E2B 分叉。
任何缺 template 的 Eval 都是 missing；若 Experiment 改为声明 template，则所有选中 Eval 必须 command-only，否则全矩阵 link planning 报 conflict。

## C11:逐题自包含的隐藏判分

**输入:**每道 Eval 都在独立 `.eval.ts` 中完整声明题面、环境、超时与判分，不使用批量 loader 或共享 Eval 工厂。
判分依赖一棵本地测试文件树；Agent 开始前不能看到它，内容变化又必须使使用它的 Attempt 重新执行。

**验收:**作者在对应 `send` 返回后直接用普通 Sandbox API 上传文件、运行命令与断言。
没有模块顶层登记、文件专用 EvalDef field 或特殊 callback；Runner 从真实上传生成 transfer manifest，send 窗口负责归因。

## 候选覆盖入口

| 候选 | 覆盖矩阵 | Lifecycle 与 Base/template 选择 |
|---|---|---|
| PLAN-1 | [Environment 与 Provision](PLAN-1/use-case/README.md) | [Lifecycle](PLAN-1/lifecycle.md) |
| PLAN-2 | [单 template 与统一 Layer](PLAN-2/use-case/README.md) | [Lifecycle](PLAN-2/lifecycle.md) |
| PLAN-3 | [完整 Sandbox Case 与 Experiment Addon](PLAN-3/use-case/README.md) | [Lifecycle](PLAN-3/lifecycle.md) |
| PLAN-4 | [Requirement、Base Case 与 Ensure](PLAN-4/use-case/README.md) | [Lifecycle](PLAN-4/lifecycle.md) |
| PLAN-6 | [唯一 Environment 起点与双侧 setup](PLAN-6/use-case/README.md) | [Lifecycle](PLAN-6/lifecycle.md) |
| PLAN-7 | [单一起点与受管 Eval 文件](PLAN-7/use-case/README.md) | [Lifecycle](PLAN-7/lifecycle.md) |
| PLAN-8 | [Environment 作者面与三层 Sandbox 准备](PLAN-8/use-case/README.md) | [Lifecycle](PLAN-8/lifecycle.md) |
| PLAN-9 | [单一 Sandbox Recipe 与 template owner 顺序](PLAN-9/use-case/README.md) | [Lifecycle](PLAN-9/lifecycle.md) |
| PLAN-10 | [统一 Sandbox Layer、固定 root-first 顺序与逐配对 root](PLAN-10/use-case/README.md) | [Lifecycle](PLAN-10/lifecycle.md) |
| PLAN-11 | [默认与条件基底分档](PLAN-11/use-case/README.md) | [Lifecycle](PLAN-11/lifecycle.md) |
