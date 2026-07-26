# 选哪些 eval 来跑:用例手册

两层选择:实验文件里 `evals` 声明「这个实验管哪些题」,命令行位置参数临时收窄「这次只跑哪些」;两层取交集。规则单点在 [Library · evals](../library.md#evals遍历发现结果自定义选择)与 [CLI · 实验选择器](../cli.md#实验选择器怎样解析),本篇按场景给搭配。

## 1. 只跑一个子目录的题

**场景**:实验只关心 `evals/memory/` 下的题。

```ts
export default defineExperiment({
  agent: claudeCode({ model: "claude-sonnet-5" }),
  evals: ["memory/"],        // eval id 前缀;全跑写 "*" 或省略
  sandbox: dockerSandbox(),
});
```

**你会看到**:选择结果落进 Run 的 `experiment.selectedEvalIds`,报告按它读,不重跑表达式。

## 2. 按 tag / 环境需求过滤

**场景**:只跑打了 `coding` 标签、且不要 GPU 环境的题。

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: (e) => e.tags.includes("coding") && e.environment !== "gpu",
  sandbox: e2bSandbox(),
});
```

**你会看到**:谓词参数是只读的 `EvalDescriptor`(测试集扇出已完成,拿到的是最终 id)。参数名不能叫 `eval`——strict mode 保留字,会直接语法报错。谓词返回非布尔值时启动期完整报错,不静默当 false。

## 3. 命令行临时收窄:调一条题

**场景**:实验声明了几十条题,现在只想对一条题快速迭代。

```bash
niceeval exp compare memory/agent-029        # 位置参数 = eval id 前缀,与 evals 声明取交集
```

**你会看到**:只派发前缀命中的 attempt。注意:带位置参数跑出的 Run 是**部分 Run**,对照报表要用不带位置参数的完整重跑。配合 `--dry` 先看计划再花钱的全流程见[选择器输入面用例](selector-narrowing.md)。

## 4. 一批题里混了通过制和计分制:报错要求拆开

**场景**:`evals: "*"` 把 `defineEval`(通过率)和 `defineScoreEval`(总分)的题都选了进来。

**你会看到**:启动期直接报错,列出两类 eval id 各自的清单和计数,并给收窄建议(按 tags / 前缀 / `scoring` 谓词),或拆成两个实验文件。通过率和总分是两种不能相加的读数,一个实验只回答一种(语义见[计分粒度](../score-points.md))。
