# 修改 Agent 工厂参数

## 场景

agent 由工厂函数造出来,开关写在工厂参数里:

```typescript
agent: codexAgent({ webSearch: true }),
```

`webSearch` 从 `true` 改成 `false`,被测 agent 的能力就换了一半,
两个值下跑出来的是两批不可比的结果。

## 怎么写

Adapter 工厂返回必选 `AgentSpec`，把会改变被测行为的参数写成可序列化条件：

```typescript
export function codexAgent(opts: CodexOptions): SandboxAgent {
  return {
    name: "codex",
    kind: "sandbox",
    spec: {
      adapter: "codex",
      options: { webSearch: opts.webSearch ?? false },
    },
    async send(input, ctx) { /* … */ },
  };
}
```

`AgentSpec` 进入每条相关 Requirement 的 manifest。
`webSearch` 换一个值后，默认计划把相关历史 Evidence 标为失效并派发。
API key 不在 spec 中，轮换凭据不改变 Requirement。

```text
compare/codex
  36 个失效：AgentSpec changed
    options.webSearch  true → false
  将派发 36 个 attempt
```

## 边界

`spec` 不可选。
即使没有行为参数，也必须显式返回空 `options`，
不能把「确实没有」和「忘了声明」合并成只认 Agent 名字。

参数归属仍按
[配置归属不变量](../../../feature/adapters/architecture/agent-contract.md):
改变被测行为的是条件，只决定访问权的是凭据。
条件进 spec，凭据只经 secret binding。

AgentSpec 变化不开放 `--accept-change`。
如果用户认为两个开关值下的结果等价，应先修正 Adapter 的 spec 建模，
不能在每次 Invocation 临时放宽被测条件。

要把开关作为报告对照维度时仍可搬进 flags；
那是为了分析分组，不是为了触发重跑。
