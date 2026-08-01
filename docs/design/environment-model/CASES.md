**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [DECISION](DECISION.md)

# 环境模型 Cases

这里固定所有候选都要面对的输入与验收结果。
本页不使用 Provision、Layer、Addon 等候选专用概念;每个 PLAN 的 `use-case/` 负责展示自己的公开调用与运行路径。

## 共同验收条件

下面十一个 Case 都遵守同一组底线:

- Eval、Experiment Sandbox 配置与 Agent 三方声明在 Environment 解析前都存在;Agent 不因预装在 template 中而失去独立检查。
- 每条 Attempt 由当前 Provider 解析一个完整 Sandbox Case；Eval source/profile 与 Provider 实现的边界必须明确。
- Experiment sandbox setup、EvalDef setup 与 Agent setup 按 owner 分层执行,任一来源不能覆盖另一个来源。
- image、template、snapshot、产物名与受管 manifest 都不能单独代替实际检查。
- 可预装条件由领域 helper 检查实际状态,并在安装后复检。
- Agent 安装保留平台探测、宿主侧 payload 准备、安装模式和逐 Attempt 事实,不能被较弱的通用安装接口吞掉。
- 复用同一个 Sandbox 时,检查频率跟 owner 语义走:逐 Attempt 语义的准备(EvalDef setup、Agent setup)每条 Attempt 重新检查目标状态;窗口语义的准备每个窗口检查一次,跨 Attempt 会变化的条件不得放进窗口语义层。
- Environment、setup helper、所选 case、实际 facts、活动与耗时进入各自的 configHash、fingerprint 或运行记录。

## C1:评估环境较重

**输入:**每道 Eval 自带 Dockerfile 或 Compose。
系统包、服务、ready 条件和主执行位置都是题意的一部分,Experiment 只选择 Sandbox Provider 与 Agent。

**验收:**Experiment 不枚举题目环境,也不为 Provider 注册逐题转换器。
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
Experiment sandbox setup 作用于每道题最终的主 Sandbox;离线 payload 的准备、上传、安装和复检有明确错误归属。

## C4:组合多个条件

**输入:**一个 Experiment 同时需要证书、内部 registry、运行时和工具。
它们存在语义依赖、共享资源冲突,后安装项还可能破坏先安装项。

**验收:**作者按阅读顺序写 Experiment sandbox setup 链。
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
每个窗口有独立身份与载入、回存记录;Experiment sandbox、EvalDef 与 Agent setup 按各自窗口或 Attempt 语义执行。

## C8:Experiment template 主导起点

**输入:**Experiment 已有一个预制 template,它预期满足实验条件。
某个 Eval 没有 environment source,但仍要 checkout 仓库或安装项目依赖。

**验收:**该 Attempt 从 Experiment fallback 创建 Sandbox,先运行 Experiment sandbox setup,再运行 EvalDef setup。
任一 setup 失败都在 Agent 开始前归入自己的 phase。

## C9:Eval source 需要预制组合实现

**输入:**Eval 提供题目 source,Experiment fallback 预装实验条件,两者不能在运行时直接叠加。
当前 Experiment Sandbox 配置覆盖多个 environment profile。

**验收:**Runner 不隐式回退到普通 fallback,也不合并两个起点。
Experiment 可以按 profile 提供已经组合双方条件的完整 case;缺失实现时明确 skip,启动后仍执行 Experiment sandbox 与 EvalDef setup。

## C10:混合批次

**输入:**同一批 Eval 中,一部分自带 Compose 或其它 Environment source,另一部分没有。
Experiment 同时配置 fallback、Provider Environment 支持与可选 profile 覆盖。

**验收:**有 Environment 的 Eval 使用 profile 覆盖或 Provider 规划,其余 Eval 使用 fallback。
普通默认起点不覆盖题目 source,也不制造额外冲突。

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
| PLAN-5 | [默认与条件基底分档](PLAN-5/use-case/README.md) | [Lifecycle](PLAN-5/lifecycle.md) |
| PLAN-6 | [唯一 Environment 起点与双侧 setup](PLAN-6/use-case/README.md) | [Lifecycle](PLAN-6/lifecycle.md) |
| PLAN-7 | [单一起点与受管 Eval 文件](PLAN-7/use-case/README.md) | [Lifecycle](PLAN-7/lifecycle.md) |
| PLAN-8 | [Environment 作者面与三层 Sandbox 准备](PLAN-8/use-case/README.md) | [Lifecycle](PLAN-8/lifecycle.md) |
