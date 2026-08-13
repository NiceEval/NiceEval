# API 设计

niceeval 的公开 API 先定义用户能观察到的语义，再决定名字、参数与类型。
名字只声明一次，却会在每个调用点反复出现；评审因此以完整调用为单位，不孤立评价一个标识符。

本篇约束 TypeScript Library API，包括根入口、子路径导出、公开类型、函数、方法、组件和配置字段。
CLI 的命令与 flag 另见 [CLI](cli.md)，但沿用同一条调用点清晰原则。

## 首要标准：调用点清晰

API 应让第一次使用它的人在调用处看出“这一步要什么、会发生什么、得到什么”：

```ts
import { attemptSlotProjection, reportInputs, verdictProjector } from "niceeval/report";

const verdicts = attemptSlotProjection(verdictProjector);
const inputs = reportInputs({ verdicts });
```

`attemptSlotProjection` 表明作者声明的是按 Sample slot 对齐的官方投影；`reportInputs`
只形成可签入的数据声明，不打开 Record 或启动 host。持久化读取由 `show` / `view` 的内部 host
完成，不进入公开 Library 调用点。

清晰优先于简短，但长度不是清晰的替代品。
名字变长若能消除相邻 API 的实质歧义，就保留必要词；模块、参数和返回类型已经表达的信息不重复。

## 先定语义，再定语法

命名前先回答四个问题：

1. 返回或改变的领域对象是什么？
2. 这是纯查询、转换、定义、资源操作，还是会产生外部副作用的命令？
3. 调用者为什么需要它？
4. 最容易与哪个相邻 API 选错？

答不出对象是什么时，不先争论单复数；答不出动作类型时，不先套“动词 + 名词”。
一个名字语法正确，仍可能指向错误的领域概念。

公开名字只使用 [Concepts](concepts.md) 已有的领域词，或与 API 同批立下的新词。
实现类型、算法步骤、存储布局和历史包名不因“源码里已经这么叫”自动获得公开资格。

## 名字跟随 API 角色

函数没有统一的“动词 + 名词”公式。
符号扮演什么角色，决定它使用哪种语法：

| 角色 | 命名形态 | 例子 |
|---|---|---|
| 执行动作或产生副作用 | 动词短语 | `exportStaticReport`、`runEvals` |
| 打开、加载或读取外部资源 | `openX` / `loadX` / `readX` | `loadYaml`；内部 `openRecordReader` 不属于公开 API |
| 创建普通运行时值 | `createX` | `createAgentSession`、`createTurnHandle` |
| 声明并校验定义 | `defineX` | `defineEval`、`defineExperiment` |
| 返回逻辑视图或派生值 | 结果名或准确的计算动词 | `estimateCost` |
| 判断条件 | `isX` / `hasX` / `canX` | `isDefined`、`hasSections` |
| 转换表示 | `toX` / `fromX` / `targetFromSource` | 词根写明目标与输入表示 |
| 收窄不可变集合 | `filterX` / `onlyX` / `dropX` | `filterAttempts`、`dropExperiments` |
| 类型、组件与值对象 | 名词 | `Record`、`AnalysisSample`、`AttemptEvidence` |
| 事件回调 | `onX` | `onAttemptReceipt` |

同一个前缀只表达一种稳定动作：

- `defineX` 返回可签入、可组合的声明，不打开资源或启动运行时对象。
- `createX` 创建运行时实例，不冒充纯定义。
- `openX` 建立到外部资源的读取面，错误必须能定位该资源。
- `loadX` 把外部内容完整读入值，不暗示持续句柄。
- `exportStaticReport` 构造完整的静态交付目录，不只是复制 HTML。

纯查询可以使用名词性结果名，但“纯”不自动推出“名词性”。
结果名必须准确指向返回对象，并足以区分相邻查询；否则使用能说明计算或选择语义的准确动词。
不要默认补一个含义空泛的 `get`、`select`、`process`、`handle` 或 `make`。

