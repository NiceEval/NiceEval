# Sample —— 库用法

`niceeval/sample` 把一份 [Record](../record/README.md) 选成一批可比较的 attempt,并如实交代这批
数据的覆盖与可靠性。这一层有判断,而且判断全部物化在返回值上。

## 两个选择器

多数消费场景先回答「现在什么水平」。官方口径有两个,区别是要看最新一次 Run 的执行事实,还是看
由可比历史共同形成的当前状态:

```typescript
import { openRecord } from "niceeval/record";
import { latestRunSample, currentSample } from "niceeval/sample";

const record = await openRecord(".niceeval");

const executed = latestRunSample(record, { experiments: "compare/" });
const current = currentSample(record, { experiments: "compare/" });
```

| 选择器 | 单位 | 回答 | 什么时候用 |
|---|---|---|---|
| `latestRunSample` | 每个 Experiment 的最新 Run | 最近一次执行实际产出了什么 | 发布自包含测试集、归档 |
| `currentSample` | Experiment × Eval | 每道题当前可用的判定,可能取自可比旧 Run | 看当前水平、连续开发中对数 |

`niceeval show` / `view` 的默认首页用 `currentSample`;自定义报告要与官方入口对上数字,从它出发。
`experiments` 收 experiment id 前缀(`string | string[]`,与 CLI 位置参数同一套前缀匹配机制)。

**为什么是两个而不是一个。** 位置参数允许只重跑一道题(`niceeval exp midterm algebra/quadratic`
是正常的 debug 姿势)。这时「最近一次 Run」只有一道题,而「每道题当前水位」要跨历史把其余题拼
回来。两种都是正当需求,而且**谁也不能替谁**:发布要的是一次执行的自包含产物,看水位要的是完整
分母。`current` 指观察时刻成立的状态,不等于时间最大的 Run。一道题的判定可能不是这次跑出来的,
而是来自可比的旧 Run。这一步有前提,紧接着一节说清。

### 缝合的前提:configHash 相等

