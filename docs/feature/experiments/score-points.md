# 计分粒度：对比里一个 eval 记几分

一条 eval 怎么计分由它的**定义函数**声明，两种题型：**`defineEval` = 通过制**——整题折叠成一分，gate 硬、soft 软；**`defineScoreEval` = 计分制**——题内用给分 API 叠加挣分，五步走完三步挣 3 分，rubric 大题按分值给分。题型是定义期事实：发现期就可知、进 `EvalDescriptor`，不靠执行 `test()` 推断——榜单列形态、errored 时分数显示 `null` 还是不参与，都在题目一行代码没跑时就有答案。**一个 experiment 选中的 eval 必须同型**：通过制实验读通过率、计分制实验读总分，混型选择是启动期配置错误（报错列出两类 eval id 并给收窄建议）；两类都要跑就写两个实验文件，报告并排两个实验组。experiment 不得改变计分语义——「怎么算分」是题目的契约，不是跑法的参数。

## 通过制（`defineEval`，默认）：一个 eval 一分

- 一条 eval 的一次 attempt 折叠成四态 [Verdict](../scoring/architecture/severity-and-verdict.md)，`passed` 记 1、其余记 0；`runs > 1` 时按通过率。`Scoreboard` / `ExperimentComparison` 读的就是这个数。
- 断言只是 verdict 的**内部构成**：一条 eval 写 3 条还是 20 条 gate，对比里都是一分。这与 eve 的模型一致：一个 eval 就是一分，soft 分数 tracked-only。

通过制是**对的默认**，三个理由：

1. **不被断言数量加权。** 写了 20 条断言的 eval 不该比写 3 条的权重大——断言多少反映作者的检查习惯，不反映题目的重要性。题目分量的差异要靠**显式给分**（计分制）表达，不靠断言数量隐式发生。
2. **单位对齐。** 发现、缓存指纹、重试、首过即停的单位都是 eval；计分单位一致，「跑了 40 道题、过了 31 道」的心智直接成立。
3. **判定可信。** 四态互斥、优先级固定（errored > failed > skipped > passed），不需要回答「部分可信的分数怎么折叠」这类没有好答案的问题。

## 计分制：叠加给分，没有上限声明