转换器只有在模块已经明确目标对象时，才可只写 `fromX`。
扁平入口同时导出多种发布包时，名字要写成 `targetFromSource`，例如 `turnFromResponses`。
名称同时表达输入协议与返回对象，调用点不必另查 `Turn`、事件还是 usage；`responsesToTurn` 虽然方向明确，但把输入放在调用点主位，不如一组 `turnFromChatCompletion` / `turnFromResponses` 先按共同返回对象聚类。

## 计算、转换、结果与呈现角色分开命名

报告作者面只暴露普通函数与具体结果值，不把执行管线包装成公开声明对象。
同一能力经过多个阶段时，名字按调用者手里的对象与动作区分：

| 角色 | 命名 | 例子 |
|---|---|---|
| 从单条 Attempt 取值并两级聚合 | 名词性 Calculation 值 | `passRate`、`costUSD` |
| 按 AnalysisSample 分组计算 | 准确计算动词 | `aggregate(sample, options)` |
| 立即投影成显示结果 | `toX` | `toAttemptRows(attempts)` |
| 复杂算法的结果构造器 | 结果名 | `metricValue(...)`、`evidenceRow(...)` |
| 通用呈现组件 | PascalCase 形状名 | `Table`、`Scatter`、`Callouts` |
| 成品装配 | 任务函数或具名 Page | `comparisonResult()`、`standardAttemptPage` |

转换函数返回精确形状，例如 `AttemptRow[]`、`WaterfallNode[]` 或 `SummaryItem[]`。
不建立适用于所有组件的 `Data` 或 `Content` 总协议；组件属性直接说出角色，例如 `rows`、`points`、`items`、`nodes` 与 `attempt`。

### 立即转换使用 `to*`

实体投影在调用时执行，不注册名字，也不等待渲染器触发：

```ts
const rows = toAttemptRows(attempts);
const nodes = await toTraceNodes(sample);
```

`to*` 明确表示输入值立刻转成另一种表示。
需要读取 artifact 的转换返回 Promise，调用者在 page render 中显式 `await`；组件永远不接 Promise 或惰性查询对象。

### 正反例

```ts
await aggregate(sample, { by: { agent }, values: { passRate } });
toExperimentRows(sample);
await toTraceNodes(sample);

measureRows({ ... });       // 差：像声明对象，没说明何时执行
source.compute(sample);     // 差：把内部执行协议交给作者
metricTableData(...);       // 差：领域词、呈现形状和机械 Data 后缀绑死
getSampleSummary(...);      // 差：get 没增加可观察语义
```

## 单复数跟随指代对象

名字先确定自己指什么，再决定单复数：

| 指代 | 形式 |
|---|---|
| 一个领域实体、定义、句柄或返回对象 | 单数：`Record`、`AnalysisSample`、`AttemptEvidence` |
| 返回或操作的一组同类成员 | 复数：`experiments`、`attempts`、`dropExperiments` |
| 集合类型自身 | 单数类型名，成员字段用复数 |
| 复合名词里的类型修饰语 | 通常用单数，如 `attemptHref` |

一组相邻 API 必须采用同一种指代视角。
不能一边按返回对象命名，另一边按内部遍历成员命名，再用单复数制造表面对称。

返回集合不表示函数名必然复数。
`openRecordReader({ root })` 返回一个 Record 读取面，所以是单数；`experimentIds` 指一组筛选成员，所以是复数。

## 选择 API 先固定命名视角

选择 API 同时涉及两个对象：它返回的派生对象，以及它从输入中挑出的成员。
名字必须先决定指向哪一个，不能把两种视角混在同一组 API 里。

| 命名视角 | 名字回答 | 单复数依据 | 适用条件 |
|---|---|---|---|
| 返回对象 | “得到的是哪一种对象” | 返回对象本身 | 返回对象是稳定领域实体，调用者把它作为整体继续传递 |
| 被选成员 | “挑出了哪些成员” | 被直接选择的成员 | 成员集合本身就是公开结果，没有更高层领域对象 |

