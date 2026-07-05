# 静态托管导出丢源码：code view 显示「源码未捕获」但 sources.json 明明存在

## 现象

coding-agent-memory-evals 部署到 Vercel 后（`scripts/build-site.mjs` 生成 `site/index.html` 静态托管），打开任意 attempt modal 都显示「源码未捕获。此 run 可能早于 source-loc，或源码不可读」。但本地 `.niceeval/<run>/<attempt>/sources.json` 全部存在，summary.json 里 `hasSources: true`，本地 `niceeval view` 一切正常。提示文案误导排查方向——源码捕获成功了，是没送到线上。

## 根因

查看器的按需工件加载耦合在本地 dev server 的 `/artifact?p=<rel>.json` query 端点上（`src/view/server.ts` 的 serveArtifact），没有静态托管出口：

1. `AttemptModal.tsx` 只在 `result.artifactBase` 存在时才 fetch `sources.json`；
2. `niceeval view --out` 只输出单个 HTML，不带任何工件文件；
3. 下游（coding-agent-memory-evals 的 `build-site.mjs`）为了避免静态站上 404 死链，主动 `delete r.artifactBase` 并强制 `hasTrace/hasEvents = false`——于是 modal 的 `base` 为空 → `status: "none"` → NoSourceBody；
4. 下游 `snapshot-results.mjs` 也只拷 summary.json，工件目录根本没进 `site/`。

Vercel 纯静态 rewrite 无法把 query param 映射成文件路径，所以用户侧无法单方面修复，修法必须落在 niceeval。

## 修法

两层，按成本递进：

1. **单文件模式内嵌 sources（低成本，先做）**：`buildView`/`renderHtml` 走 `--out` 时把各 attempt 的 sources.json 读出来内嵌进 viewData（实测一整个 run 的 sources 总共 ~80KB，可按内容去重；events 1.8MB、trace 上百 MB 不适合内嵌）。静态托管的报告直接有代码视图 + 断言标注；transcript/trace 仍优雅降级。
2. **目录式静态导出（完整体验）**：`niceeval view --out <dir>` 输出 `index.html` + 复制工件到 `<dir>/artifact/<artifactBase>/`；前端 fetch 从 `/artifact?p=X` 改成路径式相对 URL `artifact/<base>/xxx.json`，本地 server 同时支持该路径路由，一套前端两种托管通用。做完后下游的 delete-字段 hack 和 snapshot 只拷 summary 的限制都可以撤掉。

另外「源码未捕获」的 noSource 文案应区分「run 里就没有 sources（hasSources=false）」和「有 sources 但当前托管取不到」两种情况，否则每次都误导向 source-loc 版本问题。
