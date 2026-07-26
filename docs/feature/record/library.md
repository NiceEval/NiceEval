# Record —— 库用法

磁盘记录格式的 TS 读写 API(`niceeval/record`)。层的分工见 [README](README.md),磁盘上的格式
规范见 [Architecture](architecture.md),选口径与算覆盖见 [Sample](../sample/README.md)。

这一层只有事实。没有选择器、没有覆盖判断、没有警告——`openRecord()` 返回的每个值都能在磁盘上
逐字节指出来源。

## 读:`openRecord`

两条设计决策。**层次跟使用者的心智走**(「所有实验 → 单次跑的实验 → 每道题」)——磁盘布局与这个
心智同构(实验目录在外层),reader 的分层就是目录树的类型化投影。**「record」一个词不在层级里
重复**:分层把它拆成 `experiments` / `runs` / `attempt.result` 各归其位。API 如下:

```typescript
import { openRecord } from "niceeval/record";

const record = await openRecord(".niceeval");

record.experiments;            // Experiment[]:每个实验一项,挂着自己的全部历史(id 字典序)
record.unreadable;             // 读不了的落盘:{ dir, reason, schemaVersion?, producer?, detail? }[]
record.root;                   // 记录根的绝对路径(入参解析后的原样值,不论传入的是记录根、
                               // 实验目录、run 目录还是某个 run.json)

const exp = record.experiments.find((e) => e.id === "compare/bub-gpt-5.4")!;
exp.runs;                      // Run[]:历次运行,最新在前
exp.knownEvalIds;              // 已知 eval 并集 = 本地历史 ∪ 各 Run 携带的 knownEvalIds

const run = exp.runs[0];       // 单次跑的实验 = 一个 run 目录
run.dir;                       // run 目录的绝对路径
run.agent; run.model; run.startedAt;
run.completedAt;               // 缺失 = 未收尾(进程中断);已落盘 attempt 照常在下面读到
run.configHash;                // 这次运行的配置身份 —— 跨 Run 可比性的唯一判据,见下
run.experiment;                // 实验运行配置(flags / attempts / earlyExit / sandbox …)
run.producer;                  // { name, version?, commit? }:谁写的这份记录
run.schemaVersion;             // 记录格式版本(能读进来的恒为当前版本;不兼容的在 unreadable)
run.evals;                     // Eval[]:每道题一项 { id, attempts }
run.attempts;                  // 全部 attempt 平铺(不关心题目边界的聚合消费用)

const attempt = run.evals[0].attempts[0];
attempt.evalId;                // 属于哪道题 —— 直达字段,不绕 result
attempt.experimentId;          // 属于哪个实验
attempt.result;                // EvalResult 瘦身条目:判定、断言、用量、成本(Run 级字段已拼合)
attempt.ref;                   // { run, attempt }:证据路径引用(根相对 run 目录 + run 相对 attempt 目录),
                               // 站点 artifact/ 证据树按它布局;寻址一个 attempt 用 result.locator
attempt.run;                   // 所属 Run(比较新旧、读配置靠它)
attempt.carried;               // true = 携带条目:fingerprint 未变、上一轮终态结果合入本 Run,
                               // startedAt 是原执行时刻
attempt.evidenceState;         // "local" | "borrowed" | "dangling" —— artifact 在哪,见下
await attempt.events();        // StreamEvent[] | null —— 重 artifact 全部懒加载
await attempt.commands();      // FailedCommandEvidence[] | null —— 非零 Sandbox 命令与 stdout/stderr
await attempt.trace();         // TraceSpan[] | null(span 属性同样受 256 KiB 值上限约束)
await attempt.o11y();          // O11ySummary | null
await attempt.agentSetup();    // AgentSetupManifest | null
await attempt.diff();          // DiffData | null(不截断,可达百 MB,所以必须懒)
await attempt.sources();       // SourceArtifact[] | null
```

以上懒加载方法名与[证据 registry](architecture.md#证据-registry)的词干一一对应(`events` →
`attempt.events()`、`agentSetup` → `attempt.agentSetup()`,以此类推);新增一种证据在库内加一个
同名方法即可,不另造别名。

命名约定:`Experiment` / `Run` / `Eval` 是纯数据,不带 `Handle` 后缀;唯一叫 `AttemptHandle`
的是 attempt——它的方法真的会碰磁盘,后缀标记的就是这件事。

