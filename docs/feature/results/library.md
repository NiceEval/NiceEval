# Results —— 库用法

这是磁盘快照格式的 TS 读写 API(`niceeval/results`);为什么格式与库合一见 [README](README.md),磁盘上的格式规范见 [Architecture](architecture.md)。

## 写:`createResultsWriter`

writer 与 reader 是同一组类型的两半,而且是**字面的**两半:reader 的 `attempt.result`(瘦身 `EvalResult`)由两部分拼成——快照级字段(experimentId / agent / model / startedAt / 实验运行配置 / producer)来自 `writer.snapshot()` 的一次声明,是快照层注入的装饰;其余全部字段就是 `writeAttempt` 第一参数的类型。第二参数是 reader 懒加载能拿到的那几样 artifact 的类型。**「writeAttempt 参数 + snapshot() 声明 = reader 读回的全部,由类型拼合背书」**:快照级字段不在 attempt 参数类型里,不存在「谁的值为准」的运行时问题。这个拼合形状不可替换:「大字段内联的完整 EvalResult」是另一个类型,编译器背书当场不成立;「第一参 = 完整的 attempt.result」含 experiment 元数据,与「快照级只声明一次」互相矛盾。「大字段拆文件、判决落 attempt 记录」的布局知识全部在库内。EvalResult 的「瘦身条目 + 拆出的 artifact」两拆,与 Reports 侧读到的形状是同一件事。

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
});                                   // 空数据不落文件;events / trace 里的超大字符串在这里截断

await writer.finish();                // 给每个快照补 completedAt(声明里给过就用声明值);
                                      // 除此之外没有收尾聚合 —— 计数、用量、成本由 reader 逐条推导
```

`writer.snapshot()` 是读取面「实验 → 快照」层次的镜像:experimentId / agent / model / startedAt 这些快照级身份在这里声明一次,不塞进每条 attempt——否则第三方转换器要么漏写要么各条不一致,reader 侧还得猜以谁为准(类型上由 `writeAttempt` 参数的 `Omit` 保证,见上)。快照级可选项还包括 `experiment`(实验运行配置 `ExperimentRunInfo`:flags / runs / earlyExit / sandbox / timeoutMs / budget)、`knownEvalIds`(该实验已知的 eval 并集,残缺检测的分母,见 `copySnapshots` 节)、`completedAt`(转换历史数据时如实交代收尾时刻)与 `name`(项目名,view hero 显示)。

**每个文件恰好写入一次**是写入面的核心承诺:`snapshot.json` 开跑即写、收尾只补 `completedAt`;`result.json` 与 artifact 随 attempt 完成落盘。进程中断只丢未完成的 attempt;并发进程各写各的快照目录,互不触碰(唯一性由独占创建保证,见 [Architecture](architecture.md#目录结构))。

**超大字符串在这里截断,而且只在这里。** `writeAttempt` 是全仓库唯一的截断落点:`events` 与 `trace` 里的字符串值超过 256 KiB 就截断并打 `truncated` 标记,`sources` / `diff` / `o11y` 原样落盘。调用方——包括第三方转换器——传进来的永远是完整数据,不需要自己先削一遍;断言与 `o11y` 派生统计跑在完整值上,截断不影响判决。完整规则、marker 形状与两条「明确不做」见 [Architecture · 大值截断](architecture.md#大值截断)。

## 复制与瘦身:`copySnapshots`

发布场景的第三个原语:把选中的快照按格式感知地复制到另一个目录——只带指定 artifact、只带选中的 attempt,布局知识不外泄。输入收 `Scope` 或手工挑的 `Snapshot[]`,产出一个**结果根目录**(实验目录在外层的同一布局,`openResults` 直接能开);与 Reports 组件的 `data` 函数同一输入约定:

```typescript
import { openResults, copySnapshots } from "niceeval/results";