内部 selection 若采用返回对象视角，名字和类型都以单数 AnalysisSample 为中心；Run、Attempt 等成员只用于说明选择维度。这条命名规则不使 reader-bound handle 获得公开资格。
若采用成员视角，就必须整组改用成员的单复数，不能一个名字指 AnalysisSample、另一个名字指 Runs，再靠表面对称掩盖差别。

名词性纯查询可以采用任一视角，但名词短语必须准确指向所得结果：返回对象视角按单数领域对象命名，成员视角按成员集合命名。
若去掉参数和返回类型后无法判断它是形成 AnalysisSample、成员集合还是布尔状态，名词短语不够清楚，应使用准确的选择动词或调整模块与调用形状。

## 状态、顺序与出处不要混成并列模式

`current` 与 `latest` 分别表达状态和顺序；`fresh` 只在 Sandbox 创建等确有用户旅途的地方表达新建出处，不能自动升级为第三种结果模式：

| 词 | 唯一含义 | 使用要求 |
|---|---|---|
| `current` | 观察时刻成立的领域状态 | 可以由多个出处共同形成；必须说明状态按什么规则成立 |
| `latest` | 在明确顺序中排在最后的实体 | 必须写清被排序的实体、分组范围与排序键；不单独充当“当前”的近义词 |
| `fresh` | 相对复用实例新建的资源或执行 | 只在新建出处会改变用户动作的局部 API 使用；结果读取面保留 provenance 字段，不据此制造第二套状态 |

因此 `latest` 不能只靠日常语感表示“最好用的当前结果”，`current` 也不能暗中表示“时间最大的 Run”。
出处差异若不改变用户决策，就只保留为明细事实；不得因为实现能区分，就增加筛选器、转换或公开状态。

`Record` 本身不是一次隐含的“最新结果”。它是由 immutable Run 构成的持久事实集。分析既有事实时，API 通过 analysis selection 产生带 expected-slot 分母的 `AnalysisSample`。这种明确成员范围称为有效选择（Effective selection）。当前目标的复用与执行缺口由 reuse planning 产生，不能从 `AnalysisSample` 推导。

## Record 与 Report 的调用形状

Record root 与选择属于 CLI 调用点；Report 作者只声明 definition：

```ts
const report = defineReport({ id, calculations, pages });

// host boundary
// niceeval show --record <root> --run <run-id>
// niceeval view --record <root> --run <run-id> --out <target>
```

不带 locator 或 `--run` 的命令、`--run`、可选的 `--record` 与 `--out` 在 CLI 调用处可见。默认 Record root
与 `exp` 一致；只有读取其它 root 才需要 `--record`。host 在 frozen reader Scope 内完成 selection、Attachment I/O
与作者 graph，形成 immutable `ReportExecution`。根入口与普通 consumer 子路径不导出 reader、selection handle 或
`executeReport()`。

需要组合 CLI 或 application main 的代码只能从 host-only 子路径导入 scoped facade，例如
`niceeval/record/host` 与 `niceeval/report/host`。这些入口不会进入 Report 作者 callback；callback-bound
`RecordReader` 与 `AnalysisSampleHandle` 也不能逃出 Scope。普通 Eval、Analysis 与 Report consumer 不使用 host 子路径。

Record 不提供局部 edit/delete、mirror、proof、revision 或防伪 API。业务演进通过新的 RecordAttachment schema 与相邻 migration 进入；已发布 Run 不再修改。

### 领域 API 与 Record adapter SPI 分开

普通 Eval 作者调用领域 API，不提交 Record command。一个 GPU SDK 的典型调用点是：

```ts
export default defineEval({
  plugins: [
    gpuEnergy({
      meter: nvmlEnergyMeter({ device: 0 }),
    }),
  ],
  async test(t) {
    await t.send("完成任务");
  },
});
```

schema、version、migration、owner 与 projection 属于领域 SDK 的 `niceeval/record/adapter` SPI。SDK 用
`defineRecordAttachmentAdapter()` 声明适配器，再用 owner-specific binding 把一个 producer lifecycle 接上它。
普通 `TestContext`、Plugin Hook context 与 Eval／Experiment definition 不增加 `record()`、write grant 或通用
service locator。

