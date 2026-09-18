---
format: concord.document/v1
id: view-hot-reload-needs-namespace-import
title: 已修:view 热重载断在装载层——watch 闭集对、模块缓存未失效
createdAt: 2026-07-28T21:12:53+08:00
createdAtSource:
  kind: first-recorded
  path: memory/view-hot-reload-needs-namespace-import.md
  commit: 06588ff8f6bdfcaf2ce303d328f2504077829299
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "# 已修:view 热重载断在装载层——watch 闭集对、模块缓存未失效"
    proof: []
    source:
      path: memory/view-hot-reload-needs-namespace-import.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:5fcfa4216d4de2deb78574a89e4a21795990a9e2128ab20cbbfecbf9e015de85
---
# 已修:view 热重载断在装载层——watch 闭集对、模块缓存未失效

## 现象

`pnpm exec niceeval view`（报告来自 `niceeval.config.ts` 的 `report: memory`）改
`reports/memory.tsx` 或它 import 的 `components/leaderboard.tsx`：watcher 响、rebuild
跑、SSE 推 reload、浏览器刷新，页面内容逐字节不变。带 `--report reports/memory.tsx`
时改入口文件生效，改依赖组件仍要重启。

## 根因

两层同属「没有跨 import 图的模块失效」：

1. **config 形态吃启动时对象。** CLI 起 server 前 `loadConfig` 一次，把已求值的
   `config.report` 塞进 `scan`；`loadHostReport` 在没有 `--report` 时原样返回该对象，
   重建管线从不重新 import。
2. **`--report` 只用 query cache-busting。** `loadReportFile` 给入口 file URL 加
   `?mtime=`，它 import 的模块仍走 ESM 缓存。watch 闭集按 docs 盯了整棵项目内
   import 图，装载器兑现不了闭集的一半。

docs（`view.md`「持续重建」）契约已正确；`architecture.md` 曾把「只击穿入口本体」写成
故意语义，是实现欠账被误记成契约。

## 修法

- 装载改用 tsx namespaced `register({ namespace })`：入口及其子图都是新实例
  （`src/report/runtime/load.ts` 的 `freshImport`、`src/fresh-import.ts`）。
- 并发 `register` 会死锁：namespaced import 整进程串行化；view server 的
  `rebuild` 同步挂 `inFlight`，首页请求与 watch 调度器共享同一次构建
  （`src/view/server.ts`）。
- view 的 `scan.config` 只记 `{ cwd }`，每次 `loadViewScan` 用
  `loadConfigFile(cwd, { freshImport: true })` 重装配置取 `report` / `theme`
  （`src/view/data.ts`、`src/cli.ts`、`src/load-config.ts`）。
- `architecture.md` 与覆盖规范对齐 `view.md`：入口 + 项目内 import 图同级失效。

代价：每次编辑泄漏一代模块实例（dev server 可接受）；重装 config 会重跑其副作用
（dotenv 等）。品牌校验走 `Symbol.for`，跨模块实例安全。

**日期**:2026-07-28
