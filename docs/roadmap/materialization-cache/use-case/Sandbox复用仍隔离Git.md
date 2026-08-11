# Sandbox 复用仍隔离 Git

Experiment 可以启用 Sandbox 复用，Eval 写法不变：

```ts
export default defineExperiment({
  sandboxReuse: true,
  // agents、models 与 evals 省略
});
```

上一题即使执行以下污染，也不能影响下一题：

```sh
git config core.hooksPath /tmp/evil-hooks
git remote add answer https://example.invalid/future.git
git update-ref refs/heads/answer <future-oid>
```

下一条 Attempt 到达原 `checkout(...)` 位置时，consumer 删除整个旧 `.git` 和旧 worktree 内容，从宿主投影重建 repository，并复验无 remote、额外 ref、reflog、alternate 或 promisor。
任何传输、导入或复验失败都会退休当前物理 Sandbox，而不是只做 `git reset --hard` 后归还复用池。
