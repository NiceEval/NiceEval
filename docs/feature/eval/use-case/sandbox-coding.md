# 沙箱 coding 任务：从放文件到评 diff

## 解决什么问题

评 coding agent 要回答三件事：起始项目怎么进沙箱、任务完成后怎么验证、以及怎么保证只评 **agent 自己的改动**（而不是 fixture 或校验脚本的写入）。`t.sandbox` 一个命名空间覆盖全程：文件 IO 与命令是立即动作，diff 断言是延迟评估的结果视图。没有自动发现、没有隐式拷贝——起始文件只有显式写入一种来源（[设计原则](../architecture.md#两条设计原则)）。

## 全流程

1. 起始文件显式写进沙箱。少量内联文本用 `writeFiles`，整个 fixture 项目用 `uploadDirectory`（本地路径相对 eval 文件解析，`opts.ignore` 挡住 `node_modules` 这类不该进沙箱的目录）：

   ```typescript
   // evals/refactor.eval.ts
   import { defineEval } from "niceeval";
   import { commandSucceeded, includes } from "niceeval/expect";
   import { readFileSync } from "node:fs";

   export default defineEval({
     description: "把回调改写成 async/await",
     async test(t) {
       await t.sandbox.writeFiles({
         "src/legacy.js": readFileSync("fixtures/legacy-callbacks/legacy.js", "utf-8"),
       });
       // 或整个起始项目: await t.sandbox.uploadDirectory("fixtures/refactor-starter");

       await t.send("把 src/legacy.js 里的回调全部改写成 async/await,保持行为不变。");

       const test = await t.sandbox.runCommand("npm", ["test"]);
       t.check(test, commandSucceeded());

       t.sandbox.fileChanged("src/legacy.js");
       t.check(t.sandbox.diff.get("src/legacy.js"), includes("await"));
     },
   });
   ```

2. 验证命令用 `runCommand`（argv 形式）或 `runShell`（要管道 / 重定向时），结果配 `commandSucceeded()` 断退出码。

3. diff 断言读的是 **agent 归因增量**：变更分类账只把 `t.send()` 窗口内的 workspace 变化归给 agent。你写入的 fixture、send 之后写入的校验文件都不在 `t.sandbox.diff` 里——`fileChanged` 断的是「agent 改了它」，不是「它相对空目录变了」。除 `fileChanged` / `fileDeleted` 外还有 `notInDiff(re)` 断 agent 没碰某类路径（[断言结果](../../sandbox/library/asserting-results.md)）。

4. **防作弊靠调用顺序，不靠框架黑箱**：隐藏校验材料在最后一次 `t.send(...)` 返回后才写入、才运行，而且此后不再发起 `send`。这样 agent 看不到，材料也不进入 agent diff：

   ```typescript
   await t.send("在 src/components/Button.tsx 导出一个 Button 组件。");

   await t.sandbox.writeFiles({ "button.test.ts": BUTTON_TEST_SOURCE });   // agent 看不到
   const test = await t.sandbox.runCommand("npm", ["test"]);
   t.check(test, commandSucceeded());
   ```

5. 评产物质量用 judge 配 `{ on }`：

   ```typescript
   t.judge.autoevals.closedQA("重构是否保持了原有错误处理?", {
     on: t.sandbox.diff.get("src/legacy.js"),
   }).atLeast(0.7);
   ```

## 把最终产物存到宿主机

diff 断言评的是这一次跑分内的归因增量，跑完就随沙箱销毁；要把 agent 的最终产出整体留存到宿主机（离线复查、喂给外部工具、归档训练材料）用 `downloadDirectory`——它是 `uploadDirectory` 的镜像，原样搬运、不做扩展名或内容过滤：

```typescript
// localDir("./out/attempt-final")相对本 eval 文件所在目录解析,与 uploadDirectory 同一锚点,
// 不是相对进程 cwd(运行 niceeval 命令时所在的目录)
await t.sandbox.downloadDirectory("./out/attempt-final", "src");
```

不内置「哪些文件算产出」的判断：下载下来就是宿主机上的普通目录，要筛选、要拼给 judge 用，用 `fs`/`glob` 写普通代码处理——这与 `t.sandbox` 不设带过滤约定的批量读取器是同一条原则（[操作 Sandbox](../../sandbox/library/operations.md#文件)）。

## 边界

- `t.sandbox` 的前提是 agent 声明了 sandbox capability；非沙箱型 agent 上一调用就报清晰错误。
- 路径全部用相对路径，解析到 workdir；不要 hardcode 某个 provider 的绝对路径（[路径与 workdir](../../sandbox/library.md#路径与-workdir一个坐标系)）。
- 第一次 `t.send()` 之前 diff 恒为空，可读不报错。改完又改回的文件净效果是 none，但 `fileChanged` 仍按「触及过」通过。
- 依赖安装这类每 attempt 一次的任务预置放 `EvalDef.setup`，不占 `test(t)` 的篇幅（见[Fixture 与反馈](fixtures-lifecycle.md)）；`stop()` 等生命周期动作由 runner 管，不暴露给 eval 作者。

## 相关阅读

- [Sandbox · 文件与命令](../../sandbox/library/operations.md) —— IO 与命令 API 的单源契约。
- [Sandbox · 断言结果](../../sandbox/library/asserting-results.md) —— diff 视图与延迟断言。
- [Sandbox · 变更归因](../../sandbox/architecture.md#变更归因send-窗口与分类账) —— send 窗口与分类账契约。
- [计分制](rubric-scoring.md) —— 长链条要部分分：检查点 `.points(n)` 叠加挣分，前置用 `t.require()` 或 `.stopOnFailure()`。
