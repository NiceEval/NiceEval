# 缓存与携带 —— 上一轮的结果哪些还算数

跑过一轮之后再跑同一条命令,已经跑完的结果默认不重花 agent / sandbox 成本:
它们直接**携带合入**本次 Run,本次只派发真正缺的那些 attempt。
这篇定义「哪些结果还算数」的完整判据,是指纹输入、携带粒度与终态定义的单源。

「我改的这个东西会不会让它重跑」按场景查[用例手册 · 改什么会作废缓存](use-case/缓存与沿用/),
本篇只写判据本身。

## 携带要过的门

一条已落盘的 attempt 要携带进本次 Run,必须同时过下面每一道门,缺一不可。
只有指纹那道走哈希——它是其中一个判据,不是携带的全部。
前四道问的是「这个条目自己够不够格」,后两道问的是「本次调用还认不认它」。

| 门 | 看哪一侧 | 判据 | 不过会怎样 |
|---|---|---|---|
| 终态 | 条目 | 判定是 `passed` 或 `failed` | `errored` / `skipped` 永不携带,总会重试 |
| 指纹 | 条目 | 该 eval 的指纹等于本次配置算出的指纹 | 这条 eval 的全部 attempt 重跑 |
| 资格 | 条目 | `executionMs` ≤ 当前 resolved `timeoutMs` | 这一条重跑 |
| 出身 | 条目 | 没有 `reused` 标记 | 这一条重跑 |
| 口径 | 本次调用 | [`--rerun`](use-case/重新运行/) 档位仍采信这个判定 | 该判定的 attempt 重跑 |
| 模式 | Experiment 与本次调用 | 没有 `sandboxReuse: true`，且该条不落在 `--keep-sandbox` 当前留存档内 | 这一条真派发 |

`passed` 与 `failed` 都是「跑完了、判定确定」的终态,
没理由重花一次钱去复现同一个已知结果。
`errored` 与 `skipped` 的判定本身不可信,不是可复用的终态,因此从不缓存——
前者是框架或环境层面的不确定失败,例如超时、沙箱挂了。