`defineRecordAttachmentAdapter()` 返回可签入、可组合的静态声明；它不打开 Record，也不是当前 owner 的 live
capability。`defineAttemptRecordAdapterBinding()` 与 `defineRunRecordAdapterBinding()` 同样返回 link declaration。
只有 host 在 actual owner Scope 中解释 binding，并推导内部 grant、reservation 与 tracked command。

完整调用点评审必须分别展示两种身份：普通消费者只看到领域名；SDK 作者才看到 adapter SPI。把低层调用藏到同一示例
的注释里不算隔离，因为消费者仍会被迫理解它。

## 可观察的选择差异必须进入公开形状

实现步骤不进名字，但会改变用户决策的选择差异不是实现细节。
判断标准不是“内部是否跨 Run”，而是：

- 调用者是否必须根据该差异选择 API；
- 两种选择是否会返回不同成员、涵盖范围、分母或警告；
- 错选是否会改变发布、归档、比较或报告结果。

第一项为“是”，且后两项至少一项为“是”时，该差异必须出现在函数名、模块上下文、具名参数或返回值的判别字段中，不能只藏在长篇契约里。
名字表达用户需要选择的语义，例如“一次执行的事实”与“观察时刻的完整状态”；扫描哪些目录、怎样比较时间、怎样按配置排除不可比 Run，仍由参数、类型与契约正文承担。

这条规则不要求把实现术语直接拼进名字。
`crossRun`、`stitch` 或 `merge` 只有在它们本身是用户任务时才有资格成为公开词；若用户关心的是涵盖完整性或自包含性，API 应表达后者。

## 自由函数与方法按领域归属选择

调用形状同样传达设计。
以下条件决定公开操作放在哪里：

| 形状 | 使用条件 |
|---|---|
| 内部 `record.operation()` | NiceEval 自身导航或读取 Record Core 与 RecordAttachment；不形成公开子路径 |
| 内部 `operation(reader)` | CLI host 根据 frozen reader 形成 AnalysisSample，并引入具名 selection policy 与分母判断 |
| `sample.operation()` | 操作依赖既有 `AnalysisSample` 语义，且仍返回或观察同一领域对象 |
| `sample.pipe(operator())` | 多个不可变转换需要顺序组合，并共享 `AnalysisSample → AnalysisSample` 形状 |

“方法更短”或“自由函数更函数式”都不是理由。
若操作跨越领域层，模块归属应让这个边界在 import 和调用点可见。
按此规则，从 Record 形成 AnalysisSample 的 selection 属于内部 Sample/host 边界；公开用户
通过 CLI selector 使用它，不把 root 字符串或 reader 暴露进 Library。

## 选择函数与判别字段共用语义词根

派生对象若把选择方式写入返回值，公开函数与返回值中的判别字段必须一一对应。
两者共享同一个语义词根，但不要求逐字符相同：函数名还要承担语法角色和返回对象视角，判别字段只承担稳定分类。

每增加一个基础选择器，都要在同一张表里声明：

| 项目 | 要回答的问题 |
|---|---|
| 公开函数 | 调用者怎样得到这类对象 |
| 判别字段 | 序列化后怎样识别基础选择方式 |
| 返回对象 | 词根指向哪个领域对象 |
| 正交选项 | 哪些约束不属于基础方式，不进入判别字段 |

`AnalysisSample.selection.policy` 是上层 ABI，不版本化。内建 identity 是 `explicit-runs` 与 `project-current`，输入分别由自己的具名类型承载。`project-current` 比较当前项目目标与已有 Eligibility identity，并保留全部匹配结果；它不是按时间排序的模式。durable RecordAttachment identity 仍保留版本。不要把 execution `reuse | gap` 混进同一个 slot 联合。

