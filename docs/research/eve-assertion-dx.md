# Eve 断言 DX 与 Harness 需求

本研究比较 Eve 与 NiceEval 的断言作者面，并用 NiceEval-Eval Harness 检查候选 API 是否解决真实用户问题。
它只提供带日期的设计输入，不构成 NiceEval 的目标契约。

> 本页列出的 `ToolMatch.command`、`ToolSelector` 与 `toolInputsExclude()` 是阶段性候选，已被当前 [Assertion 作者面 Roadmap](../roadmap/assertion-authoring/README.md) 取代。
> 目标契约使用一等 `commandMatch()`、共用 `ToolMatch`，并以 `notCalledTool(toolMatch({ input: referencesAnyPath(...) }))` 表达 observed-input 负约束。

## 观察版本

观察日期是 2026-08-08。

| 对象 | Revision | 主要证据 |
|---|---|---|
| Eve | `bd93f55481b3048d0273dd041b423e73fb9248cf` | `packages/eve/src/evals/` 与 `docs/evals/` |
| NiceEval-Eval | `2794a6cf315c247605f14a9ffed55f0a4564ac78` | 当时的 `evals/harness/` 与 Harness 说明 |
| NiceEval | 本研究所在工作树 | Assertions、Sandbox diff、Adapter events 与 evidence coverage |

Eve 与 NiceEval-Eval 都来自本机 checkout。
本研究读取源码、文档与 Git revision，没有把运行中服务或发布包行为混入判断。

Harness 的目标收敛为两个单轮端到端诊断场景。
旧题的条目数与分数只作为研究样本，不构成需要守恒的产品契约。

## Eve 的真实作者面

Eve 把普通检查分成两层：

| 入口 | 负责什么 |
|---|---|
| `t` / session / turn scoped method | run、tool、event、状态等标准事实 |
| `t.check(value, assertion)` | 作者明确交出的任意值 |

`succeeded()`、`calledTool()` 与 `toolOrder()` 都直接挂在 scope receiver 上。
scope 只改变证据范围，不改变方法风格。

`calledTool()` 的 matcher object 内联表达 input、output、status 与 count。
`toolOrder()` 检查 tool request subsequence；它不能证明前一笔 completed 后下一笔才开始。

Eve 的 `t.check()` 使用 `eve/evals/expect` builders，例如 `includes()`、`equals()` 与 `matches()`。
这适合任意应用值，但若每个标准行为事实都先变成 value 再套 builder，作者会失去领域接收者的清晰范围。

## 对旧 Match AST 的否决

旧候选要求作者先声明 text matcher，再嵌入 JSON shape：

```ts
const command = match.text.pattern("local command", /niceeval exp local/i);
const input = match.json.shape({ command });
turn.calledTool("shell", { input });
```

它有四个用户问题：

- 作者必须知道 Adapter 把 command 放在哪个 input field；
- 一条常见检查需要多个中间值；
- 关系被递归 AST 和正则语法淹没；
- 同一 command 在存在性和顺序 API 中容易出现两套 matcher。

因此普通 Harness 不应导入 `match.*`，也不应靠共享规则构造器隐藏复杂度。
调用点应直接从 `turn` 或 `t.sandbox` 开始。

## 阶段性候选：先复用，再扩展

下表保存研究当时的候选，供理解决策演进；它不是目标签名：

| 需求 | 裁决 |
|---|---|
| scope 成功 | 复用 `succeeded()` |
| tool 存在 | 复用 `calledTool()` |
| tool 顺序 | 复用 `toolOrder()` |
| 任意文本值 | 复用 `t.check()`，普通文件规则内联 |
| 文件断言与 diff | 复用 `t.sandbox`，不增加 `turn.changes` |
| command 结构 | 扩展既有 `ToolMatch`，不增加 `ranCommand()` |
| tool 子序列 | 让 `toolOrder()` 接受同源 `ToolSelector` |
| 禁止可观察 input 路径 | 增加窄的 `toolInputsExclude({ paths })` |
| show 的动态 locator 与诊断 | 不在本次确定性规则中增加 JSON matcher |

这次扩展的中心不是“名字更好看的新断言词汇”，而是让既有 scoped methods 能消费标准 observation。

## Command projection 的稳定边界

coding-agent Adapter 会遇到 raw shell、argv、`program + args` 与 SDK display summary。
core 无法仅凭 `shell`、`Bash`、`command_execution` 或 input key 判断它们语义等价。

标准 original projection 因此只在两种情况下提供 executable + args：

1. 原生协议直接提供 argv；
2. Adapter 能按自己声明的 grammar 无歧义取得单一 invocation。

