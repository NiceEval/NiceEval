# Eve 断言 DX 与 Harness 需求

本研究比较 Eve 与 NiceEval 的断言作者面，并用 NiceEval-Eval Harness 检查候选 API 是否解决真实问题。
它只提供带日期的设计输入，不构成 NiceEval 的目标契约。

## 观察版本

观察日期是 2026-08-08。

| 对象 | Revision | 主要证据 |
|---|---|---|
| Eve | `bd93f55481b3048d0273dd041b423e73fb9248cf` | `packages/eve/src/evals/` 与 `docs/evals/` |
| NiceEval-Eval | `2794a6cf315c247605f14a9ffed55f0a4564ac78` | 当时的 `evals/harness/add-regression/eval.ts` 与 Harness 说明 |
| NiceEval | 本研究所在工作树 | Assertions、Sandbox change attribution、Adapter events 与 evidence coverage |

Eve 与 NiceEval-Eval 都来自本机 checkout。
本研究读取源码、文档与 Git revision，没有把运行中服务或发布包行为混入判断。

Harness 随后的产品目标收敛为两个端到端诊断场景。
旧题的 18 条、34 分只作为研究样本，不构成需要守恒的目标契约。

## 值得保留的分层

Eve 与 NiceEval 都把检查分成三类：

| 入口 | 负责什么 |
|---|---|
| scope assertion | turn、session 或 attempt 内的标准行为事实 |
| value/source assertion | 作者值、Sandbox 文件、JSON 与 change selection |
| Judge | 无法由确定规则完整表达的开放式质量标准 |

这套分层避免把协议事实、任意 TypeScript 值和模型判断并入一个万能函数。
NiceEval 还需要保留 Eve 没有的 `unavailable`、evidence coverage、题内 points 与 optional 语义。

Eve 的 `.label()`、assertion-backed require、类型化 event matcher 与结构化 Judge material 都提供了有价值的作者体验。
这些体验可以吸收，但不能继承 raw event、boolean-only result 或缺少 coverage 的数据模型。

## 旧 Match 方向为什么不足

第一轮候选把所有关系统一成显式 Match AST：

```ts
const command = match.text.pattern("local command", /niceeval exp local/i);
const input = match.json.shape({ command });
turn.calledTool("shell", { input });
```

它消除了 raw RegExp 的部分歧义，却没有解决普通作者的核心负担：

- 作者仍需知道 Adapter 把命令叫作 `shell`；
- 一条常见检查需要预声明多个中间 matcher；
- `allOf`、`not` 与递归 shape 把 AST 组合复杂度暴露到每个 Eval；
- `eventOrder` 若另收 `{ command }`，容易形成第二套命令匹配语义；
- exact-one 仍需要匿名 type predicate 才能取得收窄后的值。

因此问题不只是 Match builder 名字。
普通入口需要先拥有标准 observation fact 与延迟 source，再用局部 inline rule 说明关系。

## Command fact 的边界

现有 Adapter 会遇到 `shell`、`Bash`、`command_execution`、argv、`command`、`cmd` 与 `program + args` 等形状。
canonical tool name 适合展示和粗粒度工具统计，但不足以证明这些形状语义等价。

研究据此得到两条限制：

1. CommandProjection 必须由 Adapter 按原生协议显式分类，不能由 core 猜；
2. TextRule 只匹配协议明确提供的原始 command source，不能把 argv 重建成字符串。

argv-only Adapter 对文本命令断言返回 unavailable，比输出一条看似统一、实际 quoting 已失真的字符串更可靠。
这使 `ranCommand()` 成为跨 Adapter 的共同信任规则，而不是强行统一所有命令表示。

## Inline rule 的消歧

text slot 的普通路径只保留：

```ts
{ exact: "..." }
{ contains: "..." }
{ pattern: /.../, excludes: { contains: "..." } }
```

直接传入的 string 与 RegExp 都不进入 text slot。
Identifier slot 直接接收 string 并固定 exact，因为工具名、角色和 change kind 本来就是离散身份。

`excludes` 只作用于同一个 candidate。
它满足“命令包含 A 且不含 B”的高频需求，但不会发展成跨 candidate 的通用 `not/allOf` 程序。

## Logical order

Eve 的 event order 使用 raw protocol events，没有把 start 与 finish 合成 logical occurrence。
同类事件交错时，“前一项结束后下一项才开始”无法由事件类型数组可靠表达。

NiceEval 的 sequence 需要：

- command rule 与 `ranCommand()` 复用同一 projection 和 evaluator；
- 每个位置由不同 occurrence 满足；
- 非最终 operation 必须 finish；
- `next.start > previous.finish`；
- partial / opaque evidence 保留 feasible-but-unproven 的 unavailable。

一条 sequence 已证明命令存在时，不再为同一事实重复登记存在性分。
独立 status、count 或 partial diagnosis 确有价值时，才额外登记 `ranCommand()`。

## Sandbox 与 JSON

Harness 需要在调用点检查 Turn changes、最终文本文件和 `show --json` 输出。
这些事实不应通过 eager read、手写 parser 或匿名 predicate进入 Eval。

研究建议：

- `turn.changes.paths({ exact })` 比较应用 ignore 后的最终 normalized path 集合；
- `t.sandbox.file(path)` 继续作为延迟文本 source，不增加同义 `text(path)`；
- `t.sandbox.json(path)` 负责一次读取、UTF-8 decode 与 parse；
- missing、invalid UTF-8 与 JSON syntax error 是 Assertion failed；
- permission、transport 与 timeout 是 unavailable；
- nested shape 使用显式 object / array node，不靠 serialized JSON search。

数组需要两种精确关系：ordered exact 与 unordered exact multiset。
unordered 使用一对一匹配，重复 rule 消费不同 actual index，额外元素不能通过。

object shape 还需要局部 `present` / `absent` field rule。
它们能表达 accepted provenance 的有无和禁止额外差异字段，又不引入任意 predicate。

## Exact-one

旧 Harness 用 `newEvalFiles[0]!` 接在 boolean length check 后，Assertion 与类型控制流彼此分离。
`t.requireOne()` 直接对 `readonly T[]` 或 collection source 登记一条 gate Assertion，并返回唯一的 `T`。

0 或多项是 failed，source unavailable 是 unavailable。
两种结果都终止依赖路径，但不冒充 Attempt error。

## 研究判断

NiceEval 不需要换掉 AssertionResult、scope、handle、coverage 或 Judge 分层。
需要替换的是普通作者面对 Match AST 和 Adapter 细节的方式。

目标应是一组受 observation owner 约束的一等词汇：`ranCommand`、`eventOrder`、`toolInputsExclude`、Turn changes、typed require 与延迟 Sandbox source。
高级 Match AST 仍可作为少数协议或任务特例的逃生口，但不应成为普通 Harness 的必经路径。

普通词汇只有在两个独立下游需要、跨 Adapter completeness 可定义、并能归入既有 rule domain 时才增加。
这道门槛比“能少写几行”更能阻止核心 API 膨胀。

定稿契约见 [Assertion 作者面 Roadmap](../roadmap/assertion-authoring/README.md)。
