---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 沙箱 coding 任务：从放文件到评 diff

评 coding agent 要回答三件事：起始项目如何进入 Sandbox、任务完成后如何验证、以及如何只评 Agent 自己的改动。文件传输使用公开 Sandbox API；相对 `send` 的位置决定可见性，send 区间决定归因。

```typescript
import { defineEval } from "niceeval";
import { closedQA, commandSucceeded, includes } from "niceeval/expect";

export default defineEval({
  judge: true,
  description: "把回调改写成 async/await",
  async test(t) {
    await t.sandbox.uploadDirectory(new URL("fixtures/legacy-callbacks/", import.meta.url), "/app");
    await t.send("把 src/legacy.js 里的回调全部改写成 async/await，保持行为不变。 ");

    const test = await t.sandbox.runCommand("npm", ["test"]);
    t.check(test, commandSucceeded()).label("测试通过");
    t.sandbox.fileChanged("src/legacy.js").label("修改目标文件");
    const src = await t.sandbox.readText("src/legacy.js");
    t.check(src, includes("await")).label("使用 await");
    t.check(
      { input: "重构 src/legacy.js，保持原有错误处理。", output: src },
      closedQA("重构是否保持原有错误处理？").atLeast(0.7),
    ).gate().label("重构质量");
  },
});
```

验证命令使用 `runCommand` 或 `runShell`，结果经 `t.check` 登记为值 Assertion。`fileChanged` 负责 Agent 归因判定；`readText` 只提供当前内容，不判断是谁写入的。Fixture 和验证写入不混进归因。

文件内容要送给 Judge 时先读取或取得字符串，再以 `{ input, output }` 和 Judge Match 交给 `t.check`。Judge 不接受路径或 `{ on }`。

## 相关阅读

- [Sandbox · 文件与命令](../../sandbox/library/operations.md) —— IO 与命令 API。
- [Sandbox · 断言结果](../../sandbox/library/asserting-results.md) —— diff Assertion。
- [Judge](../../judge/library.md) —— 显式材料与 measurement。
