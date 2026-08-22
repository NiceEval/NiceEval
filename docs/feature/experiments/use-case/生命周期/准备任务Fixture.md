# 准备任务 Fixture

某道 Eval 独有的起始仓库、数据文件或任务依赖，写 Eval `sandbox` layer 的 `prepare()` 命令或 `test(t)` 普通代码。
它们随 Eval 变化，并且属于该题的归因边界。

```ts
export default defineEval({
  sandbox: sandboxLayer().before(command("pnpm", ["install"])),
  test: async (t) => {
    await t.sandbox.writeText("TASK.md", "修复登录失败");
  },
});
```

不要把题目素材放进 Experiment layer 的命令；后者不知道即将运行哪道 Eval。
