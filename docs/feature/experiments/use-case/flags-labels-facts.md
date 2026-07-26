# flags / labels / facts 放哪个:用例手册

一句判据:**值是你写下的 → 配置(`flags` / `labels`);值是跑起来才有的 → `ctx.fact()`**。配置里再分一道:会改变 attempt 里发生的事 → `flags`,只给报表归类 → `labels`。判据单点在 [Library · 运行时坐标不进配置](../library.md#运行时坐标不进配置三个家),本篇按场景给搭配。

## 1. A/B 对比「开不开联网」

**场景**:两个实验同一个 agent,唯一差别是允不允许 agent 联网,要对比通过率。

```ts
// experiments/compare/online.ts
export default defineExperiment({
  agent: codex({ model: "gpt-5.4" }),
  flags: { webSearch: true },     // 改变 attempt 里发生的事 → flags
  evals: "*",
  sandbox: e2bSandbox(),
});
```

```ts
// evals 或 adapter 的 send 里消费它
const agent = codex({ model: "gpt-5.4", webSearch: ctx.flags.webSearch === true });
```

**你会看到**:`flags` 进 `ctx.flags` / `t.flags`,参与可比性配置——改了值,已有缓存结果不再匹配,重跑是对的(它们本来就是不同条件下跑出来的)。

## 2. 给报表标注「这格用的是哪个记忆机制」

**场景**:三个实验分别接 baseline / mempal / nowledge,报告里想按「记忆机制」轴分组对比,但 agent 和 eval 根本读不到这个词。

```ts
export default defineExperiment({
  agent: mempalAgent(),
  labels: { memory: "mempal", line: "codex" },   // 只是报表坐标 → labels
  evals: ["memory/"],
  sandbox: e2bSandbox(),
});
```

**你会看到**:报告用 `label("memory")` 把三个实验排到同一根轴上;改 `labels` **不作废任何已有结果**——它不进运行时,改名、补标注都是零成本的报表操作。

## 3. 记下「这条 attempt 实际连的是哪个实例」

**场景**:记忆服务由 `setup` 现起,隧道 URL 每次重启都换一个。报告里想按实例分组核对,但这个值不该让已完成的结果作废。

它不是你写下的声明——`setup` 跑完才有——所以两个配置袋都不进,上报成 fact:

```ts
// 每沙箱执行的 Hook 里,attempt 作用域
sandboxSetup(): SandboxHook {
  return async (sandbox, ctx) => {
    ctx.fact("nowledge.endpoint", env!.url);
    await sandbox.writeFiles({ ".nowledge/env": `NMEM_URL=${env!.url}\n` });
  };
}
```

**你会看到**:URL 换了照常携带,一条不重烧;`show` 的 `facts:` 行、`--json` 和 `fact("nowledge.endpoint")` 报告轴都读得到它。携带来的条目读到的是**产出它那一轮**的地址,不被本轮的新值冒名顶替。

## 4. 同一个事实,两种角色

**场景**:记忆服务的版本号 `0.10.39`——要不要进 `flags`?

**判据走一遍**:实验声明「我这一格就是要 0.10.39」→ 它是你写下的条件,进 `flags`,换版本作废旧结果正是想要的。跑起来问服务端「你现在是哪个版本」→ 它是观测,进 `ctx.fact()`,用来事后核对当时实际连的是什么。两种都对,取决于谁写下它——但**别只写成 fact 却当条件用**:条件变了旧结果会被错误携带(边界见 [Results · facts](../../record/architecture.md#facts运行事实))。

## 5. 分不清的时候

**场景**:「模型名要不要放 labels?」「实验 id 本身算不算标注?」

**判据走一遍**:模型名改了,attempt 里跑的就是另一个模型 → 它是 `model` 字段(运行配置),连 `flags` 都不是;实验 id 是身份,由文件路径推导,两者都轮不到 `labels`。`labels` 只装「agent 和 eval 看不见、只有报表关心」的词。声明与消费的完整规则见 [Library · labels](../library.md#labels声明归类坐标不进运行时)。

## 相关阅读

- [改什么会作废缓存](cache-invalidation.md) —— 放错家之后表现出来的样子,以及搬家怎么不赔重烧。
