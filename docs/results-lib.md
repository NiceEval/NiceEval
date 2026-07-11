# Results Lib —— 实验结果数据的读写库

> 状态:已按本文实现(`src/results/`,源码入口见 [Source Map](source-map.md#results-lib-与-reports)),与 `docs-site/zh/guides/results-data.mdx` 对齐:读取面(`openResults` 分层、`latest()` Selection、`dedupeAttempts`)、写入面(`createRunWriter`)、发布(`copySnapshots`)与 `Artifacts()` reporter 薄壳全部落地;view 的读取层收编也已完成(2026-07,`src/view/data.ts` 改吃 `openResults`,见 [View](view.md))。一步未实现:「类型的家」迁移(`RunSummary` / `EvalResult` 等仍住 core 的域文件,库经 `../types.ts` 引用,见「库的边界」)。[Results Format](results-format.md) 是磁盘上的格式规范;本库是这份格式的**读与写**的唯一实现 `niceeval/results`,做 runner、view、[Reports](reports.md) 和用户脚本的共同数据层。

抽库前,同一份磁盘格式的写和读长在两个器官里。写在 `src/runner/reporters/artifacts.ts`:时间戳目录、attempt 路径清洗(evalId 保留 `/` 层级、agent/model 非 `[\w.@-]` 全换 `_`)、大字段拆 artifact、`artifactsDir` / `has*` 回填、空数据不落文件——全是它的私有知识。读长在 `src/view/index.ts`:`readSummary` 的版本判定、`loadSummaries` 的目录扫描、 artifact 路径反拼。两边靠 `src/types.ts` 共享类型,但**布局知识各自实现了一遍**:格式演进要同步改两处,谁漏改谁坏。用户侧则根本没有读取 API,想编程消费只能第三次重写这些知识:

```typescript
// 抽库前:想比「谁的代码短」,只能手工爬目录
const summary = JSON.parse(readFileSync(".niceeval/2026-07-02T.../summary.json", "utf-8"));
for (const r of summary.results) {
  const diffPath = join(runDir, r.artifactsDir ?? "", "diff.json"); // 布局知识泄漏
  if (!existsSync(diffPath)) continue;                             // 存在性自己判断
  const diff = JSON.parse(readFileSync(diffPath, "utf-8"));        // 类型自己想
}
```

抽成一个专门的库,理由就是 TypeScript 最擅长的那件事:**写和读是同一组 interface 的两半,住在同一个包里,writer 的参数类型 = reader 的返回类型**——「写出去的就是读得回的」由编译器背书,布局知识(路径、清洗、拆分、版本)全宇宙只有一份实现。

## 库的边界

`niceeval/results` 拥有:

- **类型的家。** `RunSummary` / `EvalResult` / `StreamEvent` / `TraceSpan` / `O11ySummary` / `DiffData` 等结果类型和 `RESULTS_FORMAT` / `RESULTS_SCHEMA_VERSION` 常量搬进库;core 的 `src/types.ts` facade 反向 re-export,模块代码 `import type { … } from "../types.ts"` 的老习惯不破。
- **writer。** 目录创建、结果快照级元数据、attempt artifact 增量落盘、summary 推导收尾(见下)。
- **reader。** `openResults`:目录扫描、版本过滤、懒加载、实验/快照/eval 分层、选择器(见下)。
- **身份。** attempt 身份键与去重规则——读写两侧对「同一个 attempt」的理解必须一致,所以住在这。

它不拥有:「看法」(聚合、指标、组件在 [Reports](reports.md))、渲染(view)、执行(runner)。库位于依赖图最底层,不 import core 的任何其它模块;必要时可以原样提成独立 npm 包(给「只想解析或产出 niceeval 结果的工具」用),但先作为子路径导出,不预设。

四个消费方:

| 消费方 | 用哪面 | 变化 |
|---|---|---|
| runner 的 `Artifacts()` reporter | 写 | 变薄壳:订阅 reporter 事件,转手调 writer,落盘行为不变 |
| `niceeval view` | 读 | 已收编(2026-07):旧 `readSummary` / `loadSummaries` 删掉,`src/view/data.ts` 吃 reader,版本判定与 skipped 姿势统一 |
| [Reports](reports.md) 的计算函数 | 读 | 第二档的全部数据入口 |
| 你的脚本 / 第三方工具 | 读、写、发布 | 读:自定义分析;写:把别家平台的结果转成 niceeval 格式,`niceeval view` 直接能看;发布:`copySnapshots` 瘦身快照进仓库 / CDN——兼容性都由库保证,不用抄格式文档 |

## 写:`createRunWriter`

writer 与 reader 是同一组类型的两半,而且是**字面的**两半:reader 的 `attempt.result`(瘦身 `EvalResult`)由两部分拼成——快照级字段(agent / model / startedAt / producer)来自 `writer.snapshot()` 的一次声明,是快照层注入的装饰;其余全部字段就是 `writeAttempt` 第一参数的类型。第二参数是 reader 懒加载能拿到的那几样 artifact 的类型。**「writeAttempt 参数 + snapshot() 声明 = reader 读回的全部,由类型拼合背书」**:快照级字段不在 attempt 参数类型里,不存在「谁的值为准」的运行时问题。两版落选形状的记录:「大字段内联的完整 EvalResult」是另一个类型,编译器背书当场不成立;「第一参 = 完整的 attempt.result」含 experiment 元数据,与「快照级只声明一次」互相矛盾(2026-07-10 修正)。「大字段拆文件、引用填回来」的布局知识全部在库内。这与 [Reports 类型义务](reports.md#类型义务本提案的落地前置)第 3 条的 EvalResult 两拆是同一件事。

```typescript
import { createRunWriter } from "niceeval/results";

const writer = await createRunWriter(".niceeval", {
  producer: { name: "niceeval", version: "0.12.0" },
});
writer.dir;                        // .niceeval/2026-07-07T…Z/(时间戳目录,: 与 . 已替换)

const snap = writer.snapshot({     // 快照级元数据的家:一个 experiment 开一个
  experiment: "compare/bub-gpt-5.4",
  agent: "bub",
  model: "gpt-5.4",
  startedAt,                       // 必填:身份键与去重以它为锚,官方产出永不缺
});

await snap.writeAttempt(result, {  // result = attempt 级条目;快照级字段在 snapshot() 声明
  events, trace, o11y, diff, sources,   // 全部可选;缺哪样读取面就懒加载出 null
});                                // 拆 artifact 文件、算 artifactsDir(含路径清洗)、
                                   // 回填 has* 引用;空数据不落文件

await writer.finish();             // summary 从已写入的 attempt 推导(计数永远和条目一致),
                                   // 注入 format / schemaVersion / producer;个别推不出的
                                   // 字段走可选参数覆盖,不让调用方手拼整份 summary
```

`writer.snapshot()` 是读取面「一个 run 装多份快照」的镜像:`niceeval exp compare` 整组对照就是一个 run 目录里开多个快照,agent / model / startedAt 这些快照级身份在这里声明一次,不塞进每条 attempt——否则第三方转换器要么漏写要么各条不一致,reader 侧还得猜以谁为准(类型上由 `writeAttempt` 参数的 `Omit` 保证,见上)。快照级可选项还包括 `knownEvalIds`(该实验已知的 eval 并集,残缺检测的分母,见 `copySnapshots` 节)。attempt artifact 按完成增量写入(与今天的行为一致):长 run 中途失败,已完成的 attempt artifact 仍留在盘上供手工排查——但 summary 是 `finish()` 写的收尾事实,没收尾的目录读取面归入 `skipped("incomplete")`,不认半份落盘(决策记录见「读」一节要点)。

## 复制与瘦身:`copySnapshots`

发布场景的第三个原语:把选中的快照按格式感知地复制到另一个目录——只带指定 artifact、只带选中的 attempt,布局知识不外泄。名字不叫 `copyRun`:本文用一整节教「快照不是 run」,而这个 API 恰恰收快照、产出「装着选中快照的一个 run 目录」——名字再叫 run,刚建立的心智当场自相矛盾。输入收 `Selection` 或手工挑的 `Snapshot[]`,与 Reports 组件的 `data` 函数同一输入约定:

```typescript
import { openResults, copySnapshots } from "niceeval/results";

const results = await openResults(".niceeval");
await copySnapshots(results.latest(), "site/data/run", {
  artifacts: ["sources", "events", "trace", "o11y"],   // diff 可达百 MB,发布时常见地不带;
});                                                     // o11y 只有几 KB,报告读它就带上
```

`o11y` 曾经也在「常见地不带」那一档,理由是「查看器不读」——这个理由是循环论证:因为没消费者所以不带,因为不带所以做不了消费它的内置指标。`turns`(见 [Reports「两档内置指标」](reports.md#两档内置指标瘦身字段-vs-artifact))成为消费者后,循环断开:`o11y.json` 实测几 KB 一个(和 `diff` 可达百 MB 完全不是一个量级),没有不带的理由。

动机来自真实消费者:coding-agent-memory-evals 把最新 run 快照进仓库供静态托管,今天是 40 行手写脚本——按 `summary.json` 的 mtime 挑「最新」(口径还错了:该挑快照,不该挑 run),再按白名单拷贝 artifact 文件(布局知识第三次泄漏)。`copySnapshots` 之后这段只剩上面几行,挑选交给 `results.latest()`(见[静态导出场景](reports.md#dx-模拟))。复制不改 artifact 内容、不消毒——发布消毒是自由文本的事,归 [Reports 的 `CaseList.data({ redact })`](reports.md#计算函数与数据契约)。三条契约细节(2026-07-10 拍板):

- **覆盖事实随数据走(`knownEvalIds`)。** `partial-coverage` 的分母是实验的历史并集,而发布目录没有历史——只复制选中快照,发布目录上重新 `openResults().latest()`,警告会静默消失,「缺口永远被算出来」在官方教的发布路径上断掉。修法不是持久化警告(那违反「reader 派生物删了可重算」),而是让警告的**依据**随数据走:`copySnapshots` 给每个复制出的快照补记 `knownEvalIds`(复制时刻该实验的 `exp.evalIds`);reader 端 `exp.evalIds` 的定义改为 **并集(本地历史, 各快照携带的 knownEvalIds)**——不是「优先字段」:把快照复制进已有历史的目录时,本地并集可能更大,优先字段会让分母缩水。字段是格式的一部分,`writer.snapshot()` 同样可声明(第三方转换器交代已知覆盖);可选新增字段不破坏兼容,按 [Results Format 版本规则](results-format.md#版本与升级设计)不递增 schemaVersion,落地时同步该规范。「复制忠实于源」的承诺相应精确化:不改 artifact 内容,但随行补记挑选时的覆盖事实。
- **目标目录非空即报错**,不静默覆盖、不合并——发布脚本要幂等就自己先清目录;盘上不该出现「我没写的东西被动过」的惊讶。
- **`artifacts` 合法值全集** `"events" | "trace" | "o11y" | "diff" | "sources"`,缺省全带。

## 读:`openResults`

两条设计决策。**层次跟使用者的心智走**(「所有实验 → 单次跑的实验 → 每道题」),不跟物理目录走;producer / schemaVersion 从 RunSummary 浮到快照上。**「results」一个词不在层级里重复**:分层把它拆成 `experiments` / `snapshots` / `attempt.result` 各归其位;入口名考虑过 `openExperiments`,否掉——模块叫 `niceeval/results`,返回物上除了 `experiments` 还有 `skipped` / `runDirs` / `latest()`,示例里的变量名怎么写都是 `results`,入口叫 experiments 只会让三者失配。API 如下:

```typescript
import { openResults } from "niceeval/results";

const results = await openResults(".niceeval");

results.experiments;           // Experiment[]:每个实验一项,挂着自己的全部历史(id 字典序)
results.skipped;               // 读不了的落盘:{ dir, reason, schemaVersion?, producer? }[]
results.runDirs;               // 低层忠实磁盘面:物理落盘目录,新→旧;多数消费方不碰

const exp = results.experiments.find((e) => e.id === "compare/bub-gpt-5.4")!;
exp.snapshots;                 // Snapshot[]:历次快照,最新在前
exp.latest;                    // 最新一次(= snapshots[0])
exp.evalIds;                   // 已知 eval 并集 = 本地历史 ∪ 各快照携带的 knownEvalIds —— 残缺检测的依据

const snap = exp.latest;       // 单次跑的实验
snap.agent; snap.model; snap.startedAt;
snap.producer;                 // { name, version?, commit? }:谁写的这份结果(niceeval 或第三方 harness)
snap.schemaVersion;            // 结果格式版本(能读进来的恒为当前版本;不兼容的在 skipped)
snap.evals;                    // Eval[]:每道题一项 { id, attempts }
snap.attempts;                 // 全部 attempt 平铺(不关心题目边界的聚合消费用)
snap.runDir;                   // 所属物理落盘(低层)

const attempt = snap.evals[0].attempts[0];
attempt.evalId;                // 属于哪道题 —— 直达字段,不绕 result
attempt.experimentId;          // 属于哪个实验
attempt.result;                // EvalResult 瘦身条目:判定、断言、用量、成本、experiment 元数据
attempt.ref;                   // { run, result }:证据引用(run 目录名 + results 下标),
                               // Reports 的 MetricCell.refs 与 view 深链 #/attempt/... 同一身份
await attempt.events();        // StreamEvent[] | null —— 重 artifact 全部懒加载
await attempt.trace();         // TraceSpan[] | null
await attempt.o11y();          // O11ySummary | null
await attempt.diff();          // DiffData | null(可达百 MB,所以必须懒)
await attempt.sources();       // SourceArtifact[] | null
```

命名约定:`Experiment` / `Snapshot` / `Eval` / `RunDir` 是纯数据,不带 `Handle` 后缀;唯一叫 `AttemptHandle` 的是 attempt——它的方法真的会碰磁盘,后缀标记的就是这件事。`AttemptRef` 的字段名(`run` / `result`)是 view 深链的持久化路由契约,不随句柄改名。

要点:

- **懒加载即存在性判断。** artifact 缺失返回 `null`,不抛错。今天 summary 里只有 `hasEvents` / `hasTrace` / `hasSources`,连 `hasO11y` / `hasDiff` 标记都没有——这类不对称全被方法语义吸收,消费方不再碰路径。
- **版本过滤沿用格式规范。** 按 [Results Format 的版本规则](results-format.md#版本与升级设计)判定,不兼容的落盘进 `skipped` 并带 `schemaVersion` 与**完整的** `producer`(name + version),与 [View 的报错与降级](view.md#报错与降级)同一姿势。带完整 producer 是硬要求:`npx niceeval@<version> view` 的提示只对 `producer.name === "niceeval"` 成立,第三方 harness 写的落盘拿它的版本号拼 npx 命令是一句错误提示——只给 `producerVersion` 一个裸版本号,消费方连做对这个分支的信息都没有。能读进来的每个快照带自己的 `producer` / `schemaVersion`,「这份结果是谁、用什么版本写的」不用下钻 summary。
- **`skipped` 的第三种原因:`"incomplete"`(2026-07-10 拍板)。** 有 attempt artifact、没有 summary 的目录 = run 中途 crash、writer 没走到 `finish()`。与 `"malformed"` 区分开——诊断动作完全不同(一个是没收尾,一个是坏数据)。reader **不读**无 summary 的目录:summary 是收尾事实,给半份落盘造第二条读取路径会破坏它的地位。「重开 writer 补 finish」的恢复路径也被否:判定只活在 summary 里,恢复成立的前提是 writer 增量落一份判定 journal——那是 Results Format 级的新落盘物,代价大于收益,不做。已完成的 artifact 留在盘上,供手工排查。
- **分组是切片,不是看法。** 实验归组、eval 分组都是确定性切片(不合并、不聚合、不去重),与「忠实磁盘」不冲突;有看法的合并聚合仍然全部在消费方。
- **同一进程内按 handle 记忆化。** 两个都要读 diff 的消费方不会把「可达百 MB」的 `diff.json` 读两遍;扫全部历史仍然可能慢,但要慢得线性、可预期。
- **只读不写事实。** reader 的一切派生物删了随时可重算;唯一事实来源仍是磁盘上的 Results Format。

## 快照:experiment × run,不是 run

一次 CLI 调用写一个 run 目录,但一个 run 目录里可以装多个 experiment:`niceeval exp compare` 把整组对照跑进同一份 `summary.json`(runner 收的是 `agentRuns[]` 复数),顶层 `RunSummary.agent` 只是第一个配置的 agent(`src/runner/run.ts` 的 `summarize(allResults, firstAgent?.name …)`)。所以「每个 experiment 最新一次」没法用 run 粒度表达——周一跑了整组 compare,周二只重跑 `compare/bub-gpt-5.4`,bub 的最新快照在周二的 run 里,codex 的还在周一的 run 里。

reader 把这层身份显式化:**快照 = 单次跑的实验**,一个 experiment 在一次落盘里的那部分结果,与 [View · Compare 计划](view.md#compare-挑两次运行对比)的 `(experimentId, startedAt)` 同一口径:

```typescript
interface Snapshot {
  experimentId: string;        // 结果里缺 experimentId 时以 "<agent>/<model>" 合成键,并记入 warnings
  startedAt: string;
  agent: string;               // 本快照自己的 agent —— 不是落盘顶层那个「第一个配置」
  model?: string;
  producer?: RunSummary["producer"];  // 谁写的(legacy 结果可能缺失)
  schemaVersion: number;       // 结果格式版本,缺失按 1
  evals: Eval[];               // 每道题一项:{ id, attempts },残缺检测/逐题遍历从这里走
  attempts: AttemptHandle[];   // 全部 attempt 平铺(= evals 逐题展开)
  runDir: RunDir;              // 所属物理落盘(低层面)
  synthetic?: boolean;         // experimentId 是合成键时为 true
  knownEvalIds?: string[];     // 写入时刻该实验已知的 eval 并集(可选);copySnapshots 自动补记,
                               // writer.snapshot() 也可声明——残缺检测的分母随数据走,见 copySnapshots 节
}
```

`results.runDirs` 忠实磁盘,快照与实验归组只切片、不合并、不去重;合并与聚合永远发生在消费方([Reports](reports.md) 的计算函数,或你自己的脚本),reader 不预设看法——这条教训来自 view 旧 `aggregateRows` 把全部历史揉成一行的前车之鉴(已修,见 [View · 已知差异](view.md#已知的文档-vs-实现差异))。

## 选择快照:`results.latest()` 返回 Selection

多数消费场景先回答「现在什么水平」,所以选择器只有一个,长在集合上。返回物是一个 **Selection(挑选结果)**:快照与挑选警告绑在一起走:

```typescript
const latest = results.latest({
  experiments: "compare/",     // 可选:experiment id 前缀过滤(string | string[],与 CLI 位置参数
});                            // 可给多个前缀对齐),同一套前缀匹配机制

latest.snapshots;              // Snapshot[]:每个实验最新一次
latest.warnings;               // SelectionWarning[]:结构化,不是渲染好的文本
```

每个实验取最新一次快照,最不误导。单看一个实验直接用 `exp.latest`;要累计历史就遍历 `exp.snapshots`;要更细的口径,普通 `.filter` 就够——选择器不是 DSL,只是最常用的那次筛选;它长在集合上而不是独立导出,少一个要 import 的名字。

但「最新」可能残缺:位置参数允许只重跑一道题(`niceeval exp midterm algebra/quadratic` 是正常的 debug 姿势),它产出的「最新快照」只有一道题,安静吞下的话下游报表就变成按一道题打分。所以**选择器同样要诚实**:把每个选中快照的 `evalIds` 与该 experiment 历史快照的并集对比,缩水就写进 `warnings`:

```typescript
latest.warnings[0];
// {
//   kind: "partial-coverage",
//   experimentId: "midterm/bub-gpt-5.4",
//   covered: 1,
//   total: 50,
//   message: "snapshot covers 1 of 50 evals seen in history; re-run `niceeval exp midterm/bub-gpt-5.4` for a full snapshot",
// }
```

结构化是给程序判断的(CI 里「覆盖缩水就 fail」直接比 `covered < total`),`message` 是渲染好的英文句子,要展示就原样打;第一稿的「普通字符串数组」被否——「渲染与否在消费方」的承诺只对可判断的数据成立,只给文本等于逼消费方正则解析。渲染与否在消费方,但缺口永远被算出来,不静默。

**Selection 有且只有一个方法:`filter(predicate)`(2026-07-10 拍板)。** 最常见的自定义不是另起口径,而是微调官方口径——「latest 减掉一个已知坏掉的实验」「排除 partial 的快照」。若一 `.filter()` 就降级成裸 `Snapshot[]`,幸存快照本该有的警告全丢。`selection.filter((s) => …)` 返回新 Selection:快照删减,warnings 按规则修剪——**experimentId 不在幸存快照中的警告丢弃,非实验作用域的警告保留**(为将来非 per-experiment 的 kind 留位置)。边界同样明确:`filter` 只做删减;「换成该实验上一个完整快照」这类**替换式**重挑不给方法(那才是 DSL 的开端),回 `exp.snapshots` 自己挑,挑出来的裸数组没有挑选过程、没有 warnings,也如实——这是显式立场,不是漏做。

**Selection 是下游的通用输入**:Reports 的计算函数与 `copySnapshots` 都收 `Selection | Snapshot[]`。收 Selection 时 warnings 随行——`RunOverview` 把警告直接渲染在 KPI 条内,「诚实不靠使用者记得渲染」才真正成立(早先草案要求手动把 `warnings` 传进 `overview()`,忘了就静默丢失,承诺不成立);手工挑的 `Snapshot[]` 没有挑选过程,自然没有 warnings 可带,也如实。

### 警告 kind 全集

每种警告都带 `kind`、可判断的结构化字段和渲染好的英文 `message`;kind 是契约的一部分,新增 kind 要回这张表登记:

| kind | 归属 | 触发 | 结构化字段 |
|---|---|---|---|
| `partial-coverage` | `Selection` | 选中快照的覆盖 < 该实验已知 eval 并集(本地历史 ∪ knownEvalIds,再交命令行范围) | `experimentId`, `covered`, `total` |
| `stale-snapshot` | `Selection` | 该实验选中的快照早于 Selection 中最新的落盘——无阈值,如实触发,要阈值消费方按字段自比;`message` 带人话时距("predates latest run by 2 days") | `experimentId`, `startedAt`, `latestStartedAt` |
| `synthetic-experiment-id` | `Selection` | 落盘缺 experimentId,以 `<agent>/<model>` 合成键(快照的 `synthetic: true` 同源) | `experimentId`, `runDir` |
| `missing-startedAt` | `dedupeAttempts` | 身份键缺 `startedAt`,宁可不去重也不误删 | `experimentId`, `evalId` |

公开面的全集由参考页承载(`pnpm docs:reference` 从 TSDoc 生成),guide 只举例并声明「不止一种」。`missing-startedAt` **不透出到组件数据**(2026-07-10 裁决):`writer.snapshot()` 的 `startedAt` 必填,官方产出与走写入面的转换永不缺,缺失只可能来自 legacy 落盘;计算函数「不去重、如实保留重复」即终稿,`dedupeAttempts` 直调时警告随返回值走。

## 身份键与去重

`--resume` 会把上一轮已通过的结果**原样合入**新 run 的 summary(`RunOptions.priorResults`):这让续跑出来的最新快照天然完整(正好配合 `results.latest()`),代价是同一个 attempt 存在于多份落盘。

**合入条目的读取面行为(2026-07-10 拍板,机制已在盘上)**:合入时条目的 `artifactsDir` 置空、`artifactBase`(相对结果根)指向原 run 的 artifact 目录,`has*` 真值原样携带(`src/runner/run.ts` 的 carriedResults、`src/runner/reporters/artifacts.ts` 的 slimResult)——`artifactBase` 就是事实上的「合入」标记,不需要再发明一个。reader 据此定三条:

- **懒加载按候选顺序回退**:先本 run 的 `artifactsDir`,再 `artifactBase` 指向的原 run 目录;原 run 被清理后如实返回 `null`(「懒加载即存在性判断」不破:盘上确实没有了)。
- **`ref` 指条目所在的落盘**(合入后的新 run):证据身份跟着条目走, artifact 经回退仍可达;view 深链与 `copySnapshots` 的源 artifact 定位用同一套候选顺序。
- **身份键四字段都在数据上**:`experimentId` / `evalId` 是 AttemptHandle 直达字段,`attempt` 序号与 `startedAt` 在 `attempt.result` 上——消费方自己实现去重不缺任何一块。

reader 忠实反映这份重复,不擅自去重;**跨快照聚合前按身份键去重是消费方的义务**:

- 身份键:`(experimentId, evalId, attempt, startedAt)`,重复时保留**最新 run 目录**里的那份(内容相同,取新 run 里的副本让 ref 落在最新落盘上);
- `startedAt` 缺失时宁可不去重也不误删,并记入 warnings(kind `missing-startedAt`,见警告全集表);
- [Reports 的计算函数](reports.md#计算函数与数据契约)内置这条;自己写脚本跨快照累计时,要么复用计算函数,要么自己按键去重。

## 直接吃读取面:一个真实脚本

折叠类的看法(表格、矩阵、成绩单、散点)去用 [Reports](reports.md) 的计算函数;直接吃 reader 服务的是连算法都自定义的场景,比如「每个 agent 的 shell 命令分布直方图」——那是分布,不是折叠:

```typescript
import { openResults } from "niceeval/results";

const results = await openResults(".niceeval");
const points = [];
for (const exp of results.experiments) {
  for (const attempt of exp.latest.attempts) {
    const o11y = await attempt.o11y();
    points.push({
      agent: exp.latest.agent,
      eval: attempt.evalId,
      passed: attempt.result.verdict === "passed",
      shellCommands: o11y?.shellCommands.length ?? 0,
    });
  }
}
```

即使在这条最深的路径上,用户也**不碰磁盘布局**——`artifactsDir` 拼接、存在性判断、版本过滤、快照切分都被库消化了。Results Format 若演进,全宇宙只有这一个库要改。

## 相关阅读

- [Results Format](results-format.md) —— 磁盘格式规范;本库是它唯一的官方读写实现,一格式一库,成对演进。
- [Reports](reports.md) —— 建立在本库读取面之上的积木:指标、计算函数、React 组件。
- [View](view.md) —— 内置前端;读取层已收编本库 reader(2026-07),skipped 三种原因经 viewData 进前端横幅。
- [Experiments](experiments.md) —— experimentId 与可对比组从哪来。
