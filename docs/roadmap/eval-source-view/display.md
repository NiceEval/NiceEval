# 展示层怎么装配这棵树

[源码调用树](README.md)的展示不是「多渲染几个文件」，而是一次归属判定加一次裁行：把每条判定痕迹挂到它该待的调用点上，再决定哪些行值得占终端。本页定稿装配算法、预算与降级，[CLI](cli.md) 定稿终端形态，[Architecture](architecture.md) 定稿数据结构与捕获。

装配是一个纯函数，text 面与 web 面共用同一份产物：

```ts
assembleSourceTree(
  input: {
    sources: SourceArtifact[];      // 已解引用的 {path, content}
    assertions: AssertionResult[];
    scoreEntries: ScoreEntry[];
    sends: SendAnnotation[];
    abort?: SourceLoc;              // 计分制前置中止发生的位置
  },
  opts: { inlineAll: boolean; budgetLines: number },
): AnnotatedEvalSource
```

两个面的差别只在 `opts`：终端默认 `{ inlineAll: false, budgetLines: 400 }`，`--source=full` 与 web 面用 `{ inlineAll: true, budgetLines: Infinity }`。折叠与展开因此是同一棵树的两种投影，不是两套渲染器。

## 三个阶段

### 一、归属：每条痕迹挂到哪个调用点

每条带 `loc` 的痕迹（断言、给分记录、send）取出它的完整用户帧链 `chain = [...loc.callers, loc]`，由外到内。挂点按下面的顺序判定：

1. **链里有主干帧**：取**最深的那个**主干帧作为挂点，它之后的帧构成子树路径。取最深而不是最外，是因为回调会让链多次穿过主干——`t.group("产出质量层", async () => { … t.judge… })` 的链是 `[eval:108, eval:113]`（`t.group` 自身是内部帧，被过滤掉），标注该落在写着 judge 的 113 行，不是写着 group 的 108 行。
2. **链里没有主干帧**：整条链进 `detached`，按 `chain[0]` 的文件分组。setup hook 里的断言、另一个入口里发生的判定都走这里。
3. **没有 `loc`**：进 `unmapped`，平铺。

主干是哪个文件不靠猜——`sources.json` 的条目自带 `role`（见 [Architecture](architecture.md#sourcesjson-标注主干)），恰好一条是 `entry`。

### 二、建树：链的剩余段变成嵌套调用

挂点之后的帧序列逐段下钻，每一段是一条边：调用行 `chain[i]` → 被调文件 `chain[i+1].file`。同一条边被多条痕迹经过时合并成同一个 `SourceCall`，最深帧的 `(file, line)` 上挂这条痕迹的标注。

因此循环里三次调用同一个 helper 只产生一棵子树，三次的标注按发生顺序落在同一批行上——与「一行多断言」同规则。帧链不携带调用序号，树也不假装知道调用了几次。

汇总数字（`checks` / `passed` / `failed` / `points`）在建树后自底向上累加：一个 `SourceCall` 的汇总等于它子树里全部标注的合计，含更深层的。前置中止的位置沿链把 `aborted` 一路标到主干。

### 三、裁行：哪些行值得占位置

每个节点先算「必留行」——有标注的行、有出边的行、中止行。再按上下文半径向两侧扩张、合并相邻段，落成 `lines` 数组；被跳过的区段不进数组，行号不连续处由渲染面画 `⋯ N lines`。

| | 上下文半径 | 折叠阈值 | 起始范围 |
|---|---|---|---|
| 主干 | 3 行 | 连续 8 行以上无标注无调用 | `defineEval` 调用覆盖的行范围 |
| 子树节点 | 2 行 | 连续 4 行以上无标注无调用 | 全文件 |

## 展开策略与预算

`inlineAll: false` 时，一个 `SourceCall` 只有满足下面任一条才展开子树，否则只留汇总行：

- 子树里有未通过的断言（`✗`）；
- 计分制下有丢分（`earned < available`）；
- 子树里有前置中止。

展开后总行数仍可能超 `budgetLines`。超出时按「最深且最不严重优先」收回：先收深层子树，同深度里先收只有 soft 失败的，再收有 gate 失败的；主干永不收回。被收回的子树留汇总行并在尾部提示 `--source=full`。预算是有界诊断的兜底，不是常态路径——正常的失败 attempt 应该在预算内展开完。

## 降级：链不完整时展示什么

调用链是展示质量的增量，不是展示的前提。同一个装配器在链缺失时自然退化，不需要第二套实现：

| 输入状态 | 展示 |
|---|---|
| `callers` 为空，`loc.file` 是主干 | 正常挂主干行——单文件 eval 恒走这条 |
| `callers` 为空，`loc.file` 不是主干 | 该文件成为一个 `detached` 节点，按文件分组的片段排在主干之后 |
| 链中间某帧的文件没被捕获（在沙箱内、已删、权限） | 该帧不建节点，链在此处压缩：更深的帧直接挂到上一个有源码的帧下，汇总行标 `(source unavailable: <path>)` |
| 链穿过第三方包 | 折叠成一条不可展开的 `(package: <name>)` 标记 |
| 没有 `loc` | `unmapped` 平铺 |
| 没有 `sources` | `evalSource` 为 `null`，`--source` 报 unavailable，不伪造空文档 |

第二行是这套设计的下限形态：**没有调用链时，展示就是「主干 + 按文件分组的片段」**。它比当前挑一份主文件、其余进兜底桶严格地好，且不依赖 `loc` 的任何变化——链只是把这些片段从主干后面搬到它们该在的调用行下面。

## 两个面各自负责什么

树是可序列化的纯数据，两个面都不重新分桶、不重新裁行：

- **text 面**渲染缩进 `│` 层级、`↳` 汇总行、`⋯ N lines`，按终端宽度截长行。
- **web 面**（`AttemptSource`）把 `SourceCall` 渲染成调用行右缘的汇总 pill 加一个 `<details>`，展开态内联片段；含未通过标注的路径 `open` 默认为真。零 JS 静态文档因此完整成立，展开不依赖脚本。行状态、展开区、兜底区的视觉沿用[既有规范](../../feature/reports/components/attempt-detail.md#attemptsource-web-面视觉规范)，片段内的行与主干的行是同一套样式——新容器不会自动继承样式，片段容器要有自己的规则覆盖。

## 落地时展示层要改的落点

- `loadAnnotatedEvalSource()` 的「挑一份主文件」换成 `assembleSourceTree()`；`AttemptEvidence.evalSource` 字段名不变，类型换成树。
- `AnnotatedSourceLine` 增 `calls`，`AnnotatedEvalSource` 增 `detached`，`sourcePath` / `sourceSha256` 下沉成主干节点的字段。
- `attemptSourceData()` 与两个面按树重写；`loc.file === sourcePath && line <= lines.length` 这类「在不在展示源码里」的判定由归属阶段统一给出，各处不再自己判。
- `summary.mappedAssertions` 的口径扩成「挂上树的（含 `detached`）」，`unmappedAssertions` 只剩没有 `loc` 的。

## 相关阅读

- [源码调用树](README.md) —— 问题、目标模型与待裁决。
- [CLI](cli.md) —— 终端形态与两个展开入口。
- [Architecture](architecture.md) —— `loc` 调用链、捕获规则与数据结构。