const results = await openResults(".niceeval");
await copySnapshots(results.latest(), "site/data/run", {
  artifacts: ["sources", "events", "trace", "o11y", "agentSetup"],   // diff 不截断,缺省也不带
});   // 所有待发布文件还会经过 50 MiB 单文件预检
```

`o11y` 在缺省携带之列。「查看器不读所以不带」是循环论证——因为没消费者所以不带,因为不带所以做不了消费它的内置指标;`assistantTurns`(见 [Reports 的内置指标](../reports/library/metrics.md#内置指标))就是它的消费者,且 `o11y.json` 实测几 KB 一个,没有不带的理由。

逐值[截断](architecture.md#大值截断)与整文件发布预算解决不同问题:`events` / `trace` 的 256 KiB 上限会切断一条失控工具输出被重复落盘的常见爆炸链,但一个文件可以含很多正常值,不能据此宣称文件大小有界。`diff`、源码 blob 与历史版本的 events / trace 也可能超过 Git host 的单文件限制。因此 `.niceeval/` 是本地事实根,不是默认可提交目录;进 Git / 静态托管的结果集先经过 `copySnapshots`。

动机来自真实消费者:coding-agent-memory-evals 把最新快照进仓库供静态托管——没有这个原语,消费方只能手写几十行脚本:按落盘 mtime 挑「最新」(口径还是错的:该挑快照),再按白名单拷贝 artifact 文件(布局知识泄漏)。`copySnapshots` 把这段收敛成上面几行,挑选交给 `results.latest()`(见[静态导出](../reports/view.md#静态导出))。

结果数据分**两类**:`.niceeval/` 是**本地事实根**——prompt、工具参数、完整输出、源码全在里面,不是默认可提交目录;任何要离开本机的拷贝是**发布拷贝**,经 `copySnapshots` 这一条管线产出(`niceeval view --out` 的 artifact 复制走同一管线)。没有更细的档位:体积取舍由 `artifacts` 字段声明,导出层不再裁剪。发布内容的保密边界由格式在**采集侧**划定,不在发布侧设关卡:运行环境注入的秘密不落盘——时间树的命令证据只保存有界脱敏摘要,env 值与命令 stdout/stderr 不进入 `result.json`([Architecture · `result.json`](architecture.md#resultjson));artifact 里剩下的就是 eval 任务与 agent transcript 本身,内容是否适合公开由构建发布根的作者判断。复制忠实于源:artifact 原字节复制,不重新序列化、不改写。契约细节:

- **覆盖事实随数据走(`knownEvalIds`)。** `partial-coverage` 的分母是实验的历史并集,而发布目录没有历史——只复制选中快照,发布目录上重新 `openResults().latest()`,警告会静默消失,「缺口永远被算出来」在官方教的发布路径上断掉。解法不是持久化警告(那违反「reader 派生物删了可重算」),而是让警告的**依据**随数据走:`copySnapshots` 给每个复制出的快照补记 `knownEvalIds`(复制时刻该实验的 `exp.evalIds`);reader 端 `exp.evalIds` 的定义是**并集(本地历史, 各快照携带的 knownEvalIds)**——不是「优先字段」:把快照复制进已有历史的目录时,本地并集可能更大,优先字段会让分母缩水。字段是格式的一部分,`writer.snapshot()` 同样可声明(第三方转换器交代已知覆盖);可选新增字段不破坏兼容,按 [Architecture · 版本与升级设计](architecture.md#版本与升级设计)不递增 schemaVersion。「复制忠实于源」的精确含义:不改 artifact 内容,但随行补记挑选时的覆盖事实(落在复制出的 `snapshot.json` 上)。
- **目标目录非空即报错**,不静默覆盖、不合并——发布脚本要幂等就自己先清目录;盘上不该出现「我没写的东西被动过」的惊讶。
- **发布前整文件预检。** `copySnapshots` 在创建目标目录前先规划并序列化全部目标文件;任一文件超过固定的 `PUBLISH_FILE_MAX_BYTES = 50 * 1024 * 1024` 就整体失败,错误列出源路径、实际字节数与处理动作(从 `artifacts` 排除该类证据,或用当前 writer 重新生成历史 events / trace)。不自动删半个 artifact,也不留下半成品目标目录。50 MiB 为 GitHub 的 100 MB 单文件硬限保留余量,同时覆盖其它常见 Git host;它不是可调旋钮,避免发布脚本把保护调没。
- **`artifacts` 合法值全集** `"events" | "trace" | "o11y" | "agentSetup" | "diff" | "sources"`;缺省带 `events` / `trace` / `o11y` / `agentSetup` / `sources`,不带 `diff`。显式带 `diff` 仍受同一发布预算约束。

## 读:`openResults`

两条设计决策。**层次跟使用者的心智走**(「所有实验 → 单次跑的实验 → 每道题」)——磁盘布局与这个心智同构(实验目录在外层),reader 的分层就是目录树的类型化投影;producer / schemaVersion 是快照自己的字段。**「results」一个词不在层级里重复**:分层把它拆成 `experiments` / `snapshots` / `attempt.result` 各归其位;入口不叫 `openExperiments`——模块叫 `niceeval/results`,返回物上除了 `experiments` 还有 `skipped` / `latest()`,示例里的变量名怎么写都是 `results`,入口叫 experiments 只会让三者失配。API 如下:

```typescript
import { openResults } from "niceeval/results";

