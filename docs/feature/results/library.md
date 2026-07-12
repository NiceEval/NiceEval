# Results —— 库用法

这是磁盘快照格式的 TS 读写 API(`niceeval/results`);为什么格式与库合一见 [README](README.md),磁盘上的格式规范见 [Architecture](architecture.md)。

## 写:`createResultsWriter`

writer 与 reader 是同一组类型的两半,而且是**字面的**两半:reader 的 `attempt.result`(瘦身 `EvalResult`)由两部分拼成——快照级字段(experimentId / agent / model / startedAt / 实验运行配置 / producer)来自 `writer.snapshot()` 的一次声明,是快照层注入的装饰;其余全部字段就是 `writeAttempt` 第一参数的类型。第二参数是 reader 懒加载能拿到的那几样 artifact 的类型。**「writeAttempt 参数 + snapshot() 声明 = reader 读回的全部,由类型拼合背书」**:快照级字段不在 attempt 参数类型里,不存在「谁的值为准」的运行时问题。两版落选形状的记录:「大字段内联的完整 EvalResult」是另一个类型,编译器背书当场不成立;「第一参 = 完整的 attempt.result」含 experiment 元数据,与「快照级只声明一次」互相矛盾(2026-07-10 修正)。「大字段拆文件、判决落 attempt 记录」的布局知识全部在库内。EvalResult 的「瘦身条目 + 拆出的 artifact」两拆,与 Reports 侧读到的形状是同一件事。

```typescript
import { createResultsWriter } from "niceeval/results";

const writer = createResultsWriter(".niceeval", {
  producer: { name: "niceeval", version: "0.12.0" },
});

const snap = await writer.snapshot({  // 建快照目录(独占创建,撞名换后缀重试)+ 写 snapshot.json
  experimentId: "compare/bub-gpt-5.4",
  agent: "bub",
  model: "gpt-5.4",
  startedAt,                          // 必填:身份键与去重以它为锚,官方产出永不缺
});
snap.dir;                             // .niceeval/compare_bub-gpt-5.4/2026-07-11T…Z-x1f2/

await snap.writeAttempt(result, {     // 写 result.json(判决权威落点,一次写成)+ 拆 artifact 文件;
  events, trace, o11y, agentSetup, diff, sources,
                                      // artifact 全部可选;缺哪样读取面就懒加载出 null;
});                                   // 空数据不落文件

await writer.finish();                // 给每个快照补 completedAt(声明里给过就用声明值);
                                      // 除此之外没有收尾聚合 —— 计数、用量、成本由 reader 逐条推导
```

`writer.snapshot()` 是读取面「实验 → 快照」层次的镜像:experimentId / agent / model / startedAt 这些快照级身份在这里声明一次,不塞进每条 attempt——否则第三方转换器要么漏写要么各条不一致,reader 侧还得猜以谁为准(类型上由 `writeAttempt` 参数的 `Omit` 保证,见上)。快照级可选项还包括 `experiment`(实验运行配置 `ExperimentRunInfo`:flags / runs / earlyExit / sandbox / timeoutMs / budget)、`knownEvalIds`(该实验已知的 eval 并集,残缺检测的分母,见 `copySnapshots` 节)、`completedAt`(转换历史数据时如实交代收尾时刻)与 `name`(项目名,view hero 显示)。

