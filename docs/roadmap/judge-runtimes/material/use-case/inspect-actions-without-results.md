# 检查动作但不授权结果

要判断 Agent 是否采用了正确操作路径，只绑定 `actions()`：

```ts
const check = judge.check({
  recipe: usedPublicVerificationFlow,
  material: {
    task: turn.material.input,
    actions: turn.material.actions(),
  },
});

t.judge.llm(check).atLeast(0.8).label("公开验证流程");
```

`actions` 可以说明 Agent 调用了什么工具、传了什么 input、logical command 是什么以及调用是否完成。它不包含 stdout、stderr、文件内容、子 Agent 输出或其它 Tool result。

因此 Judge 可以确认 Agent 自己运行过 `niceeval query`，却不能从 query 输出替 Agent 推理答案。若任务要求 Agent 在最终回复解释 `runtime: node` 到 `runtime: python` 的变化，只授权 reply；Judge 只有在 Agent 写出这项理解时才能得分。

Action collection 不完整时 required `actions` slot 为 unavailable，不拿已采到的半条 transcript 继续判分。
