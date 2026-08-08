# Report scenario repo

本 Repo 是 Report 功能与浏览器用户旅程的共同消费现场，不使用 Adapter Repo 的模型结果。它直接使用 Playwright Test：`page` 生命周期、web-first assertion、trace、
screenshot 和失败时的 browser context 关闭由 Playwright 管理。

- `exported-navigation.spec.ts` 证明导出首页的真实 `href` 能打开正确 Attempt；
- `first-eval-to-debug.spec.ts` 证明 `init → list → dry → exp → show → view → browser` 的完整新手旅程。

Journey 使用 Testkit 的项目副本，不删除或改写 Report Repo 的共享 config 与结果根。

```sh
# NiceEval 根目录；runner 注入候选 tarball
pnpm e2e --repo report -- --grep "actual href"
pnpm e2e --repo report -- --grep "新项目"

# 已安装候选包的隔离 Repo
pnpm exec playwright install chromium  # 首次或 CI image 未预装时
pnpm test -- --grep "actual href"
pnpm test -- --grep "新项目"
```

正式 Repo 签入安装生成的 lockfile；示例省略二进制浏览器与生成的 lockfile。
