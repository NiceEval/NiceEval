# 沙箱 coding 任务：从放文件到评 diff

评 coding agent 要回答三件事：起始项目如何进入 Sandbox、任务完成后如何验证、以及如何只评 Agent 自己的改动。文件传输使用公开 Sandbox API；相对 `send` 的位置决定可见性，send 区间决定归因。

```typescript
import { defineEval } from "niceeval";
import { commandSucceeded, includes } from "niceeval/expect";

export default defineEval({
  judge: true,
  description: "把回调改写成 async/await",
  async test(t) {
    await t.sandbox.uploadDirectory(new URL("fixtures/legacy-callbacks/", import.meta.url), "/app");
    await t.send("把 src/legacy.js 里的回调全部改写成 async/await，保持行为不变。 ");

    const test = await t.sandbox.runCommand("npm", ["test"]);
    t.check(test, commandSucceeded()).label("测试通过");
    t.sandbox.fileChanged("src/legacy.js").label("修改目标文件");
    const diff = t.sandbox.diff.get("src/legacy.js") ?? "";
    t.check(diff, includes("await")).label("使用 await");
    t.judge.autoevals.closedQA("重构是否保持原有错误处理？", {
      input: "重构 src/legacy.js，保持原有错误处理。",
      output: diff,
    }).atLeast(0.7).label("重构质量");
  },
});
```

验证命令使用 `runCommand` 或 `runShell`，结果经 `t.check` 登记为值 Assertion。`fileChanged` 与 `t.sandbox.diff` 只评 Agent 归因的增量；Fixture 和验证写入不混进该 diff。

文件内容要送给 Judge 时先读取或取得字符串，再在根级 `t.judge` 中明确传入 `{ input, output }`。Judge 不接受路径或 `{ on }`。

## 相关阅读

- [Sandbox · 文件与命令](../../sandbox/library/operations.md) —— IO 与命令 API。
- [Sandbox · 断言结果](../../sandbox/library/asserting-results.md) —— diff Assertion。
- [Judge](../../judge/library.md) —— 显式材料与 measurement。
