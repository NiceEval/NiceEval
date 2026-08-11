# 审查仓库

工作区审查需要显式授权快照，并在独立 Sandbox 中执行：

```ts
const review = t.judge.agent({
  rubric: repositoryReviewRubric,
  workspace: "snapshot",
  material: { task: "修复并验证竞争条件。", diff: t.sandbox.diff() },
});

review.atLeast(0.8).label("修复质量");
```

裁判的读写、命令和失败不会改变被测 workdir、后续 Assertion 或被测 Sandbox 留存策略。快照、裁判执行 identity 和 evidence refs 写入 AssertionResult，不保存 secret。

Score Eval 可改为 `review.score(5)`。再添加 `.atLeast(0.8)` 时，才得到局部 condition 与 `.orStop()` 能力。
