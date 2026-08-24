---
format: niceeval.feedback/v2
id: 20260824133453-feature-test-list-tree
title: Feature 与 Test 追溯列表难以按层级阅读
state: open
reportedAt: 2026-08-24T13:34:53+08:00
source:
  kind: dogfood
  repository: NiceEval/NiceEval
  originId: pr-109-feature-test-list-tree
  commit: 4e6b028e1c3bb0062fbaf311c804c3407a21777a
subject: repository
claim: friction
observation: "用户在 PR #109 的真实本地试用中运行 `pnpm feature list`、`pnpm feature list eval`、`pnpm feature show eval` 与 `pnpm test list`。Feature 与 Test 列表都是制表符分隔的平铺行，父子 Feature、E2E Repo 与测试文件之间的层级不明显；`feature show` 只显示 Use Case，没有显示同一 Feature 下的 `README.md`、`library.md`、`cli.md` 等组成文档及其角色。用户明确反馈 `pnpm test list` 太难阅读，并要求两个 list 都采用树型输出。"
impact: 维护者必须逐行解析完整路径和 owner 才能找到一个 Feature 的子项或一个 Repo 的测试集合，也无法从 `feature show` 判断接下来该读 Library、CLI、Architecture 还是其它正文；83 个测试的平铺输出尤其难以扫描。
memoryRelations:
  - kind: decision
    memory: docs-trace-relations-are-source-owned
adoptions:
  current:
    - docs/engineering/docs-traceability/README.md
  history: []
---
# Feature 与 Test 追溯列表难以按层级阅读

## 现场观察

在 PR #109 checkout 上直接运行正式 package commands：

```sh
pnpm feature list
pnpm feature list eval
pnpm feature show eval
pnpm test list
```

`feature list` 与 `test list` 都输出制表符分隔的平铺行。Feature 父子关系、E2E Repo 分组和测试路径层级只能由读者自行从字符串推断；`feature show eval` 能看到 Use Case，却看不到 `README.md`、`library.md`、`cli.md`、`architecture.md` 等组成文档。

用户原话包括“看看如何优化，要不要加入树型结构，优化阅读”、“pnpm test list 太难阅读了。也是要树型”以及“看看哪些需要加 frontmatter，我们是否有 metadata”。

## 影响

当列表包含 18 个 Feature 或 83 个测试时，维护者很难快速扫描层级、选择下一条 `show` 命令或判断应该阅读哪个入口文档。
