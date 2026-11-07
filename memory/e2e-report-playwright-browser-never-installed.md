# e2e-report-playwright-browser-never-installed

e2e/report 的 CI 任务因 Playwright chromium 从未被安装而失败——playwright 系依赖已无 postinstall 生命周期脚本

**现象**：`e2e (report)` CI job（run 29885246651，触发提交 8359408 B5）失败，报错
`browserType.launch: Executable doesn't exist at .../chromium_headless_shell-1228/...`，
抛出点是 `scripts/verify-custom-reports.ts:158` 的 `chromium.launch()`。

**根因**：B4（`ca66ef5`，新增 `verify-render-visual.ts`）与 B5（`8359408`，新增
`verify-custom-reports.ts`）都用 `@playwright/test` 的 `chromium.launch()`，但检查
`node_modules/.pnpm/{playwright,playwright-core,@playwright+test}*/**/package.json`
发现三者的 `scripts` 字段都是空的——现装的 `playwright@1.61.1` 系列包不再靠
`postinstall` 生命周期脚本自动下载浏览器二进制，`pnpm install`（无论是 CI「Install
orchestrator dependencies」步骤还是 `e2e/scripts/run.ts` 里各仓库自己的隔离
`pnpm install --no-frozen-lockfile`）都不会触发浏览器下载，必须显式跑
`playwright install`。这个坑从 B4 起就存在，只是 B4~B5 之间的几次 push 都被
`e2e-report-${{ github.ref }}` concurrency group 的 `cancel-in-progress: true`
提前取消，`report` job 直到 B5 才第一次真正跑完，才第一次暴露。

**修法**：给 `e2e/report/package.json` 加 `"postinstall": "playwright install
chromium"`（只装 chromium，因为代码只 import 了 `chromium`）。这是项目自己
`package.json` 的脚本，不受 pnpm 的 `onlyBuiltDependencies`/`allowBuilds` 门禁
（那只管 `node_modules` 里依赖包自己的生命周期脚本），装本仓库依赖时会自动跑，
本地、CI、crabbox 三处用的都是同一条 `pnpm install`，不需要在中央
`.github/workflows/e2e.yml` 里加仓库专属知识。验证：本地删掉
`node_modules/.modules.yaml` 状态文件强制 pnpm 重跑 install 生命周期，看到
`postinstall$ playwright install chromium` → `postinstall: Done`，且
`~/Library/Caches/ms-playwright/chromium-1228` 被下载。

其它同样用 `@playwright/test` 的 e2e 仓库若未来新增浏览器驱动的验收，需要照此
补 `postinstall`，不能假设装依赖就自动带浏览器。