正交约束必须写成独立字段，但前提是它对应明确用户旅途。
adoption、rename 或其它出处事实留在 Run-owned RecordAttachment，不进入 Member 核心，也不膨胀成组合选择模式。

## 相邻 API 按选择维度成组设计

两个 API 会出现在同一张选择表时，必须一起命名。
名字要暴露调用者真正需要判断的差别，而不是让两边只靠文档、参数默认值或返回类型区分。

历史上的 `results.latest()` / `results.current()` 是反例：两个日常英语近义词承载了差异很大的选择行为。
调用者必须先记住实现，才能知道该选哪个。

成组评审至少写出：

| 项目 | API A | API B |
|---|---|---|
| 用户问题 | 它回答什么 | 它回答什么 |
| 输入边界 | 从哪里选 | 从哪里选 |
| 输出实体 | 返回什么 | 返回什么 |
| 可观察差异 | 哪个场景会给出不同答案 | 同左 |
| 错选风险 | 会漏掉或混入什么 | 同左 |

成组 API 不要求共享前缀。
词形对称若会掩盖实质差别，优先保留语义对照。

## 名字、模块、参数与类型共同说明

评审完整调用，而不是只读导出名：

```ts
import { selectExplicitRuns } from "niceeval/sample";

const handle = yield* selectExplicitRuns(reader, { runIds });
const sample = handle.sample;
```

模块说明领域，函数名说明动作，参数名说明边界，类型限制合法组合。
函数名不必重复成 `exportSelfContainedReportToDirectory`。

参数遵守三条规则：

- 对调用者有领域意义的选择使用具名对象参数。
- 不使用含混的位置布尔值；布尔字段用肯定形式，并让 `true` 的行为可直接读出。
- 两个参数不能互换时，名字要在调用点暴露角色，不只依赖相同的 `string` 类型。

返回类型不能补救含混名字。
IDE 能显示类型，不代表读代码的人应该悬停以后才知道调用做了什么。

## 仓库正反例

### 定义与创建

```ts
defineEval({ ... });  // 好：声明一条 Eval
createEval({ ... });  // 差：暗示创建运行时实例
makeEval({ ... });    // 差：make 没说明定义、验证还是执行
```

`defineEval` 与 `defineExperiment` 共享“声明产品配置”的动作词族。
新增同类 API 应先判断能否进入这个词族，不为局部偏好另造 `declareX` 或 `specX`。

### 打开事实与读取文件

```ts
const reader = yield* openRecordReader({ root }); // 内部：准确表达 frozen 读取面
getResults(root);                                 // 差：Results 指代不明，get 也没交代资源边界
loadRecord(root);                                 // 差：若返回 reader，load 会错误暗示已经完整读入
```

`open` 与 `load` 的差别仍约束内部 API，但不会让该能力自动成为公开 package export。

### 导出与复制

```ts
exportStaticReport({ execution, out: dir });  // 好：交付已经执行的自包含静态报告
copyHtml(report, dir);                        // 差：遗漏 runtime、页面和依赖资产
processArtifacts(input);                      // 差：process 没有用户可判断的结果
```

函数按用户任务命名，内部机制留在契约与实现。
Record / AnalysisSample / Reports 的职责见 [Record](feature/record/README.md)、[Sample](feature/sample/README.md) 与 [Reports](feature/reports/README.md)。

### Matcher 与布尔判断

```ts
t.check(command, commandSucceeded()); // 好：调用点读成一条条件
isDefined();                          // 好：返回一个“值已定义”的 matcher
checkCommandExitCode();               // 差：描述检查步骤，没说成功条件
definedCheck();                       // 差：词序不像条件，也不与 isX 词族一致
```

Matcher 工厂的名字优先让断言句子读起来自然。
它可以是条件短语，不必为了“函数必须有动词”改成命令。

### 不可变转换

```ts
sample.pipe(dropExperiments("broken"));   // 好：返回删减后的新 AnalysisSample
sample.pipe(removeExperiments("broken")); // 差：remove 容易暗示原地修改
```

