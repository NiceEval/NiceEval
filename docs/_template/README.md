# 文档模板

Feature、Roadmap 与 Design 候选共用同一套 Feature Design Package。
三者改变的是契约成熟度,不改变 README、Library、CLI、Architecture、Lifecycle 与 Use Case 的体裁分工。

- [`feature-design/`](feature-design/README.md)：由 `pnpm run repo docs feature create` 和 `pnpm run repo docs design create` 使用。
- [`design-decision/`](design-decision/README.md)：由 `pnpm run repo docs design create` 创建多个候选的决策外层。

Roadmap 与 Use Case 尚无受管结构写入入口。在对应命令出现于仓库工具 `--help` 之前，不手工复制模板、生成索引或伪造收据。

模板中的 `README.md` 必备。
`library.md`、`cli.md`、`architecture.md`、`lifecycle.md` 与 `use-case/` 按功能形态用 `--pages` 选择。
模板由 manifest 版本化；create receipt 保存 manifest digest，节点不保存 template version。