`AttemptRef` 的字段名(`run` / `attempt`)是证据文件的持久化路径契约,不随句柄改名:`run` 恒为
两段(`<实验目录>/<run 目录>`),`attempt` 是 `<evalId 路径>/a<n>`,
[导出站的 `artifact/` 树](../reports/view.md#静态导出)按这两段拼路径。

**寻址一个 attempt 是另一回事。** 报告的 `MetricCell.refs`、`show @<locator>` 与 view 深链
`#/attempt/@<locator>` 用的都是不透明的
[`AttemptLocator`](#按-locator-寻址一个-attemptresolvelocator),不走磁盘路径。

要点:

- **懒加载即存在性判断。** artifact 缺失返回 `null`,不抛错。「不 stat 磁盘就知道有什么」由
  `result.json` 上的 `AttemptRecord.artifacts`(writer 实际写出的按需 artifact 词干列表)
  回答;两者在 `evidenceState` 上对齐,见下节。
- **截断是磁盘上的事实,读取面不参与。** reader 原样读出被截断的值(含 marker 与 `truncated`
  字段),既不重新截断,也变不回完整值——完整值只在写入那次运行的内存里存在过。要在 UI 上如实说
  「这里少了东西」,读 `truncated`。
- **版本过滤沿用格式规范。** 按 [Architecture · 版本与升级设计](architecture.md#版本与升级设计)
  判定,不兼容的落盘进 `unreadable` 并带 `schemaVersion` 与完整的 `producer`(name + version),
  供调用方生成正确的版本建议。只有 `producer.name === "niceeval"` 时才能拼
  `npx niceeval@<version>`;第三方 producer 保留自己的名字与版本。
- **`unreadable` 的三种 reason。** `"incompatible"`(schema 版本不同)、`"malformed"`(元数据是
  坏 JSON 或必需字段错误)、`"incomplete"`(有 attempt 落盘、没有 `run.json`——只可能出现在
  「run 目录建好、元数据还没写完」的极小窗口里进程死亡,或人为删文件)。三种的诊断动作完全不同,
  所以不合并成一个「读不了」。字段名叫 `unreadable` 而不是 `skipped`,因为 `skipped` 已经是一个
  verdict 取值,同一个词在同一份数据里指两件事会让 `.filter()` 写错。
- **未收尾 Run 不是数据黑洞。** `run.json` 在、缺 `completedAt` 是进程中断的常态:判定与 artifact
  同级落盘、随 attempt 完成即写,中断只丢未完成的 attempt,已完成的照常读出。它不进 `unreadable`;
  「这批数据可能不完整」是选择层的警告,见 [Sample](../sample/library.md#警告-kind-全集)。
- **分组是切片,不是看法。** 实验归组、eval 分组都是确定性切片(不合并、不聚合、不去重)。
- **同一进程内按 handle 记忆化。** 两个都要读 diff 的消费方不会把「可达百 MB」的 `diff.json`
  读两遍;扫全部历史仍然可能慢,但要慢得线性、可预期。
- **只读不写事实。** reader 的一切派生物删了随时可重算;唯一事实来源仍是磁盘上的记录格式。

## `configHash`:配置身份只算一次

跨 Run 比较有一个前提:两个 Run 得是同一套配置跑出来的。这个前提由 `run.configHash` 单点回答。
它与逐 eval 指纹是同一个嵌套哈希的两层,**输入清单与嵌套关系单源在
[Experiments · 指纹](../experiments/cache.md#指纹两个哈希嵌套)**——配置身份和缓存判据用的是同一张
清单,一个字段只在那里裁决一次。

跨 Run 可比性据此定下两条,理由与那边同源:

- **`timeoutMs` 与 `budget` 不进 configHash。** 它们决定「等不等得到、跑不跑得完」,不决定
  「跑出来的那条结果是什么」。一条 15 分钟跑完的 `passed`,在 20 分钟和 40 分钟上限下是同一个
  事实。把它们塞进配置身份会让提高上限一次性切断全部历史可比性,为一个不影响结果的参数付全量
  重跑。两者各有正交判据:超时上限管[携带资格](../experiments/cache.md#携带资格timeoutms-不进哈希)(`executionMs` ≤
  当前上限),止损闸管覆盖缺口(被掐掉的题没有结果,如实进
  [`coverage`](../sample/library.md#覆盖是逐行的事实))。
- **`attempts` / `earlyExit` / `maxConcurrency` / `selectedEvalIds` / `labels` 不进。** 编排与
  选题字段决定跑哪些、跑几次,不改变单题被测行为;`labels` 是报告坐标。

`configHash` 落在 `run.json` 上,是格式的一部分:第三方转换器写入时同样声明它,不声明的 Run 只能
与自己比较。Sample 层跨 Run 拼接时按它相等判定,不重新推导配置——推导逻辑一旦有第二份实现,两份
就会分叉。反过来,进 configHash 的字段必须在 `run.json` 上找得到,顶层或 `ExperimentRunInfo`
二选一:重算配置身份是[搬迁出口](../experiments/cache.md#--carry-ignoring-flag搬迁用的一次性出口)
的前提,少落一个字段,那条路径就只能靠猜。

[`--carry-ignoring-flag`](../experiments/cache.md#--carry-ignoring-flag搬迁用的一次性出口) 是这条
可比性担保上唯一的人为出口:它让一批历史条目按抹掉某些 `flags` 键之后的口径重锚到本 Run 的
configHash 上。它不构成上面那个「混着两套配置的数据」的分叉,因为它只接受**已经不在本次 `flags`
里**的键——被抹掉的那个值已经不是实验条件了。留痕跟着条目走(`carriedIgnoringFlags`),消费方要
分辨时读得到。

## 携带条目与 `evidenceState`

运行器默认把上一轮 fingerprint 匹配、判定为终态的结果**携带合入**新 Run(语义见
[Experiments · 缓存与携带](../experiments/cache.md)),让最新 Run 天然完整。携带条目在新 Run 里也是
一条 `result.json`,带原条目的 `startedAt`、`artifactBase`(相对记录根,指向原 Run 的 attempt
目录)与 `artifacts` 词干列表。读取面把它投影成 `attempt.carried`,消费方不自己探测 artifactBase。

artifact 因此有三种去处,`attempt.evidenceState` 如实说出是哪一种:

| 取值 | 含义 | 懒加载行为 |
|---|---|---|
| `"local"` | artifact 与 `result.json` 同目录 | 按 `artifacts` 列表命中 |
| `"borrowed"` | 经 `artifactBase` 指向原 Run,目录仍在 | 按 `artifacts` 列表命中 |
| `"dangling"` | `artifactBase` 指向的目录已不存在 | 一律返回 `null` |

**`dangling` 必须可分辨,否则 `artifacts` 字段在撒谎。** 原 Run 被清理后,`result.json` 上
`artifacts: ["events", "trace"]` 仍然声明有,而 `events()` 返回 `null`——两个契约当场互相打脸,
而 `artifacts` 存在的唯一理由正是「不 stat 磁盘就知道有什么」。把它和「这类证据本来就没采集」
混成同一个 `null`,消费方无法区分「没有」与「丢了」。`openRecord()` 扫描时逐条判定这个状态,
Sample 层据此产出 [`dangling-evidence`](../sample/library.md#警告-kind-全集) 警告。这条借用与
悬空的形状抄自 Git 的 alternates,连修法都同源,见[参考方案](reference/README.md#git-object-alternates)。

避免 dangling 的正确动作是清理历史 Run 前先 `publish()` 物化要保留的结果,见下。

**跨 schemaVersion 不携带。** 记录格式版本变化时,上一轮的落盘对本轮 writer 是另一种格式:
`artifactBase` 会让新 Run 的条目指向旧版本写的 artifact,而 artifact 是裸 JSON、不带版本,
版本判定只在 `run.json` 层做——沿着这条路读出来的东西没有任何一层能声明它可信。所以
`schemaVersion` 不同的历史 Run 一律不参与携带判定,如实重跑。这是「不做兼容机制」在携带路径上
的同一条纪律,不是例外。

## 身份键

同一个 attempt 因携带而存在于多份落盘。reader 忠实反映这份重复、不擅自去重;跨 Run 聚合前的
去重是消费方的义务,官方实现在 [Sample](../sample/library.md#去重身份键与最新落盘)。Record 的
义务是**把身份键四字段全部放在数据上**,让任何人都能自己实现:

- `experimentId` / `evalId` 是 `AttemptHandle` 直达字段;
- `attempt` 序号与 `startedAt` 在 `attempt.result` 上。

`ref` 指条目所在的落盘(携带入的新 Run):证据身份跟着条目走,artifact 经 `artifactBase` 回退
仍可达;view 深链与 `publish()` 的源 artifact 定位用同一套候选顺序。

## 按 locator 寻址一个 attempt:`resolveLocator`

`AttemptLocator` 是 attempt 的不透明短标识(`@` + 1 位 scheme 字符 + 7 位 base36 body,如
`@1x7f3q9k`),由 `{experimentId, Run 的 startedAt, evalId, attempt}` 这个不可变身份元组确定性
派生——不是数组下标,也不编码磁盘路径。用户从 `niceeval show` 的输出、报告或 view 深链里复制到
一个 locator,拿它回到库里定位同一个 attempt:

```typescript
import { openRecord, resolveLocator, LocatorNotFoundError, MalformedLocatorError } from "niceeval/record";

const record = await openRecord(".niceeval");
const attempt = resolveLocator(record, "@1x7f3q9k");   // → AttemptHandle
console.log(attempt.evalId, attempt.result.verdict);
```

`openRecord()` 收尾时已经把扫到的全部 attempt 建成 locator 索引,`resolveLocator` 只查这份索引,
不碰磁盘。两种失败各自抛一个可分辨的错误,不返回 `null`:输入串本身语法不合法(不是 `@` 开头、
body 长度或字符不对)抛 `MalformedLocatorError`;语法合法但索引里没有这个 attempt(记录目录被
清理、locator 来自别的项目)抛 `LocatorNotFoundError`——CLI 据此分别给出「这不是一个 locator」
与「这个 attempt 不在当前记录里」两种提示。

## 写:`createWriter`

writer 与 reader 是同一组类型的两半,而且是**字面的**两半:reader 的 `attempt.result`(瘦身
`EvalResult`)由两部分拼成——Run 级字段(experimentId / agent / model / startedAt / configHash /
实验运行配置 / producer)来自 `writer.run()` 的一次声明,是 Run 层注入的装饰;其余全部字段就是
`writeAttempt` 第一参数的类型。第二参数是 reader 懒加载能拿到的那几样 artifact 的类型。
**「writeAttempt 参数 + run() 声明 = reader 读回的全部,由类型拼合背书」**:Run 级字段不在
attempt 参数类型里,不存在「谁的值为准」的运行时问题。

```typescript
import { createWriter } from "niceeval/record";

const writer = createWriter(".niceeval", {
  producer: { name: "niceeval", version: "0.12.0" },
});

const run = await writer.run({           // 建 run 目录(独占创建,撞名换后缀重试)+ 写 run.json
  experimentId: "compare/bub-gpt-5.4",
  agent: "bub",
  model: "gpt-5.4",
  startedAt,                             // 必填:身份键与去重以它为锚,官方产出永不缺
  configHash,                            // 配置身份;不声明的 Run 只与自己可比
});
run.dir;                                 // .niceeval/compare_bub-gpt-5.4/2026-07-11T…Z-x1f2/

await run.writeAttempt(result, {         // 写 result.json(判定权威落点,一次写成)+ 拆 artifact 文件;
  commands, events, trace, o11y, agentSetup, diff, sources,
                                         // 全部是按需 artifact,词干见证据 registry;
});                                      // 空数据不落文件;逐值截断的适用范围见 registry「逐值截断」列

await run.finish({                       // 封口这个 Run:唯一一次补 completedAt
  diagnostics,                           // + Run 级诊断(如 teardown 失败 / budget 不可执行)
  facts,                                 // + experiment 作用域 ctx.fact() 累计的运行事实
});                                      // 不写跨 Run 聚合;Invocation 审计走 Json(path) reporter
```

`writer.run()` 是读取面「实验 → Run 」层次的镜像:experimentId / agent / model / startedAt /
configHash 这些 Run 级身份在这里声明一次,不塞进每条 attempt——否则第三方转换器要么漏写要么各条
不一致,reader 侧还得猜以谁为准(类型上由 `writeAttempt` 参数的 `Omit` 保证)。 Run 级可选项还
包括 `experiment`(实验运行配置 `ExperimentRunInfo`)、`knownEvalIds`(该实验已知的 eval 并集,
残缺检测的分母)、`completedAt`(转换历史数据时如实交代收尾时刻)与 `name`(项目名,view hero
显示)。attempt 级 facts 不走 `finish()`——随 `writeAttempt` 第一参数的 `facts` 字段与判定一起
一次写成,形状与两级归属语义见 [Architecture · facts](architecture.md#facts运行事实)。

**每个文件只有一个封口时点**是写入面的核心承诺:`run.json` 开跑即写、`run.finish()` 收尾唯一
一次补 `completedAt`、 Run 级 `diagnostics` 与 `facts`;`result.json` 与 artifact 随 attempt 完成
落盘。进程中断只丢未完成的 attempt 与尚未封口的 Run 级诊断/事实;并发进程各写各的 run 目录,
互不触碰(唯一性由独占创建保证,见 [Architecture](architecture.md#目录结构))。

**超大字符串在这里截断,而且只在这里。** `writeAttempt` 是全仓库唯一的截断落点:哪些 artifact
逐值截断、哪些原样落盘,单源在[证据 registry](architecture.md#证据-registry)的「逐值截断」列
(截断上限 256 KiB,超出打 `truncated` 标记)。调用方——包括第三方转换器——传进来的永远是完整
数据,不需要自己先削一遍;断言与 `o11y` 派生统计跑在完整值上,截断不影响判定。完整规则、marker
形状与两条「明确不做」见 [Architecture · 大值截断](architecture.md#大值截断)。

## 发布:`publish`

把选中的 Run 按格式感知地复制到另一个目录——只带指定 artifact、只带选中的 attempt,布局知识不
外泄。输入收 `Sample` 或手工挑的 `Run[]`,产出一个**记录根目录**(实验目录在外层的同一布局,
`openRecord` 直接能开);与 Reports 组件的 `data` 函数同一输入约定。

**这个原语不叫 `copy`,因为它做的事不是 cp。** 一个 Run 通常**不自包含**:携带条目的 artifact
以 `artifactBase` 指向原 Run 的 attempt 目录。手工 cp 一个 run 目录出去,携带条目的 events /
trace / 源码在新根里静默变成 `dangling`,没有任何报错。整根搬运不受影响(`artifactBase` 相对
记录根,整个 `.niceeval/` 搬到哪里引用都完整);取子集离根必须经 `publish()`,它把引用解引用成
完整内容物化进目标 Run,产物自包含。

```typescript
import { openRecord, publish } from "niceeval/record";
import { latestRuns } from "niceeval/sample";

const record = await openRecord(".niceeval");
await publish(latestRuns(record), "site/data/run", {
  artifacts: ["commands", "sources", "events", "trace", "o11y", "agentSetup"], // diff 缺省不带
});   // 所有待发布文件还会经过 50 MiB 单文件预检
```

`o11y` 在缺省携带之列。「查看器不读所以不带」是循环论证——因为没消费者所以不带,因为不带所以做
不了消费它的内置指标;`assistantTurns`(见 [Reports 的内置指标](../reports/library/metrics.md#内置指标))
就是它的消费者,且 `o11y.json` 实测几 KB 一个。

逐值[截断](architecture.md#大值截断)与整文件发布预算解决不同问题:`commands` / `events` /
`trace` 的 256 KiB 上限会切断一条失控输出被重复落盘的常见爆炸链,但一个文件可以含很多正常值,
不能据此宣称文件大小有界。`diff`、源码 blob 与历史版本的 artifact 也可能超过 Git host 的单文件
限制。因此 `.niceeval/` 是本地事实根,不是默认可提交目录。

记录数据分**两类**:`.niceeval/` 是**本地事实根**——prompt、工具参数、失败命令输出、Agent 输出、
源码全在里面;任何要**跨出可信边界**的拷贝(进 Git、静态托管、对外分享)是**发布拷贝**,经
`publish()` 这一条管线产出(`niceeval view --out` 的 artifact 复制走同一管线)。可信边界内搬运
事实根不是发布——把整个 `.niceeval/` 作为 CI job artifact 在 job 间传递或取回本机,就是搬一个
普通目录,搬到哪里那里就是记录根,`--results` 直接打开。没有更细的档位:体积取舍由 `artifacts`
字段声明,导出层不做二次裁剪。发布内容的保密边界由格式在**采集侧**划定,不在发布侧设关卡:运行环境
注入的 env 值不落盘,命令 display 脱敏;但失败进程主动写到 stdout/stderr 的内容会进入
`commands.json`,与 Agent transcript 同属待发布作者审核的证据。复制忠实于源:artifact 原字节
复制,不重新序列化、不改写。契约细节:

- **产物自包含。** 携带条目的 artifact 解引用复制进目标 Run,复制出的条目不带 `artifactBase`
  指针,`evidenceState` 恒为 `"local"`;`sources` 内容按哈希在目标 Run 的去重仓库重新落盘。
  「忠实于源」在这里的边界:改变的只是引用结构与落盘位置,artifact 内容字节不变。
- **覆盖事实随数据走(`knownEvalIds`)。** 覆盖缺口的分母是实验的历史并集,而发布目录没有历史——
  只复制选中 Run,发布目录上重新算,缺口会静默消失。解法不是持久化算好的缺口(那违反「reader
  派生物删了可重算」),而是让覆盖判断的**依据**随数据走:`publish()` 给每个复制出的 Run 补记
  `knownEvalIds`(复制时刻该实验的 `exp.knownEvalIds`);reader 端 `exp.knownEvalIds` 的定义是
  **并集(本地历史, 各 Run 携带的 knownEvalIds)**——不是「优先字段」:把 Run 复制进已有历史的
  目录时,本地并集可能更大,优先字段会让分母缩水。
- **目标目录非空即报错**,不静默覆盖、不合并——发布脚本要幂等就自己先清目录;盘上不该出现
  「我没写的东西被动过」的惊讶。
- **发布前整文件预检。** `publish()` 在创建目标目录前先规划并序列化全部目标文件;任一文件超过
  固定的 `PUBLISH_FILE_MAX_BYTES = 50 * 1024 * 1024` 就整体失败,错误列出源路径、实际字节数与
  处理动作(从 `artifacts` 排除该类证据,或用当前 writer 重新生成历史 events / trace)。不自动
  删半个 artifact,也不留下半成品目标目录。50 MiB 为 GitHub 的 100 MB 单文件硬限保留余量,同时
  覆盖其它常见 Git host;它不是可调旋钮,避免发布脚本把保护调没。
- **`dangling` 条目整体失败。** 源里有 artifact 已丢失的携带条目时,`publish()` 报错并列出这些
  attempt 与它们指向的原 Run 目录,不产出一份「看起来完整、实际缺证据」的发布物。要发布只剩
  判定的历史,显式把该类 artifact 从 `artifacts` 里排除。
- **`artifacts` 的合法词干与缺省携带单源在[证据 registry](architecture.md#证据-registry)**——
  新增一种证据只需要 registry 加一行。两条缺省理由需要显式交代:失败命令证据是 errored attempt
  的主要下钻面,`commands` 默认发布拷贝不能静默删掉;`diff` 不在缺省之列,体量取舍留给显式选择。

## 直接吃读取面:一个真实脚本

折叠类的看法(表格、矩阵、成绩单、散点)去用 [Reports](../reports/README.md) 的计算函数;要按
官方口径选数据用 [Sample](../sample/README.md)。直接吃 Record 服务的是连口径都自定义的场景,
比如「把全部历史按 agent 拉成 shell 命令分布直方图」——那是分布,不是折叠:

```typescript
import { openRecord } from "niceeval/record";

const record = await openRecord(".niceeval");
const points = [];
for (const exp of record.experiments) {
  for (const attempt of exp.runs[0].attempts) {
    const o11y = await attempt.o11y();
    points.push({
      agent: exp.runs[0].agent,
      eval: attempt.evalId,
      passed: attempt.result.verdict === "passed",
      shellCommands: o11y?.shellCommands.length ?? 0,
    });
  }
}
```

即使在这条最深的路径上,用户也**不碰磁盘布局**——路径拼接、存在性判断、版本过滤、 Run 定位都被库
消化了。记录格式若演进,全宇宙只有这一个库要改。

## 相关阅读

- [README](README.md) —— 三层分工、库的边界、消费方。
- [Architecture](architecture.md) —— 磁盘上的格式规范。
- [参考方案](reference/README.md) —— 这一层的形状从哪些系统学来。
- [Sample](../sample/library.md) —— 选口径、覆盖、时效与转换算子。
- [Reports](../reports/README.md) —— 建立在样本之上的指标与组件。
- [Experiments](../experiments/README.md) —— experimentId 与 `selectedEvalIds` 从哪来。
