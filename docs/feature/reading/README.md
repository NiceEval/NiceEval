# Reading —— 从记录到报告

[Architecture](../../architecture.md) 讲一次运行怎么产生结果,终点是判定与 artifact 写进 Run 目录。
本篇接着往下讲:这些字节躺在磁盘上之后,怎么变成终端里的一屏、网页上的一张报告,或者你自己脚本里
的一个数字。两篇的交接点就是那个 Run 目录 —— 执行链路的终点,读取面的起点。

读取面拆成三层,每层一个包,各自只做一件事。本目录是三层之上的总纲:分工、跨层不变量,以及
[用例手册](use-case/README.md) 里一个读取任务从头走到尾的路径。各层自己的契约仍单源在各层目录,
这里不复制。

下面这张图按层给出三样东西:数据长什么样、这一层做了什么、下一层从哪个调用开始。图上只出现类型名
与层间调用,字段级形状看各层文档。

```text
.niceeval/midterm_bub-gpt-5.4/2026-07-26T10-03-11-873Z-x1f2/   执行链路写下的字节
  ├── run.json            Run 元数据:身份、配置投影、knownEvalIds
  └── algebra/quadratic/a0/
      ├── result.json     单个 attempt 的权威判定记录
      ├── events.json  commands.json  sources.json  trace.json  diff.json …  大,按需读
      └── o11y.json       派生缓存,可从 events.json 重算
                  │
                  │  openRecord(".niceeval")
                  ▼
──── niceeval/record ──── 扫目录、认版本、建懒句柄;一个 attempt 大文件都不读 ────

Record
└─ experiments[]                  按 run.json 的 experimentId 归组
   └─ runs[]                      一个实验跑一次 = 一个 Run
      └─ evals[].attempts[]  →  AttemptHandle {
                                  result: EvalResult    判定、断言、locator 在这里
                                  run, ref              指回来源
                                  events() sources() diff()  调用时才读盘
                                }
                  │
                  │  currentSample(record, { experiments: "midterm/" })
                  ▼
──── niceeval/sample ──── 挑一批、数出缺口、记警告 ─────────────────────────────

  ① 每个 experiment × eval,跨该实验全部可比历史 Run 取最新那条 attempt
  ② knownEvalIds(分母,交命令行范围) − ① 挑中的题   →  missingEvalIds
  ③ 未封口 / 不可读的 Run,以及悬空证据             →  warnings

Sample {
  mode:     "current"                 基础选择方式
  fresh:    false                     是否只含新执行
  attempts: AttemptHandle[]           引用上一层的句柄;消费它就自动正确
  runs:     Run[]                     贡献过至少一条 attempt 的真实 Run
  coverage: [{ experimentId:   "midterm/bub-gpt-5.4",
               knownEvalIds:   [10 道],
               missingEvalIds: ["geometry/area"] }]      这一层新造的信息
  warnings: [{ kind: "unfinished-run", … }]              这一层新造的信息
  pipe(dropExperiments(…), filterAttempts(…))            只删减,不替换、不重挑
}
                  │
                  ▼
──── niceeval/report ──── 算值、两级折叠、装进组件树、两个面各渲一遍 ───────────

sample.attempts
   │  逐 attempt 求值  →  perEval 折叠  →  acrossEvals 折叠
   ▼
MeasureCell { value, display, samples, total, refs } 每格带回覆盖率与证据
   │  数据源的 compute()
   ▼
TableContent / ChartContent / GridContent … 可序列化
   │  resolve：source 形态计算成 data 形态
   ▼
<Report><Page><Chart/><Table/><SampleOverview/></Page></Report>
   │
   ├─ text 面 → niceeval show   终端一屏
   └─ web 面  → niceeval view   静态站点        两个宿主,同一棵报告树
```

## 三层与那条分界线

| 层 | 模块 | 输入 | 输出 | 有没有判断 |
|---|---|---|---|---|
| 事实 | [`niceeval/record`](../record/README.md) | 磁盘 | `Record` / `Run` / `AttemptHandle` | 无 |
| 选择 | [`niceeval/sample`](../sample/README.md) | `Record` | `Sample` | 有:口径、覆盖、时效 |
| 呈现 | [`niceeval/report`](../reports/README.md) | `Sample` | 组件数据 | 有:指标、折叠、排版 |

分界线是**判断**:哪一层允许有看法,允许到什么程度。

**Record 一点判断都不许有。** 它的承诺是每个返回值都能在磁盘上逐字节指出来源。所以通过数、成本
合计这类聚合不落盘,「最新一次」这种选法也不在这里 —— 「最新」先要定义粒度,而定义粒度就是看法。

Record reader 可以把残缺目录投影为 `skipped("incomplete")`，供上层用同一形状保守处理。
这个值描述“无法读出完整事实”，不是 runner 产生的 Verdict。未派发 Attempt 则只存在于 Invocation
的 `unstarted` 计数中，不创建 `result.json`，两者不能互相替代。

**Sample 有判断,但判断必须物化。** 「每个实验取最新一次」是一种选法,「这批数据缺了三道题」是一次
推断。两者都写在返回值的字面字段上:`mode` 说口径,`coverage` 说覆盖,`warnings` 说哪里不可靠。