`drop` 与 `filter` 表示不可变选择；会修改接收者的 API 才使用带突变意味的动作，并在类型上同步体现。

## 哪些能力进公开 API

一个候选能力先过三条判据，再进入命名评审：

| 判据 | 进公开 API | 留在用户代码 |
|---|---|---|
| 事实归谁掌握 | 只有 niceeval 掌握的事实：provider 的 workdir、归因 send 区间、标准事件流 | 用户任务域内的事实 |
| 错了是否静默失效 | 用错会悄悄毁掉评测有效性，如路径传错后 agent 看不见文件 | 用错立刻大声报错、下一步明确，如 shell 命令失败 |
| 形态是否收敛 | 几乎所有调用只有一个正确形态 | 形态天然发散，承诺一种就要背其余全部变体 |

niceeval 交付素净、可预测的运行条件，并把自己私有的事实经 API 与契约交出去；在这个运行条件里做什么任务、怎么准备 fixture、怎么验证，是用户的普通代码。
API 的扩张方向是交出更多私有事实，不是代替用户编排任务。

评审时先问：让用户写样板代码的原因，是不是 niceeval 自己制造的。
是，就先拆掉那个原因，不为它包一层官方 API。
fixture 装载（`git clone`、拷贝、生成）因此不进公开 API：一行 shell 能表达、报错可读、形态发散（[裁决存档](../memory/no-official-fixture-loading-api.md)）。

同一条判据的另一面：用户被迫 import Node 内置模块，是为了满足 niceeval 自己定的参数形态时，加宽参数形态，不转售那个内置模块。
loader 收 `URL` 就是这条判据的结果——判据文件按 eval 相对路径定位是常规写法，`new URL(..., import.meta.url)` 全局可用， niceeval 因此不提供 `fileURLToPath` 的包装。
通用能力的家在 Node 标准库； niceeval 的 API 只在输入形态上保证「常规写法用不到它们」。

## 定名前的最小评审材料

每个新增或改名的公开 API 在定稿前写出五样东西：

1. 一句以“返回”“创建”“打开”或其它准确动作开头的摘要。
2. 一个使用真实变量名与参数的典型调用点。
3. 一张与最容易选错的相邻 API 的对照表。
4. 一个会让候选名字产生不同判断的边界场景。
5. 名字刻意没有表达的细节，以及它们由模块、参数、类型还是契约正文承担。

先写对应 Feature 的 use case，再回来看调用是否自然。
声明看起来顺眼、放进任务句子却需要额外翻译，说明名字尚未承担工作。

## 评审清单

- 新读者只看 import、调用与返回类型，能否说出它解决什么问题？
- 名字使用的每个领域名词是否已经在 Concepts 定义？
- 单复数是否跟随同一个明确指代，而不是为了和另一个名字押韵？
- 函数的语法是否符合它的角色，还是机械套用了“动词 + 名词”？
- 一组选择器是否统一指返回对象或被选成员，而不是混用两种视角？
- `current` 与 `latest` 是否分别只表达状态与顺序？出处词是否确有独立用户旅途？
- 相邻 API 的真正选择维度是否出现在名字或调用形状里？
- 会改变成员、涵盖或分母的跨出处组合，是否已经进入公开形状？
- 方法或自由函数的归属是否与领域层一致？
- 函数词根、返回对象与判别字段是否一一对应？
- 正交选项是否各有独立字段，而不是放入 `mode` 造成组合爆炸？
- 名字描述的是可观察语义，还是当前实现步骤？
- 参数名能否让调用点自解释，是否存在含混的位置布尔值？
- 同一个前缀在仓库里是否仍表示同一种动作？
- API 摘要能否用一句简单的话写清？
  写不清时，是否应先拆职责？

## 设计参照

本契约吸收 Swift 的“调用点清晰”、Google TypeScript 的描述性命名与 casing、Rust 的稳定动作词族，以及 Google Go 对查询和动作名字的区分。
具体学了什么、哪些语言习惯不照搬，见[References · API 设计准则](references.md#api-设计准则)。
