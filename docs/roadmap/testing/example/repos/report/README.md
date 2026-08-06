# Report scenario repo

本 Repo 使用 Playwright Test 本身，不再由 Vitest 包一层 `chromium.launch()`：`page` 生命周期、web-first assertion、trace、
screenshot 和失败时的 browser context 关闭由 Playwright 管理。测试只拥有 NiceEval 领域动作与 oracle，并从首页实际 anchor 取得 `href` 后导航。

```sh
# NiceEval 根目录；runner 注入候选 tarball
pnpm e2e --repo report -- --grep "actual href"

# 已安装候选包的隔离 Repo
pnpm exec playwright install chromium  # 首次或 CI image 未预装时
pnpm test -- --grep "actual href"
```

正式 Repo 签入安装生成的 lockfile；示例省略二进制浏览器与生成的 lockfile。
