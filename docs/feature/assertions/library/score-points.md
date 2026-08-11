# Assertions —— Score Eval

Score Eval 的完整 dual-mode 边界在 [Assertions](../README.md#score-eval)。本页只定义 score 如何由
已登记 entry 累加。

## 默认仅保存 evaluation

`evaluationKind` 只出现在 Run-owned `niceeval.evaluations` Attachment 的 `niceeval.evaluations/v1` payload，取值只有 `pass` 或 `score`。Assertion 的 `.points(n)` 与 `t.score(...)` 只是在 Score Eval 内挣分，不是第三种题型，也不能把 Pass Eval 变成 Score Eval。

## 通过制（`defineEval`，默认）：一个 eval 一分

- 一条 eval 的一次 Attempt 在 `niceeval.verdict/v1` Attempt Attachment 形成四态 [Verdict](../../verdict/architecture.md)，`passed` 记 1、其余值记 0； `attempts > 1` 时按通过率。它不占用 Attempt lifecycle state。
  这个数可由 Report 的 pass-rate Calculation 计算，通过制的对比主读数读的是它（见 [Calculations](../../reports/calculations.md)）。
- Assertion result 只是 Verdict 的**内部构成**：一条 eval 写 3 条还是 20 条 gate，对比里都是一分。
  这与 eve 的模型一致：一个 eval 就是一分，soft 分数 tracked-only。

通过制是**对的默认**，三个理由：

1. **不被断言数量加权。**
    写了 20 条断言的 eval 不该比写 3 条的权重大——断言多少反映作者的检查习惯，不反映题目的重要性。
   题目分量的差异要靠**显式给分**（计分制）表达，不靠断言数量隐式发生。
2. **单位对齐。**
    发现、缓存指纹、重试、首过即停的单位都是 eval；计分单位一致，「跑了 40 道题、过了 31 道」的心智直接成立。
3. **判定可信。**
    四态互斥、优先级固定（errored > failed > skipped > passed），不需要回答「部分可信的分数怎么折叠」这类没有好答案的问题。

## 计分制：叠加给分，没有上限声明

`defineScoreEval` 与 `defineEval` 字段完全同形。
唯一区别是 `test(t)` 的 `t` 额外提供给分词汇。
给分词汇**只**存在于计分制的 `t` 上，在通过制 eval 里写给分是类型错误，不需要运行时守护（形状声明见 [Eval · defineScoreEval](../../eval/README.md#definescoreeval计分制题型)）。

计分是**叠加制不是扣分制**：分从 0 往上挣、分值非负、给一次加一次，**不声明满分**。
对比是相对的——同一条 eval 的代码对每个 experiment 是同一把尺子，模型 A 挣 3 分、模型 B 挣 1 分，对比不需要分母；不存在「满分声明」，也就不需要守护声明与实际给分是否一致。
「做了坏事」不用负分表达。
要表达「到这一步不成立就别往下跑了」，写 `.gate().stopOnFailure()` 或值断言的 `t.require()`；要给「没做坏事」计分，就写成正向检查点。

```
eval 得分 = Σ 各给分项的挣分        （纯累加,无分母）
```

以上两条都是合法的 record-only Assertion。

## 显式贡献

`handle.score(n)` 让已有 Assertion 贡献 score。`n` 必须 finite 且大于零，并且同一 handle 最多配置一次。

这些是作者 API，不是 Record shape。producer 把 `.points(n)` 归一成 check entry 的 conditional award，并把 `n` 保存为 available。

available result 的实得分由 `n * score` 派生，Record 不重复保存 earned。

`t.score(label, n)` 归一成独立的 direct score entry，直接保存 points。`.gate()`、`.atLeast()` 与 `.soft()` 归一成 decision；`.optional()` 归一成 availability。`stopOnFailure` 只控制 producer，不落入 Assertions document。

精确联合、数值闭包和永久限制见 [Assertions Architecture](../architecture.md#稳定落盘投影)。上层 API 可以改名或重组，只要继续产生同一投影，旧 Record 的分数展示就不变。

一条断言在计分制里的**角色由断言句柄上链的词决定**，四种角色的读数落点两两不相交——同一条证据不会被两个读数读到：

| 链的词 | 角色 | 落到哪个读数 | 失败的后果 |
|---|---|---|---|
| `.points(n)` | 得分点 | 分数面：挣 `n × score` | 丢这 n 分，继续往下跑 |
| `.points(n).gate(x?)` | 得分点兼硬要求 | 分数面 + 判定面 | 丢这 n 分，形成 `failed` Verdict，继续执行 |
| `.gate(x?)` | 硬要求 | 判定面 | 形成 `failed` Verdict，继续执行 |
| `.gate(x?).stopOnFailure()` | 硬前置 | 判定面 | 形成 `failed` Verdict，并就地结束 `test()` |
| 不链 | 观测 | 质量分（soft 均值） | 照记 failed（用 matcher 自带的线），不影响判定 |
| `.atLeast(x)` | 观测（带通过线） | 质量分（soft 均值） | 低于 `x` 记 failed，不影响判定 |
| `.soft()` | 观测（纯留档） | 质量分（soft 均值） | 无（不设线，永不 failed） |

表里「失败的后果」这一列怎样落到代码的每一行，逐行标注在 [Severity 与 Verdict · 控制流与严重度正交](../../verdict/architecture.md#控制流与严重度正交)。
分数面这边配套的语义：

- **分数与严重度正交**：`.points(n)` 决定挣分，`.gate()` / `.atLeast()` / `.soft()` 决定判定面。
  每个 Attempt 都有四态 Verdict，Score Eval 另有独立 `niceeval.score/v1` Attachment；Verdict 与 score 并存，互不推导（[Verdict Attachment 数据](../../verdict/architecture.md#recordattachment-数据)）。
  带 points 的断言不进入质量分，避免同一证据重复计入两个连续读数。
- **观测的通过线只改那一行的显示**：judge 这类默认没有线的打分断言靠 `.atLeast(x)` 把「装好了但质量差」显示成失败行；0/1 断言不需要它——matcher 自带的线在计分制照常生效，没做到的检查点如实记 `failed` 挣 0 分。
- **`--strict` 两种题型同义**：带线 soft 升级为 gate；它不添加 `.stopOnFailure()`。
- **`t.require` 两种题型都有**：它是 `t.check(...).gate().stopOnFailure()` 的值断言简写。
- **中止挣 0，基础设施得 null，严格分开**：前置失败强制结束，后面的给分代码不执行、那些分自然没挣到——agent 没走到是它的责任，低分成立。
  Sandbox 炸了、Judge 没 key 时材料 unavailable：required 情形使 producer 写出 `errored` Verdict；分数面同时没有可派生的实得分、显示 `null`、不折成 0——评不了不是 agent 差。
  带 `.points` 的断言形成 unavailable result 时不派生实得分，并在报告里如实标注；required 情形还会使 producer 写出 `errored` Verdict。
- **丢分不是失败**：五步走完三步的 Attempt 可形成 `passed` Verdict 且挣 3 分，「做到几成」由分数面回答，不借判定面表达；Verdict 回答的是 Attempt 的终态检查结果，不按分数重新折叠（[四态与优先级](../../verdict/architecture.md#四态折叠)）。
   `errored` / `skipped` 与通过制同义，缓存、重试、发现单位照旧。
- **`attempts > 1`**：eval 得分取各 attempt 的均值（`null` 跳过，全 `null` 为 `null`），与通过制按通过率聚合同构。

两种题内写法（完整用例见[计分制用例](../../eval/use-case/rubric-points.md)）：

```typescript
// 检查点制:每步 1 分,走完三步挣 3 分,挂一步不连坐后面
export default defineScoreEval({
  description: "安装并启动 DB-GPT",
  async test(t) {
    await t.send("把 DB-GPT 装起来并通过健康检查。");
    // 纯前置:失败就地结束,后面自然 0 分——存在性检查用 pathExists(布尔) + isTrue
    await t.require(await t.sandbox.pathExists("db-gpt/README.md"), isTrue("db-gpt cloned"));
    t.sandbox.fileChanged("db-gpt/.env").points(1);
    // 值 1 分,且没装依赖后面全白跑——得分点兼前置
    await t.calledTool("shell", { input: { command: /pip install/ } })
      .points(1).gate().stopOnFailure();
    // ……每个检查点 1 分,互相独立
  },
});

// rubric 制:正确性 60 / 精简 20 / 说明 20,分值作者自定
export default defineScoreEval({
  description: "回调改写 async/await,按 rubric 给分",
  async test(t) {
    await t.send("把 src/legacy.js 的回调改写成 async/await,并写重构说明。");
    const test = await t.sandbox.runCommand("npm", ["test"]);
    t.check(test, commandSucceeded()).points(60);                    // 纯得分点,丢分不中止
    t.score("代码精简", tierPoints(lines, [50, 80, 120], 20));       // 自算分档,直接给分
    t.judge.autoevals.closedQA("说明是否讲清动机与风险?").points(20); // judge 按连续分比例挣
  },
});
```

Boolean matched 贡献 `n`，mismatched 贡献 `0`。measurement 为 `m` 时贡献 `m * n`。因此 measurement
为 `.8` 且 `.score(5)` 时，贡献是 `+4`。

`t.score(n)` 只属于 `ScoreTestContext`。它直接登记 contribution，`n` 必须 finite 且不小于零：

```ts
t.score(5).label("人工评分");
```

返回的 `DirectScoreHandle` 只允许 `key` 与 `label`，不能再加 score、threshold 或 control。

## threshold 与 stop

Score measurement 可以没有 threshold 直接封口。`.atLeast(n)` 只增加局部 `met` / `below` condition，
不改变 contribution；`.score(n).atLeast(x)` 与 `.atLeast(x).score(n)` 同义。

Boolean handle 可以直接 `await .orStop()`。measurement 必须先 `.atLeast(n)` 才能使用 `.orStop()`。
正常 below stop 仍产出 `scored` grading，并保留 stop cause。

## 可排名性

正常没有贡献项的 Score Eval 得到正式 `score: 0`。只有配置 score 的 Assertion、direct score 或 control
Assertion 的 `unavailable` / `errored` 才使 grading 不可排名。record-only Assertion 的 Issue 不作废正式 score。
