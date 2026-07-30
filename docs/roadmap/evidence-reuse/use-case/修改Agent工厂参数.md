# 修改 Agent 工厂参数

Agent 工厂返回必选 `AgentSpec`，把会改变被测行为的参数写成可序列化条件：

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

`webSearch` 从 `true` 改成 `false` 是 observed condition delta。
两套默认政策都重跑相关 Eval；默认严松只影响系统看不见的参数。

用户确认某组 Eval 完全不使用 web search 时，可以先收窄选择再授权：

```bash
niceeval exp compare/codex local-only \
  --accept condition:agent.options.webSearch
```

框架允许这项风险授权，而不是硬编码禁止 Agent 差异。
授权只作用于当前精确 old → new 值摘要和选中 Eval，不能变成“永远忽略 webSearch”。

API key、token 与凭据路径只经 secret binding 提供，不进入 `AgentSpec`。
凭据轮换不重跑；如果不同 key 实际连接不同账户、权限或后端，影响行为的不是“凭据字符串”，而是账户或服务身份，应另声明 condition 或 resource identity。

`spec` 不可选。
空 `options` 区分“确实没有行为参数”和“Adapter 忘了声明身份”。
任意闭包参数没有进入 spec 时为 opaque：证明优先重跑，复用优先沿用并标 unverified。
