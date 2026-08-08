# Assertion 作者面

## 用户需要

Eval 作者要表达的是用户可观察的要求：Agent 是否按顺序运行命令、是否只修改允许的文件、是否通过公开输出完成诊断。
作者不应先学习 Adapter 工具名、手写正则，或把一条 CLI 输出转换成 JSON Match AST。

一条普通检查应直接从证据所属对象开始：

```ts
turn.succeeded().gate();
turn.toolOrder([{ command: ["niceeval", "exp", "local"], excludes: ["--dry", "--dry-run"] }, { command: ["niceeval", "show"] }], { sequential: true }).gate();
t.sandbox.changedPaths(["experiments/local.ts"]).points(3).gate();
```

`t`、session 与 turn 使用同一组作用域词汇，只改变观察范围。
文件操作、文件材料与 agent 归因 diff 统一留在 `t.sandbox`，不在 `t` 或 turn 上复制文件 API。

## 参照设计

本 Roadmap 以 Eve 的作用域断言为参照设计，优先扩展已有方法，不为一项用例增加同义方法。

| 用户意图 | 普通入口 |
|---|---|
| 作用域健康 | `t.succeeded()` / `session.succeeded()` / `turn.succeeded()` |
| 工具存在与顺序 | `calledTool()` / `toolOrder()` |
| 禁止可观察工具输入引用路径 | `toolInputsExclude()` |
| 文件范围与内容 | `t.sandbox.*` |
| 任意文本值 | `t.check(value, inlineRule)` |
| 需要解释完整操作过程 | `turn.judge.llm()` |

普通路径没有 `match.*` namespace，也不要求作者预声明 matcher 或共享规则构造器。
Inline rule 只在需要比较明确文本值时出现。
已有 `t.check()` 继续负责明确的值；新领域事实不包装成 `t.check()` 的自定义 value。

## 最小扩展

本 Roadmap 只增加已有词汇无法诚实表达的能力：

- `calledTool()` 与 `toolOrder()` 共用结构化 command selector；
- `toolOrder(..., { sequential: true })` 证明前一项完成后下一项才开始；
- `toolInputsExclude({ paths })` 检查已观察工具输入中的路径引用；
- `t.sandbox.changedPaths()` / `noChanges()` 检查 agent 归因路径集合；
- `t.sandbox.fileChanged(path, options)` 在同一条 change 中检查前后文本。

`ranCommand()`、新的 `eventOrder()` 方言、`turn.changes`、`t.requireOne()` 与 `t.sandbox.json()` 不进入这套作者面。
它们会复制既有概念，或把展示格式和通用 JSON DSL 变成核心契约。

## 为什么不匹配 show JSON

Harness 的用户要求是“用 `niceeval show` 完成诊断”，不是“产出某个 JSON envelope”。
机器断言负责命令顺序、禁止路径、成功状态和 Sandbox diff 等标准事实。

`show` 的 locator 绑定、输出含义与最终建议需要关联完整 tool calls 和 assistant message。
这类检查由 `turn.judge.llm()` 读取完整 Turn；Eval 不要求 Agent 重定向 JSON，也不把 `format`、`schemaVersion` 或 `sections` 固化成断言 API。

## 证据与结果

确定性 Assertion 继续产生 `passed | failed | unavailable`：

- 已观察到的确定正事实可以在 partial channel 上通过；
- 完整证据已经排除目标事实时才 failed；
- opaque 字段或不完整 coverage 仍可能让事实成立时是 unavailable；
- evaluator、Adapter 或 provider 违反自身协议时才使 Attempt errored。

负断言必须证明没有命中。
因此 `toolInputsExclude()` 与 `t.sandbox.noChanges()` 只有在对应证据完整时才能 passed。

## 一条事实只断言一次

顺序断言已经证明其中每个 command occurrence 存在。
普通 E2E 不再为同一命令额外登记 `calledTool()` 得分项；只有 count、独立 status 或独立诊断确有用户价值时才增加存在性 Assertion。

Score Assertion 直接链 `.gate()` 是零分硬要求。
只有 `.points(n)` 进入可得分总数，且 `n` 必须是正有限数；`.points(0).gate()` 是 author error。

## 入口

- [Library](library.md) —— 公开方法与类型形状。
- [Rule](matching.md) —— inline rule 与 selector 的消歧语义。
- [Architecture](architecture.md) —— command projection、coverage、diff 与错误分类。
- [Use Case](use-case/README.md) —— 两道单轮 Harness 的用户旅程和完整调用。
- [Research](../../research/eve-assertion-dx.md) —— Eve 与 Harness 的带日期设计输入。