**Reports 的判断是呈现判断。** 值怎么算归[读数](../reports/library/measures.md),两级折叠归
`perEval` / `acrossEvals`,长什么样归组件与主题。

把选择器长在 Record 上,那条「逐字节可指出来源」的承诺当场垮一半:读者每读一个字段都要先想
「这算事实还是算解释」。三层切法本身学自 Vega-Lite 的 `data → transform → mark`,逐条出处见各层的
`reference/`。

## 跨三层的不变量

这六条不属于任何一层,是三层共同守的。改动任何一层前先对一遍。

**一、聚合永远发生在消费方。** 通过率、总成本、p90 耗时都不落盘,由逐条 `result.json` 现算。
同一个数字有两个地方能算,两边迟早给出不同的值。

**二、判断物化在数据上,不藏在语义里。** 消费 `sample.attempts` 就自动正确,不需要知道口径怎么
展开。反例是让消费方自己 `flatMap` 一遍 `runs`,那会把同一道题的历史 attempt 重复计入。

**三、每个数字都能回到证据。** 样本成员是 `AttemptHandle` 而不是行,`AttemptLocator` 让报告里的
一格能寻址回一个 attempt。这条排除了「把结果压成宽表」这类看着更通用的中间表示。

**四、给用户的自由度是闭集。** Sample 的算子可以逐条列举,`filterAttempts` 是唯一的函数出口;报告树是
声明式结构,不是能求值的表达式。失败模式不是积木不够,是积木长成了半门语言。

**五、派生物明确标为缓存。** 落盘的派生物只有 [`o11y.json`](../record/architecture.md#o11yjson)
一份,定位写死为缓存不是权威,删掉能从 `events.json` 重算,不一致时以事实为准。

**六、格式即契约。** `.niceeval/` 的[格式规范](../record/architecture.md)是唯一的接入面:
第三方 harness 经 `createWriter` 写进来,渲染器不 link 任何采集代码。跨出可信边界一律经
[`publish()`](../record/library.md#发布publish) 物化,不带指向原 Run 的回退指针。

## 一件事该放哪层

| 要加的东西 | 落哪层 | 判据 |
|---|---|---|
| 一种新的证据文件 | Record | 它是磁盘上的字节;加一行[证据 registry](../record/architecture.md#证据-registry) |
| 「只看最近七天」 | Sample | 这是口径,要连覆盖一起交代 |
| 「排掉一个坏掉的实验」 | Sample 的 `pipe` 算子 | 只删减,不替换、不重挑 |
| 「按 agent 分组算 p90」 | Reports 的指标 | 值怎么算、两级怎么折叠归呈现层 |
| 一个通过率字段 | 哪层都不落 | 聚合永远在消费方 |
| 一种新的展示形态 | Reports 的 `defineComponent` | 两个渲染面必填,缺一面定义时就报错 |
| 一个新的运行配置字段 | Record 的 `run.json` 投影 | 它是运行事实,同步进 `ExperimentRunInfo` |

判不准时问一句:**这东西删掉能重算吗?** 能重算的是派生物,不进事实层;不能重算的是事实,不进
选择层和呈现层。

## 宿主、收窄与出站

`show` 与 `view` 是两个宿主 —— 打开记录、挑 Sample、渲染报告的那一侧。它们装载同一份报告定义,
走同一条 `装载 → resolve → validate → render` 管线,没有宿主特权。

**收窄是选择层的事,写在命令行上。** 两个宿主的位置参数与 flag 是同一套:位置参数是 eval id 前缀,
`--exp` 按 experiment id 路径段匹配,`--fresh` 只留新执行,`--record` / `--run` 换输入。它们合起来
把记录根滤成一份有效根,再交给选择器。命令行表达不了的挑选走
[`publish()`](../record/library.md#发布publish) 构一个新的记录根,而不是给 CLI 加谓词语法。

**出站有两条,共用一条站点管线。** [`niceeval view`](../reports/view.md) 建一次站点再盯着输入
[持续重建](../reports/view.md#持续重建),`niceeval view --out <dir>` 建完就退出、产物写进目录。
同一份收窄下两者逐字节一致 —— 本地看到的就是发出去的。

## 常见用途

| 用途 | 入口 |
|---|---|
| 只看某几个实验、某几道题 | [收窄读取范围](use-case/narrow-what-you-read.md) |
| 一边跑一边看结果长出来 | [跟着运行看](use-case/watch-while-running.md) |
| 把结果发成一个静态站点 | [导出与发布](use-case/export-a-site.md) |
| 在自己的脚本里算一个数 | [脚本里读结果](use-case/read-from-script.md) |

## 相关阅读

- [用例手册](use-case/README.md) —— 四个读取任务的完整路径。
- [Architecture](../../architecture.md) —— 这些字节怎么被跑出来:发现、驱动、评分、报告。
- [Record](../record/README.md) —— 事实层:格式、读写、身份与发布。
- [Sample](../sample/README.md) —— 选择层:口径、覆盖、时效与转换算子。
- [Reports](../reports/README.md) —— 呈现层:show、view 与报告组件。
- [Concepts](../../concepts.md) —— 「结果数据与报告」一组词的总表。
