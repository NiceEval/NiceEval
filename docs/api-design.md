# API 设计

niceeval 的公开 API 先定义用户能观察到的语义，再决定名字、参数与类型。名字只声明一次，却会在每个
调用点反复出现；评审因此以完整调用为单位，不孤立评价一个标识符。

本篇约束 TypeScript Library API，包括根入口、子路径导出、公开类型、函数、方法、组件和配置字段。
CLI 的命令与 flag 另见 [CLI](cli.md)，但沿用同一条调用点清晰原则。

## 首要标准：调用点清晰

API 应让第一次使用它的人在调用处看出“这一步要什么、会发生什么、得到什么”：

```ts
const record = await openRecord(".niceeval");
const data = await metricTableData(sample, spec);
```

`openRecord` 表明它会打开外部资源，`metricTableData` 表明它返回指标表的数据。两者不需要把 reader、
文件扫描、聚合循环或序列化步骤写进名字。

清晰优先于简短，但长度不是清晰的替代品。名字变长若能消除相邻 API 的实质歧义，就保留必要词；
模块、参数和返回类型已经表达的信息不重复。

## 先定语义，再定语法

命名前先回答四个问题：

1. 返回或改变的领域对象是什么？
2. 这是纯查询、转换、定义、资源操作，还是会产生外部副作用的命令？
3. 调用者为什么需要它？
4. 最容易与哪个相邻 API 选错？

答不出对象是什么时，不先争论单复数；答不出动作类型时，不先套“动词 + 名词”。一个名字语法正确，
仍可能指向错误的领域概念。

公开名字只使用 [Concepts](concepts.md) 已有的领域词，或与 API 同批立下的新词。实现类型、算法步骤、
存储布局和历史包名不因“源码里已经这么叫”自动获得公开资格。

## 名字跟随 API 角色

函数没有统一的“动词 + 名词”公式。符号扮演什么角色，决定它使用哪种语法：

| 角色 | 命名形态 | 例子 |
|---|---|---|
| 执行动作或产生副作用 | 动词短语 | `publish`、`runEvals` |
| 打开、加载或读取外部资源 | `openX` / `loadX` / `readX` | `openRecord`、`loadYaml` |
| 创建运行时对象 | `createX` | `createAgentSession` |
| 声明并校验定义 | `defineX` | `defineEval`、`defineMetric` |
| 返回逻辑视图或派生数据 | 结果名或准确的计算动词 | `metricTableData`、`estimateCost` |
| 判断条件 | `isX` / `hasX` / `canX` | `isDefined`、`hasSections` |
| 转换表示 | `toX` / `fromX` | `fromResponses` |
| 收窄不可变集合 | `filterX` / `onlyX` / `dropX` | `filterBy`、`dropExperiments` |
| 类型、组件与值对象 | 名词 | `Sample`、`MetricTable`、`AttemptEvidence` |
| 事件回调 | `onX` | `onEvalComplete` |

同一个前缀只表达一种稳定动作：

- `defineX` 返回可签入、可组合的声明，不打开资源或启动运行时对象。
- `createX` 创建运行时实例，不冒充纯定义。
- `openX` 建立到外部资源的读取面，错误必须能定位该资源。
- `loadX` 把外部内容完整读入值，不暗示持续句柄。
- `publish` 跨可信边界构造自包含产物，不只是文件复制。

纯查询可以使用名词性结果名。为它机械添加 `get` 不会增加语义：

```ts
const data = await metricTableData(sample, spec);     // 好
const data = await getMetricTableData(sample, spec);  // 差：get 没说明新事实
```

如果名词性函数在调用点会被误认成值、组件或构造器，再选择准确动词；不要默认补一个含义空泛的
`get`、`process`、`handle` 或 `make`。

## 单复数跟随指代对象

名字先确定自己指什么，再决定单复数：

| 指代 | 形式 |
|---|---|
| 一个领域实体、定义、句柄或返回对象 | 单数：`Record`、`Sample`、`AttemptEvidence` |
| 返回或操作的一组同类成员 | 复数：`experiments`、`attempts`、`dropExperiments` |
| 集合类型自身 | 单数类型名，成员字段用复数 |
| 复合名词里的类型修饰语 | 通常用单数，如 `metricTableData`、`attemptHref` |

一组相邻 API 必须采用同一种指代视角。不能一边按返回对象命名，另一边按内部遍历成员命名，
再用单复数制造表面对称。

返回集合不表示函数名必然复数。`openRecord()` 返回一个带集合导航能力的 `Record`，所以是单数；
`dropExperiments()` 的动作直接作用于多个 Experiment，所以是复数。

## 相邻 API 按选择维度成组设计

两个 API 会出现在同一张选择表时，必须一起命名。名字要暴露调用者真正需要判断的差别，而不是让
两边只靠文档、参数默认值或返回类型区分。

历史上的 `results.latest()` / `results.current()` 是反例：两个日常英语近义词承载了差异很大的
选择行为。调用者必须先记住实现，才能知道该选哪个。

成组评审至少写出：

