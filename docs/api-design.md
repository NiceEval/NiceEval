# API 设计

niceeval 的公开 API 先定义用户能观察到的语义，再决定名字、参数与类型。
名字只声明一次，却会在每个调用点反复出现；评审因此以完整调用为单位，不孤立评价一个标识符。

本篇约束 TypeScript Library API，包括根入口、子路径导出、公开类型、函数、方法、组件和配置字段。
CLI 的命令与 flag 另见 [CLI](cli.md)，但沿用同一条调用点清晰原则。

## 首要标准：调用点清晰

API 应让第一次使用它的人在调用处看出“这一步要什么、会发生什么、得到什么”：

```ts
turn.calledTool(
  toolMatch("get_weather", { input: jsonMatch({ city: "Taipei" }) }).exactly(1),
);
```

三层分别说清断言范围、要匹配的工具调用与次数。作者不会看到事件流、Record family、SQLite 或 projection；
运行后读取由 fixed Inspection Operations 完成。

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
| 执行动作或产生副作用 | 动词短语 | `runEvals`、`deleteRun` |
| 打开、加载或读取外部资源 | `openX` / `loadX` / `readX` | `loadYaml`；内部 `openRecordReader` 不属于公开 API |
| 创建普通运行时值 | `createX` | `createAgentSession`、`createTurnHandle` |
| 声明并校验定义 | `defineX` | `defineEval`、`defineExperiment` |
| 返回逻辑视图或派生值 | 结果名或准确的计算动词 | `estimateCost` |
| 判断条件 | `isX` / `hasX` / `canX` | `isDefined`、`hasSections` |
| 转换表示 | `toX` / `fromX` / `targetFromSource` | 词根写明目标与输入表示 |
| 收窄不可变集合 | `filterX` / `onlyX` / `dropX` | `filterAttempts`、`dropExperiments` |
| 类型、组件与值对象 | 名词 | `Record`、`AttemptEvidence` |
| 事件回调 | `onX` | `onAttemptReceipt` |

同一个前缀只表达一种稳定动作：

- `defineX` 返回可签入、可组合的声明，不打开资源或启动运行时对象。
- `createX` 创建运行时实例，不冒充纯定义。
- `openX` 建立到外部资源的读取面，错误必须能定位该资源。
- `loadX` 把外部内容完整读入值，不暗示持续句柄。
- canonical `.niceeval/record.sqlite` 由 Host publication 与 graceful portable gate 形成，不导出额外的 snapshot writer。

纯查询可以使用名词性结果名，但“纯”不自动推出“名词性”。
结果名必须准确指向返回对象，并足以区分相邻查询；否则使用能说明计算或选择语义的准确动词。
不要默认补一个含义空泛的 `get`、`select`、`process`、`handle` 或 `make`。

转换器只有在模块已经明确目标对象时，才可只写 `fromX`。
扁平入口同时导出多种发布包时，名字要写成 `targetFromSource`，例如 `turnFromResponses`。
名称同时表达输入协议与返回对象，调用点不必另查 `Turn`、事件还是 usage；`responsesToTurn` 虽然方向明确，但把输入放在调用点主位，不如一组 `turnFromChatCompletion` / `turnFromResponses` 先按共同返回对象聚类。

## 读取与呈现不形成作者 API

Record 的读取只经固定 Inspection operation 闭合，再交付给机器 `query` 或人读 `view`。
不导出通用聚合、作者控制的读取管道或渲染组件 API；调用者不能自定义查询、转换或呈现协议。

## 单复数跟随指代对象

名字先确定自己指什么，再决定单复数：

| 指代 | 形式 |
|---|---|
| 一个领域实体、定义、句柄或返回对象 | 单数：`Record`、`AttemptEvidence` |
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

内部 selection 若采用返回对象视角，名字和类型都以单数 Inspection result 为中心；Run、Attempt 等成员只用于说明选择维度。这条命名规则不使 reader-bound handle 获得公开资格。
若采用成员视角，就必须整组改用成员的单复数，不能一个名字指 Inspection result、另一个名字指 Runs，再靠表面对称掩盖差别。

名词性纯查询可以采用任一视角，但名词短语必须准确指向所得结果：返回对象视角按单数领域对象命名，成员视角按成员集合命名。
若去掉参数和返回类型后无法判断它是形成 Inspection result、成员集合还是布尔状态，名词短语不够清楚，应使用准确的选择动词或调整模块与调用形状。

## 状态、顺序与出处不要混成并列模式

`current` 与 `latest` 分别表达状态和顺序；`fresh` 只在 Sandbox 创建等确有用户旅途的地方表达新建出处，不能自动升级为第三种结果模式：

| 词 | 唯一含义 | 使用要求 |
|---|---|---|
| `current` | 观察时刻成立的领域状态 | 可以由多个出处共同形成；必须说明状态按什么规则成立 |
| `latest` | 在明确顺序中排在最后的实体 | 必须写清被排序的实体、分组范围与排序键；不单独充当“当前”的近义词 |
| `fresh` | 相对复用实例新建的资源或执行 | 只在新建出处会改变用户动作的局部 API 使用；结果读取面保留 provenance 字段，不据此制造第二套状态 |

因此 `latest` 不能只靠日常语感表示“最好用的当前结果”，`current` 也不能暗中表示“时间最大的 Run”。
出处差异若不改变用户决策，就只保留为明细事实；不得因为实现能区分，就增加筛选器、转换或公开状态。

