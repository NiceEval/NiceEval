**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [DECISION](DECISION.md)

# 环境模型 Cases

这里固定所有候选都要面对的输入与验收结果。
本页不使用 Provision、Layer、Addon 等候选专用概念;每个 PLAN 的 `use-case/` 负责展示自己的公开调用与运行路径。

## 共同验收条件

下面十个 Case 都遵守同一组底线:

- Eval、Experiment 与 Agent 三方声明在 Base 选择前都存在;Agent 不因预装在 template 中而失去独立检查。
- 每条 Attempt 恰好选择一个完整 Base Case;默认 template、Eval Base、条件基底与融合 case 的取舍必须明确。
- 题目条件、实验条件与 Agent 运行条件都在 Agent 开始前成立,任一来源不能覆盖另一个来源。
- image、template、snapshot、产物名与受管 manifest 都不能单独代替实际检查。
- 任一安装可能破坏已满足条件时,进入 Agent 阶段前必须有三方最终验证屏障。
- Agent 安装保留平台探测、宿主侧 payload 准备、安装模式和逐 Attempt 事实,不能被较弱的通用安装接口吞掉。
- 复用同一个 Sandbox 时,每条 Attempt 仍重新检查目标状态。
- 声明身份、解析后的目标身份、实际事实、活动与耗时进入各自的 configHash、fingerprint 或运行记录。

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
payload 按声明身份与目标平台 single-flight;准备、上传、安装和复检都有明确错误归属。

## C4:组合多个条件

**输入:**一个 Experiment 同时需要证书、内部 registry、运行时和工具。
它们存在语义依赖、共享资源冲突,后安装项还可能破坏先安装项。

**验收:**作者不用靠数组位置猜顺序。
依赖与资源冲突可声明;安全节点可以并行,未知冲突保守串行,最终验证能发现后装破坏。

## C5:预装稳定条件

**输入:**某项工具每次安装和预热都很慢,维护者把它预装进 image、template 或 snapshot。

**验收:**预装只把现场安装优化成检查命中。
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
每个窗口有独立身份与载入、回存记录;每条 Attempt 仍重新检查安装条件,不能因复用跳过验证。

## C8:Experiment 提供条件基底

**输入:**Experiment 已有一个预制起点,它预期满足实验条件。
某个 Eval 没有自己的不可叠加基底,但仍有必须验证或补齐的题目条件。

**验收:**该 Attempt 可以从实验起点创建 Sandbox,再验证或补齐题目条件。
预制起点不跳过实验条件检查;题目条件无法补齐时在 Agent 开始前给出明确不兼容结果。

## C9:双方都有不可叠加基底

**输入:**Eval 与 Experiment 都提供不能在运行时直接叠加的完整起点。
一个 Experiment 覆盖多个 environment profile。

**验收:**Runner 不隐式选边或合并两个起点。
配置按 profile 显式选择已经融合双方条件的完整 case;缺失项一次穷举报出,启动后仍分别验证双方条件。

## C10:混合批次

**输入:**同一批 Eval 中,一部分自带 Compose 或其它题目基底,另一部分没有。
Sandbox 配置还带一个普通默认起点,Experiment 可以另外声明与实验条件绑定的条件基底。

**验收:**普通默认起点不制造双基底冲突。
有题目基底的 Eval 使用自己的起点,其余 Eval 使用默认起点或条件基底;只有双方都明确贡献条件基底时才要求融合 case。

## 候选覆盖入口

| 候选 | 覆盖矩阵 | Lifecycle 与 Base/template 选择 |
|---|---|---|
| PLAN-1 | [Environment 与 Provision](PLAN-1/use-case/README.md) | [Lifecycle](PLAN-1/lifecycle.md) |
| PLAN-2 | [单 template 与统一 Layer](PLAN-2/use-case/README.md) | [Lifecycle](PLAN-2/lifecycle.md) |
| PLAN-3 | [完整 Sandbox Case 与 Experiment Addon](PLAN-3/use-case/README.md) | [Lifecycle](PLAN-3/lifecycle.md) |
| PLAN-4 | [Requirement、Base Case 与 Ensure](PLAN-4/use-case/README.md) | [Lifecycle](PLAN-4/lifecycle.md) |
| PLAN-5 | [默认与条件基底分档](PLAN-5/use-case/README.md) | [Lifecycle](PLAN-5/lifecycle.md) |
