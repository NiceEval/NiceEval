# 准备任务 Fixture

某道 Eval 独有的起始仓库、数据文件或任务依赖，应由 `EvalDefinition.setup` 或 `test(t)` 准备。
它们随 Eval 变化，并且属于该题的归因边界。

```ts
export default defineEval({
  setup: async (t) => {
    await t.sandbox.runCommand("pnpm", ["install"]);
  },
  test: async (t) => {
    await t.sandbox.writeFiles({ "TASK.md": "修复登录失败" });
  },
});
```

不要把题目素材放进 Sandbox Hook；后者不知道即将运行哪道 Eval。
