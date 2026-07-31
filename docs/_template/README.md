# 文档模板

Feature、Roadmap 与 Design 候选共用同一套 Feature Design Package。
三者改变的是契约成熟度,不改变 README、Library、CLI、Architecture、Lifecycle 与 Use Case 的体裁分工。

- [`feature-design/`](feature-design/README.md):复制到 `docs/feature/<name>/`、`docs/roadmap/<name>/` 或 `docs/design/<decision>/PLAN-N/`。
- [`design-decision/`](design-decision/README.md):复制到 `docs/design/<decision>/`,作为多个候选外层的决策记录。

模板中的 `README.md` 必备。
`library.md`、`cli.md`、`architecture.md`、`lifecycle.md` 与 `use-case/` 按功能形态选用,复制后删除不需要的空页。
