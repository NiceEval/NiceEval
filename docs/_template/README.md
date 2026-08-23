# 文档模板

Feature、Roadmap 与 Design 候选共用同一套 Feature Design Package。
三者改变的是契约成熟度,不改变 README、Library、CLI、Architecture、Lifecycle 与 Use Case 的体裁分工。

- [`feature-design/`](feature-design/README.md)：供 `pnpm docs:trace create feature|roadmap|use-case` 与 Design Plan 创建使用。
- [`design-decision/`](design-decision/README.md)：供 `pnpm docs:trace create design` 创建多个候选的决策外层。

模板中的 `README.md` 必备。
`library.md`、`cli.md`、`architecture.md`、`lifecycle.md` 与 `use-case/` 按功能形态用 `--pages` 选择。
模板由 manifest 版本化；create receipt 保存 manifest digest，节点不保存 template version。
