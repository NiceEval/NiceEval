# Library 逐词表说明

本目录 adapter 的完整词表。设计定位与边界见 [README](README.md);逐场景写法见 [Use Cases](use-case/README.md)。

词分两组,分界是 [PLAN-2 的 User View 规则](../../design/user-readable-testing/PLAN-2/README.md#user-view-设计规则):

- **领域词**——测试正文写的那些:用户对象、动作与稳定身份。
- **读面内部**——只有 adapter 实现读得到的那些:结构解析、role locator、正则与归一。

一个词属于哪组由它出现的位置决定,不由实现难度决定。
全部是普通函数与 vitest matcher,不带 runner、不带全局状态,由所属 E2E 仓库自己签入。

```ts
import { cli, world, reportView, expectObserved } from "../verify";
import "../verify/matchers";
```

## 领域词

### `cli(command, options?)`

继承[验收脚本写法](../../engineering/testing/e2e/verification.md)的两条约定:命令以 **shell 原文**出现(可整句复制到终端复现),预期非零退出是一等场景。

```ts
const sep = await cli("pnpm exec niceeval exp x --json");                  // separate + file 捕获
const pip = await cli("pnpm exec niceeval show --json", { pipe: true });   // separate + 真实管道
const mix = await cli("pnpm exec niceeval exp x", { streams: "merged" });  // 单管道保序(shell 2>&1)
```

- `expect: 0 | number | "nonzero"`,不符即抛断言错误,消息含命令原文、实际退出码与 stderr 尾部。
- `cwd`:执行目录,默认仓库根;消费边界一类的场景用它切到 world 里的临时项目目录。
- `pipe` 与 `streams` 互斥,共同决定 fd 捕获形态;省略两者时默认 separate + 文件捕获:
  - `pipe: true`:separate 模式的真实管道形态,stdout 接真实管道而不是文件。pipe 截断类历史缺陷(d8d5a84b)只在管道形态可触发,文件捕获永远复现不了,所以保留这个专门形态,验收「输出喂给下游工具」的场景用它。
  - `streams: "merged"`:单管道形态,用 shell `2>&1` 把 stdout 与 stderr 接到同一个文件描述符,按真实写入顺序落盘。POSIX 一次 write 只落一个 fd,单管道合并因此必然丢失流归属。两路各自捕获再事后拼接得到的顺序是测试设施自己编的,不是 shell 的真实写入序,合流与分流因此是互斥的两个模式,不能同时声明。
- 每次调用把命令与输出追加到证据日志(供 `e2e.ts` 的基础设施故障分类扫描),路径来自 world manifest。

返回值按捕获形态给出对应字段:

```ts
sep.stdout; sep.stderr; sep.exitCode(); sep.signal();
sep.stdoutText(); sep.stderrText();

mix.combined; mix.exitCode(); mix.signal();
mix.combinedText();
```

- separate 模式(默认与 `pipe: true`)提供 `stdout` / `stderr` 两路及对应的 `stdoutText()` / `stderrText()`;访问 `combined` 或 `combinedText()` 在返回的包装读面上抛 `unsupported-observation`。
- merged 模式只提供 `combined` / `combinedText()`;访问 `stdout` 或 `stderr` 同样抛 `unsupported-observation`。
- `exitCode()` 与 `signal()` 两种模式都提供,返回 `Observed`,让进程结果与 JSON / JUnit 关系进入同一条 Outcome Assertion。
- `stdoutText()`、`stderrText()` 与 `combinedText()` 只用于逐字承诺;结构 adapter 直接消费对应 evidence stream。

**输出流归属是一等事实,断言要点名读哪一路。**
[用法错误与无匹配提示写 stderr](../../../memory/cli-usage-errors-go-to-stderr.md) 是公开契约,把两路合起来查子串的写法对这条契约没有区分力:文案回退到 stdout 时断言照样通过。
所以断文案的 proof 读 separate 模式的 `stdout` 或 `stderr` 各自那一份,merged 模式只用于「人读输出整流后保序」这类以顺序为契约的场景,拿它断[非 TTY 单流保序](../../feature/experiments/cli.md#输出流和落盘节奏)才对应产品的真实写入路径。

**需要流归属与保序两个事实时发两次调用。**
一次 separate 调用与一次 merged 调用各证一个边缘事实,不构成「同一次执行上联合成立」的合取断言。
只读命令(不写 resultsRoot)可以对同一个 world 连续两次调用;会写入的命令(carry / reuse 语义下同命令重复运行不幂等)每次调用各用一个私有 clone。

### `world()`

读取 prepare 阶段产出的 world manifest(路径来自环境变量 `NICEEVAL_E2E_WORLD`),返回只读句柄:

```ts
const w = world();
w.recipeId;                     // 本 proof 绑定的 evidenceRecipeId
w.digest;                       // world 身份摘要;与 proof 声明不符时构造即失败
w.resultsRoot;                  // 本次运行的记录根,只读
w.locator("tool-call");         // prepare 提取好的 attempt locator,缺失即抛错并列出可用键
w.target("failed-attempt");     // prepare 命名的 { pageId, key },不把 target 限定为 attempt
w.exportDir("branded");         // 命名导出站目录
w.artifact("junit");            // 命名机器出口或其它文件 artifact
w.consumerDir("react-jsx");     // prepare 搭好的临时消费方项目目录
w.process("main-run");          // prepare 真实执行并封口的命名进程结果,返回带模式核对的包装读面
w.logPath;                      // 证据日志(cli() 自动追加的那份)
```

manifest 里的 `PreparedProcess` 是纯数据,按捕获模式只携带 `stdout` / `stderr` 或 `combined` 对应的路径字段。
`w.process(name)` 返回的不是这份纯数据,而是一层包装读面:模式核对与抛错发生在这一层,访问未声明模式的字段抛 `unsupported-observation`。
`exitCode()` 与 `signal()` 同样经这层包装返回 `Observed`,与「matcher 只接受 `Observed<T>`」的规则一致。

要改结果的场景不碰共享 world,先取自己的私有 clone:

```ts
const clone = await w.clone("readback-carry-forward");   // 只有 mutable-clone 模式的 proof 能调
await clone.run("readback-append");                      // 执行声明过的 mutationActionId
clone.resultsRoot;                                       // 可写,生命周期随本测试结束
```

`read-only` 模式的 proof 调用 `w.clone()` 直接报错。
manifest 的产出方是仓库自己的 `scripts/e2e.ts` prepare 步骤;adapter 只定义 manifest 的形状与读取面,不定义怎么跑实验。

### 读面构造

每个媒介一个构造函数,返回同一族领域对象:

```ts
const report = reportView(stdout);                        // stdout:non-TTY 语义输出
const screen = await ptyScreen(w, "pnpm exec niceeval show", { columns: 80 });
const events = ndjsonEvents(stdout);                      // exp --json 的生命周期事件
const summary = jsonSummary(readFileSync("summary.json", "utf8"));
const junit = junitReport(readFileSync("fail.xml", "utf8"));
const site = siteExport(w.exportDir("site"));              // 导出目录的文档、链接与 target 集合
const index = await siteDoc(w.exportDir("site"), "index", { hosting: "file-url" });
const doc = await targetDoc(w, w.target("failed-attempt"), { hosting: "file-url" });
const ui = await openSite(w.exportDir("site"), { hosting: "directory-root" }); // 浏览器会话,启用 JS
```

构造函数与 Behavior 声明的 `observations` 一一对应,核对分两层,都发生在运行时而不是静态分析。

入口核对:Behavior 包装器把声明的 observations 集合写入 AsyncLocalStorage;每个读面构造函数在入口读取该集合,自己的媒介不在集合内即抛 `unsupported-observation`。
store 缺失是硬错误,不静默放行。
事件回调(如浏览器 `console` 收集)用 `AsyncResource.bind` 显式绑回发起 Behavior 的上下文,保证异步产生的观察仍能核对到正确声明。

事后核对:Behavior 执行完成时,包装器比对声明集合与实际构造集合;声明了 `stdout` 却全程没构造对应读面,同样使该次 outcome 失败。
入口核对堵住「用了没声明的媒介」,事后核对堵住「声明了却没真的用」,两层合起来才能防住声明与实际观察面走样。

### 托管形态

两个浏览器读面各收一个必填的 `hosting`,声明导出站被暴露成什么形状的 URL:

```ts
const ui = await openSite(w.exportDir("site"), { hosting: "clean-url-subpath" });
const doc = await targetDoc(w, target, { hosting: "directory-root" });
```

| 形态 | 索引文档的地址 | 对应的真实托管 |
|---|---|---|
| `directory-root` | `/` | 本地 server、`--out` 后用静态服务器直开 |
| `file-url` | `file:///…/index.html` | 双击打开导出目录 |
| `clean-url-subpath` | `/showcase/memory`,同路径带斜杠形态 308 回无斜杠 | cleanUrls 平台与反向代理 rewrite |

这是读面的显式参数,不是它自己挑一个默认值。
导出站的正确性取决于产物**和**索引文档所在目录两件事,而 server 起在哪个路径由验收方决定——读面替测试作者挑形态,等于替它挑掉一整类观察不到的缺陷。
理由与两次真实失效见[静态托管缺陷账本](../e2e-acceptance-testing/bugs/hosting-base.md)。

同一份产物在三种形态下的领域断言完全相同:领域词不随托管变,变的只是浏览器解析相对引用时的基底。
声明哪一种由 Behavior 的 `observations` 写死,`e2e.ts` 按声明起对应形态的服务,测试正文不出现端口、路径与 rewrite 规则。

### Report 领域词

词的存在前提是对应行为写在 `docs/feature/reports/` 的契约里;寻址一律按公开身份,不按位置:

| 词 | 返回 | 契约来源 |
|---|---|---|
| `report.table(标题)` | 表对象;找不到时列出实际表标题 | [Table](../../feature/reports/components/primitives/table.md) |
| `table.rowIds()` | `Observed<string[]>`,行身份按显示顺序 | Table Content 协议 |
| `table.row(身份)` | 行对象;身份取首列的稳定标识,不取行号 | 同上 |
| `table.columnNames()` | `Observed<string[]>`,列集身份 | 同上 |
| `row.cell(列名)` | `Observed<Cell>`;列不在本表列集时报错并列出实际列集 | 同上 |
| `row.verdict()` | `Observed<Verdict>`,判定按枚举值读,不按字形读 | [ExperimentTable](../../feature/reports/components/summaries/experiment-table.md) |
| `report.chart({ x, y })` | 图对象,按两轴的公开维度名寻址 | [Chart](../../feature/reports/components/charts/README.md) |
| `chart.seriesIds()` | `Observed<string[]>`,系列身份 | 同上 |
| `chart.axisTicks("x")` | `Observed<string[]>`,刻度标签按位置顺序 | 同上 |
| `report.history()` | attempt 历史行,每行有 `timestamp` / `verdict` / `locator` | [show --history](../../feature/reports/show/history.md) |
| `report.stats()` | 判定三态计数 | [show --stats](../../feature/reports/show/stats.md) |
| `report.attempt(locator)` | attempt 对象,可继续按身份下钻 | [show 的 attempt 面](../../feature/reports/show/attempt.md) |
| `attempt.executionNodes()` | `Observed<string[]>`,执行树节点身份 | [show --execution](../../feature/reports/show/execution.md) |
| `attempt.timingGaps()` | `Observed<string[]>`,缺时间注释的节点身份 | 同上 |
| `attempt.source()` | Web Attempt 的标注源码对象；按公开源码身份继续寻址 drive / assertion 调用 | [SourceView](../../feature/reports/components/primitives/source-view.md) |
| `source.paths()` | `Observed<string[]>`，源码文件的公开捕获路径 | 同上 |
| `source.driveCall({ api, path, occurrence })` | 一次 drive API 调用；按 API 的公开返回契约得到 `SourceCall<ReturnView>` | [Eval Context](../../feature/eval/library/context.md) |
| `call.expand()` | 展开该调用的行内返回，并把点击前后状态写入 ActionTrace | [AttemptDetail](../../feature/reports/components/attempt-detail/README.md) |
| `call.returned()` | 返回 API 对应的领域读面；`t.send` / `sendFile` 得到 Turn，输入请求 API 得到请求，找不到或错挂时列出源码调用候选 | [Turn](../../feature/assertions/library/display.md#turntsend的展示) |
| `source.assertionCall({ api, path, occurrence })` | 一次 assertion API 调用，返回 `SourceCall<AssertionResultView>` | [Assertions](../../feature/assertions/library/display.md) |
| `attempt.unmappedConversation()` | 只有无法归入源码 drive 调用的轮与失败命令；已映射轮次出现在这里属于重复 | [AttemptDetail](../../feature/reports/components/attempt-detail/README.md) |
| `conversation.entryKinds()` | `Observed<string[]>`，按显示顺序返回 `assistant`、`tool` 等公开 entry kind | 同上 |
| `conversation.toolNames()` | `Observed<string[]>`，按执行顺序返回对话中的公开工具身份 | 同上 |
| `attempt.executionEvidenceState()` | `Observed<"available" \| "unavailable">`；根据 Conversation 或契约 warning 判定，不从 artifact 路径旁读 | 同上 |
| `attempt.calloutTitles()` | `Observed<string[]>`，按显示顺序返回 Attempt 详情的公开 callout 标题 | 同上 |

导出 HTML 与浏览器读面共享查询词；动作只在声明 `browser-a11y` 的 Behavior 可用。`targetDoc(...).attempt()`
可以读取 drive 与返回的结构关系，但不能冒充真实点击。`ui.dialog().attempt()` 才提供 `expand()` 等动作。

reader 不读取 Record artifact 来补页面缺失；否则 renderer 丢内容时测试会用旁路真值把缺陷遮住。它也不按
内部 session / turn label 寻址源码调用。调用身份来自公开 API、source path 与发生序，`returned()` 的类型来自
该 API 已声明的返回契约，不为每个 API 发明一个新的 DSL 动词。

### 断言:`expectObserved`

```ts
expectObserved(report.table("Experiments").rowIds()).toShowRows(["main", "rag"]);
expectObserved(report.attempt(w.locator("te-fail")).verdict()).toEqualValue("failed");
expectObserved(textRow.cell("Pass rate")).toEqualObserved(webRow.cell("Pass rate"));
```

| matcher | 语义 |
|---|---|
| `toEqualValue(v)` | 观察值等于测试声明的字面值 |
| `toEqualObserved(other)` | 两个观察值相等;失败时同时打印两侧的来源与提取路径 |
| `toHaveSeries([…])` | 系列身份集合相等,顺序不计 |
| `toShowRows([…])` | 身份按序出现,允许中间夹着其它行 |
| `toShowExactRows([…])` | 身份不多不少且同序 |
| `toBeAbsent()` | 该身份在这一面不存在;失败时列出实际候选 |

三条规则:

- **比较口径写在 matcher 名字上。**
  `toShowRows` 与 `toShowExactRows` 是两个词,不靠选项开关,也不靠期望文本里的内联指令。
- **matcher 只接受 `Observed<T>`。**
  传入未包装的原始值直接报错——`expectObserved` 的入参类型就是这条规则的执行点。
- **跨面关系逐字段书写。**
  text 与 web 比同一个格子时逐格调 `toEqualObserved`,不提供一次比较整棵树的聚合词。

### 逐字比对 `toMatchScrubbedFileSnapshot`

只用于[逐字承诺的短文本](README.md#逐字比对的适用面)。比对前先过 scrub 归一管线,归一必须在传入 matcher 前完成(vitest 的自定义 serializer 不作用于 file snapshot,见 References):

```ts
expectObserved(fail.combinedText()).toMatchScrubbedFileSnapshot("golden/deliberate-fail.txt", {
  scrub: [{ pattern: /run-\d{8}T\d{6}/g, tag: "RUN_ID" }],   // 仓库自定义规则,追加在内置表之后
});
```

内置 scrub 规则表(正则换成占位符):

| 易变值 | 占位符 |
|---|---|
| ANSI 转义序列 | 删除 |
| 耗时(`3.2s` / `450ms` / `1m 12s`) | `[DURATION]` |
| 成本(`$0.0123`) | `[COST]` |
| token 计数(`12.3k tokens`) | `[TOKENS]` |
| attempt locator(`@…`) | `[LOCATOR]` |
| 记录根及其下路径 | `[ROOT]/…` |
| ISO 时间戳 | `[TIMESTAMP]` |

- golden 文件签入仓库;更新走 `vitest -u`,diff 即 review 面。
- scrub 后逐字符全等,没有行内通配。
  需要行级容差的表面说明它不够窄稳,换对应读面的结构断言。

## 浏览器交互词表

浏览器交互验收「用户操作可达、状态收敛」,断言对象是真实浏览器里的行为。
写法规则五条见 [README · 浏览器交互](README.md#浏览器交互现成词表加领域词);调研结论「引擎现成、不自建」见 [References · 浏览器交互 DSL 生态](../../references.md#浏览器交互-dsl-生态playwright-原生词表screenplaycodeceptjs)。
adapter 只做两件事:按公开组件契约立词的领域寻址,和步骤轨迹。
等待、重试与结构读取全部直接用 Playwright 原生面,不做第二层包装。

```ts
const ui = await openSite(w.exportDir("site"), { hosting: "directory-root" });
await ui.goto("Scoreboard");                       // 按导航名切页;页不存在列出实际导航

const table = ui.table("Comparison");
await expect(table.visibleRows()).toHaveCount(3);  // web-first 断言,自动重试到收敛
await ui.filter().fill("main");
await expect(table.visibleRows()).toHaveCount(1);

const target = w.target("failed-attempt");
await ui.expectTargetDoc(target);                  // 前置：<pageId>/<key>.html 在当前 hosting 下返回 200
await ui.targetLink(target).click();
await expect(ui.dialog()).toBeVisible();           // dialog 对 attempt / experiment / 自定义参数页一视同仁
```

| 词 | 契约来源 | 行为 |
|---|---|---|
| `ui.goto(页名)` | 报告导航 | 切页;页不存在时列出实际导航集合 |
| `ui.expectTargetDoc({ pageId, key })` | 参数化页静态文档 | 前置断言宿主导出并以 HTTP 200 交付该目标文档；失败列最终 URL 与状态 |
| `ui.table(标题)` | Table | 表句柄;找不到时列出实际表标题 |
| `table.visibleRows()` | Table searchable | 可见行 Locator,可见性判定单点实现 |
| `table.expand(行身份)` | 层级 Table | 指名展开某一行;行不存在即失败并列出实际行 |
| `ui.filter()` | Table searchable | 过滤输入框 |
| `ui.targetLink({ pageId, key })` | Report target | 按公开 target 身份寻址下钻链接，不按 DOM 位置或实体种类猜测 |
| `ui.dialog()` | 参数化页 dialog | 当前 dialog Locator；内容身份仍按 target 的公开 pageId / key 断言 |
| `ui.closeDialog(方式)` | 参数化页 dialog | 按 `button`、`escape` 或 `backdrop` 关闭，并等待 URL 与焦点恢复 |
| `ui.chartPoint({ series, x })` | Chart 数据点 | 按系列与横轴身份寻址一个点 |
| `ui.tooltip()` | Chart 悬停提示 | 提示元素 Locator,断可见与内容 |
| `ui.region(名称)` | 页内命名区块 | 区块句柄,可继续取领域词 |
| `ui.consoleErrors()` | 浏览器诊断 | `Observed<string[]>`，只收集未登记豁免的 console error |
| `ui.networkFailures()` | 浏览器诊断 | `Observed<string[]>`，包含最终 URL、method 与失败原因或 HTTP 状态 |

三条运行学约定:

- **等待与断言**:直接用 Playwright web-first `expect`(自动重试到收敛),词表不提供固定时长 sleep,不带重试的 `count()` 即时读数不进场景;`expect` 脱离 Playwright runner 的行为是[待裁决分歧](README.md#待裁决分歧)。
- **结构**:交互后的结构收敛用同一批领域词读,与静态 HTML 面同源,词表不发明第二套结构语法。
- **步骤轨迹**:每个领域词把自己记入步骤日志;失败消息等于已执行步骤序列加失败步骤加该步骤的定位候选(Screenplay 活动轨迹之形,不引其依赖),前置断言失败与交互深处失败因此天然可分。

`target` 是唯一跨页下钻身份。attempt locator 只是 `{ pageId: "attempt", key: locator }` 的一种 key；
experiment 与自定义参数化页不得新增平行的 `experimentLink()` / `customDialog()` 词。全量 target 是否闭合由
[Report target 闭环](../e2e-acceptance-testing/use-case/report-target-closure.md)负责，DSL 只负责按一个已声明 target 观察文档、链接与 dialog。

## 读面内部

以下是 adapter 的实现面。测试正文不出现这一节里的任何名字。

### stdout 结构解析器

`parseTerminal(text)` 先 strip ANSI,再按 [Library · 排版原语](../../feature/reports/library/layout.md)声明的 **non-TTY 形态**识别结构。
解析器是渲染契约的第二实现,不含 niceeval 组件名,范围限于已声明 Behavior 实际消费的结构:词随消费的 Behavior 增长,新结构先有 Behavior 声明消费,解析器才补对应的词,不预先建设全量排版的第二实现。

当前已声明消费的结构:

| 结构 | non-TTY 形态 | 身份取值 |
|---|---|---|
| 面板(`Section`) | 标题成行,正文整体缩进两列 | 标题文字 |
| 表(`Table` / `Grid`) | 连续行按列对齐的纯文本,首行为表头 | 表头折叠文本 |
| 表行 | 表内数据行,层级由首列缩进表达 | 首列的身份文本 |
| 历史行 | `report.history()` 分节内的逐 attempt 记录行,列对齐但不取首列身份 | 时间戳与 verdict 的组合 |
| 逐条流事件 | 无标注,逐行原样 | 行折叠文本 |

框线字符不参与识别。
[量测与降级](../../feature/reports/library/layout.md#量测与降级)声明 non-TTY 下三种线一起消失、字段与顺序逐字相同、脚本不解析框字符;解析器读框线就等于把 TTY 形态当成 stdout 契约的一部分,而那恰恰是 PTY 读面的对象。

「折叠文本」等于空白折叠(连续空白折成单空格、去首尾)后的行文本,用于表头与身份的匹配口径;格内折行按 layout.md 的续行缩进规则并回原行。
显示宽度口径(CJK 记 2 列)只服务解析,不暴露为断言面——它是 PTY 读面的断言对象。

**fixture 来源是 layout.md 的 fenced 示例块,不是解析器自己造的输入。**
`layout.md` 为每种 non-TTY 结构配一段带 info-string 标注的 fenced 示例块(info-string 形如 `niceeval-layout`),块内含可 JSON 化的组件树语义输入与渲染文本两段。
fence 内文本逐字节比对,不做空白折叠——layout 契约里空白就是语义,和上面用于身份匹配的折叠文本是两回事。

**双向验证覆盖 renderer、文档与解析器三方。**
NiceEval 仓库内一条单元测试把示例块的语义输入喂给真实 renderer,输出与示例的渲染文本段逐字节比对;unit 层可以 import renderer,不违反 E2E oracle 独立。
E2E 侧解析器自测消费同一批示例块,验证解析器识别出的结构与身份和示例一致。
两条边合起来,renderer、文档与解析器三方传递闭合,E2E 侧全程不 import 候选代码。

**「逐条流事件」类别有预算。**
它不能静默吞掉未声明的结构:至少一条代表 Behavior 断言该类别的行数为 0,或断言它只匹配一份显式白名单。
结构本身自相矛盾(如声明是表却缺表头)仍然是 parse failure,不会被归类进「逐条流事件」类别掩盖。

**准入 mutation 叫 fixture mutation,和解析器容差表成对声明。**
它施加在抽取文本上,证明的是解析器拒收畸形结构,而不是解析器容忍到什么程度;mutation 集与解析器逐结构容差表写在同一处,防止准入判据和容差判据各说各话。

### 匹配口径

领域 matcher 的比较规则整段照抄 aria 结构期望:

- **默认有序子序列**:期望的身份按序出现即通过,多出的实际项忽略。渲染器新增一行注解、插一个区块,不打红已有断言。
- **省略即不关心**:没被断言的列、格与子树不参与比较。
- **显式升级**:锁「不多不少」的计数与顺序契约用 `toShowExactRows`,不用默认档。
- **文本折叠后再比**:身份文本一律折叠,避免间距变化打红。

### PTY 屏幕证据

PTY 读面开真实 PTY 会话,断的是屏幕终态而不是字节流。
每个 PTY proof 固定记录六项证据:invocation、终态 cell grid、scrollback、raw ANSI、resize 序列与退出信息。

```ts
screen.columns();                          // 屏幕列数
screen.rowsOccupiedBy("deliberate-error"); // 该身份占用的屏幕行数,证明折行机制生效
screen.displayWidthOf("deliberate-error"); // 显示宽度,CJK 记 2 列
screen.styling();                          // "ansi" | "plain",证明降级形态
```

宽度、折行、降级与 CJK 显示宽度只在这一层断言;同一个事实不在 stdout 读面再断一遍。

### 机器出口的结构比较

JSON 与 JUnit parse 之后按结构语义比较,不比字符串:

```ts
expectObserved(summary.evalIds()).toShowExactRows(["tool-call", "te-fail"]);
expectObserved(summary.fieldNames()).toShowExactRows(["evals", "runId", "totals"]);
expectObserved(junit.case("deliberate-fail/gate").outcomeTag()).toEqualValue("failure");
expectObserved(junit.counts()).toEqualValue({ tests: 1, failures: 1, errors: 0 });
```

`fieldNames()` 加 `toShowExactRows` 承接整段 golden 原本的「不多不少」职责:漂移进来的新字段、丢失的字段一样现形,而序列化顺序与空白不进契约。
parse 失败按 observe 阶段错误报告,不退回子串探测。

### HTML 可访问性树

导出 HTML 的结构由 Playwright 加真实 Chromium 产生可访问性树,领域词到 role 与 accessible name 的映射写在 adapter 内部。
每例全新 BrowserContext 与 Page;静态读面禁用 JS 且只准本地网络。
producer identity(候选包与导出时刻)与 verifier identity(Chromium 版本与本次 Verification Run)分开记录,失败时能分辨「导出站是旧的」与「浏览器版本变了」。

## 失败反馈

失败按 [PLAN-2 的失败语义](../../design/user-readable-testing/PLAN-2/README.md#失败语义)输出,adapter 负责其中的 Evidence 与 Observed identities 两段:

```text
Behavior: reports.view.narrow-by-experiment
Outcome: Experiments 表只剩 main
Entry: cli / Observations: stdout / Boundaries: real-cli
Execution: read-only @ report-scoreboard
World: report-scoreboard@<digest>
Expected identity: main
Observed identities: main, rag
Evidence:
  stdout: <log>#table[name=Experiments] > row[2]
  实际行身份: main, rag
```

- **寻址失败**:列出该层实际存在的候选(实际表标题、最近似行身份),消息模板强制含「哪条契约断了、下一步看哪里」。
- **golden 失配**:scrub 后的行级 diff;golden 文件不存在时首跑落盘并提示 review。
- **阶段可分**:declaration、prepare、invoke、observe、outcome、cleanup 六段各自报告;解析失败不退回宽松匹配,缺 evidence 也不解释成产品结果不符合预期。

## 与 vitest 的装配

- matcher 经 `expect.extend` 注册,`../verify/matchers` 副作用导入一次生效;TS 类型经 module augmentation 提供。
- world manifest 在 globalSetup 校验身份与形状,失配时整个 vitest run 快速失败并指向 prepare 步骤。
- Behavior 文件按用户任务组织(`test/behavior/analyze/compare-experiments.test.ts`),vitest 原生标题统一带 `[Behavior ID]` 前缀。
- 单例重跑走仓库唯一入口:`pnpm e2e -- verify --world <manifest> --behavior <id>`,底层 `-t` 仍可按稳定 ID 定位同一测试。
- `e2e.ts` 对 vitest 退出码的折叠规则,以及 `candidate-install` 单列 stepKind 归产品侧、无归属失败一律判回归等出处分类,单源在[测试方案 Architecture · 失败与诊断](../e2e-acceptance-testing/architecture.md#失败与诊断),本文件不复制规则正文。