const results = await openResults(".niceeval");

results.experiments;           // Experiment[]:每个实验一项,挂着自己的全部历史(id 字典序)
results.skipped;               // 读不了的落盘:{ dir, reason, schemaVersion?, producer?, detail? }[](detail 是 malformed 的一句英文诊断)

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
await attempt.events();        // StreamEvent[] | null —— 重 artifact 全部懒加载;超大字符串带 truncated 标记
await attempt.trace();         // TraceSpan[] | null(同上,span 属性同样受 256 KiB 值上限约束)
await attempt.o11y();          // O11ySummary | null
await attempt.agentSetup();    // AgentSetupManifest | null
await attempt.diff();          // DiffData | null(不截断,可达百 MB,所以必须懒)
await attempt.sources();       // SourceArtifact[] | null
```

命名约定:`Experiment` / `Snapshot` / `Eval` 是纯数据,不带 `Handle` 后缀;唯一叫 `AttemptHandle` 的是 attempt——它的方法真的会碰磁盘,后缀标记的就是这件事。`AttemptRef` 的字段名(`snapshot` / `attempt`)是 view 深链 `#/attempt/<snapshot>/<attempt>` 的持久化路由契约,不随句柄改名;`snapshot` 恒为两段(`<实验目录>/<快照目录>`),`attempt` 是 `<evalId 路径>/a<n>`,路由按「前两段 = 快照」解析。

要点:

