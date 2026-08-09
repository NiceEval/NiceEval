# 原生 LLM Judge Runtime

LLM Judge 需要稳定表达“看哪些材料、按什么 rubric、由哪个模型执行、怎样得到分数”。
第三方 scorer 的函数名、参数约定和模型客户端不属于这份公开契约。

本主题用 NiceEval 自有的 Runtime 统一单次 rubric、内置配方与多节点判分。
公开 API 不暴露 scorer 供应商；模型传输通过 Judge Provider 接入。

## 解决的问题

- 多个 scorer 对 `input`、`output`、`expected` 和 `criteria` 的解释不同，同一个参数位置不能稳定表示材料角色。
- 判分材料被压成一段字符串，图片、音频、文件和带角色的多段上下文没有共同形状。
- rubric、prompt 模板、模型调用、响应读取和 Assertion 登记绑在一次函数调用里，无法独立演进或复用。
- 单条结果只保留分数和材料预览，无法复核配方版本、模型、节点、理由、引用、重试和用量。
- 多维质量评估只能写成互不关联的 Judge Assertion，不能表达并行评分、确定性聚合与 fallback。
- 运行器靠源码中的 `judge` 字样猜测是否需要预检，工具或动态调用会让成本保护失去确定性。

## 核心心智

一次 `t.judge.llm(...)` 注册一条 LLM Judge Assertion。
它接收一份 Judge Check；Check 指向 rubric 或 Judge Recipe，并把输入槽绑定到 Judge Material。

Judge Recipe 编译成静态 Judge Graph。
单模型 rubric 是只有一个模型节点的图，复杂评估也沿用同一执行与登记协议。

```text
Judge Check
  ├─ rubric / Judge Recipe
  ├─ Judge Material bindings
  └─ Judge Profile
             │
             ▼
      static Judge Graph
             │
      Judge Runtime scheduler
       ├─ Judge Provider
       ├─ deterministic nodes
       └─ retry / budget / capability checks
             │
             ▼
       Judge Decision Claim ──> Assertion Claim ──> Verdict Claim
             │
             └──────────────> judge Observation stream / typed evidence
```

`Judge Decision` 恒包含 `0..1` 分数、简短理由和材料引用。
分数进入既有 Assertion 阈值与 Verdict 折叠；理由不是隐藏思维过程，也不参与判定。

## 所有者边界

| 所有者 | 负责 | 不负责 |
|---|---|---|
| Judge Check | 选择配方、绑定材料、选择 profile | 构造模型协议或折叠 Attempt |
| Judge Recipe | 声明 rubric、输入槽、静态图和最终节点 | 读取凭据或执行网络请求 |
| 材料读取器 | 读取 scope、文件与内联内容，生成稳定材料清单 | 猜测材料角色或支持能力 |
| Judge Runtime | 校验图、调度节点、预算、重试与 fallback | 理解某家模型 SDK |
| Judge Provider | 能力声明、预检、规范请求转换和原始响应归一 | 决定 rubric、阈值或 Verdict |
| Assertion collector | 把最终 Decision 写成 Assertion Claim | 展开图节点或调用模型 |
| Record | 保存判分 provenance、节点 Observation、Judge / Assertion Claim 与材料引用 | 重新执行 Judge Graph |

## 设计原则

- 所有模型节点都返回同一个 `JudgeDecision`，内置配方不拥有私有结果形状。
- rubric 与材料分开传递；candidate、reference、context 等角色写进材料，不靠参数位置猜测。
- profile 只描述执行；rubric 和阈值不进入 profile。
- Provider 能力在请求前校验，图片等内容不会静默降级成文件名或 OCR 占位文本。
- Judge Graph 是有稳定节点 id 的有限 DAG，不允许循环、运行期新增节点或隐藏网络调用。
- 每条 Judge Assertion 只向 Verdict 暴露最终 Decision；内部节点进入独立 artifact，避免制造额外断言。
- 配方 id、配方版本、图结构、材料摘要和 profile 身份都参与可比性与审计。

## 与 Agent-as-Judge 的边界

LLM Judge 只对已给材料执行有界模型请求，不主动打开仓库、运行工具或补证据。
需要独立 Agent 调查证据时使用 [Agent-as-Judge](../agent-as-judge/README.md)。

两者共享 Assertion handle、`unavailable` 和 Verdict 语义，但拥有不同 evaluator execution。
本主题不定义 Agent Session、裁判 Sandbox、workdir 快照或 Agent Judge 的返回协议。

## 范围

本主题包含：

- `t.judge.llm(check)`、内置配方、自定义配方和静态 Judge Graph。
- 文本、对话、图片、音频与一般文件的规范化材料模型。
- Judge Profile、Provider 能力、预检、预算、并发和重试。
- 结构化 Decision、节点 unavailable、fallback 与 Assertion 映射。
- 内容寻址的 typed evidence、judge Observation stream，以及 show / view 的判分详情 Projection。
- Eval 对 Judge profile 和模态要求的静态声明。

本主题不包含：

- 用裁判模型驱动被测 Agent，或把 Judge Graph 变成 Agent 工作流引擎。
- 动态循环、无界 fan-out、跨 Attempt 状态或跨 Run 的 Judge 节点缓存。
- 把模型理由当作事实证据，或展示私有 chain-of-thought。
- 在 core 内维护第三方 scorer 的兼容命名空间。
- 修改 Severity、`optional` 或四态 Verdict 的既有语义。

## 入口

- [Library](library.md) —— Judge Check、材料、配方、图与配置 API。
- [Architecture](architecture.md) —— 规范请求、调度、失败、Record 与不变量。
- [Use Cases](use-case/README.md) —— 多模态输出与多节点判分。