`Record` 本身不是一次隐含的“最新结果”。它是由 Run 与逐个发布、不可变的 Attempt 构成的持久事实集。读取既有事实时，固定 Inspection operation 在短 scope 内形成带 expected-slot 分母的闭合 result；这份明确成员范围由该 operation 的 selector 定义。当前目标的复用与执行缺口由 reuse planning 产生，不能从读取结果反推。

## Record、Inspection 与 Delivery 的调用形状

Record source 与 selection 属于 CLI 调用点。自动化通过 `query` 发送 machine request；人通过 `view` 查看固定界面：

```sh
niceeval query run --request request.json
niceeval view --run <run-id>
```

`view` 只读取项目内 canonical `.niceeval/record.sqlite`，没有持久数据源参数；source 与 transport 规则见 [Insight CLI](feature/insight/cli.md)。

深度应用组合使用 [公开 Host composition SDK](architecture.md#公开-host-composition-sdk)。Inspection 的唯一公开 Library 入口是纯跨运行时的
`niceeval/inspection`；不存在 `/host` 子路径、alias、fallback 或 Node 专用公开面。
它只导出固定协议的 typed registry、Schema、类型、完整 document decoder 与按 operation 语义窄化函数。
reader、facts、SQLite、source selection 与 operation execution capability 都留在内部 Scope。

### 领域 API 不暴露持久写入

NiceEval 不导出通用 durable definition、Record Host 或写入 API，边界见 [Run Library](feature/run/library.md)。
普通 Eval 作者与 Plugin 作者调用领域 API；事实由所属 producer 的固定 collector 关闭后随 Attempt 发布：

```ts
export default defineEval({
  plugins: pluginStack().use(gpuEnergy({ device: 0 })),
  async test(t) {
    await t.send("完成任务");
  },
});
```

普通 `TestContext`、Plugin Hook context 与 Eval / Experiment definition 不增加 `record()`、write grant 或通用 service locator。
调用点评审只展示领域 Plugin 与 Inspection 结果，不展示 Record schema、converter、installation 或 raw projection。

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
| `niceeval/inspection` | 纯跨运行时协议入口；从同一个 typed registry 导出 request/document Schema、类型、decoder 与语义窄化函数 |
| 内部 `selectInspectionOperation(facts, operation)` | 从已打开且 pinned 的 facts 形成固定 Inspection document，并完成 selection policy 与分母判断；不是公开 Library API |

“方法更短”或“自由函数更函数式”都不是理由。
若操作跨越领域层，模块归属应让这个边界在 import 和调用点可见。
按此规则，从 Record 形成 Inspection result 的 selection 属于内部 Inspection selector 边界；公开用户
通过固定 query request 或 View selector 使用它，不把 root 字符串或 reader 暴露进 Library。

`InspectionDocument` 是 `outcome` 判别联合：`discovery | success | explanation | failure`。只有完整 document 先经
`decodeInspectionDocument(unknown)` 严格解码后，consumer 才能按 `outcome` 分支；成功或 explanation 再用具名
operation 窄化函数取得对应结果类型。Testkit 也遵守这条顺序，不能先读 `operation` 或局部字段后自行断言类型。

每个 success/explanation document 的 `source` 固定为
`{ kind: facts.kind, publicationCutoffIdentity: facts.cutoff().identity }`，完整定义见 [Inspection CLI](feature/inspection/cli.md#machine-输出与错误面)。

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

Inspection selection policy 是 operation 内部 ABI，不版本化。内建 identity 是 `explicit-runs` 与 `project-current`，输入分别由自己的具名 request shape 承载。`project-current` 比较当前项目目标与已有 Eligibility identity，并保留全部匹配结果；它不是按时间排序的模式。durable RecordAttachment persistence 仍保留独立 revision。不要把 execution `reuse | gap` 混进同一个 slot 联合。

正交约束必须写成独立字段，但前提是它对应明确用户旅途。
adoption 与 reuse 的采用动作是 Member Core 的 `action` 事实，见 [Run 架构](feature/run/architecture/README.md)；它们不膨胀成组合选择模式。

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
await writeFile("request.json", JSON.stringify({
  protocol: "niceeval.query/v1",
  operation: { kind: "run.get", runId },
}));

await niceeval(["query", "run", "--request", "request.json"]);
```

模块说明领域，函数名说明动作，参数名说明边界，类型限制合法组合。
函数名不必重复成 `executeFixedInspectionOperationAgainstCanonicalRecord`。

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

### 领域副作用与物理写入

```ts
await runHost.delete({ runId });              // 好：按具名领域操作删除 Run
deleteRecordRows({ runId });                  // 差：暴露物理持久格式
processArtifacts(input);                      // 差：process 没有用户可判断的结果
```

函数按用户任务命名，内部机制留在契约与实现。
Record、Inspection 与 Insight 的职责见 [Record](feature/run/README.md)、[Inspection](feature/inspection/README.md)
与 [Insight](feature/insight/README.md)。

### Matcher 与布尔判断

```ts
t.check(command, commandSucceeded()); // 好：调用点读成一条条件
isDefined();                          // 好：返回一个“值已定义”的 matcher
checkCommandExitCode();               // 差：描述检查步骤，没说成功条件
definedCheck();                       // 差：词序不像条件，也不与 isX 词族一致
```

Matcher 工厂的名字优先让断言句子读起来自然。
它可以是条件短语，不必为了“函数必须有动词”改成命令。

### 通用评估与应用断言

通用层拥有 Match、`check`、`closeQA`、Assertion handle、受管 Judge 与审计。
应用层拥有业务操作、事实读取和领域断言。游戏的 `systemTwo`、`said`、`operations` 与 Agent 的 `usedNoTools`、`calledTool` 属于同一层；Agent 再适配各具体 Agent。

所有领域断言都构造 Match 并交给同一 `check` 登记，不另建 evaluator。
`check(value, match)` 检查显式事实；`check(contextualMatch)` 在调用时从当前接收者的只读 ctx 读取事实。
集合材料 Match 选择符合条件的项；单个事实的上下文 Match 将聚合事实交给已有 BooleanMatch 或 ScoreMatch。

`closeQA(selector, question)` 对全部命中材料提出验收问题。
它将 selector 与 question 编译为受管评分 Match，再交给同一接收者的 `check`；handle 继续配置同一个 Assertion。
游戏使用业务 ctx reader，例如 `t.closeQA(saidMatch(npcMatch({ id: "a" })), question)`。
通用层不从任意应用 ctx 猜测默认材料。

Agent 应用提供 `t.closeQA(question)`、`turn.closeQA(question)` 与 `session.closeQA(question)` 简写，默认读取当前 scope 的完整材料。
作者也可用显式领域 Match 筛选全部命中项。两种调用都使用同一通用问答组合，完整性、预算、取消与审计规则相同。
`usedNoTools()` 是零参数领域断言，不接额外 Match；它要求工具集合计数为 exact zero，未知集合不能证明没有发生。

`defineJudge` 返回真实 ScoreMatch。`check(value, scoreMatch)` 与便利入口 `judge(value, scoreMatch)` 都接受 ScoreMatch，共享登记和受管评分路径。
具体调用与材料规则见 [Judge Library](feature/judge/library.md) 和 [自定义 Match](feature/assertions/library/custom-assertions.md)。

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

## 公开入口的单一职责

根入口提供作者定义与作者所需的错误值。本次只撤销下文列举的运行时导出，其余值与现有类型出口保留。

`defineModelRoles` 从根入口导出，命名理由与完整改名表见下文[模型用途统一称为 role](#模型用途统一称为-role)。
`ExperimentFatalError`、`EvalFatalError`、`failureClassOf` 和 `MigrationRequiredError` 也保留在根入口。

判据构造统一从 `/expect` 导入：

- `defineJudge`、`defineScoreMatch`、`defineMaterialMatch`、`defineContextMatch`。
- `factuality`、`faithfulness`、`instructionFollowing`、`pairwisePreference`。

根入口不再重复导出这些运行时值；能力和执行语义不变。审计 reader `readScoreMatchAudit` 只从 `/inspection` 导出。
现有类型导出保留，不要求作者为本次入口收敛重新组织纯类型依赖。

通用工具 `requireEnv`、`getEnv` 与 `stripComments` 不属于评估 Library 的公开职责。
移除其根导出，内部进程变量读取及文本 matcher 的 `stripComments` 选项不变。
Sandbox 的 profile 查找函数只保留 `resolveDockerProfile` 这个名称，删除同实现的 `resolveDockerProfileAlias`。
内部不再保留没有调用点的 `CASE_LOCK_EXPIRY_MS` 常量。

这些改动属于 minor 的入口迁移，不增加 deprecated 转发层。
判据与审计 reader 只调整 import；Docker profile 查找函数改为保留名称。三个通用工具由调用方自行提供，
不能只改 import；进程变量工具原来把空串当作缺失，迁移到 `process.env` 时需自行决定这一行为。
同步对应设计正文、公开文档、示例和测试；生成区块由源 owner 及既有生成命令更新。
不改变判据、资源或结果数据，不修改两个下游仓库。

安装发布包后的验收分别检查 ESM/CJS 中保留入口存在、撤销入口缺失，且 `/expect` 工厂维持同一函数身份。
保留入口构造的普通与受管 ScoreMatch、MaterialMatch、ContextMatch 必须能被真实 Assertion 消费。
混合模块消费与 `.mts`、`.cts` 类型检查需包含保留的根类型；审计 reader 比较两种模块的解码行为，
不要求独立浏览器 ESM bundle 与 CJS reader 的函数身份相同。
当前 Record 读取、迁移恢复、资源账本和第三方协议解码不因名称含 legacy 而删除。

## 模型用途统一称为 role

一个 Experiment 可以为应用声明多个模型用途，例如 `mind` 与 `speech`。
这些键表达“这个模型在应用里担任什么角色”，不是可插拔的空位。
它们也不与 Run 的 Planned attempt 或 Adapter 的 SessionKey 同义。
仓库里 slot 已经指称 Run 分母成员与会话存储；再让它表示模型用途，同一词根会在相邻 API 里指向三种对象。
因此作者可见的模型用途统一使用 role：

| 旧名 | 新名 |
| --- | --- |
| `defineModelSlots(...)` | `defineModelRoles(...)` |
| `ModelSlotSelection` | `ModelRoleSelection` |
| `ctx.recordUsage({ modelSlot })` | `ctx.recordUsage({ modelRole })` |
| `cacheRead.modelSlots[]` 及其中 `modelSlot` | `cacheRead.roles[]` 及其中 `modelRole` |
| `models[]` 分组键 `[modelSlot, provider, model]` | `[modelRole, provider, model]` |
| unavailable 原因 `slot-has-no-calls` | `role-has-no-calls` |
| 错误文案 `undeclared model slots` | `undeclared model roles` |

`t.usage.cacheRead.rate(role?)`、`requires: { models }`、Experiment 的 `models` 与 `ctx.models` 字段名不变；
`rate` 的参数名改为 `role`。`show`、`show --json`、`query` 输出与 `view` 中描述模型用途的字段和文案同步改为 role。
内部类型与函数随之改名，例如 `ResolvedModelRoles`、`normalizeModelRoles`、`assertRequiredModelRoles`，源码模块改为 `model-roles.ts`。
不保留 `defineModelSlots` 或 `modelSlot` 的 deprecated 转发；beta 期直接迁移，升级说明给出逐项替换。

持久编码不改：adapter-usage Record 的 `modelSlot` 列与 revision 保持原样。
config identity 中 `models: { version: 1, slots }` 的编码也保持原样，只在 decode/projection 边界映射到 role。
这样已落盘的 Record 无需迁移，下游已有结果不会因改名变成 `previous-result`。
新增 Record revision 或改 identity 编码不属于本次改名。

验收：安装后候选的 `.mts` 与 `.cts` 类型检查中，`rate("mimd")`、未声明的 `modelRole` 编译失败，旧名导入编译失败；
0.18 写入的 Record 被候选读取后以 role 字段呈现；同一份 Experiment 在 0.18 与候选下的 config identity 相同。

## 扩展与配置面的保留裁决

0.18 交给维护方裁决的表面按真实使用证据定案。
证据范围是本仓库 E2E 与示例，以及 terminal-bench、MemoryBench、NiceEval-Eval、ljkx-game、rpg-game 五个已知使用方的作者源码。

删除：

- `Config.workspace`：没有任何读取者，是无效字段。
- `Eval.reporters`：逐 Eval 的报告器没有使用方；报告输出属于项目级。
- `Experiment.classifyFailure`：没有使用方，失败分类保留内建语义与 `ExperimentFatalError` / `EvalFatalError`。
- `niceeval run show <run-id>`：与 `niceeval show --run <run-id>` 消费同一 `run.get`，保留后者作为唯一读取入口。
  `run` 命令组只保留 list、delete、recover 这类 Run 生命周期动作。

保留：

- NiceEval Plugin：保留并重构为可复用的实验条件，见[Plugin 是一个可复用的实验条件](#plugin-是一个可复用的实验条件)。
- `Config.reporters` 与内建 Json、JUnit、Braintrust：这是 CI 与外部实验平台的项目级集成出口。
- `Eval.diff` 与 `Eval.metadata`：terminal-bench 全部题目、MemoryBench 大部分题目在用；0.18 盘点漏扫了这两个使用方。
- `maxBuildConcurrency`、`maxSetupPrefixConcurrency`：各自约束独立资源，删除后没有替代旋钮。
- 旧 Record、RunContext 与 trace 的读取迁移链：下游已落盘的付费结果依赖它们保持可读。
- `model` / `reasoningEffort` 简写：见下节。

被删字段若出现在作者配置中，加载时以说明替代方式的错误拒绝，而不是静默忽略。
未使用被删字段的 Experiment，其 config identity 与 0.18 完全相同，已有结果继续 carry。

## Experiment 只用 adapter 选择被测对象

Experiment 的 `agent` 字段删除，统一写 `adapter`。
`defineAgent` 与 `defineSandboxAgent` 的返回值本身就是 Adapter，可直接放进 `adapter`；两个工厂不变。
定义时出现 `agent` 以说明替代写法的错误拒绝。
被测对象的 config identity 与 0.18 写 `agent` 时完全相同，已有结果继续 carry。

`model` / `reasoningEffort` 简写保留，`models` 也保留，二者不是重复入口。
前者服务只有一个模型的 Agent，在定义边界归一为唯一的 `default` role；后者服务声明多个 role 的 Adapter。
两者仍互斥，已有归一与 identity 不变。

## 生命周期统一用 before / after

作者声明生命周期 Hook 只用一对词：`before` 与 `after`。
Hook 包裹哪段工作、在宿主还是 Sandbox 内执行、多久执行一次，由它所在的字段或对象说明，不由动词说明。
`before` 可以链式或以数组追加多步，`after` 按完全逆序执行。

| 旧写法 | 新写法 | 包裹的工作 |
| --- | --- | --- |
| Experiment `setup` / `teardown` | `before` / `after` | 宿主侧，一次 Run 的全部 Attempt |
| SandboxLayer `.before()` / `.after()` | 不变 | Sandbox 内，该实例上的 Agent 运行 |
| Agent factory `postSetup` / `preTeardown` | `before` / `after` | Sandbox 内，Agent 安装之后、收尾之前 |
| `defineAgent` / `defineSandboxAgent` 的 `setup` / `teardown` | `before` / `after` | 自定义 Agent 的会话前后 |
| Plugin 各字段 | `before` / `after`，见下节 | 由字段决定 |

`setup` / `teardown` 与 `postSetup` / `preTeardown` 不保留别名；出现旧名时，定义期以指向新名的错误拒绝。
2026-07-18 的裁决确定的是“成对字段、不用 setup 返回 cleanup”，这一结构保留，本次只替换词。
两对词并存时，读者无法从名字判断它们是否是同一机制，因此只留一对。
改名不改变执行顺序、触发规则与失败语义，也不改内部 identity 与 Record 编码。
同一份声明改用新名后，config identity 与 0.18 相同；能否 carry 仍受 Eval sourceClosure 等既有规则约束。

## Plugin 是一个可复用的实验条件

一个实验条件（例如 mempal 记忆、mem0 记忆、terminal-bench harness）通常同时需要 Agent 扩展、Sandbox 步骤、
宿主侧的前后步骤和一份条件身份。Plugin 把这些装进一个值，Experiment 只写一次 `plugins: [mempal(...)]`。
旧 Plugin 只承载生命周期，条件仍要拆到 agent、flags、sandbox 三处。本节替换它的语法与挂载语义。

### 定义

```ts
import { definePlugin } from "niceeval/plugin";

export const mempal = definePlugin((options: { tool: "codex" | "claude"; cohort: string }) => ({
  name: "mempal",
  key: options.tool,
  identity: { version: "0.9.0", install: "r6", cohort: options.cohort },
  requires: { evalGroup: true },
  agent: { skills: [mempalSkill] },
  sandbox: {
    before: [installMempal(options.tool), loadCheckpoint],
    after: [saveCheckpoint],
  },
}));

export default defineExperiment({
  adapter: codexAgent(),
  model: "gpt-5.6-luna",
  sandbox: memorybenchBase("codex"),
  plugins: [mempal({ tool: "codex", cohort: "2026-10" })],
});
```

`definePlugin(spec)` 直接返回 Plugin 实例；`definePlugin((options) => spec)` 返回接收一个参数的工厂。
spec 的字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 必填，非空字符串 |
| `key` | 可选，默认 `"default"`；同名 Plugin 的多个实例用它区分 |
| `identity` | 必填的 JSON 对象，可以为 `{}`；条件的唯一版本 |
| `requires` | 可选；`{ evalGroup: true }` 要求作用范围内的 Eval 都属于 Eval Group |
| `agent` | Agent 扩展，见下文 |
| `experiment` | `{ before?, after? }`，宿主侧，每次 Run 一次 |
| `group` | `{ before?, after? }`，宿主侧，每条 Eval Group lane 一次 |
| `sandbox` | `{ before?, after? }`，Sandbox 内，等同挂载点 SandboxLayer 的 `.before()` / `.after()` |
| `attempt` | `{ before?, after? }`，宿主侧，每条 fresh Attempt 一次 |

除 `name`、`key`、`identity`、`requires` 外至少声明一个字段。每个 `before` / `after` 接受一个元素或数组。
`behaviorRevision`、`instanceKey`、`pluginStack()`、旧的 `eval` 字段与按 owner 交集收窄的重载全部删除。
`plugins` 只接受 readonly 数组。

### 挂载点决定范围，字段决定时机

| 挂载在 | 允许的字段 | 作用范围 |
| --- | --- | --- |
| `Experiment.plugins` | 全部 | 该 Experiment 选中的全部 Eval |
| `EvalGroup.plugins` | `group`、`sandbox`、`attempt` | 该 Group 的成员 |
| `Eval.plugins` | `sandbox`、`attempt` | 该 Eval |

挂在 Experiment 上的 Plugin，其 `group` 字段对该 Experiment 的每条 Group lane 生效，`attempt` 字段对每条 fresh Attempt 生效。
未分组的 Eval 不激活 `group` 字段。挂载点不允许的字段在加载期以错误拒绝，类型层面同样拒绝。

激活只针对实际执行的工作：

- `experiment` 只在本次 Run 至少有一条 fresh Attempt 时激活；全部 carry 时不执行任何 Plugin Hook，也不创建 Sandbox。
- `group` 每条至少有一条 fresh Attempt 的 lane 激活一次，replacement Sandbox 不重新执行。
- `attempt` 每条 fresh Attempt 激活一次。

`requires: { evalGroup: true }` 在完整 selection 形成后、任何 build、prepare、Sandbox 创建或宿主 Hook 之前检查作用范围内的全部选中 Eval，含将被 carry 的 Eval。
有 Eval 不属于 Eval Group 时报 `plugin-requires-eval-group`，并列出这些 Eval。
声明后，该 Plugin 的 `sandbox` 与 `attempt` Hook 上下文中 `evalGroup` 类型上必有，作者不再写运行时判空；未声明时它是可选字段，非 Group 的 Eval 上为 undefined。

### `sandbox` 字段就是一段 SandboxLayer

`sandbox: { before, after }` 与在挂载点自己的 SandboxLayer 上追加 `.before(...)` / `.after(...)` 完全等价，不引入新的物理生命周期：

- 元素是受管 Action（如 `writeText`、`uploadDirectory`）或 `(sandbox, ctx) => …` 回调，与 `.before()` / `.after()` 参数相同。
- 每条 Attempt 形成一次 occurrence，题间 reset 之后执行；受管 Action 照常参与 Action DAG 排序与 before cache，回调每次真实执行。
- 回调上下文就是现有 `SandboxCommandContext`，绑定当前 Attempt 与它的 signal、deadline。
- Experiment 挂载的 Plugin 投影到 Experiment layer，EvalGroup 与 Eval 挂载的分别投影到对应 owner layer。
- 挂在 Eval 上的 `sandbox` 字段隔离普通 reuse pool；同一 Group 成员的 Sandbox 字段身份不同时，在创建前报 `eval-group-incompatible`。

需要“整条 lane 只做一次”的宿主侧工作写在 `group.before` / `group.after`；需要每题恢复与保存的 Sandbox 状态写在 `sandbox`。

### Agent 扩展

```ts
agent: {
  skills?: readonly SkillSpec[];
  mcpServers?: readonly McpServer[];
  codex?: { plugins?, configFile?, before?, after? };
  claudeCode?: { plugins?, settingsFile?, before?, after? };
  bub?: { pythonPlugins?, before?, after? };
}
```

`agent` 只允许挂在 Experiment 上。按 agent 区分的子字段与对应 factory 的同名配置形状相同。
合并规则：

- factory 自身配置在前，各 Plugin 按数组顺序追加；`before` 按同一顺序执行，`after` 逆序执行。
- 合并后的 `before` / `after` 保留 factory 的既有失败语义：任一步失败使该 Attempt 失败，其余 `after` 与底层 finalizer 仍执行。
  因此 Nowledge、mem0 这类“条件仍有效”的探针放在 `agent.*.after`，失败会反映在结果里。
- skill 名、MCP server 名、原生插件名重复时，加载期报错并给出两处声明位置。
- `configFile` / `settingsFile` 只能由 factory 或一个 Plugin 声明。
- 所选 Adapter 不支持某个通用字段（例如 Bub 没有 `mcpServers`）时报错，不静默丢弃。
- Plugin 声明了按 agent 区分的子字段、却没有所选 Adapter 的那一项时报错；只有通用字段的 Plugin 可用于任意内建 coding agent。
- 自定义 Adapter（`defineAdapter`）不接受 `agent` 扩展，挂载时报错。

合并结果就是 Adapter 实际收到的配置，与直接写在 factory 中的同一配置执行效果相同。
连接参数、凭据仍在 Adapter 构造或 Hook 执行时求值，Plugin 不提前读取或保存它们。

### 顺序与失败

宿主 Hook（`experiment`、`group`、`attempt`）严格按声明顺序执行：

- before：作者自己的 Hook 先执行；Plugin 再按挂载层级（Experiment、EvalGroup、Eval）与数组顺序执行。
- after：按实际已激活顺序完全逆序，因此 Plugin 的 after 先于作者自己的 after。
- before 调用前先计入已激活前缀，自身失败也会得到对应 after；未激活的 Plugin 不执行 after。
- 任一 before 失败跳过其后的业务阶段。宿主 after 失败只追加 warning diagnostic，不跳过剩余 after 或底层 finalizer。
- 宿主 after 使用独立的收尾 signal 与预算，不继承已耗尽的执行 deadline。

`sandbox` 字段的元素加入 Action DAG，顺序服从现有规则：依赖优先，其次 changeFrequency，最后 owner 与声明序号。
Plugin 元素的声明序号排在同一 owner 作者元素之后；数组顺序不构成依赖，需要先后关系时显式写 `dependsOn`。
`niceeval debug <experiment> <eval>` 展示展开后的完整生命周期与实际 Action 顺序，每一步标出声明它的 Plugin 的 `name` 与 `key`。

### 身份

每个生效的 Plugin 以下列投影进入 Attempt fingerprint，按挂载层级与数组顺序排列：

| 投影项 | 内容 |
| --- | --- |
| 挂载 | 挂载层级、在数组中的位置 |
| 名称 | `name`、`key` |
| 版本 | `identity`、`requires` |
| 形状 | 声明了哪些字段，以及每个 before / after 的元素个数 |
| Sandbox | `sandbox` 字段中受管 Action 的 canonical identity，与作者 layer 中的同一 Action 完全相同 |
| Agent | `agent` 字段的无凭据投影：skill 规格与内容摘要、MCP 的 name / command / args / url（不含 headers 与 env）、原生插件规格、配置文件内容摘要 |

回调函数体不进入 Plugin 投影。只改 Experiment 模块里 Plugin 回调的函数体时，结果继续 carry；需要重跑时修改 `identity` 或显式 `--rerun all`。
Eval 模块及其静态 import 仍按既有 sourceClosure 规则进入 fingerprint，Plugin 不绕开它。
同一 Attempt 的生效集合里 `(name, key)` 重复时，加载期报错；这比旧 Plugin 的同 scope 检查更严格。

`show --exp`、`show --json` 与 `view` 的 Experiment 信息列出生效 Plugin 的 `name`、`key` 与 `identity`。
条件版本因此不需要另写一份 flags。Plugin identity 不进入 `ctx.flags`；Adapter 与 Eval 需要读取的条件参数仍用 flags。
没有挂载 Plugin 的 Experiment，其 config identity 与 0.18 相同。旧 Plugin 写法迁移到新语法后不保证 carry。

### 验收

全部经安装后候选的公开入口，通过 `show`、`query`、`debug` 观察，不读私有缓存目录。

- mempal 形态的 Plugin 挂在 Experiment 上，两个 Group 各两个 Eval：`group.before` 每条 lane 一次；`sandbox` 元素每条 Attempt 一次，replacement 后照常执行；workdir 内 marker 跨 Attempt 的可见性与作者 layer 相同。
- 全部 carry 时零 Hook、零 Sandbox 创建；部分 carry、只选一个 Group 成员时只激活 fresh 的部分。
- before 中途失败与取消：已激活前缀得到 after，未激活的不执行；某个 after 失败后其余 after 与 finalizer 仍执行；`group.after` 在首条 Attempt 超时后仍有收尾预算。
- `agent.codex.after` 探针抛错使该 Attempt 失败，且剩余 after 与 finalizer 完成。
- Group 外的 Eval 触发 `plugin-requires-eval-group`，在任何 build 与 Sandbox 创建前失败，含全部 carry 的情况。
- `.mts` 与 `.cts`：声明 requires 的 Plugin 回调可直接读 `ctx.evalGroup.id`，未声明时直接读编译失败；挂载点不允许的字段编译失败，运行时同样拒绝。
- Agent 扩展在 Codex 与 Claude Code 上都实际安装；重名、多个 configFile、Bub 的 `mcpServers`、缺目标 agent 子字段、`defineAdapter` 加 `agent` 扩展各自报出具名错误。
- 身份反例：`identity` 固定时改 `writeText` 内容不再 carry；改 skill 内容不再 carry；只换 MCP header 凭据仍 carry；只改 Experiment 模块里回调函数体仍 carry；改 Eval 模块里的回调不再 carry。
- 顺序反例：作者 Action frequency=100、Plugin Action frequency=10 且无依赖时，`debug` 显示 Plugin Action 先执行；加 `dependsOn` 后顺序反转。
- 没有 Plugin 的 Experiment 在 0.18 与候选下 config identity 相同；Experiment `setup` 改写为 `before`、`postSetup` 改写为 `before` 后 identity 不变。

## 只展示的 Note：`t.note`

```ts
t.note("出手频率", result.activity);
t.note("首个决策延迟", ms(result.firstDecisionMs));
```

`t.note(label, value)` 写入一条不参与判定的展示项。

- 它没有 matcher、gate、score，不进入 Verdict、score 与 coverage，也不计入 Assertion 数量。
- value 是 JSON 值或 `Quantity`（见下节）；null 表示该项未取得，呈现为 unavailable。
- 同一 Attempt 内 label 唯一。重复 label、超过 64 项或单项 JSON 超过 64 KiB 时，`t.note` 抛出 TypeError。

Note 不是 Assertion。Record 新增 `attempt-note` family（revision 1），每项保存 label、按调用顺序的序号、value 与可选 unit。
旧 Record 没有该 family，读取为空列表。

呈现：

- `show @<locator>` 在 Assertion 之后列出 Notes；`--json` 与 `query` 的 Attempt 结果带 `notes`。
- `show --exp` 对同一 label、同一单位的数值 Note，跨 Attempt 给出 count、min、median、p90、max。
- `view` 的 Attempt 详情展示同一内容。

## 数值单位

单位从 `/expect` 的构造函数取得：

| 构造 | 单位 |
| --- | --- |
| `ms(n)` | 毫秒 |
| `seconds(n)` | 秒 |
| `tokens(n)` | token 数 |
| `usd(n)` | 美元 |
| `ratio(n)` | [0,1] 之间的比例，越界抛出 RangeError |
| `count(n)` | 计数 |
| `bytes(n)` | 字节 |

构造返回冻结对象 `Quantity<U> = { readonly value: number; readonly unit: U }`，带编译期品牌。
单位必须在运行时可见，JS 的原始 number 无法携带它，因此 `Quantity` 不是 number，也不参与算术。
作者先用 number 计算，再在交给 NiceEval 的边界包装；取数值读 `.value`。NiceEval 不提供单位换算或单位算术。
`n` 必须是有限数，否则抛出 RangeError。

消费方式：

- `measured(value, opts)` 与 `t.note` 接受 `Quantity<U>`；`measured` 产出的 `NumericMaterial<U>` 携带 unit。
- `quantile(samples, p, opts)` 接受 `readonly number[]` 或单位一致的 `readonly Quantity<U>[]`，后者保留 unit；混合单位在运行时抛出 TypeError。
- `t.usage.cacheRead.rate(role?)` 返回 `NumericMaterial<"ratio">`。

数值 matcher（`atLeast`、`atMost`、`greaterThan`、`lessThan`、`between` 等）对有单位的材料要求同单位阈值。
`t.check(latency, atMost(ms(500)))` 通过编译；`atMost(seconds(1))` 与未包装的 `500` 编译失败。
无单位材料继续接受普通 number 阈值，不接受 `Quantity`。
运行时同样比对单位；类型被绕过时，结果为 unavailable 并给出原因，不按数值比较。

NumericMaterial 的 Record 编码新增可选 `unit`；旧 Record 未提供时视为无单位。
`show`、`view` 按单位格式化，例如 `512 ms`、`61.2%`、`$0.031`。

## Bub 与 OpenCode 只读取固定版本的协议

Bub Adapter 只支持 Adapter 当前固定的 Bub 版本。
删除 0.3.9 legacy live 版本线、对应 E2E Experiment，以及只为旧 top-level `type` 事件存在的 parser 分支。
OpenCode parser 只保留固定版本 CLI 实际产出的 JSONL 事件与 `export` 形状，删除其它字段 fallback。

固定版本产出的真实样本作为 parser 的 fixture。
parser 不认识的事件不进入 `Turn.events`，也不静默丢弃：每条 Attempt 追加一条 warning diagnostic `agent-event-unrecognized`，列出事件类型与次数。
已落盘 Record 中的事件是 parse 后的形状，不受影响。产品站的 `/en/*` 与 www 308 重定向属于公开链接，保留。

## 0.19 命名收敛

作者可见名字按本篇准则逐项收敛。持久编码（Record 字段、identity 编码、缓存键内部字段）不改，只在 decode / projection 边界映射到新名。
旧名不保留别名；定义期或 argv parse 时，以指向新名的错误拒绝。

### 生命周期词汇的遗漏位置

| 旧名 | 新名 |
| --- | --- |
| setup prefix 概念、`SetupPrefixKey` | before cache、`BeforeCacheKey` |
| `Config.maxSetupPrefixConcurrency`、`--max-setup-prefix-concurrency` | `maxBeforeCacheConcurrency`、`--max-before-cache-concurrency` |
| `sandboxCache.setup`、`SandboxSetupCache` | `sandboxCache.before`、`SandboxBeforeCache` |
| summary 的 `setupPrefixes`、debug 的 `setupPrefixPlan` | `beforeCaches`、`beforeCachePlan` |
| `AgentSetup` / `AgentTeardown` 等 Agent 生命周期类型 | `AgentBefore` / `AgentAfter` 等 |
| `SandboxCommandContext.phase` 的 `agent.post-setup` / `agent.pre-teardown` | `agent.before` / `agent.after` |
| timing 与 diagnostic activity 的 `*.setup` / `*.teardown` | `*.before` / `*.after` |
| `experimentHost.teardown`、`hasSetup` / `hasTeardown`、`teardown-required` | `experimentHost.after`、`hasBefore` / `hasAfter`、`after-required` |
| `niceeval exp --teardown` | `niceeval exp --after` |

`ExperimentHook`、`SandboxHookContext` 等不含 setup 词根的类型保留。Agent 安装事实不是生命周期，改用 installation：

- `AgentSetupManifest` → `AgentInstallationManifest`
- `ctx.reportSetup` → `ctx.reportInstallation`
- `EvalResult.agentSetup` → `agentInstallation`

### 公开入口只留作者 API

以下运行时导出属于内部实现，从公开子路径撤销，不提供替代：

- `/sandbox` 身份计算：`computeBuildKey`、`computeCaseKey`、`credentialIdentityContribution`、`assertPureDataIdentity`、`looksLikeDigestRef`。
- `/sandbox` Compose 编译：`COMPOSE_MATERIALIZER_REVISION`、`collectComposeBuilds`、`leakGateHintsFromComposeFile`。
- `/sandbox` Compose 校验与生成：`assertComposeBlacklist`、`findComposeBlacklistViolations`、`buildComposeOverlay`、`materializeDockerComposeProviderCase`。
- `/sandbox` 构建调度：`SANDBOX_BUILD_ACTIVITY`、`prepareSandboxBuilds`、`startSandboxBuilds`、`buildFailureOrigin`、`materializationScopeId`、`sandboxBuildRef`。
- `/sandbox` 其它：`normalizeSandboxCapture` 及其类型，Docker profile 的内部策略常量。
- `/loaders`：`captureLoadedFiles` 及其类型；只保留 `loadJson`、`loadText`、`loadYaml` 等加载函数与输入类型。
- `/inspection`：`canonicalInspectionJson`、`canonicalJsonValue`、`closeInspectionJson`。

同一实现的多个名字只留一个：

| 保留 | 删除 |
| --- | --- |
| `decodeDockerExecutionProfile` | `parseDockerExecutionProfile`、`parseDockerExecutionProfileV1`、`decodeDockerExecutionProfileV1` |
| `defineDockerExecutionProfile` | `makeDockerExecutionProfileV1`、`createDockerExecutionProfileV1` |
| `indexDockerProfiles` | `createDockerProfileRegistry`、`parseDockerProfileRegistry` |
| `resolveDockerProfile` | `resolveDockerExecutionProfile` |
| `DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION` | `DOCKER_PROFILE_SCHEMA_VERSION` |

### 作者字段与 CLI

| 旧名 | 新名 | 理由 |
| --- | --- | --- |
| `bubAgent({ apiBase })` | `baseUrl` | 与其它 Agent factory 同一概念 |
| `t.o11y`、`O11ySummary` | `t.observability`、`ObservabilitySummary` | 内部目录缩写不进入作者面 |
| `turn.message` | `turn.reply` | 与 `t.reply`、`session.reply` 同指 Agent 返回文字 |
| `Experiment.judgeRuntime`、`Eval.judge` | 均为 `judge` | 同一 `JudgeSelection`，按 Experiment → Eval → Config 优先级合并 |
| `Config.judgeRuntime` | `judgeProvider` | 类型是 JudgeProvider，不是选择 |
| `niceeval session list/show` | `niceeval invocation list/show` | session 已指 Agent 会话 |
| `niceeval sandbox --record <record-root>` | `--record-root` | `--record` 在 query/show 指单个 Record 文件 |

文档中的 `prepare()`、`SandboxAgent.setup` 等遗留词同步改为现行名字。
`defineEval`、`check`、`shell`、`command`、`createSessionSlot`、`create*EventStream` 等名字保持不变。

### 不再用 slot

slot 在仓库里同时指 Run 的 expected 位置、全局并发名额、Adapter 会话状态键和 Judge recipe 输入，读者无法从词本身判断对象。
作者与读者可见的位置不再使用 slot，按对象改名：

| 对象 | 旧名 | 新名 |
| --- | --- | --- |
| Run 创建时冻结的 expected 位置 | Slot、`slotId`、`expectedSlots`、`originSlotId` | Planned attempt、`plannedAttemptId`、`plannedAttempts`、`originPlannedAttemptId` |
| `show` 的完整度统计 | `Selected slots` 等三行统计 | Planned / Recorded / Missing attempts |
| 全局 `maxConcurrency` 名额 | Concurrency slot、`waiting for a slot` | 并发名额、`waiting for capacity` |
| Adapter 私有会话状态键 | `createSessionSlot`、`SessionSlot` | `createSessionKey`、`SessionKey` |
| Judge recipe 的材料输入 | recipe slot | recipe input |

Planned attempt 与 Attempt 的关系不变：Attempt 是已发布的执行事实，Planned attempt 是 Run 对它的期望位置，
通过 Member 以 origin 或 reference 方式绑定，未绑定时以 absence reason 收口。

`query` 协议升级为 `niceeval.query/v2`，字段按上表改名，其余结构不变；`/inspection` 的 decoder 只接受 v2。
Record 的 slot 列、`RunSlotPublication` 等持久编码与 identity 编码不改，只在 projection 边界映射。
`docs/concepts.md` 的「执行槽位」条目改为「计划 Attempt / Planned attempt」，所有 Feature 与公开文档同步。