后两道门的完整语义在[执行模式划走的两块](#执行模式划走的两块)。

## 指纹:两个哈希嵌套

指纹按**每条 eval** 各算一份(`runner/fingerprint.ts`),由两层嵌套构成:

```text
configHash  = hash(agent, model, reasoningEffort, flags, sandboxReuse, 顶层 sandbox spec, strict, judge)
fingerprint = hash(configHash, eval 源码闭包, evalId / tags / environment / metadata,
                   该 eval 解析到的 sandbox 产物, loader 读入的数据文件内容)
```

`configHash` 是 Run 级的**配置身份**,同时是跨 Run 可比性的唯一判据,
读取面怎么用它见 [Record · configHash](../record/library.md#confighash配置身份只算一次)。
两个哈希嵌套而不是并列,于是新增一个公开配置字段只需要裁决一次「进不进 configHash」,
不必分别裁决「进不进指纹」和「算不算可比性配置」。**一个字段两处裁决迟早会分叉**,
而分叉的症状是静默的:报表把一行标成单一 agent / model / flags,底下却混着两套配置的数据。

三条配套规则:

- **进 configHash 的字段必须落进 `run.json`**,顶层或 `ExperimentRunInfo` 二选一、不重复。
  没落盘就没法对历史侧重算配置身份,
  [`--carry-ignoring-flag`](#--carry-ignoring-flag搬迁用的一次性出口)这个出口也就无从落地。
- **`configHash` 不逐 eval、不逐题型分叉。** 代价是配置改动会波及证明上不受它影响的 eval:
  一条 eval 自己完整声明了 `judge` 时,config 层换裁判模型照样让它重跑。
  `--strict` 也一样——全选计分制时传它是启动期用法错误,混型选择下它被接受,
  计分制那半跟着一起烧,尽管[丢分不翻判定](../scoring/library/score-points.md#折叠树判定面分数面质量分)。
  换来的是一个字段只裁决一次,不必维护一张「哪个字段对哪类 eval 有效」的表。
- **凭据不进。** `judge` 进的是 `model` 与 `baseUrl` 两个配置值;
  `judge.apiKeyEnv` 选的是凭据从哪来,不改变「判定怎么算」,不进哈希也不落盘。
- **`sandboxReuse` 进。** 它改变 SandboxSpec Hook 次数、题间状态边界与 Attempt 是否能被
  独立沿用；省略等价于 `false`。

下面三块把每一行改动的后果标在原地。设定:这个实验选中 36 条 eval,上一轮全绿。

### 实验文件:一行下去,要么 36 条全重跑,要么一条不动

```typescript
// experiments/compare/codex-nowledge.ts
//   ↑ 改文件名 → experimentId 跟着变 → 36 条全部重跑(相当于开了一个新实验)

export default defineExperiment({
  description: "codex + nowledge 对照",
  //  改文案 → 一条不动

  //  改注释、调字段顺序、把某个值抽成变量 → 一条不动。实验文件认解析出来的值,不认字节

  agent: codexAgent({ webSearch: true }),
  //  true → false → 一条不动!指纹只认 agent 的名字 "codex",看不见工厂参数
  //  想让这个开关作废历史,把它搬去下面的 flags,再让工厂从 ctx.flags 读

  model: "opus",                    // → "sonnet" → 36 条全部重跑
  reasoningEffort: "high",          // → "medium" → 36 条全部重跑

  flags: { webResearch: true },
  //  true → false → 36 条全部重跑。加一个键、删一个键同样全跑:flags 整袋进指纹,无逐键豁免
  //  这正是想要的——两个值下跑出来的是两批不同条件的结果,混在一起读通过率没有意义

  labels: { line: "codex" },        // → { line: "codex-cli" } → 一条不动,labels 是纯报告坐标

  attempts: 5,
  //  3 → 5 → 已有的 3 条携带,只补跑缺的 2 条
  //  5 → 3 → 不删已有结果

  timeoutMs: 40 * 60_000,
  //  20min → 40min → 一条不动,上限不改变「结果是什么」
  //  40min → 10min → 上一轮执行了 15 分钟的那几条重跑(在新上限下复现不出来)

  earlyExit: false,                 // 改 → 一条不动
  maxConcurrency: 2,                // 改 → 一条不动
  budget: 50,                       // 改 → 一条不动。这三个是调度参数,不改变结果

  sandbox: e2bSandbox({ template: "niceeval-agents" })
    .setup(async (sandbox) => { await sandbox.runShell("npm i -g some-cli"); }),
  //  换 template → 36 条全部重跑(起步环境变了,结果不可比)
  //  改 environments 表里的一行 → 只有声明了那个 profile 的 eval 重跑,其余照常携带
  //  template 不变,只在 .setup() 里多装一个二进制 → 一条不动,Hook 函数体不进指纹
  //  template 不变,但重建了同名镜像 → 一条不动,指纹看不见镜像内容

  evals: (e) => e.tags.includes("memory"),
  //  改谓词 → 只改变选中谁。上一轮跑过、这一轮仍被选中的照常携带

  classifyFailure: ({ text }) => text.includes(tunnelHost)
    ? { retryable: false, scope: "experiment" }
    : undefined,
  //  改分类器 → 一条不动。它只改变终局失败怎样止损,不改变已完成 Attempt 的结果身份

  setup: async (ctx) => { tunnel = await startTunnel(); },
  //  改函数体 → 一条不动
  //  tunnel.url 这种跑起来才有的值也进不了指纹:携带决策发生在任何 setup 执行之前,那时它还不存在
});
```

命令行上还有一个:`--strict` 改变 soft 断言怎样影响判定,进指纹 → 36 条全部重跑。
`--max-concurrency` 只是调度,一条不动。

### eval 文件:一行下去只作废这一条

```typescript
// evals/memory/recall-3.eval.ts
//   ↑ 改文件名 → id 跟着变 → 这一条重跑,同实验其余 35 条照常携带

export default defineEval({
  //  在这里加一行注释 → 这一条重跑
  //  格式化一次、调个缩进、加个空行 → 这一条重跑
  //  ↑ 不是笔误:eval 文件进指纹的是**整份字节**,不是解析出来的字段

  tags: ["memory"],                 // 加一个 tag → 这一条重跑
  environment: "python-3.9",        // 换 profile → 这一条重跑(它映射到的预制产物变了)
  metadata: { source: "swe" },      // 改 → 这一条重跑

  timeoutMs: 15 * 60_000,
  //  改这个值 → 这一条重跑,因为字节变了
  //  四层来源里只有写在 eval 文件里的这一层会这样;--timeout / experiment / config 三层改了不作废

  async test(t) {
    await t.send("把 recall 结果写进 out.md");   // 改 prompt → 这一条重跑
    t.check(await t.sandbox.fileExists("out.md"), isTrue());  // 改断言 → 这一条重跑

    t.fact("endpoint", tunnel.url);
    //  改这行代码 → 这一条重跑,因为字节变了
    //  但 tunnel.url 的值不进指纹:换一个地址重跑,已完成结果照常携带
  },
});
```

### eval 源码闭包:算到哪为止

判定逻辑常常不住在 `.eval.ts` 里——断言抽进 `share/assert-memory.ts`、
数据行从 `evals/data/` 读进来,是被鼓励的写法。指纹因此认的不是单个文件,是这条 eval 的**源码闭包**:

- **静态面**:eval 文件字节,加上它的导入图里解析后落在项目根内的每个模块,递归展开。
  判据是模块解析后的真实路径,不是 import 写法——相对路径、`tsconfig` 的 `paths` 别名都算数。
  按项目根相对路径排序后逐个哈希,顺序固定;循环导入按解析后的绝对路径去重。
- **数据面**:经 `loadYaml` / `loadJson` 读入的文件,内容哈希进读它的那条 eval。
  这些 loader 在发现阶段的模块求值期就把文件读完了,早于解析期算指纹,所以拿得到内容。

两块之外还有两处进不来,是明确的缺口:落在 `node_modules` 里的包(含 workspace 内经 symlink
解析过去的那些)、以及动态 `import()`。改了这些要重验用 [`--rerun all`](use-case/重新运行/)。
用户自己写 `fs.readFileSync` 读进来的文件同样进不来——niceeval 不知道那次读发生过。

**闭包是 1 对 N 的,依赖越集中作废面越大。** eval 文件的字节只作废它自己,
而一个被 30 条 eval 引用的 helper 改一行就作废那 30 条,效果接近改一个 `flags` 值。
`share/` 里通常还混着 prompt 模板、类型与日志这类不参与判定的代码,改它们同样全批重烧。
想缩小作废面就按变更频率拆文件:稳定的断言 helper 和天天调的 prompt 模板不放同一个文件。

### 两个文件之外的世界:改了也不作废

指纹只认你写下的配置与它能读到的源码。下面这些一条都不作废,上一轮的绿照常携带:

- agent CLI 从 v1.2 升到 v1.3
- 被测服务改了行为、重启了、换了一个实例
- 同名镜像重建、`Dockerfile` 改了
- agent 的 system prompt 改了(它不在实验文件里)

这时旧的绿掩盖的可能是真实回归。要复验用 [`--rerun`](use-case/重新运行/)——
改了被测对象只复验失败项走 `--rerun`,外部世界整个变了走 `--rerun all`。
能配置化的差异(服务端版本号)就显式写进 `flags` 让指纹自然失效,比每次手动重跑可靠。

### 为什么 eval 认字节,实验文件认解析值

上面两块的不对称是有意的,来自两者语义的可声明性差异。
实验文件的语义完全等于 `defineExperiment` 那几个字段的值,列得出来,指纹就认这些值。
eval 的判定逻辑写在 `test(t)` 的函数体里,列不出一组能代表它的字段,只能把整份文件当作它的定义;
闭包只是把同一条理由推广到判定逻辑实际所在的那些文件。

代价是格式化一次 `evals/` 或 `share/` 等于一次整批重烧,这是有意接受的。
要让格式化不作废结果,前提是能声明「eval 的语义等于哪几个字段」,而函数体让这个前提不成立。
退而求其次去做源码规范化(剥注释、AST 归一),等于把「哪些字节不算语义」变成一条长期维护的猜测。
猜错的方向是**该重跑的没重跑**——静默采信一条已经不成立的旧判定,比多烧一次钱贵得多。

同理,连接坐标(隧道 URL、实例地址)的家是 [`ctx.fact()`](../record/architecture.md#facts运行事实),
换多少次都不作废已完成结果;三个家的判据见
[Library · 运行时坐标不进配置](library.md#运行时坐标不进配置三个家)。
把开关声明进 `flags` 而不是写死在 agent 工厂里,也是
[配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)本来就要求的写法。

## 携带资格:`timeoutMs` 不进哈希

超时上限不改变「结果是什么」,只决定「等不等得到」。
一条 15 分钟跑完的 `passed`,在 20 分钟和 40 分钟的上限下是同一个事实;
把 `timeoutMs` 掺进哈希会让提高上限作废全部已完成结果,为一个不影响它们的参数付全量重跑。

因此指纹不含 `timeoutMs`,它在指纹匹配之外另立一条判据:
**终态 attempt 可携带,当且仅当其 `executionMs` ≤ 当前 resolved `timeoutMs`**(未设上限视为无穷)。
四层来源的解析顺序单源在 [Resolved config](architecture.md#resolved-config一次求值处处同源)。

判据用 `executionMs` 而不是 `durationMs`,是为了让两侧量的是同一段时间。
attempt deadline 从 `sandbox.create` 起算、不含等并发位的排队,
`executionMs` 按同一口径落盘(定义见 [Results · result.json](../record/architecture.md#resultjson))。
拿含排队的 `durationMs` 去比就是两把尺子:一条排队 20 分钟、执行 5 分钟的 `passed`,
在 10 分钟上限下会被判成复现不出来,而它执行只要 5 分钟,根本不会撞线。

提高上限时全部已完成结果照常携带,只有当初撞线的 `errored`(本就不携带)重跑。
调低上限时,执行耗时超过新线的旧结果在新配置下复现不出来,如实重跑。

## 携带粒度:以 attempt 为单位

指纹未变时,上一轮已落盘的终态 attempt **逐条**携带,本轮只派发计划内缺失的 attempt 序号——
`attempts: 5` 已有 3 条终态就只补跑 2 条,通过率的分母由携带与新跑共同凑满。
`attempts` 因此不进指纹:调大只补跑缺的,调小不删已有结果。

携带的 `passed` 与[首过即停](use-case/首过即停.md)组合遵守既有语义:
已携入通过且 `earlyExit` 开时,缺失序号不再派发,计入 `earlyExitUnstarted`。

## 一份 Run 里的条目共享一个指纹口径

携带的含义是「这条已落盘的结果对本次规划的输入依然成立」,判据又正是指纹相等。
两者合起来落成一条不变量:**Run 里每个条目的 fingerprint 都等于本 Run 配置算出的指纹**,
携带条目不背着产出它那一轮的旧指纹漂下去。

读取面因此不必翻更早的 Run 就能把条目与 Run 记下的配置对上号,`flags` 与条目指纹恒同源。
合入只重打指纹一个字段:`locator`、`artifactBase`、判定、`facts` 与证据指向照旧原样携带,
落盘语义见 [Results · 两类条目](../record/architecture.md#resultjson)。

## `--carry-ignoring-flag`:搬迁用的一次性出口

把误当成实验条件写进 `flags` 的连接坐标搬进 [`ctx.fact()`](../record/architecture.md#facts运行事实) 时,
`flags` 袋子变了、指纹随之全变,历史结果会一次性作废。
这一次调用带上该键名(可重复),携带判定按抹掉这些键之后的 `flags` 认账,搬迁不必赔上一轮重烧。

**它做的是一次重锚,不是一次豁免。** 被放行的条目照常按[本 Run 的口径](#一份-run-里的条目共享一个指纹口径)
重打指纹,于是下一次跑不带这个 flag 也照常命中——这正是搬迁要的结果,那个键已经不在 `flags` 里了。
这个 flag 不需要在后续调用里再带上。

三道约束把它锁在搬迁这一种用途上:

- **只接受已经不在本次 resolved `flags` 里的键。** 键还在就是启动期用法错误,
  报错指出它仍是本次的实验条件、要先真正搬走。这在结构上堵死「抹掉一个仍然生效的实验条件」,
  也就堵死了「把两批不同条件的结果混进同一个 configHash」这条路。
- **键必须在候选历史条目的 `flags` 里出现过。** 一个两边都不存在的键是空转,
  多半是键名打错了,按启动期用法错误报出来,不静默通过。
- **留痕落在条目上。** 被放行的条目记 `carriedIgnoringFlags`,写下这次抹掉了哪些键;
  本次调用另记一条 Run diagnostic(`carry-ignoring-flag`)。
  条目侧那份让「这条是在哪个口径下被采信的」跟着结果走,不随 Run 翻篇丢失。

真正的修法是让那个值不再出现在 `flags` 里,这个出口只负责让搬迁那一次不赔钱。

## 携带来源不要求 Run 收尾

attempt 的 `result.json` 在收尾链完成后一次写成,判定可信与否与 Run 有没有补上 `completedAt` 无关。
被中断或强杀的 run 留下的未收尾 Run,其中已落盘的终态 attempt 照常携带。

**重跑同一条命令就是续跑**:只花缺失 attempt 的成本。
这也是长 run 撞上外部看门狗(CI 时限、宿主超时强杀)后的恢复路径,
配合[实验面的启动自愈](architecture.md#强杀后的收尾兜底收尾登记与启动自愈)
与[实例面的孤儿核对](../sandbox/architecture.md#孤儿核对强杀路径的实例面兜底),
重跑前不需要任何手工清理。

## 并发 Invocation:取到锁之后重做一次规划

用例锁在派发时刻逐用例取:一条 Invocation 只锁自己正在跑的用例,不囤积选择集。
两条选择重叠的 Invocation 因此各自认领不同用例、按各自并发上限并行推进——
多开一条终端就是给同一批选择加吞吐。
撞上别人持有的锁时该用例不双跑:挂起等待(不占并发位、计入独立的 `elsewhere` 计数状态,
并发位转派给下一条没被锁的用例),锁释放后重新参与派发。

**取到锁之后一律重做一次携带规划**:别的 Invocation 已跑完并落盘的终态,
每一道门都过就携入,仍缺的 attempt 序号才自己跑。
这次重判无条件发生在取锁之后,两条选择有交集的 Invocation 因此不论时序怎样交错,
各自结束时都拿到完整结果集,交集部分只花一份成本。
锁文件、心跳、接管与非目标的完整契约单源在
[Experiments · 并发 Invocation](architecture.md#并发-invocation用例锁)。

## 执行模式划走的两块

声明 [`sandboxReuse: true`](../sandbox/reuse.md#结果与结果沿用) 的 Experiment
与结果沿用**双向绝缘**：每次都真实执行计划内的 Attempt，
复用产出也永不成为后续 Run 的结果沿用来源。
绝缘让一份 Run 里的结果只有一种出身,不会混出「一半干净携带、一半污染复用」的分布。
出向那一半靠条目自己带的标记落地:复用 attempt 落盘时记 `sandbox.reused`,
[出身门](#携带要过的门)读它，与当前 Experiment 是否声明复用无关。

[`--keep-sandbox`](../sandbox/cli.md) 下,历史终态判定落在**当前留存档内**的 attempt 不携带、照常派发重跑:
留存要的是一次真实执行的现场,携带条目没有沙箱可留。
`failed` 档下 `failed` 重跑、`passed` 照常携带,`all` 档下全部重跑。

## `--rerun`:一个旋钮定「哪些还算数」

三档都只作用于本次调用,不改指纹定义;档位词表与 [`--keep-sandbox`](../sandbox/cli.md) 同构,
裸写都是保守的 `failed` 档。

| 写法 | 哪些算数 | 本次跑什么 |
|---|---|---|
| 不带 | `passed` 与 `failed` | `errored` / `skipped` / 缺失序号 |
| `--rerun` = `--rerun failed` | 只有 `passed` | 上面那些,加所有 `failed` |
| `--rerun all` | 都不算数 | 选中矩阵的每一条 |

`failed` 档用于改了不在指纹里的东西(agent 的 prompt、被测服务)之后复验失败项,
不必去结果树里挖失败的 eval id。`all` 档用于外部世界变了(agent CLI 升级、镜像重建)时的全量重验。
全流程见[用例手册 · `--rerun`](use-case/重新运行/)。

---

这几道门合起来只为一件事:让「改一个 case 重跑」只花那一个 case 的时间,而不是全量。

## 相关阅读

- [改什么会作废缓存](use-case/缓存与沿用/) —— 按场景查我改的这个会不会重跑。
- [`--rerun`](use-case/重新运行/) —— 指纹没得改但就是要重跑时的一次性口径。
- [Record · configHash](../record/library.md#confighash配置身份只算一次) —— 同一个哈希在读取面怎样担保跨 Run 可比。
- [Results · 两类条目](../record/architecture.md#resultjson) —— 携带条目怎样落盘、怎样回指原 artifact。
- [Architecture · carry](architecture.md#carry自动携带) —— 携带在实验解析与运行规划里的位置。
- [Runner](../../runner.md) —— 发现、并发调度、首过即停与退出码。