`currentSample` 会从旧 Run 里拼入当前 Run 没跑的题,所以必须先回答「这两个 Run 可比吗」。判据只有
一条:**[`run.configHash`](../record/library.md#confighash配置身份只算一次) 相等**。每个 experiment
以其最新 Run 的 configHash 为基准,只有基准一致的历史 Run 参与该实验的逐题选择。

改过 model、flags 或 sandbox 后只补跑部分 eval 时,旧配置 Run 覆盖的其余题**不冒充**新配置的
水位——它们进入 `coverage.missingEvalIds`,在实验列表上呈现为占位行,下一步就是重跑补全。这条前提
保证一个 experiment 在样本里只对应一套配置,报表把一行标成单一 agent / model / flags 永远不是谎言。

Run 缺 `configHash`(第三方转换器没声明)时只与自己可比,不与任何别的 Run 拼接。

## 一份 Sample 上有什么

```typescript
sample.mode;         // "latest-run" | "current":基础选择方式
sample.fresh;        // boolean:是否只保留相对各 Experiment 锚点的新执行
sample.attempts;     // AttemptHandle[]:按口径挑好的 attempt 全集,已物化
sample.runs;         // Run[]:贡献了至少一条 attempt 的真实 Run,各自保留 diagnostics
sample.coverage;     // SampleCoverage[]:逐实验的覆盖事实
sample.warnings;     // SampleWarning[]:结构化,不是渲染好的文本
sample.pipe(...ops); // 转换,见下
```

**口径是物化的数据,不是隐藏语义。** `mode` 与两个选择函数共享词根:`latestRunSample()` 返回
`"latest-run"`,`currentSample()` 返回 `"current"`。`fresh` 是正交的来源约束,不扩成四种 mode。
`attempts` 是按完整口径挑好的全集;消费它不需要重新展开 `runs`,也不会把同一道题的历史 attempt
重复计入。官方计算函数同样只消费 `attempts`。

`runs` 保留给需要 Run 级信息(配置、producer、目录、diagnostics)的消费方;其中每个成员都是
持久化的真实 Run,Sample 不合成报告专用 Run,attempt 仍以 `attempt.run` 与 `attempt.ref` 指回
来源。`currentSample` 下同一个 experiment 可能有多个贡献 Run(不同 eval 取自不同历史),`runs`
因此不是「每 experiment 一个」,而是「每个真正贡献过至少一条 attempt 的 Run 各一份」。

## 覆盖是逐行的事实

「最新」可能残缺,安静吞下的话下游报表就变成按一道题打分。所以**选择器同样要诚实**:每个实验把
选中口径覆盖的 eval 与该实验已知 eval 并集(`exp.knownEvalIds`,再交命令行范围)对比,结果物化
在 `coverage` 上:

```typescript
sample.coverage[0];
// {
//   experimentId: "midterm/bub-gpt-5.4",
//   knownEvalIds: ["algebra/quadratic", …],   // 分母:本地历史 ∪ Run 携带的 knownEvalIds,交命令行范围
//   missingEvalIds: ["geometry/area", …],     // 当前口径下没有任何 attempt 的题
// }
```

缺的是具体哪几道题,所以呈现在行的位置上:报告把 `missingEvalIds` 渲染成实验列表里的占位行
(「当前配置下无结果」+ 可复制的补跑命令,契约见
[ExperimentList · 占位行](../reports/components/entity-lists/experiment-list.md)),读者在正在看的
表里直接看见分母缺口。程序消费同样直接:CI 里「覆盖缩水就 fail」判
`coverage.some((c) => c.missingEvalIds.length > 0)`。缺口永远被算出来,不静默。

分母随数据走而不是随目录走:`knownEvalIds` 的定义是**并集(本地历史, 各 Run 携带的
knownEvalIds)**,`publish()` 复制时补记这个字段,发布目录因此仍算得出缺口。机制见
[Record · 发布](../record/library.md#发布publish)。

## 时效:新执行与历史执行

样本里每条 attempt 都带完整的时效事实,回答「这个数字是不是最新一次运行实测的」:

- **新执行**:属于该实验在样本中最新 Run、且非携带的 attempt——最新一次运行里真实跑出来的。
- **历史执行**:其余两种出身——携带条目(`attempt.carried === true`,fingerprint 未变、上一轮
  终态合入本 Run),与 `currentSample` 从旧 Run 拼入的 attempt(所属 Run 早于该实验在样本中的
  最新 Run)。

两种历史出身对读者是同一个事实——「这条不是最新一次跑出来的」——报告用同一种时效标注呈现(实体名
后 `↩` + 人话时距,契约见[实体列表 · 时效标注](../reports/components/entity-lists/README.md#时效标注));
机制差异(携带 vs 拼接)只在数据字段上可分辨,供脚本按需区分。

历史执行不是异常:携带是 fingerprint 担保下的正常缓存(「旧但有效」,语义见
[Experiments · 缓存与携带](../experiments/cache.md)),跨 Run 拼接受 configHash 前提保护。所以它不进
warnings——时效是每行数字的出身属性,跟着数字走,不是页面级警告。

**只看新执行:`fresh` 选项。** 两个选择器都接受 `fresh: true`,物化 attempts 时排除全部历史执行:

```typescript
const fresh = currentSample(record, { experiments: "compare/", fresh: true });
fresh.mode;   // "current"
fresh.fresh;  // true
```

分母随之如实缩水:被排除的题按覆盖事实进入 `coverage.missingEvalIds`、在实验列表上呈现为占位行,
不会静默消失。CLI 侧 [`niceeval show --fresh`](../reports/show.md#选择结果范围) /
`niceeval view --fresh` 注入的就是这个口径。

## 转换:`pipe` 与算子闭集

最常见的自定义不是另起口径,而是微调官方口径——「latest 减掉一个已知坏掉的实验」「只留覆盖完整
的实验」。若一次删减就降级成裸 `AttemptHandle[]`,幸存数据本该有的覆盖事实与警告全丢。

```typescript
import { currentSample, dropExperiments, filterAttempts } from "niceeval/sample";

const s = currentSample(record, { experiments: "compare/" }).pipe(
  dropExperiments("compare/known-broken"),
  filterAttempts((attempt) => attempt.result.verdict !== "skipped"),
);
```

`pipe` 收若干算子,逐个应用,返回新 Sample;原样本不被修改。算子是**闭集**,全部是
`Sample → Sample`:

| 算子 | 作用 |
|---|---|
| `filterAttempts(predicate)` | 按 Attempt 谓词删减 |
| `onlyExperiments(...prefixes)` / `dropExperiments(...prefixes)` | 按 experiment id 前缀保留 / 剔除 |
| `onlyEvals(...prefixes)` / `dropEvals(...prefixes)` | 按 eval id 前缀保留 / 剔除 |
| `onlyFreshAttempts()` | 排除历史执行,等价于选择器的 `fresh: true` |

每个算子应用后四个面同步重算,规则统一:

- **`attempts`**:按算子语义删减。
- **`runs`**:不贡献任何 attempt 的 Run 整份移除。
- **`coverage`**:逐 experiment 用**原始 `knownEvalIds`** 与幸存 attempts 重算 `missingEvalIds`
  ——分母不随删减缩水,被删掉的题转入缺口。这是删减与「重新定义总体」的区别:你删的是样本,不是
  总体。
- **`warnings`**:按各自记录的真实 Run 来源同步修剪;非实验作用域的警告保留。

三条边界,都是显式立场:

- **只删减,不聚合。** 值怎么算、两级怎么折叠由 [Reports 的指标](../reports/library/metrics.md)
  回答——它已经有 `perEval` / `acrossEvals` 与维度选轴。同一件事两个地方能做,两边迟早给出不同的
  数。这也是转换算子清单里没有 `groupBy` / `reduce` 的原因。
- **只删减,不替换。** 「换成该实验上一个完整 Run」这类**替换式**重挑不给算子(那是 DSL 的开端)。
  回 `exp.runs` 自己挑,挑出来的裸数组没有挑选过程、没有 coverage 也没有 warnings,也如实。
- **`filterAttempts` 是唯一的函数出口。** 其余算子全部是可序列化的声明,一条 pipe 里除了它以外
  没有用户代码——这让 pipe 可以被记录、比较与缓存。这条纪律学自 Vega-Lite,见
  [参考方案](reference/README.md)。

## 去重:身份键与最新落盘

携带让同一个 attempt 存在于多份落盘。[Record 忠实反映这份重复](../record/library.md#身份键),
**跨 Run 聚合前的去重在这一层**:

- 身份键 `(experimentId, evalId, attempt, startedAt)`,重复时保留**最新 Run** 里的那份(内容
  相同,取新 Run 的副本让 ref 落在最新落盘上);
- `startedAt` 缺失时宁可不去重也不误删,并记入 warnings(kind `missing-startedAt`)。

两个选择器都已内置这一条,`sample.attempts` 拿到手就是去重后的。直接读取 Record 的脚本若要实现
其它口径,四个身份字段都在数据上;去重步骤不是独立公开 API。

## 警告 kind 全集

warnings 只收**定位不到任何一行**的完整性事实;能定位到行的事实各归其位——覆盖缺口是 `coverage`
数据与实验列表占位行,携带与跨 Run 拼接是 attempt 的时效属性,都不是警告。新增 kind 前先自问:这个
事实能不能落到某一行上?能就放到行上,不进这张表。

每种警告都带 `kind`、可判断的结构化字段和渲染好的英文 `message`;message 以「下一步」列声明的
动作收尾([三段式契约](../../error-feedback.md#消息三段式)),能用一条命令推进的 kind 同时带
`command`(已替换真实 id,复制即跑)。kind 同批登记**徽标 / 组头模板**,供
[`SampleWarnings`](../reports/components/site/sample-warnings.md) 组件聚合呈现:模板是 en 文案、
占位符取结构化字段,zh 等 locale 由组件 chrome 词典对应,`message` 不经模板、始终是完整叙述的
单源。新增 kind 要回这张表登记:

| kind | 触发 | 结构化字段 | 徽标 / 组头模板 | 下一步 |
|---|---|---|---|---|
| `unfinished-run` | 选中 Run 缺 `completedAt`(进程中断,未收尾);已落盘 attempt 照常读出,警告提示集合可能不完整 | `experimentId`, `startedAt`, `dir` | 徽标 `unfinished` | 重跑该实验产出收尾完整的 Run;`command` = `niceeval exp <experimentId>` |
| `dangling-evidence` | 样本里有 attempt 的 [`evidenceState`](../record/library.md#携带条目与-evidencestate) 为 `"dangling"`——携带条目指向的原 Run 已被清理,`artifacts` 声明写过的文件读不到了 | `experimentId`, `evalId`, `attempt`, `artifactBase`, `artifacts` | 组头 `{n} attempts lost evidence` | 判定仍可信,证据不可下钻;下次清理历史前先 `publish()` 物化。无单条命令,不带 `command` |
| `unreadable-run` | 扫描记录根遇到不可读 Run——schema 不兼容、JSON 损坏 / 必需字段错误(malformed)、attempt 已写入但缺 `run.json`(incomplete);该 Run 被跳过,不挡其余结果(非 niceeval JSON 静默忽略,不触发) | `dir`, `reason` | 组头 `{n} runs skipped`(非实验作用域,按 kind 聚合) | schema 不兼容时建议用产出它的版本打开,`command` = `npx niceeval@<producer.version> show --results <root>`;其余 reason 给出定位动作,不带 `command`。非实验作用域,pipe 修剪时保留 |
| `missing-startedAt` | 去重时身份键缺 `startedAt`,宁可不去重也不误删 | `experimentId`, `evalId` | — | 定位动作:核对产出该条目的写入方(第三方 harness)是否写 `startedAt`;无单条命令,不带 `command` |

公开面的全集由参考页承载(`pnpm docs:reference` 从 TSDoc 生成),guide 只举例并声明「不止一种」。
`missing-startedAt` **不透出到组件数据**:`writer.run()` 的 `startedAt` 必填,官方产出与走写入面
的转换永不缺,缺失只可能来自携带条目缺锚的极端情况;计算函数对这类条目不去重、如实保留重复,
选择器则把警告随 Sample 返回。

警告的呈现件是 [`SampleWarnings` 组件](../reports/components/site/sample-warnings.md)——内建报告
每页都放它,自定义报告与自有 React 页面同样显式摆放(React 页面用 data 形态传 `sample.warnings`),
警告可见性是作者义务。指标与摘要数据不复制警告,同一份事实不会因放了 `SampleSummary` 而重复。
手工挑的 `Run[]` 没有挑选过程,自然没有 coverage 与 warnings 可带,也如实。

## 相关阅读

- [README](README.md) —— 为什么选择独立成一层。
- [参考方案](reference/README.md) —— 转换算子与口径物化从哪里学。
- [用例手册](use-case/README.md) —— 局部补跑之后两个口径分别给出什么。
- [Record](../record/library.md) —— 被选择的那份事实与身份键。
- [Reports](../reports/library.md) —— 消费 Sample 的指标与组件。
