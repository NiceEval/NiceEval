# Library

本页只定义仍存在的静态作者契约。业务字段以 Eval、Experiment、Sandbox、Adapters 与 Inspection 的功能契约为单源；固定 query 与 View 没有作者可声明的 Page、component、theme、renderer、Report 或通用 Analysis/Sample DSL。

## 三级反馈

| 级别 | 出现时机 | 产出者 | 形态 |
|---|---|---|---|
| 类型反馈 | 编辑器里写下这一行；`pnpm run typecheck` | TypeScript | tsc 诊断，光标停在出错属性上 |
| 装载期反馈 | 加载配置、Eval 与 Experiment 文件时 | `define*` 与 `assert*` 运行时守卫 | 抛出的错误消息，点名字段与下一步 |
| link 反馈 | discovery 与 selector 完成后，任何 Provider 动作之前 | 跨定义 linker | 按配对聚合的错误码与计数 |

## 阶段分离

`EvalInput` / `ScoreEvalInput`、`EvalDefinition` 与 `DiscoveredEval` 分别表示作者输入、factory 定义与发现结果。`ExperimentInput`、`ExperimentDefinition` 与 `DiscoveredExperiment` 也遵守这条分离。

作者不能填写路径、factory 或规划生成的 `id`、`evaluationKind` 与 `configHash`。这些字段用模块私有的 `unique symbol` 诊断类型排除；无类型调用仍由装载期守卫给出同一条具名错误。

## 互斥作者输入

MCP server 的 stdio 与 HTTP transport 以 union 互相排除 `command` / `url` 及其专属字段。HITL answer 使用 `optionId` 或 `text` 的 XOR 值类型。作者在同一个对象中同时给出两侧字段，或两侧都不提供时，必须在调用点被拒绝。

## Agent 与 Sandbox

Agent evidence coverage 是穷尽对象：每个固定通道都要声明可用、partial 或 unavailable，并为降级提供原因。Sandbox callback 只能返回主 Sandbox、伴随资源与可选 services；它不能拼接 retention 或未知 capability。

Sandbox layer 只能由具体 template factory 或 `sandboxLayer()` 构造。单个声明的形状由类型与运行时守卫检查；实际 Eval × Experiment 配对是否恰好一份 template 由 discovery 后 linker 检查，早于任何 Provider I/O。

固定 Inspection operations 的 request/result 是协议 owner 的穷尽 union，不由 TypeScript authors 定义或扩展。
