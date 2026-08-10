# PLAN-2 旧 Example 归档

`32f2df7f` 曾把 PLAN-2 的 Report target 示例放进 `docs/roadmap/testing/example/`，并将一条结果拆成 15 个文件：

- Behavior declaration；
- Evidence Recipe 与 World；
- Execution Registration；
- browser / Observed support；
- mechanism owner、Registry 与 Retirement；
- 最终 Vitest 文件。

这个例子是候选比较材料，不再属于选定 Roadmap。完整历史可用下面的命令读取，不在当前树复制第二份：

```sh
git show 32f2df7f:docs/roadmap/testing/example/README.md
git ls-tree -r --name-only 32f2df7f docs/roadmap/testing/example
```

否决原因与逐项对照见 [Decision](../DECISION.md#为什么否决-plan-2-作为终态)和
旧问题对账可从历史提交用 `git show eee7f377^:docs/roadmap/testing/history-problems.md` 读取。
选定方案的代码形态见 [E2E 作者约束](../../../engineering/testing/e2e/authoring.md)。
