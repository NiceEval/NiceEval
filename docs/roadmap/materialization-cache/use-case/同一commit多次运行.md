# 同一 commit 多次运行

多个 Agent、model 或重复次数可以使用完全相同的声明：

```ts
const source = checkout({
  repository: "https://github.com/acme/project.git",
  commit: "3f7c1f9a03e70cc13eaa9bdb7db891f26f74a836",
});

export default defineEval({
  sandbox: sandboxLayer().prepare(source),
  async test(t) {
    await t.send("完成任务。");
  },
});
```

planning 把相同 DemandKey 合并成一个宿主准备任务。投影只生成一次，但每条 Attempt 都重新传输、建立全新 Git metadata 并 detached checkout。
因此“缓存命中”不意味着复用工作树，也不会继承另一模型的改动。
