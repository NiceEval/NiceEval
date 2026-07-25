# 裁决:Results 拆成 Record / Sample / Reports 三层,并整套改名

**日期**:2026-07-25

## 裁决

`niceeval/results` 一分为二,与 `niceeval/report` 合成三层,每层只做一件事:

| 层 | 模块 | 职责 |
|---|---|---|
| 事实 | `niceeval/record` | 格式、读写、身份、发布 |
| 选择 | `niceeval/sample` | 口径、覆盖、时效、转换算子 |
| 呈现 | `niceeval/report` | 指标、组件、两个渲染面 |

同批改名(全部是破坏性的,beta 期不背兼容包袱):

| 旧 | 新 | 理由 |
|---|---|---|
| `results` / `niceeval/results` | `record` / `niceeval/record` | 「the record」= 可援引的记录,正对「每个数字能回到证据」的核心承诺;`results` 太泛,而且要专门写一段辩护「这个词不在层级里重复」——需要辩护就是名字弱的证据 |
| `Snapshot` | `Run` | snapshot 意为「某一刻的完整拷贝」,而它由 carry 跨时间续成、内容可来自三个月前,名不副实;且仓库里 snapshot 已被 Vercel/E2B 的 provider 产物与「快照测试」占用 |
| `Scope` | `Sample` | 仓库里 `Scope` 同时指 Effect 资源作用域、`FailureScope`、结果选择范围——三件事一个词;`sample.coverage`(样本覆盖总体多少)在统计学隐喻下自洽,`scope.coverage`(范围的覆盖)是同义反复 |
| `results.latest()` / `.current()` | `latestRuns()` / `latestPerEval()` | 旧名在英语里近义、语义差别大(Run 粒度 vs eval 粒度跨历史拼接),要靠一篇 use-case 教人选——需要文档教选择的名字对没承担区分工作 |
| `copySnapshots()` | `publish()` | 它做解引用、重去重、补分母、50 MiB 预检、拒绝非空目录;叫 `copy*` 把它讲成 cp,与文档全篇「发布拷贝/发布边界」的用词脱节 |
| `ExperimentRunInfo.runs` / `--runs` | `attempts` / `--attempts` | 腾出 `run` 作层级名;而且本来更对——它产出的就是 `a0..a4` 与 `AttemptHandle` |
| `record.skipped` | `record.unreadable` | `skipped` 已是一个 verdict 取值,同一份数据里一词两义会让 `.filter()` 写错 |

三处随之定稿的机制:

- **`configHash`**:原本有两张高度重叠但不同的清单——`runner.md` 的指纹输入表与 `results/library.md`
  的「可比性配置」表。合并成一张嵌套哈希:`fingerprint = hash(configHash, eval 源码, …)`。新增公开配置
  字段只裁决一次「进不进 configHash」。顺带裁决 `timeoutMs` / `budget` **不进**(它们决定「等不等得到、
  跑不跑得完」,不决定「跑出来的是什么」;各有正交判据:携带资格与覆盖缺口)。
- **`evidenceState` 三态**(`local` / `borrowed` / `dangling`):携带条目指向的原 Run 被清理后,
  `artifacts` 仍声明写过而懒加载返回 `null`,两个契约互相打脸;`dangling` 让「没有」与「丢了」可分辨。
- **`enhance` 具名能力位**:web 独有交互(sortable / filterable / hoverDetail / collapsible)不写
  `if (host === "web")`,每位规定 text 面的降级形态。

## 曾选方案与否决理由

- **只改名不分层**(把 `latest/current`、coverage、warnings 留在事实层):否决。选择口径与覆盖判断是
  **看法**,而 Record 的承诺是「每个返回值都能在磁盘上逐字节指出来源」;混住则读者每读一个字段都要先想
  「这算事实还是算解释」。三层切法对应 Vega-Lite 的 `data → transform → mark`。
- **给 Sample 加 `groupBy` / `reduce` 聚合算子**:否决。Reports 的指标层已有 `perEval` / `acrossEvals`
  两级聚合 + 维度选轴,比通用 groupBy 更贴 eval 语义(题级折叠与跨题折叠本来是两回事)。同一件事两处能做,
  两边迟早给出不同的数。Sample 只删减,不聚合。
- **`Cut` 作为 `Sample` 的替代**:未选。更短更无歧义但更行话;`Sample` 与 `coverage` / `warnings`
  在同一隐喻下自洽。
- **保留「携带条目唯一按本 Run 重打 fingerprint」这条例外**:否决,整条删掉。原理由是「让快照内
  fingerprint 恒等于本 Run 配置算出的指纹」,但常规携带下两者本就相等(相等正是携带判据),
  只有 `--carry-ignoring-flag` 放宽判据时不等——那时重打就是**改写历史字段**:既不是当初发生的事,
  也不是本轮观察到的事,没有读者能正确解释。`configHash` 落在 Run 上之后,「条目与配置对号」由
  `attempt.run.configHash` 直接回答,不需要靠指纹相等来推断。
- **改 `format` 的取值 `"niceeval.results"`**:否决。它是「这是一份 niceeval 落盘」的识别符,改了会让
  所有历史版本连「谁写的」都认不出,从而给不出版本提示——而那正是这个字段永久稳定的全部意义。识别符与
  模块名各自稳定,互不跟随。

## 落点与阶段性差异

docs 全量落地(`docs/feature/record/`、`docs/feature/sample/`、`docs/feature/reports/` 及全仓引用);
源码目录仍是 `src/results/`,落盘键名仍是 `snapshot.json`。四条阶段性差异登记在
[source-map.md「与设计文档的已知差异」](../docs/source-map.md)。

选型依据(从 Allure / Git alternates / dbt / Vega-Lite / Rich / Sphinx / Evidence.dev 等学了什么、
哪里有意没跟)写进各层的 `reference/README.md`——这次同批新立了 `docs/feature/<feature>/reference/`
这个体裁,规则在 [docs/feature/README.md](../docs/feature/README.md)。

## 教训:批量改名的两次误伤

`scope` / `runs` / `快照` 这类词在本仓库是**多义**的,全局正则替换两次误伤:

1. `\bscope\b → sample` 打穿了 `FailureScope.scope`(失败作用域)、scoring 的断言作用域、Effect
   资源作用域、以及文件名 `declare-fatal-scope.md`。修法:用占位符保护要保留的新 token,整体回滚,
   再定向改结果范围那几处。**先按语境分目录判断,再替换**;`docs/feature/error-classification/`、
   `feature/scoring/`、`cli.md`、`runner.md`、`feature/sandbox/architecture.md` 的 scope 都不是结果范围。
2. `` `runs` → `attempts` `` 打穿了新写文档里指层级的 `sample.runs` / `exp.runs` / `flatMap runs`。

还有一次更严重的:批量改 src 注释里的 docs 路径时,`pathlib.rglob` 扫进了 `e2e/*/node_modules`,
改了 392 个**已发布包**的文件(pnpm 硬链接到全局 store)。已按反向映射还原并验证。
**扫源码树时必须显式排除 `node_modules`**。
