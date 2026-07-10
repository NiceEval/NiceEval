# Results Lib —— 实验结果数据的读写库(设计提案,未实现)

> 状态:设计已定稿,与 `docs-site/zh/guides/results-data.mdx` 对齐;`src/results/` 里已有一版读取面实现(源码入口见 [Source Map](source-map.md#results-lib-与-reports)),与本文有差距(层次、选择器、`copySnapshots` 等),按本文一次性收敛、不留兼容层。写入面 `createRunWriter` 与 view / `Artifacts()` reporter 的收编仍是提案。[Results Format](results-format.md) 是磁盘上的格式规范(已实现);本文提议把这份格式的**读与写**抽成一个专门的库 `niceeval/results`,做 runner、view、[Reports](reports.md) 和用户脚本的共同数据层。

同一份磁盘格式,今天的写和读长在两个器官里。写在 `src/runner/reporters/artifacts.ts`:时间戳目录、attempt 路径清洗(evalId 保留 `/` 层级、agent/model 非 `[\w.@-]` 全换 `_`)、大字段拆工件、`artifactsDir` / `has*` 回填、空数据不落文件——全是它的私有知识。读长在 `src/view/index.ts`:`readSummary` 的版本判定、`loadSummaries` 的目录扫描、工件路径反拼。两边靠 `src/types.ts` 共享类型,但**布局知识各自实现了一遍**:格式演进要同步改两处,谁漏改谁坏。而用户侧根本没有读取 API,想编程消费只能第三次重写这些知识:

```typescript
// 今天:想比「谁的代码短」,只能手工爬目录
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
- **writer。** 目录创建、快照级元数据、attempt 工件增量落盘、summary 推导收尾(见下)。
- **reader。** `openResults`:目录扫描、版本过滤、懒加载、实验/快照/eval 分层、选择器(见下)。
- **身份。** attempt 身份键与去重规则——读写两侧对「同一个 attempt」的理解必须一致,所以住在这。

它不拥有:「看法」(聚合、指标、组件在 [Reports](reports.md))、渲染(view)、执行(runner)。库位于依赖图最底层,不 import core 的任何其它模块;必要时可以原样提成独立 npm 包(给「只想解析或产出 niceeval 结果的工具」用),但先作为子路径导出,不预设。

四个消费方:

| 消费方 | 用哪面 | 变化 |
|---|---|---|
| runner 的 `Artifacts()` reporter | 写 | 变薄壳:订阅 reporter 事件,转手调 writer,落盘行为不变 |
| `niceeval view` | 读 | `readSummary` / `loadSummaries` 改吃 reader,版本判定与 skipped 姿势顺带统一 |
| [Reports](reports.md) 的计算函数 | 读 | 第二档的全部数据入口 |
| 你的脚本 / 第三方工具 | 读、写、发布 | 读:自定义分析;写:把别家平台的结果转成 niceeval 格式,`niceeval view` 直接能看;发布:`copySnapshots` 瘦身快照进仓库 / CDN——兼容性都由库保证,不用抄格式文档 |

## 写:`createRunWriter`

writer 与 reader 是同一组类型的两半,而且是**字面的**两半:`writeAttempt` 的第一参数就是 reader 的 `attempt.result` 类型(瘦身 `EvalResult`),第二参数就是 reader 懒加载能拿到的那几样工件的类型。早先草案让 `writeAttempt` 吃「大字段内联的完整 EvalResult」——那是另一个类型,「writer 参数 = reader 返回」的编译器背书当场不成立;拆成两个参数后 roundtrip 由签名自己证明,「大字段拆文件、引用填回来」的布局知识仍全部在库内。

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
  startedAt,
});

await snap.writeAttempt(result, {  // result = reader 的 attempt.result 原形状
  events, trace, o11y, diff, sources,   // 全部可选;缺哪样读取面就懒加载出 null
});                                // 拆工件文件、算 artifactsDir(含路径清洗)、
                                   // 回填 has* 引用;空数据不落文件

await writer.finish();             // summary 从已写入的 attempt 推导(计数永远和条目一致),
                                   // 注入 format / schemaVersion / producer;个别推不出的
                                   // 字段走可选参数覆盖,不让调用方手拼整份 summary
```

`writer.snapshot()` 是读取面「一个 run 装多份快照」的镜像:`niceeval exp compare` 整组对照就是一个 run 目录里开多个快照,agent / model / startedAt 这些快照级身份在这里声明一次,不塞进每条 attempt——否则第三方转换器要么漏写要么各条不一致,reader 侧还得猜以谁为准。attempt 工件按完成增量写入(与今天的行为一致):长 run 中途失败,已完成的 attempt 工件仍留在盘上。

## 复制与瘦身:`copySnapshots`

发布场景的第三个原语:把选中的快照按格式感知地复制到另一个目录——只带指定工件、只带选中的 attempt,布局知识不外泄。名字不叫 `copyRun`:本文用一整节教「快照不是 run」,而这个 API 恰恰收快照、产出「装着选中快照的一个 run 目录」——名字再叫 run,刚建立的心智当场自相矛盾。输入收 `Selection` 或手工挑的 `Snapshot[]`,与 Reports 组件的 `data` 函数同一输入约定:

```typescript
import { openResults, copySnapshots } from "niceeval/results";

const results = await openResults(".niceeval");
await copySnapshots(results.latest(), "site/data/run", {
  artifacts: ["sources", "events", "trace"],   // diff 可达百 MB、o11y 查看器不读,发布时常见地不带
});
```

动机来自真实消费者:coding-agent-memory-evals 把最新 run 快照进仓库供静态托管,今天是 40 行手写脚本——按 `summary.json` 的 mtime 挑「最新」(口径还错了:该挑快照,不该挑 run),再按白名单拷贝工件文件(布局知识第三次泄漏)。`copySnapshots` 之后这段只剩上面几行,挑选交给 `results.latest()`(见[静态导出场景](reports.md#dx-模拟))。复制忠实于源:不改内容、不消毒——发布消毒是自由文本的事,归 [Reports 的 `CaseList.data({ redact })`](reports.md#计算函数与数据契约)。

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
exp.evalIds;                   // 历史覆盖过的 eval 并集 —— 残缺检测的依据

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
attempt.result;                // EvalResult 瘦身条目:判决、断言、用量、成本、experiment 元数据
attempt.ref;                   // { run, result }:证据引用(run 目录名 + results 下标),
                               // Reports 的 MetricCell.refs 与 view 深链 #/attempt/... 同一身份
await attempt.events();        // StreamEvent[] | null —— 重工件全部懒加载
await attempt.trace();         // TraceSpan[] | null
await attempt.o11y();          // O11ySummary | null
await attempt.diff();          // DiffData | null(可达百 MB,所以必须懒)
await attempt.sources();       // SourceArtifact[] | null
```

命名约定:`Experiment` / `Snapshot` / `Eval` / `RunDir` 是纯数据,不带 `Handle` 后缀;唯一叫 `AttemptHandle` 的是 attempt——它的方法真的会碰磁盘,后缀标记的就是这件事。`AttemptRef` 的字段名(`run` / `result`)是 view 深链的持久化路由契约,不随句柄改名。

要点:

- **懒加载即存在性判断。** 工件缺失返回 `null`,不抛错。今天 summary 里只有 `hasEvents` / `hasTrace` / `hasSources`,连 `hasO11y` / `hasDiff` 标记都没有——这类不对称全被方法语义吸收,消费方不再碰路径。
- **版本过滤沿用格式规范。** 按 [Results Format 的版本规则](results-format.md#版本与升级设计)判定,不兼容的落盘进 `skipped` 并带 `schemaVersion` 与**完整的** `producer`(name + version),与 [View 的报错与降级](view.md#报错与降级)同一姿势。带完整 producer 是硬要求:`npx niceeval@<version> view` 的提示只对 `producer.name === "niceeval"` 成立,第三方 harness 写的落盘拿它的版本号拼 npx 命令是一句错误提示——只给 `producerVersion` 一个裸版本号,消费方连做对这个分支的信息都没有。能读进来的每个快照带自己的 `producer` / `schemaVersion`,「这份结果是谁、用什么版本写的」不用下钻 summary。
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
}
```

`results.runDirs` 忠实磁盘,快照与实验归组只切片、不合并、不去重;合并与聚合永远发生在消费方([Reports](reports.md) 的计算函数,或你自己的脚本),reader 不预设看法——这条教训来自 view 的 `aggregateRows` 把全部历史揉成一行的现状(见 [View · 已知差异](view.md#已知的文档-vs-实现差异))。

## 选择快照:`results.latest()` 返回 Selection

多数消费场景先回答「现在什么水平」,所以选择器只有一个,长在集合上。返回物是一个 **Selection(选集)**:快照与挑选警告绑在一起走:

```typescript
const latest = results.latest({
  experiments: "compare/",     // 可选:experiment id 前缀过滤,同 CLI 位置参数的前缀匹配机制
});

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

**Selection 是下游的通用输入**:Reports 的计算函数与 `copySnapshots` 都收 `Selection | Snapshot[]`。收 Selection 时 warnings 随行——`RunOverview` 把警告直接渲染在 KPI 条内,「诚实不靠使用者记得渲染」才真正成立(早先草案要求手动把 `warnings` 传进 `overview()`,忘了就静默丢失,承诺不成立);手工挑的 `Snapshot[]` 没有挑选过程,自然没有 warnings 可带,也如实。

## 身份键与去重

`--resume` 会把上一轮已通过的结果**原样合入**新 run 的 summary(`RunOptions.priorResults`):这让续跑出来的最新快照天然完整(正好配合 `results.latest()`),代价是同一个 attempt 存在于多份落盘,而 `EvalResult` 今天没有任何「合入」标记。

reader 忠实反映这份重复,不擅自去重;**跨快照聚合前按身份键去重是消费方的义务**:

- 身份键:`(experimentId, evalId, attempt, startedAt)`,重复时保留最新 run 里的那份;
- `startedAt` 缺失时宁可不去重也不误删,并记入 warnings;
- [Reports 的计算函数](reports.md#计算函数与数据契约)内置这条;自己写脚本跨快照累计时,要么复用计算函数,要么自己按键去重。

更根治的做法是 writer 给合入的结果打标——读写同库之后,这类格式演进只改一处实现,再同步 [Results Format](results-format.md) 规范即可;是否值得为它递增 `schemaVersion`,留给格式规范那边定。

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
      passed: attempt.result.outcome === "passed",
      shellCommands: o11y?.shellCommands.length ?? 0,
    });
  }
}
```

即使在这条最深的路径上,用户也**不碰磁盘布局**——`artifactsDir` 拼接、存在性判断、版本过滤、快照切分都被库消化了。Results Format 若演进,全宇宙只有这一个库要改。

## 相关阅读

- [Results Format](results-format.md) —— 磁盘格式规范;本库是它唯一的官方读写实现,一格式一库,成对演进。
- [Reports](reports.md) —— 建立在本库读取面之上的积木:指标、计算函数、React 组件。
- [View](view.md) —— 内置前端;`readSummary` / `loadSummaries` / skipped 处理是本库 reader 要收编的现状。
- [Experiments](experiments.md) —— experimentId 与可对比组从哪来。
