# 调用链、捕获与树模型

[源码调用树](README.md)要成立，三处契约要一起改：`loc` 记得下调用链、捕获跟得上调用链、展示模型是递归的。三处都在 core 里，不引入 adapter / sandbox 分支。装配算法、预算与降级见 [Display](display.md)。

## `loc` 记调用链

[`AssertionResult.loc`](../../feature/scoring/architecture.md) 当前只记声明处一个点。候选契约给它加一条用户帧链：

```ts
interface SourceFrame {
  /** 相对项目根(config 所在目录)的路径。 */
  file: string;
  line: number;
  column?: number;
}

interface SourceLoc extends SourceFrame {
  /**
   * 从 eval 入口到声明处的用户帧,由外到内,不含声明处自己。
   * 断言直接写在入口文件里时为空数组。
   */
  callers: SourceFrame[];
}
```

`loc` 自身仍然是声明处，既有读取面（`source: <loc>` 行、`--json`、脚本）不变；`callers` 是新增的骨架。完整链是 `[...loc.callers, loc]`。同一条契约适用于 `ScoreEntry.loc` 与 `t.send` 的调用点——三类痕迹挂树的规则一致。

**用户帧**指同时满足两条的栈帧：文件在项目根之内，且不在 `node_modules` 之内。niceeval 自身的帧（`t.check` 的实现、group 的包装、adapter 内部）永远不是用户帧。链上遇到第三方包时，该段折叠成一条 `{ package: string }` 标记，不可展开、不进捕获。

这是一次给共享接口加**可选**语义的改动，按仓库规则要做调用点普查：`callers` 做成必选（无链时为空数组）而不是 `callers?`，让漏填在类型上就暴露。

### 采集

链在断言注册时采集，与声明处出自同一次栈回溯：`captureLoc()` 已经在每次 `t.check` / `t.send` 落地时生成一份栈字符串并逐帧扫描，只是命中第一个用户帧就返回。改成扫完整条栈、收集全部连续用户帧，多出的开销只是多解析几行字符串——栈的物化这一笔已经付过了，链不引入第二次回溯。

两处需要显式处理：