| 项目 | API A | API B |
|---|---|---|
| 用户问题 | 它回答什么 | 它回答什么 |
| 输入边界 | 从哪里选 | 从哪里选 |
| 输出实体 | 返回什么 | 返回什么 |
| 可观察差异 | 哪个场景会给出不同答案 | 同左 |
| 错选风险 | 会漏掉或混入什么 | 同左 |

成组 API 不要求共享前缀。词形对称若会掩盖实质差别，优先保留语义对照。

## 名字、模块、参数与类型共同说明

评审完整调用，而不是只读导出名：

```ts
import { publish } from "niceeval/record";

await publish(sample, outputDir, {
  artifacts: ["events", "trace"],
});
```

模块说明领域，函数名说明动作，参数名说明边界，类型限制合法组合。函数名不必重复成
`publishRecordSampleToDirectory`。

参数遵守三条规则：

- 对调用者有领域意义的选择使用具名对象参数。
- 不使用含混的位置布尔值；布尔字段用肯定形式，并让 `true` 的行为可直接读出。
- 两个参数不能互换时，名字要在调用点暴露角色，不只依赖相同的 `string` 类型。

返回类型不能补救含混名字。IDE 能显示类型，不代表读代码的人应该悬停以后才知道调用做了什么。

## 仓库正反例

### 定义与创建

```ts
defineEval({ ... });  // 好：声明一条 Eval
createEval({ ... });  // 差：暗示创建运行时实例
makeEval({ ... });    // 差：make 没说明定义、验证还是执行
```

`defineEval` 与 `defineExperiment` 共享“声明产品配置”的动作词族。新增同类 API 应先判断能否进入这个
词族，不为局部偏好另造 `declareX` 或 `specX`。

### 打开事实与读取文件

```ts
openRecord(".niceeval");  // 好：打开记录根，返回可导航的事实句柄
getResults(".niceeval");  // 差：Results 指代不明，get 也没交代资源边界
loadRecord(".niceeval");  // 差：若返回懒读取句柄，load 会错误暗示已经完整读入
```

`open` 与 `load` 的差别是可观察契约，不是措辞喜好。

### 发布与复制

```ts
publish(sample, dir);       // 好：按发布边界构造自包含产物
copyRuns(sample, dir);      // 差：把解引用、覆盖补记与预检讲成文件复制
processArtifacts(sample);   // 差：process 没有用户可判断的结果
```

函数按用户任务命名，内部机制留在契约与实现。`publish` 的改名理由见
[Record / Sample / Reports 分层裁决](../memory/record-sample-report-three-layer-split.md)。

### Matcher 与布尔判断

```ts
t.check(command, commandSucceeded()); // 好：调用点读成一条条件
isDefined();                          // 好：返回一个“值已定义”的 matcher
checkCommandExitCode();               // 差：描述检查步骤，没说成功条件
definedCheck();                       // 差：词序不像条件，也不与 isX 词族一致
```

Matcher 工厂的名字优先让断言句子读起来自然。它可以是条件短语，不必为了“函数必须有动词”改成命令。

### 不可变转换

```ts
sample.pipe(dropExperiments("broken"));   // 好：返回删减后的新 Sample
sample.pipe(removeExperiments("broken")); // 差：remove 容易暗示原地修改
```

`drop` 与 `filter` 表示不可变选择；会修改接收者的 API 才使用带突变意味的动作，并在类型上同步体现。

### 转换器

```ts
fromResponses(response);                  // 好：在 adapter 子路径中，来源清楚
convertOpenAiResponsesObjectToTurn(value); // 差：重复模块、输入类型与返回类型
transform(value);                         // 差：离开局部上下文后没有领域含义
```

转换词可以依赖明确的模块上下文，但公开自由函数不能依赖源码文件名才能读懂。

## 定名前的最小评审材料

每个新增或改名的公开 API 在定稿前写出五样东西：

1. 一句以“返回”“创建”“打开”或其它准确动作开头的摘要。
2. 一个使用真实变量名与参数的典型调用点。
3. 一张与最容易选错的相邻 API 的对照表。
4. 一个会让候选名字产生不同判断的边界场景。
5. 名字刻意没有表达的细节，以及它们由模块、参数、类型还是契约正文承担。

先写对应 Feature 的 use case，再回来看调用是否自然。声明看起来顺眼、放进任务句子却需要额外翻译，
说明名字尚未承担工作。

## 评审清单

- 新读者只看 import、调用与返回类型，能否说出它解决什么问题？
- 名字使用的每个领域名词是否已经在 Concepts 定义？
- 单复数是否跟随同一个明确指代，而不是为了和另一个名字押韵？
- 函数的语法是否符合它的角色，还是机械套用了“动词 + 名词”？
- 相邻 API 的真正选择维度是否出现在名字或调用形状里？
- 名字描述的是可观察语义，还是当前实现步骤？
- 参数名能否让调用点自解释，是否存在含混的位置布尔值？
- 同一个前缀在仓库里是否仍表示同一种动作？
- API 摘要能否用一句简单的话写清？写不清时，是否应先拆职责？

## 设计参照

本契约吸收 Swift 的“调用点清晰”、Google TypeScript 的描述性命名与 casing、Rust 的稳定动作词族，
以及 Google Go 对查询和动作名字的区分。具体学了什么、哪些语言习惯不照搬，见
[References · API 设计准则](references.md#api-设计准则)。
