# `show --source` 的终端形态

`--source` 装配 attempt-detail 组件族源码区块的 text 面（切片模型见 [`show`](../../feature/reports/show.md)），显示运行时保存的源码而不是工作树里可能已经改过的文件。多文件形态下它渲染一棵[源码调用树](README.md)：主干整段显示，跨文件调用按需内联被调片段。

```sh
niceeval show @1qrdcfq8 --source
```

```text
evals/install/gpt-researcher.eval.ts
  75    async test(t) {
  76      const version = t.flags.candidateVersion as string;
  ⋯ 12 lines
  89✓     const turn = await t.send(
        turn1 · completed · 12m 04s
  90        `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
  ⋯ 6 lines
  97      await evalInteraction(t, { clarify: CLARIFY, turn });
        ↳ share/eval-install.ts · 6 checks · 6 ✓ · 4/4 pts
  98      await evalInstall(t, { version, standaloneWorkspace: true });
        ↳ share/eval-install.ts · 11 checks · 9 ✓ 2 ✗ · 7/11 pts
        │ evals/install/share/eval-install.ts
        │ 243    await t.group("评估安装", async () => {
        │ 245✓     t.check(root !== null, isTrue("niceeval.config.ts 存在"));
        │ 246✗     t.check(
        │        gate · 评估安装 · satisfies(依赖解析到候选包 niceeval@0.11.0)
        │        expected 依赖解析到候选包 niceeval@0.11.0 · received "0.10.3"
        │ 247        version,
        │ ⋯ 60 lines
        │ 309    await t.group("评估安装最佳实践", async () => {
        │ 312✗     t.check(
        │        soft · 评估安装最佳实践 > 独立 workspace · isTrue(独立子目录有自己的 package.json)
        │        received false · 0/1 pts
        │ 313        pkg?.type === "module",
  99      await evalExperiment(t);
        ↳ share/eval-experiment.ts · 4 checks · 4 ✓ · 3/3 pts
 100      await evalAdapter(t);
        ↳ share/eval-adapter.ts · 9 checks · 9 ✓ · 6/6 pts
 101      await evalExecutionEvidence(t);
        ↳ share/eval-adapter.ts · 2 checks · 2 ✓ · 2/2 pts
  ⋯ 10 lines
 112        for (const r of buildQualityRubrics(QUALITY)) {
 113✓         t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, { on: material }).points(1);
        soft · 产出质量层 · closedQA(【用例真实】…) · score 0.9 ≥ 0.6 · 1/1 pts
        soft · 产出质量层 · closedQA(【断言具体】…) · score 0.4 < 0.6 · 0/1 pts
  ⋯ 9 lines
 123✓       t.calledTool("shell", { input: { command: INDEX_RE } }).points(1);
        soft · 评估是否正确加载文档 · calledTool(shell) · 1/1 pts

unmapped assertions (1) — 没有 loc,不属于任何源码行
  ◌ soft · adapter 未上报 tracing 能力 · reason: 事件流里没有 trace 关联

8 source files · 2 of 43 checks failed
full failure detail:  niceeval show @1qrdcfq8
inline every callee:  niceeval show @1qrdcfq8 --source=full
one file in full:     niceeval show @1qrdcfq8 --source=share/eval-install.ts
```

## 行的三种角色

主干与片段用同一套行语法，标注语义单点定义在 [Scoring · 断言与 Turn 的展示](../../feature/scoring/library/display.md)：

- **断言行**：行号后标 `✓` / `✗` / `◌`，下面按每条断言给分组、matcher、期望值与实际值；计分制附挣分。一行触发多条断言（循环里的 judge）时逐条列出。
- **send 行**：标该行产生的轮的头行事实——轮标签、status、墙钟与 usage。定位不到行的轮不出现在这里，轮次全量清单在 [`--execution`](../../feature/reports/show/execution.md)。
- **调用行**：行号后不标判定符号，下面接一行 `↳` 汇总——`<被调文件> · <N> checks · <通过/未通过> · <挣分>`。同一行在循环里调用多次时合并成一棵子树，各次的标注按发生顺序落在同一批行上（帧链不携带调用序号，汇总不假装知道调了几次）；一行调进两个文件时给两条 `↳`。

汇总行的判定符号取子树里最重的一条：子树全通过只出汇总，含 `✗`、丢分或前置中止时汇总行后默认内联片段（展开条件与行数预算见 [Display](display.md#展开策略与预算)）。前置中止的调用行标 `⤓`，主干上它之后的行整体降灰。

## 省略与内联

源码按「省略无标注区段」压缩，不按行数截断——有标注、有调用、有中止标记的行永不省略，上下文半径与折叠阈值单点在 [Display · 裁行](display.md#三裁行哪些行值得占位置)。被折叠的区段留一行 `⋯ N lines`。片段的行号是被调文件自己的行号，不重编号；片段头行给该文件相对项目根的路径，同一调用行下的多个片段共用一个头行。嵌套调用每层多缩进一个 `│`。

长行按终端宽度截断。

## 两个展开入口

```sh
niceeval show @1qrdcfq8 --source=full
niceeval show @1qrdcfq8 --source=share/eval-install.ts
```

`--source=full` 把全部路径的片段都内联，包括全通过的路径，省略规则照常生效。

`--source=<path>` 切换成单文件模式：指定文件整段显示，本次 attempt 落在它上面的标注全部标出——不管来自哪个调用点，每条标注末尾附 `via <主干行号>` 指回主干。参数按捕获路径的后缀匹配，命中多个时按用法错误退出并列出候选；`full` 是保留字。

## 挂不上主干的片段

调用链不经过主干的判定（setup hook、另一个入口里发生的断言）按最外层用户帧的文件分组，排在主干之后、兜底桶之前，形态与内联片段一致：

```text
outside the eval file · lib/candidate.ts
  41✗     t.check(pages.length, greaterThan(0));
       gate · 候选包里存在合格落点 · greaterThan(0) · received 0
```

## 尾部

尾部先给一行事实（捕获的源码文件数、未通过条数），再给三条取全文路径：完整 expected / received 在 [attempt 首页](../../feature/reports/show/attempt.md)展开，`--source=full` 内联全部片段，`--source=<path>` 读某个文件全文。脚本要拿拼好的 `{path, content}` 用 `AttemptHandle.sources()`，不必自己做 [`sources.json`](../../feature/results/architecture.md#sourcesjson) 的两步解析。

## 相关阅读

- [源码调用树](README.md) —— 问题、目标模型与待裁决。
- [Display](display.md) —— 这份输出怎么装配出来：归属、建树、裁行与降级。
- [Architecture](architecture.md) —— 树的数据模型与捕获规则。
- [`--execution`](../../feature/reports/show/execution.md) —— 轮次与工具调用的全量面。
