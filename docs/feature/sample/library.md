# Sample —— 库用法

`niceeval/sample` 把一份 [Record](../record/README.md) 选成一批可比较的 attempt,并如实交代这批数据的覆盖与可靠性。
这一层有判断,而且判断全部写在返回值上。

## 两个选择器

多数消费场景先回答「现在什么水平」。
官方口径有两个,区别是要看最新一次 Run 的执行事实,还是看由可比历史共同形成的当前状态:

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

**为什么是两个而不是一个。**
位置参数允许只重跑一道题(`niceeval exp midterm algebra/quadratic` 是正常的 debug 姿势)。
这时「最近一次 Run」只有一道题,而「每道题当前结果集」要跨历史把其余题拼回来。
两种都是正当需求,而且**谁也不能替谁**:发布要的是一次执行的自包含产物,看结果集要的是完整分母。
`current` 指观察时刻成立的状态,不等于时间最大的 Run。
一道题的判定可能不是这次跑出来的,而是来自可比的旧 Run。
这一步有前提,紧接着一节说清。

### 缝合的前提:configHash 相等

`currentSample` 会从旧 Run 里拼入当前 Run 没跑的题,所以必须先回答「这两个 Run 可比吗」。
判据只有一条:**[`run.configHash`](../record/library.md#confighash配置身份只算一次) 相等**。
每个 experiment 以其最新 Run 的 configHash 为基准,只有基准一致的历史 Run 参与该实验的逐题选择。

改过 model、flags 或 sandbox 后只补跑部分 eval 时,旧配置 Run 覆盖的其余题**不冒充**新配置的结果集——它们进入 `coverage.missingEvalIds`,在实验列表上呈现为占位行,下一步就是重跑补全。
这条前提保证一个 experiment 在样本里只对应一套配置,报表把一行标成单一 agent / model / flags 永远不是谎言。

`run.configHash` 是 Record 层已经解析过的值:niceeval 自己的写入面按规划期算出的配置身份声明它。
声明缺失时,Record 层按该快照全部 attempt 的 `result.configHash` 回退推导(见 [Record · configHash](../record/library.md#confighash配置身份只算一次))。
Sample 层只读这个已解析值,不重新推导,也不关心它是声明来的还是推导来的。
仍然缺失时(第三方转换器未声明,且推导不出唯一值)这份 Run 只与自己可比,不与任何别的 Run 拼接。

## 一份 Sample 上有什么

```typescript
sample.mode;         // "latest-run" | "current":基础选择方式
sample.fresh;        // boolean:是否只保留相对各 Experiment 锚点的新执行
sample.attempts;     // AttemptHandle[]:按口径挑好的 attempt 全集
sample.historyAttempts; // AttemptHandle[]:同一总体内全部去重历史,供历史读数使用
sample.runs;         // Run[]:贡献了至少一条 attempt 的真实 Run,各自保留 diagnostics
sample.coverage;     // SampleCoverage[]:逐实验的覆盖事实
sample.issues;       // SampleIssue[]:读取/选择派生,不写入 .niceeval
sample.scope({ experiments, evals }); // 重新定义总体
sample.filter(predicate);             // 删观测,不改变总体
```

**口径写在返回值里,不是隐藏语义。**
`mode` 与两个选择函数共享词根:`latestRunSample()` 返回 `"latest-run"`,`currentSample()` 返回 `"current"`。
`fresh` 是正交的来源约束,不扩成四种 mode。
`attempts` 是按完整口径挑好的全集;消费它不需要重新展开 `runs`,也不会把同一道题的历史 attempt 重复计入。
官方计算函数同样只消费 `attempts`。

`historyAttempts` 是同一 experiment / eval 总体内的全部物理历史,同样先按稳定身份去重。
它不受 `current` 的 configHash 缝合或 `fresh` 约束;趋势、稳定性等历史读数只从这里取数,因而不需要拿 `Record` 或直接传入的 `Run[]` 建立旁路。
`scope()` 同时收窄 `attempts` 与 `historyAttempts`,数据质量 `filter()` 也同时排除两边的同一类坏数据。

`runs` 保留给需要 Run 级信息(配置、producer、目录、diagnostics)的消费方;其中每个成员都是持久化的真实 Run,Sample 不合成报告专用 Run,attempt 仍以 `attempt.run` 与 `attempt.ref` 指回来源。
`currentSample` 下同一个 experiment 可能有多个贡献 Run(不同 eval 取自不同历史),`runs` 因此不是「每 experiment 一个」,而是「每个真正贡献过至少一条 attempt 的 Run 各一份」。

## 覆盖是逐行的事实

「最新」可能残缺,安静吞下的话下游报表就变成按一道题打分。
所以**选择器同样要诚实**:每个实验把选中口径覆盖的 eval 与该实验已知 eval 并集(`exp.knownEvalIds`,再交命令行范围)对比,并把差集写入 `coverage`:

```typescript
sample.coverage[0];
// {
//   experimentId: "midterm/bub-gpt-5.4",
//   run: <Run>,                              // 该 Experiment 的分组锚点
//   knownEvalIds: ["algebra/quadratic", …],   // 分母:本地历史 ∪ Run 携带的 knownEvalIds,交命令行范围
//   missingEvalIds: ["geometry/area", …],     // 当前口径下没有任何 attempt 的题
// }
```

`run` 是该 Experiment 的锚点 Run。
零 attempt 的 Eval 按 agent / model / flags 归组时读它——`latestRunSample` 锚最新 Run，`currentSample` 锚确定该 Experiment 可比性配置的最新 Run。
锚点不必出现在 `sample.runs`：全缺口 Experiment 仍然有锚点，否则「这道题按 agent 分到哪一行」没有事实来源。

缺的是具体哪几道题,所以呈现在行的位置上。
`toExperimentRows(sample)` 把 `missingEvalIds` 渲染成 Experiment 列表里的占位行(「当前配置下无结果」+ 可复制的补跑命令,契约见 [Experiment rows](../reports/library.md)),读者在正在看的表里直接看见分母缺口。
程序消费同样直接:CI 里「覆盖缩水就 fail」判 `coverage.some((c) => c.missingEvalIds.length > 0)`。
缺口永远被算出来,不静默。

分母随数据走而不是随目录走:`knownEvalIds` 的定义是**并集(本地历史, 各 Run 携带的 knownEvalIds)**,`publish()` 复制时补记这个字段,发布目录因此仍算得出缺口。
机制见 [Record · 发布](../record/library.md#发布publish)。

## 时效:新执行与历史执行

样本里每条 attempt 都带完整的时效事实,回答「这个数字是不是最新一次运行实测的」:

- **新执行**:属于该实验在样本中最新 Run、且非携带的 attempt——最新一次运行里真实跑出来的。
- **历史执行**:其余两种出身——携带条目(`attempt.carried === true`,fingerprint 未变、上一轮终态合入本 Run),与 `currentSample` 从旧 Run 拼入的 attempt(所属 Run 早于该实验在样本中的最新 Run)。

两种历史出身对读者是同一个事实——「这条不是最新一次跑出来的」——报告用同一种时效呈现:locator 后的相对时距、降饱和样式与 web 面 hover 说明(契约见[实验表 · 时效不写字](../reports/components/summaries/experiment-table.md#时效不写字));机制差异(携带 vs 拼接)只在数据字段上可分辨,供脚本按需区分。

历史执行不是异常:携带是 fingerprint 担保下的正常缓存(「旧但有效」,语义见 [Experiments · 缓存与携带](../experiments/cache.md)),跨 Run 拼接受 configHash 前提保护。
所以它不进 issues——时效是每行数字的出身属性,跟着数字走,不是 Sample 级 Issue。

**只看新执行:`fresh` 选项。**
两个选择器都接受 `fresh: true`,生成 `attempts` 数组时排除全部历史执行:

```typescript
const fresh = currentSample(record, { experiments: "compare/", fresh: true });
fresh.mode;   // "current"
fresh.fresh;  // true
```

分母随之如实缩水:被排除的题按覆盖事实进入 `coverage.missingEvalIds`、在实验列表上呈现为占位行,不会静默消失。
CLI 侧 [`niceeval show --fresh`](../reports/show.md#选择结果范围) / `niceeval view --fresh` 注入的就是这个口径。

## 转换:`scope` 与 `filter`

转换只保留两个不可互换的动作,都返回新的 Sample:

```typescript
const algebra = currentSample(record)
  .scope({ experiments: "compare/", evals: "algebra/" })
  .filter((attempt) => attempt.result.verdict !== "skipped");
```

| 方法 | 含义 | coverage 分母 |
|---|---|---|
| `scope({ experiments?, evals? })` | 声明「我比较的总体就是这些实体」 | 与作用域取交集;被排除的实体消失,不算 missing |
| `filter(predicate)` | 声明「总体不变,但这些观测不可信或不适用」 | 保持不变;被删到无结果的题进入 missing |
| `freshOnly()` | 只把当前读面收窄到新执行，保留完整去重历史 | 保持不变;历史题进入 missing |

`scope()` 与 `filter()` 同步更新 `attempts`、`historyAttempts`、`runs`、`coverage` 与有来源作用域的 `issues`;非实验作用域 Issue 保留。
`freshOnly()` 只收窄 `attempts`、`runs` 与 coverage，不裁掉供趋势读数使用的 `historyAttempts`。
`runs` 只保留仍被当前 `attempts` 引用的真实 Run；完整历史通过 `historyAttempts` 自带的 `attempt.run` 读取。
选择器的 `{ fresh: true }` 等价于在基础选择后调用 `freshOnly()`。

这层不提供 `pipe`、`only/drop` 算子族,也不提供 `groupBy` / `reduce`。
前者把总体选择和数据删减藏进一套近义 DSL,后者会与 Reports 的折叠口径重复。
需要替换式重挑时重新调用选择器;不要把普通 `Run[]` 冒充仍有 coverage 与 issues 的 Sample。

## 去重:身份键与最新落盘

携带让同一个 attempt 存在于多份落盘。
[Record 忠实反映这份重复](../record/library.md#身份键),**跨 Run 聚合前的去重在这一层**:

- 身份键是 Attempt 的稳定 `locator`,重复时保留**最新 Run** 里的那份(内容相同,取新 Run 的副本让 ref 落在最新落盘上);

两个选择器都已内置这一条,`sample.attempts` 拿到手就是去重后的。
直接读取 Record 的脚本若要实现其它口径,四个身份字段都在数据上;去重步骤不是独立公开 API。

## Issue code 全集

`issues` 只收**定位不到任何一行**的读取或选择问题;能定位到行的事实各归其位——覆盖缺口是 `coverage` 数据与实验列表占位行,携带与跨 Run 拼接是 attempt 的时效属性,都不进 `issues`。
新增 code 前先自问:这个问题能不能落到某一行上?
能就放到行上,不进这张表。

公开形状是只带 code 和判断证据的判别联合:

```ts
type SampleIssue =
  | {
      code: "unfinished-run";
      experimentId: string;
      startedAt: string;
      dir: string;
    }
  | {
      code: "dangling-evidence";
      experimentId: string;
      evalId: string;
      attempt: number;
      artifactBase: string;
      artifacts: readonly string[];
    }
  | {
      code: "unreadable-run";
      dir: string;
      reason: "incompatible" | "malformed" | "incomplete";
      producer?: { name: string; version?: string };
    };
```

`SampleIssue` 在打开记录、判定证据可达性和选择 Sample 时结构化产生。
它不写入 `.niceeval`,删掉后可以从同一记录根与同一选择参数重算。
Issue 不带 `message`、`command`、本地化文案或 Notice 严重度。

Reports 的 Notice policy 再把 Issue 映射为读者可见的标题、详情、严重度与动作。
这些选择属于呈现层,不回写 Sample 或 `.niceeval`。
读数与摘要 Result 不复制 Issue,同一个问题只由 Notice policy 解释一次。
范围级消费方不接受手工挑的 `Run[]`;先通过选择器得到 Sample,再用 `scope()` / `filter()` 表达意图。

## 相关阅读

- [README](README.md) —— 为什么选择独立成一层。
- [参考方案](reference/README.md) —— 转换算子与显式口径字段从哪里学。
- [用例手册](use-case/README.md) —— 局部补跑之后两个口径分别给出什么。
- [Record](../record/library.md) —— 被选择的那份事实与身份键。
- [Reports](../reports/library.md) —— 消费 Sample 的数据源、读数与原语。