`defineScoreEval` 与 `defineEval` 字段完全同形，唯一区别是 `test(t)` 的 `t` 额外提供给分词汇——给分词汇**只**存在于计分制的 `t` 上，在通过制 eval 里写给分是类型错误，不需要运行时守护（形状声明见 [Eval · defineScoreEval](../eval/README.md#definescoreeval计分制题型)）。

计分是**叠加制不是扣分制**：分从 0 往上挣、分值非负、给一次加一次，**不声明满分**。对比是相对的——同一条 eval 的代码对每个 experiment 是同一把尺子，模型 A 挣 3 分、模型 B 挣 1 分，结论不需要分母；不存在「满分声明」也就不存在「声明与实际给分对不上」这类要守护的一致性。「做了坏事」不用负分表达——要一票否决写 gate（判定面），要「没做坏事也算得分项」就把它写成正向检查点。

```
eval 得分 = Σ 各给分项的挣分        （纯累加,无分母）
```

给分词汇两个，其余全是既有词汇：

- **`.points(n)`（链式句柄，`n > 0`）**——挂在断言上的条件给分：0/1 断言通过挣 `n` 分、不过挣 0；judge 等打分断言按连续分比例挣 `n × score`。`t.calledTool(...).points(1)` 读作「这个检查点值 1 分」。
- **`t.score(label, n)`（直接给分，`n ≥ 0`）**——作者自己算好条件和分数后直接累加，`label` 进报告：行数分档 `t.score("代码精简", tierPoints)`、覆盖率换算 `t.score("覆盖率", coverage * 20)`。判定条件复杂到断言词汇装不下时的出口。

配套语义：

- **`.points` 与 severity 正交**：severity 管判定面（这条挂了 verdict 怎么变），points 管分数面（这条值几分）。`t.check(test, commandSucceeded()).points(60)` 是「正确性值 60 分、同时是 gate」——没挣到这 60 分，verdict 也是 failed。
- **中止挣 0，基础设施得 null，严格分开**：前置 `t.require` 挂了强制结束，后面的给分代码不执行、那些分自然没挣到——agent 没走到是它的责任，低分成立；沙箱炸了、judge 没 key 是 `errored`，整题分数为 `null`、不折成 0——评不了不是 agent 差。带 `.points` 的断言 `unavailable`（仅 `.optional()` 情形，否则整题已 errored）不挣分、在报告里如实标注。
- **Verdict 面完全不动**：计分制 eval 同样有四态 verdict（errored 的判别、gate 的一票否决都照旧），缓存、重试、发现单位照旧。计分制只是把对比的主读数从通过率换成总分，两面各自成立。
- **`runs > 1`**：eval 得分取各 attempt 的均值（`null` 跳过，全 `null` 为 `null`），与通过制按通过率聚合同构。

两种题内写法（完整用例见[计分制用例](../eval/use-case/rubric-scoring.md)）：

```typescript
// 检查点制:每步 1 分,走完三步挣 3 分,挂一步不连坐后面
export default defineScoreEval({
  description: "安装并启动 DB-GPT",
  async test(t) {
    await t.send("把 DB-GPT 装起来并通过健康检查。");
    // 前置:挂了强制结束,后面自然 0 分——存在性检查用 fileExists(布尔) + isTrue
    await t.require(await t.sandbox.fileExists("db-gpt/README.md"), isTrue("db-gpt cloned"));
    t.sandbox.fileChanged("db-gpt/.env").points(1);
    t.calledTool("shell", { input: { command: /pip install/ } }).points(1);
    // ……每个检查点 1 分,互相独立
  },
});

// rubric 制:正确性 60 / 精简 20 / 说明 20,分值作者自定
export default defineScoreEval({
  description: "回调改写 async/await,按 rubric 给分",
  async test(t) {
    await t.send("把 src/legacy.js 的回调改写成 async/await,并写重构说明。");
    const test = await t.sandbox.runCommand("npm", ["test"]);
    t.check(test, commandSucceeded()).points(60);                    // gate 兼计分
    t.score("代码精简", tierPoints(lines, [50, 80, 120], 20));       // 自算分档,直接给分
    t.judge.autoevals.closedQA("说明是否讲清动机与风险?").points(20); // judge 按连续分比例挣
  },
});
```

## 折叠树：判定面、分数面、质量分

评分证据是一棵四层折叠树（assertion → group → eval → experiment），每层最多折叠出三个读数：

- **判定面（verdict，两种题型都有）**：由 severity 决定。severity 是折叠树的**边属性**：gate 边一票否决；`atLeast` 边挂了记 failed、默认不传播、`--strict` 下翻成 gate 边；`soft()` 边永不传播。`--strict` 是作用于所有层的同一个旋钮，组层、eval 层不另设规则。
- **分数面（挣分，计分制才有）**：由给分项构成，逐层求和；组的分数读数 = 组内给分项挣分之和（「正确性挣 45 分」）。
- **质量分（tracked，两种题型都有）**：soft 断言（`.atLeast(x)` / `.soft()`）分数的**无权均值**（组内直接子项均值，逐层同构），eve 式 tracked-only 读数。gate 不进质量分——10 条全过的 gate 加一个 0.6 的 judge 均值 0.96，质量差被淹没；不带 points 的 soft 断言在计分制 eval 里也照常进质量分。选无权均值：对 0/1 型 soft 断言，均值就是过线比例（过线比例是均值的退化情形）；对打分断言保留连续信息；引入默认权重则是替作者发明没有原则化取值的参数——**权重只在作者显式给分时存在**。

通用规则：**`unavailable` 在每一层都是 `null` 传播**、不折成 0，无 soft 内容或子项全 `null` 的节点质量分为 `null`（[Metric 的缺数据语义](../../concepts.md#结果数据与报告)）；**无组断言与无组给分归属隐式根组**。

## 横截面聚合：同型实验，各读各的

- **通过制实验**：主读数是**通过率**（Σ passed / Σ 题数，每题一票），回答「它做对了几道题」。
- **计分制实验**：主读数是**总分**（Σ 各 eval 挣分），回答「它一共挣了多少分」。分值多的题分量就大——这是作者用分值声明的题目分量；同一实验内全部题都在同一套分值语境里，总分才可比。
- **混型选择是启动期配置错误**。「过了 31/40 道」和「挣了 142 分」是两种不能相加的读数，一个实验只回答一种；报错信息列出两类 eval id，建议按 tags / 前缀 / `scoring` 字段收窄，或拆成两个实验文件。`EvalDescriptor.scoring`（`"pass" | "points"`）供 `evals` 谓词过滤（见 [Experiments](README.md#defineexperiment-的形状)）。

## 得分点 = 组：对比读取的下钻粒度

一分/一个总分在模型对比里太粗的三个场景，各有一个树上的读法：

- **同 fail，不同深度**（都挂了，一个死在路由层、一个死在命令调用链）→ **组级判定读数**：哪个组的 gate 挂了就是死在哪层。它是失败定位，不是分。
- **部分完成没有部分分**（五步走完三步）→ **计分制**：步骤各 `.points(1)`，挣 3 分。
- **质量分差异被判定吞掉**（都通过，judge 一个 0.9 一个 0.6）→ **质量分列**：judge 默认 `.soft()`，读 eval 质量分。

得分点的粒度选组而不是别的：

| 得分点 = | 否决理由 |
|---|---|
| 单条断言 | 太细：断言数量差异直接污染权重，回到一分制要解决的问题 |
| 显式新 API（`t.scorePoint(...)`） | severity + 给分词汇 + `t.group` 已完整表达「哪些检查是分、值多少、叫什么名字」，新词汇纯冗余 |
| **`t.group` 组** | 组是作者已经在用的语义分块（「路由层」「正确性」），零新概念 |

组名即维度值，报告按 **`groupPath` 字面相等**聚合，不做归一化、不做模糊匹配：「路由层」和「路由」是两个维度。对齐靠 authoring 侧约定——同类检查抽成共享函数（如 `evals/*/share/`），组名在函数里写一次，跨 eval 天然一致；没对齐的组名不是错误，只是各自形成稀疏行。

## 报告读取面：show 与 view 怎么读

`show` 与 `view` 共用同一份 page 声明（[Reports](../reports/README.md)），读取面在内建 `standard` 报告一处声明、两个宿主同时生效：

- **榜单按实验题型选主列**：通过制实验显示通过率列，计分制实验显示总分列；存在质量分时两者都附质量分列。不摆空列。
- **组深度视图 `MetricMatrix`**：行 = eval × 组，列 = experiment；格在计分制下读组内挣分，通过制下读组质量分，叠加组 gate 失败定位标记；`null` 显示为缺数据。
- attempt 详情按 `groupPath` 分块展示断言与给分记录是既有行为的延伸（[断言与 Turn 的展示](../scoring/library/display.md)），失败定位的逐条证据在那里下钻。
- 自定义报告经 `niceeval/report` 读同一套折叠读数，组件契约的家在 [Reports Library](../reports/library.md)。

## 怎么选题型

1. 这些检查点是**独立可跑的题目**还是**同一次运行内的检查**？独立可跑 → 拆成多个 eval（[数据集扇出](../eval/use-case/dataset-fanout.md)），粒度来自更多的题、不是更细的分。
2. 同一道题内，「做对」是二值的 → `defineEval`：一票否决写 gate，观测指标写 soft。
3. 同一道题内，「做到几成」有意义（长链条、rubric 大题）→ `defineScoreEval`：检查点 `.points(n)`，自算分数 `t.score`，前置条件 `t.require`。

各用例的题型对照见[用例目录](../eval/use-case/README.md#通过制还是计分制)。

## 相关阅读

- [Eval · defineScoreEval](../eval/README.md#definescoreeval计分制题型) —— 计分制题型的定义形状。
- [计分制用例](../eval/use-case/rubric-scoring.md) —— 检查点制与 rubric 制的完整写法。
- [Severity 与 Verdict](../scoring/architecture/severity-and-verdict.md) —— 四态折叠与 gate / soft 语义，判定面的基础。
- [Scoring Architecture](../scoring/architecture.md) —— `AssertionResult` 的字段（`groupPath` / `score` / `severity`），折叠树的叶子素材。
- [Reports](../reports/README.md) —— show / view 共用的 page 声明，读取面的落点。
- [Observability](../../observability.md) —— 质量 × 成本对比的现有横截面。
