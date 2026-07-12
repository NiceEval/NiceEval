# Repository Guidelines

`niceeval` 是 TypeScript evals 库。直接在 `main` 上协作；仓库可能同时有用户或其它 agent 的未提交工作。

## 动态发现

不要从本文件学习整个项目。先按任务进入对应目录，读取该目录最近的 `README.md`、`AGENTS.md` 或索引，再沿链接只加载相关正文：

- 产品、架构或内部设计：[`docs/README.md`](docs/README.md)
- 设计到源码的定位：[`docs/source-map.md`](docs/source-map.md)
- 历史踩坑与设计裁决：[`memory/INDEX.md`](memory/INDEX.md)，命中索引项后才读正文
- 公开文档站：[`docs-site/AGENTS.md`](docs-site/AGENTS.md)
- 可运行示例：[`examples/README.md`](examples/README.md)
- 产品站：[`site/README.md`](site/README.md)
- 具体功能：从 `docs/README.md` 进入对应 `docs/feature/<name>/README.md`

目录入口负责说明本作用域的目标、组织方式、写作规则和验证命令。信息已有唯一入口时，不在本文件复制；目录结构变化时更新入口索引，让后续工作按路径动态发现。

## 全仓约束

- niceeval 是 beta。API、CLI 与契约按理想形态设计，不以兼容旧习惯为默认约束。
- `docs/` 是已定稿的目标契约，不是当前代码说明书。代码尚未实现目标时，修代码或记录实现任务，不把文档降格成当前实现。
- 保持 core 中立。具体边界以 [`docs/architecture.md`](docs/architecture.md) 为准。
- 公共 API、可观察行为或文档变更时，沿对应目录入口完成同步与验证；测试命令以 `package.json` 和局部入口文档为准。
- 需要新增仓库级机器守护时，优先写进 `test/` 下的 Vitest 测试并复用 `pnpm test`，不另造脚本、命令或 hook。

## Git 与协作安全

- 直接在 `main` 开发，不建 feature branch。commit message 要说明行为与原因。
- 未知改动属于用户或其它 agent。不要覆盖、顺手格式化或提交它们；提交前检查 `git status`、未暂存 diff 与暂存 diff。
- 不使用 `git reset --hard`、`git clean`、`git checkout -- <path>`、`git restore` 丢弃工作，除非用户明确要求。
- 多 agent 共用工作树时，用 `git commit <paths>` 或等价的显式路径提交，避免把并发暂存内容带入自己的 commit。

## Release 安全

发布只走 `.github/workflows/release.yml`：创建并推送 `vX.Y.Z` tag，由 CI 写版本、校验、发布 npm 并创建 GitHub Release。不要在本地运行 `npm publish`，也不要为了发布预先修改 main 上的 `package.json` 版本。
