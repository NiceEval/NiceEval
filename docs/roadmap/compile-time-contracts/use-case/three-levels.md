# 三级反馈走查

## 解决什么问题

同一批错误，作者可能在三个时刻撞上：编辑器里、`niceeval` 加载文件时、discovery 完成之后。
这一篇把一次真实改动从头走一遍，说明每一级各自负责哪一类事实，以及作者看到什么。

场景：给一个记忆评测仓库加一道题、一个实验，再画一张跨实验对比图。

## 第 1 级：写下这一行就红

作者在 `evals/weather/brooklyn.eval.ts` 里照旧仓库的习惯手写了 id：

```ts
export default defineEval({
  id: "weather/brooklyn",
  description: "布鲁克林天气查询",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");
    t.succeeded();
  },
});
```

编辑器在 `id` 那一行给出：

```text
Type 'string' is not assignable to type 'IdComesFromFilePath'.
```

类型名就是修法：id 来自文件路径，删掉这一行。
`pnpm run typecheck` 给出同一条，带文件与列号：

```text
evals/weather/brooklyn.eval.ts(2,3): error TS2322: Type 'string' is not assignable to type 'IdComesFromFilePath'.
```

接着作者给实验挂 MCP server，把两种 transport 的字段写在了一起：

```ts
mcpServers: [
  { name: "memory", command: "npx", url: "https://mem.example.com/mcp/" },
],
```

```text
experiments/codex.ts(12,5): error TS2322: Type '{ name: string; command: string; url: string; }' is not assignable to type 'McpServer'.
  Types of property 'url' are incompatible.
    Type 'string' is not assignable to type 'undefined'.
```

诊断落在 `url` 上，因为对象的其余部分已经把它判成了 stdio 分支。
最后作者在报告里把字段名拼错：

```tsx
<Scatter points={rows} x="agent" y="passRat" />
```

```text
report.tsx(24,32): error TS2820: Type '"passRat"' is not assignable to type 'EvidenceAxisKey<...>'. Did you mean '"passRate"'?
```

这三条的共同点：错的东西全写在同一个文件的同一行里，`tsc` 不需要知道项目其余部分。

## 第 2 级：加载文件时中止

同一个仓库里还有一份从旧项目拷来的 `.js` 配置，类型不覆盖它：

```js
// experiments/legacy.config.js
export default defineExperiment({ id: "codex", agent: "codex" });
```

作者跑 `pnpm exec niceeval run weather --experiment legacy`，加载这个文件时中止：

```text
defineExperiment 不接受 id —— id 由文件路径推导。
```

同一类反馈还覆盖三种绕过类型的路径：`as` 断言、动态 `import()` 得到的对象、以及 JSON 里读来的数据。
报告里那张图的数据来自上一季度导出的 JSON，作者用解析入口把它变成行：

```ts
const rows = parseEvidenceRows(await readJson("history.json"));
```

那份 JSON 里有一行只剩维度字段，解析当场失败并点名：

```text
parseEvidenceRow: row needs at least one MetricValue field, got only dimensions (agent, model)
```

这一级负责的是“类型看不见的值”，不是“类型懒得管的值”。
它与第 1 级说同一句话，区别只是证据来自运行时对象而不是字面量。

## 第 3 级：discovery 之后、动资源之前

题和实验各自都能编译，各自也都能装载。
作者给这道题写了 `dockerComposeSandbox(...)`，而实验里已经有 `e2bSandbox({ template: "mempal-codex-v3" })`。

单个文件里两份声明都合法，冲突只在实际配对上成立。
作者跑 `pnpm exec niceeval check memory/codex`：

```text
sandbox.template-conflict: Experiment "memory/codex" and
Eval "terminal-bench/play-zork-easy" both declare a template

  eval:       dockerComposeSandbox(...) at evals/.../eval.ts
  experiment: e2bSandbox({ template: "mempal-codex-v3" }) at experiments/codex.ts

NiceEval starts one Sandbox Case and does not merge or prioritize templates.
Remove one template or split the Experiment's Eval selection.
17 conflicting pairs were found. No Sandbox was created.
```

这一级一次报全部配对，不是撞一条停一条。
它发生在任何 Provider 网络请求、构建与 Sandbox 创建之前，因此 `check` 的代价是零外部资源。

## 哪一级该说话

| 事实取决于什么 | 谁说 | 判据 |
|---|---|---|
| 作者在这一行写下的字面量 | TypeScript | 单个文件内可判定 |
| `.js`、`as` 断言、动态 import 或 JSON 带进来的值 | 装载期守卫 | 值只在运行时存在 |
| discovery 与 selector 形成的实际配对 | 资源前 linker | 需要整个项目，但不需要外部资源 |
| 网络可达、文件存在、请求 option 的实际成员 | 执行期 | 需要外部资源 |

一条约束落错级别的代价是不对称的。
落得太晚，作者要等一次 Run 才知道自己写错了字段名；落得太早，类型系统会去证明它证明不了的事，作者被迫用断言绕开。

三级各自的类型形状、诊断文本与守卫消息见 [Library](../library.md)。
