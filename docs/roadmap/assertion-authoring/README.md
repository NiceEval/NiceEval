# Assertion 作者面

## 解决的问题

Eval 作者需要检查命令、行为顺序、文件变化和结构化结果。
这些确定性事实应由机器判断，不能因为 API 难写而交给 Judge。

普通调用点也不应暴露 Adapter 工具名或 Match AST。
作者若要证明执行过一条命令，不需要先知道某个 Agent 把它叫作 `shell`、`Bash` 还是 `command_execution`。
作者若要匹配一段文本，也不需要先构造 `match.text.pattern()`，再把它嵌进 `match.json.shape()`。

本作者面用领域接收者选择证据范围，用单层 inline rule 表达关系：

```ts
turn.ranCommand({ pattern: /pnpm test/, excludes: { contains: "--watch" } });
turn.changes.fileChanged("src/policy.ts");
t.check(t.sandbox.json("config/policy.json"), { shape: { mode: "strict" } });
```

## 核心心智

普通 Assertion 由三部分组成：

| 部分 | 由谁表达 | 例子 |
|---|---|---|
| 证据范围 | receiver 或 source | `turn`、`turn.changes`、`t.sandbox.json(path)` |
| 稳定事实 | 一等方法 | `ranCommand`、`eventOrder`、`noChanges` |
| 值关系 | inline rule | `{ exact }`、`{ contains }`、`{ pattern }`、`{ shape }` |

方法名只进入 NiceEval 能跨 Adapter、跨真实下游稳定观察的事实。
任务专属词汇、任意事件 predicate 和组合 Match AST 留在高级入口，不扩张普通 API。

普通词汇包含：

- `ranCommand()`：匹配 Adapter 明确投影的 command occurrence；
- `eventOrder()`：证明互不重叠的 logical occurrence 序列；
- `toolInputsExclude()`：约束已观察到的工具输入字符串，不冒充 OS 审计；
- `turn.changes`：检查该 Turn 边界内的 workspace delta；
- `t.requireOne()`：把 exact-one 前置条件、计分和类型收窄合成一条 Assertion；
- `t.sandbox.file()` / `t.sandbox.json()`：在 Assertion 求值边界取得 Sandbox 内容。

## 一条事实只评分一次

`eventOrder([{ command: A }, { command: B }, { reply: "assistant" }])` 已经证明 A、B 存在并满足顺序。
普通 E2E 不再为同两条命令重复登记 `ranCommand()`。

只有存在性本身是独立评分维度、顺序检查是可选项、partial evidence 下仍需单独报告确定存在，或另有 count/status 约束时，才增加存在性 Assertion。

## 证据与结果

确定性 Assertion 继续产生 `passed | failed | unavailable`：

- 已观察到的确定正事实可以在 partial channel 上通过；
- 完整证据已经排除目标事实时才 failed；
- 缺失事件、opaque 字段或不完整 coverage 仍可能让目标成立时 unavailable；
- evaluator 自身违反协议才使 Attempt errored。

negative Assertion 需要证明“没有任何命中”。
因此 `toolInputsExclude()` 和 `noChanges()` 只有在对应证据完整、且没有可能隐藏命中的 opaque 部分时才能 passed。

## 范围

包含：

- inline TextRule、CommandRule、JsonRule 与 ChangeRule；
- command projection、logical occurrence 和 Adapter evidence coverage；
- `ranCommand()`、`eventOrder()` 与诚实的工具输入负断言；
- typed `t.require()`、exact-one `t.requireOne()` 与已登记 handle；
- Turn changes、延迟文件和延迟 JSON source；
- Assertion scope、标题生成、三态诊断和 Judge material 交接；
- 两个 Harness 端到端诊断场景。

不包含：

- 根据 canonical tool name、`command` / `cmd` 字段或 `program + args` 猜命令；
- 把 argv 重建成 shell 文本，或定义跨 shell 的语义等价命令；
- 在普通入口暴露 `allOf`、`oneOf`、`not` 或任意 predicate；
- `includesUrl`、`hasSections` 等任务专属别名；
- 通过工具输入推断 OS 层一定没有读取某个文件；
- session 级 changes 或第二次 diff 采集。

## 入口

- [Library](library.md) —— 普通断言词汇、source、handle 与类型形状。
- [Rule](matching.md) —— inline rule 的消歧语义与高级 Match 边界。
- [Architecture](architecture.md) —— occurrence、coverage、三态求值与错误分类。
- [Use Case](use-case/README.md) —— 两个 Harness 端到端诊断场景。
- [Research](../../research/eve-assertion-dx.md) —— Eve 与旧 Harness 的带日期设计输入。