复合 shell、动态展开、管道与 quoting 不确定时保持 original opaque。
依赖 opaque invocation 的 command 字段是 unavailable，不通过空格 split 猜一份看似稳定的 argv。

只保留 original 仍不足以服务 NiceEval 自己的公开指引：pnpm 仓库通常执行 `pnpm exec niceeval`，机器 Assertion 却要表达逻辑 CLI `niceeval`。
目标契约因此在 tokenization 之后增加唯一、版本化且封闭的 logical normalizer，只识别已有真实需求的 direct、`pnpm exec`、`pnpm --silent exec` 与无选项 `npx`。
普通 `CommandMatch` 只看 logical argv；original 继续用于脱敏审计，core 不回读 raw shell text，作者也不枚举 wrapper OR。

`toolOrder()` 与 `calledTool()` 必须复用同一个 logical command evaluator。
当前 Roadmap 把它表达为一等 `commandMatch()`，不再嵌进 `ToolMatch.command`。
顺序断言已经证明 command 存在时，普通 E2E 不再重复登记存在性分。

Eve 的 `toolOrder()` 只证明 request subsequence。
NiceEval 保留这条语义：单调 cursor 消费不同 occurrence，但不新增 finish-before-start mode。

Harness 需要的动态 locator 复用、工具输出因果与最终 reply 顺序不应伪装成 `toolOrder()` 的确定性语义。
把它们并入 `toolOrder()` 会让一个常用子序列方法承担隐含的时序协议。

## 为什么路径排除不让作者写正则

Eve 的 matcher mini-language 能用 RegExp 或 predicate 搜索 tool input。
但“禁止 `.niceeval`、`evals` 与 `agents` 路径 component”要求作者维护跨平台边界正则，调用点难读且容易漏报。

阶段性候选曾使用 `toolInputsExclude({ paths })`。
当前 Roadmap 改为组合既有负存在性与 value matcher，使同一 `ToolMatch` 能复用于 presence、absence、count 与 order。
它仍只检查 observed input string leaves；coverage 不完整且没有已知命中时是 unavailable。

该方法不检查 stdout、assistant reply、子进程变量集合或 OS syscall。
它不能被描述为文件访问审计。

## Sandbox 归位

NiceEval 已有 `t.sandbox.fileChanged()`、`fileDeleted()`、`file()` 与 agent 归因 diff。
把文件能力放进 `turn.changes` 会制造第二个 receiver，也让多轮 scope 设计先于真实 Harness 需要。

两个新 Harness 都是一条 `t.send()`，所以 attempt 级 agent 归因 diff 已能表达用户范围：

- `t.sandbox.changedPaths(paths)` 比较 exact touched-path set；
- `t.sandbox.noChanges()` 使用同一个空集 collector；
- `t.sandbox.fileChanged(path, options)` 在同一条 change 检查 before / after 文本；
- `t.sandbox.file(path)` 继续作为延迟 UTF-8 text source。

本轮不增加 exact-one collection API。
Harness 没有后续控制流依赖该值，Eve 既有 `require` 与 NiceEval 当前 diff view 足以处理其它高级场景。

## 为什么不读 show JSON

`niceeval show` 是用户诊断界面。
Harness 的目标是确认 Agent 看懂 compact 输出、复用正确 locator 下钻，并给出正确修复建议。

若 Eval 要求 Agent 把 `show --json` 写到临时文件，再断言 `format`、`schemaVersion`、`view` 与递归 `shape`，测试重点就从用户诊断变成展示 envelope。
大量 array / shape 规则也是一个事实：当前断言层级不对。

研究因此否决 `t.sandbox.json()` 与通用 `JsonRule` 作为这项 Roadmap 的新增能力。
标准机器事实由 scoped assertions 与 Sandbox diff 检查；show 的动态关联不在本次 Assertion Roadmap 中新增。

若 CLI Human 输出无法呈现用户诊断所需事实，应暴露 NiceEval 呈现缺口。
Eval 不能改读 `.niceeval` 私有文件补齐。

## 研究判断

NiceEval 应保留 Eve 的 scope-first 风格，也应保留自己的 `unavailable`、evidence coverage、题内 points 与 optional 语义。
普通调用点不需要新的 Match AST 或大量新方法。

本研究确认了 scope-first、logical command、exact Sandbox path set 与 observed-input coverage 的需求。
具体语法已经由后续 Roadmap 收敛；目标契约只以 [Assertion 作者面 Roadmap](../roadmap/assertion-authoring/README.md) 为准。
