# Agent-as-Judge

裁判模型适合对一段已给材料求分，但它不能主动打开仓库、运行测试、追踪引用或用工具补证据。
Agent-as-Judge 让一条 Assertion 由独立 Agent 执行，使开放式判据可以经过多步调查后再产生分数。

## 核心心智

Agent Judge 是 Assertion 的 evaluator，不是第二个被测对象。
每条 Agent Judge 断言启动一条独立 Agent Session，取得结构化判分结果，再进入既有 `AssertionResult` 与 Verdict 折叠链。

```text
被测 Agent ──> Turn / events / 最终工作区
                          │
                          ▼
                   Agent Judge
                调查、运行工具、补证据
                          │
                          ▼
            score + rationale + evidence
                          │
                          ▼
             AssertionResult ──> Verdict
```

rubric、材料、严重度与阈值属于 Eval；Agent、model、Sandbox 与超时属于裁判执行配置。
Experiment 可以只替换 Agent Judge 来做可复现的裁判 A/B，但不能改写题目的 rubric。

## Direct 与 Sandbox 都支持

被测 Agent 与 Agent Judge 的运行形态互相独立，四种组合都合法：

| 被测 Agent | Agent Judge | 典型用途 |
|---|---|---|
| Direct | Direct | 评对话、结构化输出或远程服务响应 |
| Direct | Sandbox | 裁判在自己的工具 Sandbox 里查资料、执行分析脚本 |
| Sandbox | Direct | 把 diff、测试结果或显式材料交给远程裁判服务 |
| Sandbox | Sandbox | 在独立工作区副本中审查仓库、运行测试与追踪代码 |

Sandbox Agent Judge 不进入被测 Sandbox。
需要查看最终仓库时，Runner 在判分边界捕获被测 workdir，并把副本导入全新的裁判 Sandbox。
裁判的写入、命令和失败因此不会改变被测工作区、后续 Assertion 或被测 Sandbox 的 retention policy。

Direct Agent Judge 不创建也不伪造 Sandbox。
它从默认断言范围或显式 `{ on }` 取得材料，适合不需要文件系统工具的判分。

## 与 LLM-as-Judge 的分工

| 能力 | LLM-as-Judge | Agent-as-Judge |
|---|---|---|
| 单次模型请求 | 是 | 否；允许多轮与工具调用 |
| 主动调查外部证据 | 否 | 是 |
| 打开最终工作区 | 否；只能接收作者显式交付的材料 | Sandbox Agent Judge 可读取独立副本 |
| 输出 | 0–1 分数、理由与材料引用 | 0–1 分数、理由与调查证据引用 |
| Verdict 语义 | 复用 Assertion | 复用同一套 Assertion |

能用确定性 matcher 表达的规则仍使用 matcher。
只需对给定文本做一次语义判断时使用 LLM-as-Judge；只有判分需要调查、工具或仓库上下文时才使用 Agent-as-Judge。

## 安全边界

- 被测输出、仓库文件与工具结果都按不可信证据处理，不能覆写 rubric、返回协议或裁判执行配置。
- Agent Judge 使用自己的 Adapter 鉴权与进程条件，不继承被测 Agent 的凭据、Session 或 env 变量。
- `{ workspace: "snapshot" }` 是复制整个被测 workdir 的显式授权；省略时只交付断言材料。
- Agent Judge 不取得阈值、Verdict、其它裁判结果或历史 Attempt，避免围绕及格线作答或形成循环判定。
- 裁判运行失败表示证据不可用，不等于被测对象得 0 分；它进入既有 `unavailable` 传播规则。

## 范围

本主题包含：

- `t.judge.agent()` 的 rubric、材料与链式严重度 API。
- Direct 与 Sandbox Agent Judge 的执行配置。
- 被测 workdir 的隔离快照、裁判生命周期与错误语义。
- 结构化判分协议、裁判事件、usage、成本与复核依据。
- Agent Judge 配置进入指纹、结果携带与裁判 A/B 的规则。

本主题不包含：

- 让裁判与被测 Agent 在同一对话里辩论或互相修改答案。
- 多个裁判投票、仲裁、成对比较或自动生成 rubric。
- 用 Agent Judge 替代确定性测试、过程断言或 Evidence coverage。
- 跨 Attempt 读取历史结果并评价趋势；这仍属于 Report。

## 入口

- [Library](library.md) —— Assertion API、裁判执行配置与判分协议。
- [CLI](cli.md) —— 计划、运行中反馈、show 与机器输出。
- [Architecture](architecture.md) —— 实体边界、证据流、登记、身份与错误。
- [Lifecycle](lifecycle.md) —— 两种 Agent Judge 的创建、执行与回收时序。
- [用例](use-case/README.md) —— 对话评质量与仓库审查的完整路径。