- **`Error.stackTraceLimit`**。默认 10 帧对夹着内部帧的深链不够用。采集期间把它抬到足以覆盖用户链的档位，采集结束还原，不长期改全局。
- **async 边界**。`await evalInstall(t, …)` 这类跨异步调用的帧靠 V8 的 async 栈保留，链断在哪里就到哪里为止。链短了不报错也不猜：`callers` 记到哪算哪，展示层按已有前缀挂树，缺失部分按[降级矩阵](display.md#降级链不完整时展示什么)处理。

采集不到栈（运行时不提供、或链完全断开）时 `callers` 为空数组，该条断言按「调用链不经过主干」处理，不静默丢弃。

## 捕获跟着调用链走

[`sources.json`](../../feature/results/architecture.md#sourcesjson) 的引用列表收录**链上每个用户帧的文件**，不只是 eval 入口文件。落盘的两层结构不变：attempt 级列 `{path, sha256}` 引用，快照级 `sources/<sha256>.json` 按内容去重存正文。

- **读取时机**：文件在首次被某个用户帧引用时读盘并哈希，attempt 内缓存。attempt 运行期间源码被改（agent 改到自己的题、watch 模式重存）不影响已经捕获的那份——源码是判定时刻的快照。
- **去重收益**：五道题共用一套 `share/` helper 是常态，同一快照内这些 helper 的正文只存一份。多文件捕获因此不按文件数线性增长存储。
- **携带与发布**：携带条目照旧走 `artifactBase` 回退，`copySnapshots` 照旧解引用后在目标快照重新去重。多文件不改这两条。

### `sources.json` 标注主干

展示层要知道哪份源码是主干，这件事不靠猜（挑「断言命中最多的文件」会在 helper 承载判定时挑中 helper，把读者带到一份不是他写的题的文件上）。引用列表的条目因此自带角色：

```ts
type SourcesRef = {
  path: string;
  sha256: string;
  /** 恰好一条是 entry:eval 定义所在的文件,即展示的主干。 */
  role: "entry" | "referenced";
}[];
```

`role` 是必选字段而不是给主干加个可选 `entry?: true`——可选字段在多个构造点上漏填是合法省略，类型系统一次都拦不住（仓库规则见 [CLAUDE.md](../../../CLAUDE.md)）。角色在 discovery 时就已知：入口文件正是 `captureEvalSource(evalDef.sourcePath)` 捕获的那份，不需要运行后反推。

入口文件即使没有任何标注也一定被捕获——它是主干。

## `AnnotatedEvalSource` 是递归的

树的一个节点是「一个文件的若干行 + 每行的标注 + 每行发出的调用子树」：

```ts
interface AnnotatedEvalSource {
  /** 主干:eval 入口文件里 defineEval 调用覆盖的行范围。 */
  spine: SourceNode;
  /** 调用链不经过主干的判定,按最外层用户帧的文件分组。 */
  detached: SourceNode[];
  /** 没有 loc 的断言与给分记录。 */
  unmapped: { assertions: AssertionResult[]; scores: ScoreEntry[] };
}

interface SourceNode {
  /** 相对项目根的路径。 */
  file: string;
  /** 本节点要展示的行,按行号升序;省略区段由消费方按连续性判定。 */
  lines: SourceLine[];
}

interface SourceLine {
  line: number;
  text: string;
  /** 该行上的断言、给分记录与 turn 头行事实,按发生顺序。 */
  annotations: LineAnnotation[];
  /** 该行发出的跨文件调用,一行调进两个文件时有两项。 */
  calls: SourceCall[];
  /** 前置中止发生在这一行或它的子树里。 */
  aborted?: boolean;
}

interface SourceCall {
  summary: {
    file: string;
    calls: number;
    checks: number;
    passed: number;
    failed: number;
    points?: { earned: number; available: number };
    aborted: boolean;
  };
  node: SourceNode;
}
```

`SourceNode.lines` 已经是过滤后的展示行：主干含定义行范围内的全部行，被调节点只含标注行与上下文行。省略区段不进数组，消费方按行号不连续渲染 `⋯ N lines`。这让 text 面与 web 面共用同一份可序列化数据，不各自重算取哪些行。

`attemptSourceData(evidence)` 产出这棵树（组件契约见 [Attempt 详情组件](../../feature/reports/components/attempt-detail/README.md)）。装配在 `loadAttemptEvidence` 里一次完成：读 `sources.json` 解引用正文，按每条 `loc` 的链把标注挂到节点上，再按上下文半径裁行。

**同一调用行调用多次**（循环里调 helper）合并成一个 `SourceCall`，`summary.calls` 记次数，各次的标注按发生顺序累加到同一批行上——与「一行多断言」同规则。

## web 面

`AttemptSource` 消费同一棵树，投影规则与终端的差别只在展开策略与交互：

- 主干整段渲染，视觉规范（密度、行状态、展开区、兜底区）沿用 [`AttemptSource` web 面视觉规范](../../feature/reports/components/attempt-detail/attempt-source.md#web-面视觉规范)。
- 调用行右缘挂汇总 pill（`11 checks · 2 ✗ · 7/11`），点击展开内联片段；片段左缘一条竖线表示层级，片段内的行与主干的行是同一套行状态样式。
- 报告必须在零 JS 的静态 attempt 文档里完整成立，因此展开态用 `<details>` 承载，不依赖脚本。含未通过标注的路径默认展开。
- 静态导出照旧在构建期把解引用好的树写进初始 HTML，浏览器不回头读 `sources.json`。

## 落地时要一起改的契约页

- [Scoring Architecture](../../feature/scoring/architecture.md)：`loc` 的形状。
- [Results Architecture](../../feature/results/architecture.md#sourcesjson)：`sources.json` 的捕获范围。
- [Concepts](../../concepts.md)：`AnnotatedEvalSource` 的一句话定义。
- [`--source`](../../feature/reports/show/eval-source.md)：替换为 [CLI](cli.md) 的形态。
- [Attempt 详情组件](../../feature/reports/components/attempt-detail/README.md)：`AttemptSource` 的数据与视觉规范、兜底区的两类划分。
