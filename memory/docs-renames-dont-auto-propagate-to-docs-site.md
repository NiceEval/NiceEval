# docs-renames-dont-auto-propagate-to-docs-site

内部 docs/ 契约改名或改型后，docs-site/ 的教程/参考页不会自动跟上——即使 docs/ 全部同步了也要单独 grep docs-site

Phase H 收尾时发现两处独立的大范围 docs-site 陈旧，根因是同一类问题：**改 `docs/` 时只同步了
`docs/` 内部，没检查 `docs-site/` 是否引用了同一个旧名字/旧形态**。

1. **`--eval` → `--source` 改名**(commit `c8e6252`，2026-07-16)只碰了 `docs/` 与
   `docs/feature/experiments/cli/README.md`，`docs-site/` 一个字没改。`docs-site/{,zh/}troubleshooting/
   debugging.mdx`、`tutorials/{viewing-results,agent-feedback-loop}.mdx`、
   `reference/{cli,report-components}.mdx` 全部还在教用户敲一个已经不存在的 flag，中英文都中招，
   commit message 里"Adjusted references in various files"完全没提 docs-site。
2. **`defineReport(async ({selection}) => …)` 函数形态被整个删除**(Phase A,同一次报告重设计)，
   `docs/` 下没有一处还用旧写法(grep 全仓库为空),但 `docs-site/zh/tutorials/custom-reports.mdx`
   整篇教程还在教这个已经不存在的调用约定——不是术语过时,是要教的 API 已经不存在。

**修法**:两处都是纯 grep 定位 + 对照 `docs/feature/reports/library/*.md` 各分篇原文重写,
不靠记忆现造代码示例(容易在 `aggregate: { perEval, across }` vs 实际的 `acrossEvals`、
`Dimension` vs 实际的 `CustomDimension`、`a.result.model` vs 实际的 `a.snapshot.model`
这类细节上出错)。改写完的自造/改编示例(非逐字抄自 `docs/`)在外部 dogfood repo
(`/Users/ctrdh/Code/coding-agent-memory-evals`)用 `niceeval show --report` 真跑一遍确认可执行,
逐字抄自 `docs/` 配方(`recipes.md` 等)的示例视为已验证,不重复起跑。

**适用场景**:任何"改 API 契约"或"改 CLI flag 名字"的改动,即使 commit 已经全量改完
`docs/` 且 `pnpm test` 全绿,也不能认为 `docs-site/` 自动跟上——两者不共享同一份校验,
`docs:validate`/`docs:links` 只查构建和链接,不查文中代码示例是否还调得通。收尾一个大改动前,
单独 grep 一遍 `docs-site/` 找旧名字/旧写法,不要假设"docs/ 干净了就全干净了"。

关联:[show-attempt-md-stale-spots-found-in-phase-e](show-attempt-md-stale-spots-found-in-phase-e.md)
(同一类"docs-site 落后于源码"问题,不同文件)。
