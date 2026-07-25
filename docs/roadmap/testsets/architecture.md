# Testsets —— 架构

实体关系、id 命名空间、指纹算法、发现流程与穷尽数据形状。用法见 [Library](library.md)。

## 实体关系

```text
Testset ──贡献──▶ Eval ◀──选择── Benchmark ◀──引用── Experiment ──产出──▶ Snapshot
   │                 ▲                                                        │
   │                 │                                                        │
   └── evals/ 目录 ───┘                                    testsets[] + benchmark 指纹
                      ▲
             本地 evals/ 目录
```

- **Eval 从属于它的来源**：本地 `evals/` 或某个 Testset。来源决定 id 的第一段，也是 `EvalDescriptor.testset` 的值。
- **Benchmark 不拥有 Eval**，只持有一个对发现结果求值的选择表达式。题的生命周期归它的来源，不归卷子。
- **Experiment 引用 Benchmark**，多对一。卷子被几个实验引用不影响卷子本身。
- **Snapshot 记录来源与卷面的指纹**，让消费方判断两份结果比的是不是同一批题的同一个版本。

Testset 与 Benchmark 都不参与运行时：agent 的 `send` 与 eval 的 `test` 都看不见它们，它们只影响「哪些题进入这次运行」和「结果上标什么身份」。

## id 命名空间

一份发现结果里的 eval id 有两类来源，规则各一条，合起来保证全局无歧义：

| 来源 | id | 谁钉死它 |
|---|---|---|
| 本地 `evals/` | `<相对路径去掉后缀>`，如 `billing/refund` | 消费者的目录布局 |
| Testset | `<testset.id>/<测试集内相对路径去掉后缀>`，如 `swe-memory/recall/summarize` | 出题人的 `id` + 出题人的目录布局 |

数据集扇出（数组零填充索引、keyed record 业务 key）在测试集内部照常发生，只是整段 id 前面多一个测试集命名空间：测试集里的 `evals/swelancer.eval.ts` 导出 keyed record，key `15193` 得到 `swe-memory/swelancer/15193`。

**「id 只从路径推导」这条纪律对测试集的例外是刻意的**，而且只开在一个地方：测试集自己声明 `id`。理由是这一段 id 承担的职责不同——本地路径推导要解决的是「改名即改 id，不会腐烂」；测试集命名空间要解决的是「同一道题在谁的项目里都叫同一个名字」，它是要写进跨人榜单横轴的共享坐标，不能是消费者装包位置的函数。测试集**内部**的那段路径推导规则一字不改。

Benchmark id 不开这个例外，仍从消费者的 `benchmarks/` 路径推导——它是本地引用名，跨人对齐由指纹承担。

### 碰撞

两类碰撞都是**启动期配置错误**，不是警告：

- 两个被引用的测试集声明了同一个 `id`。
- 某个测试集的 `id` 等于本地 `evals/` 下的一个顶层目录名。