- **懒加载即存在性判断。** artifact 缺失返回 `null`,不抛错。`result.json` 里只有 `hasEvents` / `hasTrace` / `hasSources`,连 `hasO11y` / `hasDiff` 标记都没有——这类不对称全被方法语义吸收,消费方不再碰路径。
- **截断是磁盘上的事实,读取面不参与。** reader 原样读出被截断的值(含 marker 与 `truncated` 字段),既不重新截断,也变不回完整值——完整值只在写入那次运行的内存里存在过。要在 UI 上如实说「这里少了东西」,读 `truncated`。
- **版本过滤沿用格式规范。** 按 [Architecture · 版本与升级设计](architecture.md#版本与升级设计)判定,不兼容的落盘进 `skipped` 并带 `schemaVersion` 与完整的 `producer`(name + version),供 [View](../reports/view.md#结果版本与错误) 和其它调用方生成正确的版本建议。只有 `producer.name === "niceeval"` 时才能拼 `npx niceeval@<version>`；第三方 producer 保留自己的名字与版本。历史 run 级 `summary.json` 可被识别为不兼容结果,但不会被迁移。每个可读快照也直接暴露自己的 `producer` / `schemaVersion`。
- **`skipped` 的第三种原因:`"incomplete"`。** 有 attempt 落盘、没有 `snapshot.json` 的目录——只可能出现在「快照目录建好、元数据还没写完」的极小窗口里进程死亡,或人为删文件。与 `"malformed"`(元数据是坏 JSON)区分开,诊断动作完全不同。进程中断的常态是**未收尾快照**(`snapshot.json` 在、缺 `completedAt`):判决与 artifact 同级落盘、随 attempt 完成即写,中断只丢未完成的 attempt,已完成的照常读出——`latest()` 对选中的未收尾快照给结构化警告(见警告全集表),不是数据黑洞。
- **分组是切片,不是看法。** 实验归组、eval 分组都是确定性切片(不合并、不聚合、不去重),与「忠实磁盘」不冲突;有看法的合并聚合仍然全部在消费方。
- **同一进程内按 handle 记忆化。** 两个都要读 diff 的消费方不会把「可达百 MB」的 `diff.json` 读两遍;扫全部历史仍然可能慢,但要慢得线性、可预期。
- **只读不写事实。** reader 的一切派生物删了随时可重算;唯一事实来源仍是磁盘上的 Results Format。

### 例:读 agent diff 做跨 attempt 分析

`attempt.diff()` 返回的 `DiffData` 就是 [agent 归因增量](../sandbox/architecture.md#变更归因send-窗口与分类账)(形状见 [Architecture · diff.json](architecture.md#diffjson)):只有 agent 改动的文件,fixture 与校验材料已经天然不在里面,分析脚本不需要任何过滤白名单。比如回答「agent 最常动哪些文件、动了多少行」:

```typescript
import { openResults } from "niceeval/results";

const results = await openResults(".niceeval");
const current = results.current({ experiments: "compare/" });

const touched = new Map<string, { attempts: number; lines: number }>();
for (const snap of current.snapshots) {
  for (const attempt of snap.attempts) {
    const diff = await attempt.diff();                    // DiffData | null,懒加载
    if (!diff) continue;                                  // remote agent / 发布时未带 diff
    for (const path of Object.keys(diff.files)) {
      const entry = touched.get(path) ?? { attempts: 0, lines: 0 };
      entry.attempts += 1;
      entry.lines += (diff.get(path) ?? "").split("\n").length;
      touched.set(path, entry);
    }
  }
}
console.table([...touched.entries()].sort((a, b) => b[1].attempts - a[1].attempts).slice(0, 10));
```

`diff.files[path].windows`(如 `["turn1", "turn2"]`)进一步回答「第几轮改的」,`diff.windows` 保有逐窗口的完整 before/after——与 `show --timing` 的 turn 节点、`--execution` 的轮次同一套标签,可以把「改动发生在哪轮」与「那轮说了什么、调了什么工具」对上。要把这类分析做成可复用报告,写成[自定义指标](../reports/library/metrics.md#自定义指标)交给报告组件聚合;一次性核对用 [`show --diff`](../reports/show/diff.md)。

## 快照:experiment × 一次运行

**快照 = 单次跑的实验**,物理上就是一个快照目录(`.niceeval/<experiment>/<timestamp>-<suffix>/`),与 [View 增强 · Compare 计划](../../roadmap/view-enhancements.md#compare-挑两次运行对比) 的 `(experimentId, startedAt)` 同一口径。「每个 experiment 最新一次」天然是快照粒度:周一跑了整组 compare,周二只重跑 `compare/bub-gpt-5.4`,bub 的最新快照在周二,codex 的还在周一——`niceeval exp compare` 一次 CLI 调用会同时开多个快照目录(每实验一个),但它们各自独立,没有跨实验的聚合落盘。

```typescript
interface Snapshot {
  experimentId: string;        // 权威身份(snapshot.json 字段;目录名只是它的清洗投影)
  startedAt: string;
  completedAt?: string;        // 缺失 = 未收尾(进程中断)
  agent: string;
  model?: string;
  name?: LocalizedText;        // 项目显示名;Reports 外壳标题的零配置兜底
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

## 选择快照:`results.latest()` 返回 Scope

多数消费场景先回答「现在什么水平」,所以选择器只有一个,长在集合上。返回物是一个 **Scope(范围)**:快照与挑选警告绑在一起走:

```typescript
const latest = results.latest({
  experiments: "compare/",     // 可选:experiment id 前缀过滤(string | string[],与 CLI 位置参数
});                            // 可给多个前缀对齐),同一套前缀匹配机制

latest.mode;                   // "latest-snapshots":这份 Scope 的口径,字面写在数据上
latest.snapshots;              // Snapshot[]:每个实验最新一次
latest.attempts;               // AttemptHandle[]:选中口径下的 attempt 全集,已物化——自定义脚本直接用它,
                               // 不需要自己 flatten snapshots,也就不可能算错口径
latest.warnings;               // ScopeWarning[]:结构化,不是渲染好的文本
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
//   command: "niceeval exp midterm/bub-gpt-5.4",
// }
```

结构化是给程序判断的(CI 里「覆盖缩水就 fail」直接比 `covered < total`),`message` 是渲染好的英文句子,以下一步收尾,要展示就原样打——用户读完不用再查「这条警告怎么办」;能用一条命令直接推进的警告同时带 `command`(已替换真实 id,复制即跑),web 渲染面把它呈现为可复制动作,程序消费方直接取用、不从 message 里正则抠命令。报错必带下一步是全仓库统一契约,见[错误与警告反馈](../../error-feedback.md)。warnings 不是普通字符串数组——「渲染与否在消费方」的承诺只对可判断的数据成立,只给文本等于逼消费方正则解析。渲染与否在消费方,但缺口永远被算出来,不静默。

**Scope 有且只有一个方法:`filter(predicate)`。** 最常见的自定义不是另起口径,而是微调官方口径——「latest 减掉一个已知坏掉的实验」「排除 partial 的快照」。若一 `.filter()` 就降级成裸 `Snapshot[]`,幸存快照本该有的警告全丢。`scope.filter((s) => …)` 返回新 Scope:快照删减,warnings 按规则修剪——**experimentId 不在幸存快照中的警告丢弃,非实验作用域的警告保留**(为将来非 per-experiment 的 kind 留位置)。边界同样明确:`filter` 只做删减;「换成该实验上一个完整快照」这类**替换式**重挑不给方法(那才是 DSL 的开端),回 `exp.snapshots` 自己挑,挑出来的裸数组没有挑选过程、没有 warnings,也如实——这是显式立场,不是漏做。

**Scope 是下游的通用输入**:Reports 的计算函数与 `copySnapshots` 都收 `Scope | readonly Snapshot[]`。收 Scope 时 warnings 始终保留在 Scope 上；呈现件是 [`ScopeWarnings` 组件](../reports/library/site-components.md#scopewarnings)——内建报告每页都放它,自定义报告与自有 React 页面同样显式摆放（React 页面用 data 形态传 `scope.warnings`），警告可见性是作者义务。指标与摘要数据不复制警告,同一份事实不会因放了 `ScopeSummary` 而重复。手工挑的 `Snapshot[]` 没有挑选过程,自然没有 warnings 可带,也如实。

### 警告 kind 全集

每种警告都带 `kind`、可判断的结构化字段和渲染好的英文 `message`;message 以「下一步」列声明的动作收尾([三段式契约](../../error-feedback.md#消息三段式)),能用一条命令推进的 kind 同时带 `command`。kind 同批登记**类别**与**徽标 / 组头模板**,供 [`ScopeWarnings`](../reports/library/site-components.md#scopewarnings) 组件排序与聚合呈现:类别只有两档——`integrity`(选中集合的分母可能不对:缺题、未收尾、被跳过)与 `freshness`(数字对但可能过期,带并列忽略条件);模板是 en 文案、占位符取结构化字段,zh 等 locale 由组件 chrome 词典对应,`message` 不经模板、始终是完整叙述的单源。kind 与它的类别、模板、下一步都是契约的一部分,新增 kind 要回这张表登记:

| kind | 归属 | 类别 | 触发 | 结构化字段 | 徽标 / 组头模板 | 下一步 |
|---|---|---|---|---|---|---|
| `partial-coverage` | `Scope` | `integrity` | 选中快照的覆盖 < 该实验已知 eval 并集(本地历史 ∪ knownEvalIds,再交命令行范围) | `experimentId`, `covered`, `total` | 徽标 `coverage {covered}/{total}` | 重跑该实验补全快照;`command` = `niceeval exp <experimentId>` |
| `stale-snapshot` | `Scope` | `freshness` | 该实验选中的快照早于 Scope 中最新的落盘——无阈值,如实触发,要阈值消费方按字段自比;`message` 带人话时距("predates latest run by 2 days") | `experimentId`, `startedAt`, `latestStartedAt` | 徽标 `{gap} behind`,`{gap}` 与 message 同源的人话时距 | 重跑该实验与最新落盘对齐,`command` = `niceeval exp <experimentId>`;并列忽略条件——两次跑之间 eval / agent / 模型都没改时数字仍可比,可以不管 |
| `unfinished-snapshot` | `Scope` | `integrity` | 选中快照缺 `completedAt`(进程中断,未收尾);已落盘 attempt 照常读出,警告提示集合可能不完整 | `experimentId`, `startedAt`, `dir` | 徽标 `unfinished` | 重跑该实验产出收尾完整的快照;`command` = `niceeval exp <experimentId>` |
| `missing-startedAt` | `dedupeAttempts` | —(不透出组件数据,见下) | 身份键缺 `startedAt`,宁可不去重也不误删 | `experimentId`, `evalId` | — | 定位动作:核对产出该条目的写入方(第三方 harness)是否写 `startedAt`;无单条命令,不带 `command` |
| `unreadable-snapshot` | `Scope` | `integrity` | 扫描结果根遇到不可读快照——schema 不兼容、JSON 损坏 / 必需字段错误(malformed)、attempt 已写入但缺 `snapshot.json`(incomplete);该快照被跳过,不挡其余结果(非 niceeval JSON 静默忽略,不触发) | `dir`, `reason` | 组头 `{n} snapshots skipped`(非实验作用域,按 kind 聚合) | schema 不兼容时建议用产出它的版本打开,`command` = `npx niceeval@<producer.version> show --results <root>`;其余 reason 给出定位动作,不带 `command`。非实验作用域,`filter` 修剪时保留 |

公开面的全集由参考页承载(`pnpm docs:reference` 从 TSDoc 生成),guide 只举例并声明「不止一种」。`missing-startedAt` **不透出到组件数据**:`writer.snapshot()` 的 `startedAt` 必填,官方产出与走写入面的转换永不缺,缺失只可能来自携带条目缺锚的极端情况;计算函数对这类条目不去重、如实保留重复,`dedupeAttempts` 直调时警告随返回值走。

## 官方现刻水位:results.current()

`latest()` 以**快照**为单位,是发布与归档的口径。回答「现在什么水平」还有一个更细的官方口径:**每个 experiment × eval 取「包含该 eval 的最新快照」里的全部 attempt**,跨历史拼出当前判定水位。`niceeval show` / `view` 的默认首页用的就是它(见 [Reports · Scope 是计算入口](../reports/architecture.md#scope-是计算入口)),自定义报告要与官方入口对上数字,也从 `current()` 出发:

**跨快照拼接有可比性前提**:每个 experiment 以其最新快照的**可比性配置**为基准,只有可比性配置与基准一致的历史快照才参与该实验的逐题选择。可比性配置指会改变单题被测行为或判定的字段——`agent`、`model` 与 `ExperimentRunInfo` 里的 `reasoningEffort`、`flags`、`budget`、`timeoutMs`、`sandbox`;`runs`、`earlyExit`、`maxConcurrency`、`selectedEvalIds`、`evalFilterFingerprint`、`description` 是编排与选题字段,`labels` 是报告元数据,都不参与比较([字段全集](architecture.md#snapshotjson)新增公开配置字段时同批声明归属哪一类)。改过 model、flags 或 sandbox 后只补跑部分 eval 时,旧配置快照覆盖的其余题**不冒充**新配置的水位——它们按既有 `partial-coverage` 如实告警,下一步就是重跑补全。这条前提保证 `current()` 产出的每个 experiment 只对应一套配置,报表把一行标成单一 agent / model / flags 永远不是谎言。

```typescript
const current = results.current({ experiments: "compare/" });   // 前缀过滤与 latest() 同一套

current.mode;        // "current-evals"
current.snapshots;   // 贡献了至少一道题当前判定的快照集
current.attempts;    // 已按口径物化:每 experiment × eval 只含「包含该 eval 的最新快照」里的 attempt
current.warnings;    // 同一套 ScopeWarning
```

**Scope 的口径不是隐藏语义,是物化的数据**:`mode` 字面声明口径,`attempts` 是按口径挑好的 attempt 全集——自定义脚本消费 `attempts` 就自动正确,不需要知道两种口径怎么展开,也不可能因为自己 flatten `snapshots` 而把旧快照里同一道题的历史 attempt 重复计入。官方计算函数同样只消费 `attempts`。`snapshots` 保留给需要快照级信息(配置、producer、目录)的消费方;`filter(predicate)` 仍按快照删减,`attempts` 与 warnings 随之同步修剪。警告全集同样适用:旧快照的贡献触发 `stale-snapshot`,「水位里混着旧结果」永远可见;并集中某道题在全部历史里都没有 attempt 时照常触发 `partial-coverage`。

自动携带(见下节)让常态下两个口径重合——最新快照本来就完整;`current()` 保证在携带缺席时(局部 `--force` 重跑、errored 不携带)口径依然诚实,不把报表分母缩成刚重跑的那几道题。选哪个:对外发布自包含数据集用 `latest()` + `copySnapshots`;看当前水平、连续开发中对数用 `current()`。

## 身份键与去重

运行器默认把上一轮 fingerprint 匹配、判定为终态(passed / failed)的结果**携带合入**新快照(`RunOptions.priorResults`;CLI 侧 `--force` 关闭携带全部重跑,见 [Runner · 缓存](../../runner.md#缓存指纹去重)):这让每次跑出来的最新快照天然完整(正好配合 `results.latest()`),代价是同一个 attempt 存在于多份落盘。

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
- [Experiments](../experiments/README.md) —— experimentId 与 `selectedEvalIds` 从哪来。
