# 同仓库切换 commit

适用于一组代码修复题：GitHub repository 相同，每题的 `BASE_COMMIT` 不同。

```ts
// repository.ts
export const upstream = defineGitRepository({
  repo: "https://github.com/downshift-js/downshift.git",
});
```

```ts
// pr-101/eval.ts
export default defineEval({
  sandbox: sandboxLayer().prepare(checkout({
    repository: upstream,
    commit: "1111111111111111111111111111111111111111",
  })),
  async test(t) {
    await t.send("修复当前问题。");
  },
});
```

其它题只替换 `commit`。
组文件把这些 Eval 与 repository 绑定到同一台 Sandbox：

```ts
export default defineSandboxGroup({
  evals: [pr101, pr205, pr309],
  repositories: [upstream],
  onUnavailable: "replace-sandbox",
});
```

首台 Sandbox 在第一题派发前取得并验证三个 commits。
三道题各自得到全新的工作树和可写 `.git`，但后两题不会执行 clone 或 fetch。

`replace-sandbox` 适合纯性能复用：seed 损坏或切换失败时退休旧实例，新实例重新下载一次并继续未派发题目。
需要所有题严格使用同一物理实例时改用 `stop-group`。

这项写法不适合把后续 commit 当隐藏答案的题目。
同组 objects 共存在 seed 中；需要对象级保密时让 Eval 保持 fresh。