报错要点出两边的具体位置（哪个包、哪个目录），并给出两条下一步：给测试集加 `as` 别名（若[分歧 1](README.md#待裁决分歧) 裁为允许），或改本地目录名。核心不静默重命名、不按加载顺序决定谁赢——两份都是用户写下的声明，猜哪一份都会让某个人的 id 悄悄变掉。

## 内容指纹：可比性的权威

三个指纹，各答一个问题：

| 指纹 | 覆盖什么 | 答什么问题 |
|---|---|---|
| `Testset.contentHash` | 该测试集全部 eval 的归一化源码 + 测试集 id | 题库是不是同一版 |
| `Benchmark.fingerprint` | 解析后的选题 id 有序集合 + 各来源测试集的 `contentHash` | 卷面是不是同一张 |
| eval `fingerprint`（既有） | 单题源码 + 该次运行的解析配置 | 这一题要不要重跑 |

`contentHash` 取测试集内每个 eval 文件的归一化内容，按测试集内相对路径排序后逐条哈希，与 [`AnnotatedEvalSource`](../../feature/results/architecture.md) 的归一化口径一致。它不读 `package.json.version`——版本号是人写的标签，题面改了忘了 bump 是常态；分数可比不能建在这上面。版本号仍随快照落盘，只当人读标签。

`Benchmark.fingerprint` 只覆盖选题结果与题目内容，不覆盖跑法：同一张卷跑 `runs: 1` 和 `runs: 5` 是同一张卷，读数密度不同而已。也不覆盖 benchmark 的 `description` 与 `report`——改榜单渲染不作废任何已有结果。

单题 `fingerprint` 的既有定义不变。测试集贡献的题的源码本来就进这个哈希，所以题库升级后受影响的题自动失效重跑，缓存不需要为测试集加一条特殊规则。

### 进可比性配置

各来源测试集的 `contentHash` 进[可比性配置](../../feature/results/library.md#官方现刻水位resultscurrent)，与 `agent`、`model`、`flags`、`sandbox` 同类；`benchmark` 的 id 与 `fingerprint` 也进。判据是既有的那条：**会不会改变单题被测行为或判定**——题面改了，同一个 eval id 下的两次结果就不是同一件事的两次观测。

对照之下，`selectedEvalIds` 与 `evalFilterFingerprint` 仍是**选题字段**，不参与比较。这两类的分界在测试集场景下更要说清：换一批题去跑（选题变化）不影响已跑那些题的读数仍然有效；改了题本身（内容变化）则让旧读数作废。

## 发现流程

`niceeval exp` 的发现阶段按固定顺序做四件事：

1. **装载 config**，拿到 `testsets` 数组。每一项是 `defineTestset` 的产物，niceeval 不做包名解析——引用已经由宿主模块系统完成。
2. **逐测试集扫它的 `evals` 目录**，规则与本地发现完全相同（`*.eval.ts` / `*.eval.tsx`、默认导出、数组与 keyed record 扇出、按相对路径排序），扇出后给每条 id 加测试集命名空间，并在 `EvalDescriptor` 上标 `testset`。
3. **扫本地 `evals/`**，规则不变，`testset` 为 `undefined`。
4. **合并、查碰撞、排序**：合并后的发现结果按 id 排序，保证输出稳定可 diff。碰撞在这一步报错。

benchmark 的选择表达式在发现结果**完全就绪之后**求值一次，产出 `selectedEvalIds`；experiment 的 `evals` 谓词在没有 `benchmark` 时求值，两者不叠加。求值只发生一次，结果随快照落盘，报告不重跑表达式——这条与[现有契约](../../feature/experiments/library.md#evals遍历发现结果自定义选择)同源。

`benchmarks/` 目录的发现与 `experiments/` 对称：默认导出 `defineBenchmark` 的 `.ts`，id 从路径推导。它只在 `exp` 分支需要，`show` / `view` 这两条只读路径不装载它——榜单渲染读的是快照里落下的身份，不重新解析卷子。

## 数据形状

### `TestsetDef`

```typescript
interface TestsetDef {
  /** 命名空间;单个合法路径片段,进它每道 eval 的 id 前缀。 */
  id: string;
  description?: LocalizedText;
  /** 题目录,相对 niceeval.testset.ts;默认 "./evals"。 */
  evals?: string;
  /** 出处链接,反馈与报告原样展示。 */
  homepage?: string;
  /** profile → 各 provider 产物的推荐映射;消费者显式摊开才生效,niceeval 永不隐式读取。 */
  environmentHints?: Record<string, Record<string, JsonValue>>;
}
```

### `BenchmarkDef`

```typescript
interface BenchmarkDef {
  description?: LocalizedText;
  /** 比哪些题;与 ExperimentDef.evals 同形,谓词参数多一个 e.testset。 */
  evals: "*" | readonly string[] | ((e: EvalDescriptor) => boolean);
  /** 这张卷的默认榜单;show / view 不带 --report 时装载,优先级高于 config.report。 */
  report?: ReportDefinition;
  /** 期望的 benchmark 指纹;省略则只记录不校验,不匹配即启动期配置错误。 */
  pin?: string;
}
```

### `EvalDescriptor` 增量

```typescript
interface EvalDescriptor {
  id: string;
  description?: string;
  tags: readonly string[];
  scoring: "pass" | "points";
  environment?: string;
  metadata?: Readonly<Record<string, unknown>>;
  /** 贡献这道题的测试集 id;本地 evals/ 的题为 undefined。 */
  testset?: string;
}
```

谓词里判断来源写 `e.testset === "swe-memory"`，不写 `e.id.startsWith("swe-memory/")`——前者是声明的事实，后者在本地恰好有同名目录时会误判。

### `ExperimentDef` 增量

```typescript
interface ExperimentDef {
  // …既有字段
  /** 这次跑哪张卷;与 evals 互斥,两个都写是启动期配置错误。 */
  benchmark?: BenchmarkDef;
}
```

### 快照增量

`ExperimentRunInfo` 增两处，都是解析后的投影，不存表达式本身：

```typescript
interface ExperimentRunInfo {
  // …既有字段
  /** 引用的卷:本地 id 与解析后的指纹;未用 benchmark 的实验没有这一项。 */
  benchmark?: { id: string; fingerprint: string };
  /** 本次选中的题所属的测试集;按 id 排序,只记有题被选中的那些。 */
  testsets?: Array<{ id: string; version?: string; contentHash: string; homepage?: string }>;
}
```

`testsets` 只记**这次实际有题被选中**的测试集：config 里引用了但一道题都没选中的，不进快照——快照记的是这次运行的事实，不是消费者的依赖清单。

## 不变量

- **核心不按测试集名字分支。** 测试集是数据：它贡献 `EvalDescriptor`、贡献一个 id 前缀、贡献一份指纹。运行器、评分、报告的任何路径都不出现 `testset == "swe-memory"` 这类判断，与[「保持 core 中立」](../../architecture.md)同源。
- **测试集不带来第二套 eval 语义。** 测试集里的题与本地题走完全相同的发现、扇出、指纹、调度、评分与落盘路径。差别只有 id 的第一段和 `EvalDescriptor.testset` 一个字段。
- **测试集不注入运行时能力。** 它不能提供 agent、sandbox provider、reporter 或 hook。「连到哪个被测对象」永远只由消费者的 experiment 说了算——装一个题库不应该改变自己的 agent 接到哪里。
- **发现结果对引用顺序不敏感。** `testsets` 数组的书写顺序不影响任何 id、排序或选择结果；顺序相关只会退化成「谁先加载谁赢」的碰撞处理，而碰撞是错误不是策略。
- **指纹只由内容决定。** 同一批题在两个人的机器上、两个包版本号下算出同一个 `contentHash`，前提是题目源码逐字相同。任何把机器状态、时间戳或安装路径混进哈希的实现都破坏这条。

## 相关阅读

- [README](README.md) —— 三层分工与待裁决分歧。
- [Library](library.md) —— 出题人与消费者的完整写法。
- [影响面](impact.md) —— 定稿时既有契约的逐处改动。
- [Results Format](../../feature/results/architecture.md) —— 快照与 `ExperimentRunInfo` 的现有形状。
- [Runner](../../runner.md) —— 发现、指纹与调度的现有契约。
</content>