**每个文件恰好写入一次**是写入面的核心承诺:`snapshot.json` 开跑即写、收尾只补 `completedAt`;`result.json` 与 artifact 随 attempt 完成落盘。进程中断只丢未完成的 attempt;并发进程各写各的快照目录,互不触碰(唯一性由独占创建保证,见 [Architecture](architecture.md#目录结构))。

## 复制与瘦身:`copySnapshots`

发布场景的第三个原语:把选中的快照按格式感知地复制到另一个目录——只带指定 artifact、只带选中的 attempt,布局知识不外泄。输入收 `Selection` 或手工挑的 `Snapshot[]`,产出一个**结果根目录**(实验目录在外层的同一布局,`openResults` 直接能开);与 Reports 组件的 `data` 函数同一输入约定:

```typescript
import { openResults, copySnapshots } from "niceeval/results";

const results = await openResults(".niceeval");
await copySnapshots(results.latest(), "site/data/run", {
  artifacts: ["sources", "events", "trace", "o11y", "agentSetup"],
                                                            // diff 可达百 MB,发布时常见地不带;
});                                                     // o11y 只有几 KB,报告读它就带上
```

`o11y` 曾经也在「常见地不带」那一档,理由是「查看器不读」——这个理由是循环论证:因为没消费者所以不带,因为不带所以做不了消费它的内置指标。`turns`(见 [Reports 的内置指标](../reports/library.md#内置指标))成为消费者后,循环断开:`o11y.json` 实测几 KB 一个(和 `diff` 可达百 MB 完全不是一个量级),没有不带的理由。

动机来自真实消费者:coding-agent-memory-evals 把最新快照进仓库供静态托管,曾是 40 行手写脚本——按落盘 mtime 挑「最新」(口径还错了:该挑快照),再按白名单拷贝 artifact 文件(布局知识第三次泄漏)。`copySnapshots` 之后这段只剩上面几行,挑选交给 `results.latest()`(见[静态导出](../reports/view.md#静态导出))。复制不改 artifact 内容、不消毒——发布消毒是自由文本的事,归 [Reports 的 `AttemptList.data({ redact })`](../reports/library.md#数据计算与缓存边界)。三条契约细节(2026-07-10 拍板):

- **覆盖事实随数据走(`knownEvalIds`)。** `partial-coverage` 的分母是实验的历史并集,而发布目录没有历史——只复制选中快照,发布目录上重新 `openResults().latest()`,警告会静默消失,「缺口永远被算出来」在官方教的发布路径上断掉。修法不是持久化警告(那违反「reader 派生物删了可重算」),而是让警告的**依据**随数据走:`copySnapshots` 给每个复制出的快照补记 `knownEvalIds`(复制时刻该实验的 `exp.evalIds`);reader 端 `exp.evalIds` 的定义是**并集(本地历史, 各快照携带的 knownEvalIds)**——不是「优先字段」:把快照复制进已有历史的目录时,本地并集可能更大,优先字段会让分母缩水。字段是格式的一部分,`writer.snapshot()` 同样可声明(第三方转换器交代已知覆盖);可选新增字段不破坏兼容,按 [Architecture · 版本与升级设计](architecture.md#版本与升级设计)不递增 schemaVersion。「复制忠实于源」的承诺相应精确化:不改 artifact 内容,但随行补记挑选时的覆盖事实(落在复制出的 `snapshot.json` 上)。
- **目标目录非空即报错**,不静默覆盖、不合并——发布脚本要幂等就自己先清目录;盘上不该出现「我没写的东西被动过」的惊讶。
- **`artifacts` 合法值全集** `"events" | "trace" | "o11y" | "agentSetup" | "diff" | "sources"`,缺省全带。

## 读:`openResults`

两条设计决策。**层次跟使用者的心智走**(「所有实验 → 单次跑的实验 → 每道题」)——磁盘布局与这个心智同构(实验目录在外层),reader 的分层就是目录树的类型化投影;producer / schemaVersion 是快照自己的字段。**「results」一个词不在层级里重复**:分层把它拆成 `experiments` / `snapshots` / `attempt.result` 各归其位;入口名考虑过 `openExperiments`,否掉——模块叫 `niceeval/results`,返回物上除了 `experiments` 还有 `skipped` / `latest()`,示例里的变量名怎么写都是 `results`,入口叫 experiments 只会让三者失配。API 如下:

```typescript
import { openResults } from "niceeval/results";

const results = await openResults(".niceeval");

results.experiments;           // Experiment[]:每个实验一项,挂着自己的全部历史(id 字典序)
results.skipped;               // 读不了的落盘:{ dir, reason, schemaVersion?, producer? }[]

const exp = results.experiments.find((e) => e.id === "compare/bub-gpt-5.4")!;
exp.snapshots;                 // Snapshot[]:历次快照,最新在前
exp.latest;                    // 最新一次(= snapshots[0])
exp.evalIds;                   // 已知 eval 并集 = 本地历史 ∪ 各快照携带的 knownEvalIds —— 残缺检测的依据

const snap = exp.latest;       // 单次跑的实验 = 一个快照目录
snap.dir;                      // 快照目录的绝对路径(物理落盘就是快照本身,没有更低一层)
snap.agent; snap.model; snap.startedAt;
snap.completedAt;              // 缺失 = 未收尾(进程中断);已落盘 attempt 照常在下面读到
snap.experiment;               // 实验运行配置(flags / runs / budget …),快照内全部 attempt 共享
snap.producer;                 // { name, version?, commit? }:谁写的这份结果(niceeval 或第三方 harness)
snap.schemaVersion;            // 结果格式版本(能读进来的恒为当前版本;不兼容的在 skipped)
snap.evals;                    // Eval[]:每道题一项 { id, attempts }
snap.attempts;                 // 全部 attempt 平铺(不关心题目边界的聚合消费用)

const attempt = snap.evals[0].attempts[0];
attempt.evalId;                // 属于哪道题 —— 直达字段,不绕 result
attempt.experimentId;          // 属于哪个实验
attempt.result;                // EvalResult 瘦身条目:判决、断言、用量、成本(快照级字段已拼合)
attempt.ref;                   // { snapshot, attempt }:证据引用(根相对快照目录 + 快照相对 attempt 目录),
                               // Reports 的 MetricCell.refs 与 view 深链 #/attempt/... 同一身份
attempt.snapshot;              // 所属快照(去重「保留最新快照里的那份」靠它比较新旧)
await attempt.events();        // StreamEvent[] | null —— 重 artifact 全部懒加载
await attempt.trace();         // TraceSpan[] | null
await attempt.o11y();          // O11ySummary | null
await attempt.agentSetup();    // AgentSetupManifest | null
await attempt.diff();          // DiffData | null(可达百 MB,所以必须懒)
await attempt.sources();       // SourceArtifact[] | null
```

命名约定:`Experiment` / `Snapshot` / `Eval` 是纯数据,不带 `Handle` 后缀;唯一叫 `AttemptHandle` 的是 attempt——它的方法真的会碰磁盘,后缀标记的就是这件事。`AttemptRef` 的字段名(`snapshot` / `attempt`)是 view 深链 `#/attempt/<snapshot>/<attempt>` 的持久化路由契约,不随句柄改名;`snapshot` 恒为两段(`<实验目录>/<快照目录>`),`attempt` 是 `<evalId 路径>/a<n>`,路由按「前两段 = 快照」解析。

要点:

- **懒加载即存在性判断。** artifact 缺失返回 `null`,不抛错。`result.json` 里只有 `hasEvents` / `hasTrace` / `hasSources`,连 `hasO11y` / `hasDiff` 标记都没有——这类不对称全被方法语义吸收,消费方不再碰路径。
- **版本过滤沿用格式规范。** 按 [Architecture · 版本与升级设计](architecture.md#版本与升级设计)判定,不兼容的落盘进 `skipped` 并带 `schemaVersion` 与完整的 `producer`(name + version),供 [View](../reports/view.md#结果版本与错误) 和其它调用方生成正确的版本建议。只有 `producer.name === "niceeval"` 时才能拼 `npx niceeval@<version>`；第三方 producer 保留自己的名字与版本。历史 run 级 `summary.json` 可被识别为不兼容结果,但不会被迁移。每个可读快照也直接暴露自己的 `producer` / `schemaVersion`。
- **`skipped` 的第三种原因:`"incomplete"`。** 有 attempt 落盘、没有 `snapshot.json` 的目录——只可能出现在「快照目录建好、元数据还没写完」的极小窗口里进程死亡,或人为删文件。与 `"malformed"`(元数据是坏 JSON)区分开,诊断动作完全不同。进程中断的常态是**未收尾快照**(`snapshot.json` 在、缺 `completedAt`):判决与 artifact 同级落盘、随 attempt 完成即写,中断只丢未完成的 attempt,已完成的照常读出——`latest()` 对选中的未收尾快照给结构化警告(见警告全集表),不是数据黑洞。
- **分组是切片,不是看法。** 实验归组、eval 分组都是确定性切片(不合并、不聚合、不去重),与「忠实磁盘」不冲突;有看法的合并聚合仍然全部在消费方。
- **同一进程内按 handle 记忆化。** 两个都要读 diff 的消费方不会把「可达百 MB」的 `diff.json` 读两遍;扫全部历史仍然可能慢,但要慢得线性、可预期。
- **只读不写事实。** reader 的一切派生物删了随时可重算;唯一事实来源仍是磁盘上的 Results Format。

## 快照:experiment × 一次运行

**快照 = 单次跑的实验**,物理上就是一个快照目录(`.niceeval/<experiment>/<timestamp>-<suffix>/`),与 [View 增强 · Compare 计划](../../roadmap/view-enhancements.md#compare-挑两次运行对比) 的 `(experimentId, startedAt)` 同一口径。「每个 experiment 最新一次」天然是快照粒度:周一跑了整组 compare,周二只重跑 `compare/bub-gpt-5.4`,bub 的最新快照在周二,codex 的还在周一——`niceeval exp compare` 一次 CLI 调用会同时开多个快照目录(每实验一个),但它们各自独立,没有跨实验的聚合落盘。

```typescript
interface Snapshot {
  experimentId: string;        // 权威身份(snapshot.json 字段;目录名只是它的清洗投影)
  startedAt: string;
  completedAt?: string;        // 缺失 = 未收尾(进程中断)
  agent: string;
  model?: string;
  experiment?: ExperimentRunInfo;     // 实验运行配置,快照内全部 attempt 共享
  producer?: { name: string; version?: string; commit?: string };  // 谁写的
  schemaVersion: number;       // 结果格式版本(能读进来的恒为当前版本;不兼容的在 skipped)
  evals: Eval[];               // 每道题一项:{ id, attempts },残缺检测/逐题遍历从这里走
  attempts: AttemptHandle[];   // 全部 attempt 平铺(= evals 逐题展开)
  dir: string;                 // 快照目录的绝对路径
  knownEvalIds?: string[];     // 写入时刻该实验已知的 eval 并集(可选);copySnapshots 自动补记,
                               // writer.snapshot() 也可声明——残缺检测的分母随数据走,见 copySnapshots 节
}
```

快照与实验归组只切片、不合并、不去重;合并与聚合永远发生在消费方([Reports](../reports/README.md) 的计算函数,或你自己的脚本),reader 不预设看法。

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
| `unfinished-snapshot` | `Selection` | 选中快照缺 `completedAt`(进程中断,未收尾);已落盘 attempt 照常读出,警告提示集合可能不完整 | `experimentId`, `startedAt`, `dir` |
| `missing-startedAt` | `dedupeAttempts` | 身份键缺 `startedAt`,宁可不去重也不误删 | `experimentId`, `evalId` |

公开面的全集由参考页承载(`pnpm docs:reference` 从 TSDoc 生成),guide 只举例并声明「不止一种」。`missing-startedAt` **不透出到组件数据**(2026-07-10 裁决):`writer.snapshot()` 的 `startedAt` 必填,官方产出与走写入面的转换永不缺,缺失只可能来自携带条目缺锚的极端情况;计算函数「不去重、如实保留重复」即终稿,`dedupeAttempts` 直调时警告随返回值走。

## 身份键与去重

`--resume` 会把上一轮已通过的结果**携带合入**新快照(`RunOptions.priorResults`):这让续跑出来的最新快照天然完整(正好配合 `results.latest()`),代价是同一个 attempt 存在于多份落盘。

**携带条目的落盘与读取面行为**:携带条目在新快照里也是一条 `result.json`,带原条目的 `startedAt`(身份锚)与 `artifactBase`(相对结果根,指向原快照的 attempt 目录),`has*` 真值原样携带——`artifactBase` 就是事实上的「携带」标记,不需要再发明一个。reader 据此定三条:

- **懒加载按候选顺序回退**:先 `result.json` 所在的 attempt 目录,再 `artifactBase` 指向的原快照目录;原快照被清理后如实返回 `null`(「懒加载即存在性判断」不破:盘上确实没有了)。
- **`ref` 指条目所在的落盘**(携带入的新快照):证据身份跟着条目走,artifact 经回退仍可达;view 深链与 `copySnapshots` 的源 artifact 定位用同一套候选顺序。
- **身份键四字段都在数据上**:`experimentId` / `evalId` 是 AttemptHandle 直达字段,`attempt` 序号与 `startedAt` 在 `attempt.result` 上——消费方自己实现去重不缺任何一块。

reader 忠实反映这份重复,不擅自去重;**跨快照聚合前按身份键去重是消费方的义务**:

- 身份键:`(experimentId, evalId, attempt, startedAt)`,重复时保留**最新快照**里的那份(内容相同,取新快照的副本让 ref 落在最新落盘上);
- `startedAt` 缺失时宁可不去重也不误删,并记入 warnings(kind `missing-startedAt`,见警告全集表);
- [Reports 的计算函数](../reports/library.md#数据计算与缓存边界)内置这条;自己写脚本跨快照累计时,要么复用计算函数,要么自己按键去重。

## 按 locator 寻址一个 attempt:`resolveLocator`

`AttemptLocator` 是 attempt 的不透明短标识(`@` + 1 位 scheme 字符 + 7 位 base36 body,如 `@1x7f3q9k`),由 `{experimentId, 快照 startedAt, evalId, attempt}` 这个不可变身份元组确定性派生——不是数组下标,也不编码磁盘路径。用户从 `niceeval show` 的输出、报告或 view 深链里复制到一个 locator,拿它回到库里定位同一个 attempt:

```typescript
import { openResults, resolveLocator, LocatorNotFoundError, MalformedLocatorError } from "niceeval/results";

const results = await openResults(".niceeval");
const attempt = resolveLocator(results, "@1x7f3q9k");   // → AttemptHandle
console.log(attempt.evalId, attempt.result.verdict);
```

`openResults()` 收尾时已经把扫到的全部 attempt 建成 locator 索引,`resolveLocator` 只查这份索引,不碰磁盘。两种失败各自抛一个可分辨的错误,不返回 `null`:输入串本身语法不合法(不是 `@` 开头、body 长度或字符不对)抛 `MalformedLocatorError`;语法合法但索引里没有这个 attempt(结果目录被清理、locator 来自别的项目)抛 `LocatorNotFoundError`——CLI 据此分别给出"这不是一个 locator"与"这个 attempt 不在当前结果里"两种提示。

## 直接吃读取面:一个真实脚本

折叠类的看法(表格、矩阵、成绩单、散点)去用 [Reports](../reports/README.md) 的计算函数;直接吃 reader 服务的是连算法都自定义的场景,比如「每个 agent 的 shell 命令分布直方图」——那是分布,不是折叠:

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

即使在这条最深的路径上,用户也**不碰磁盘布局**——路径拼接、存在性判断、版本过滤、快照定位都被库消化了。Results Format 若演进,全宇宙只有这一个库要改。

## 相关阅读

- [README](README.md) —— 为什么格式与库合一、库的边界、四个消费方。
- [Architecture](architecture.md) —— 磁盘上的格式规范。
- [Reports](../reports/README.md) —— 建立在本库读取面之上的积木:指标、计算函数、React 组件。
- [Experiments](../experiments/README.md) —— experimentId 与可对比组从哪来。
