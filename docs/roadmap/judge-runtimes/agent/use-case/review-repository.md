# 审查仓库

工作区审查需要显式授权快照，并在独立 Sandbox 中执行：

```ts
const check = judge.check({
  recipe: repositoryReview,
  material: {
    task: turn.material.input,
    reply: turn.material.reply,
  },
});

const review = t.judge.agent(check, {
  agent: reviewer,
  workspace: { snapshot: "attempt-workdir" },
  tools: ["read-file", "search", "run-command"],
  network: "none",
});

review.atLeast(0.8).label("修复质量");
```

Workspace 是 invocation capability，不是 `material.workspace` slot。Manifest 显示整个 snapshot 的授权范围；只有另有可信 Workspace access evidence 时，读面才显示实际 read set。

裁判的读写、命令和失败不会改变被测 workdir、后续 Assertion 或被测 Sandbox 留存策略。快照、裁判执行 identity、受管调查与 evidence refs 写入 Judge Evaluation，不保存 secret 或隐藏思维链。

Score Eval 可改为 `review.score(5)`。再添加 `.atLeast(0.8)` 时，才得到局部 condition 与 `.orStop()` 能力。
