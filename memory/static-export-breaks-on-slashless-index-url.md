---
format: concord.document/v1
id: static-export-breaks-on-slashless-index-url
title: "`--out` 站点被托管在无尾斜杠路径上时 attempt 下钻全断"
createdAt: 2026-07-25T13:00:55+08:00
createdAtSource:
  kind: first-recorded
  path: memory/static-export-breaks-on-slashless-index-url.md
  commit: f055aa676783993ac3f6010df5a11864be368da7
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
    statement: "- 已修
      [static-export-breaks-on-slashless-index-url](static-export-breaks-on-sla\
      shless-index-url.md) — `--out`
      站点被托管在无尾斜杠路径(`/showcase/memory`,cleanUrls)上时 attempt 下钻全 404;根因=浏览器按文档 URL
      的目录解析相对引用、少一层,本地 server 永远带尾斜杠所以测不出;修为 index.html 落站点根归一的 `<base>` 引导脚本"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# `--out` 站点被托管在无尾斜杠路径上时 attempt 下钻全断

## 现象

`https://niceeval.com/showcase/memory`（`vercel.json` 把它 rewrite 到导出站的 origin）上点任何
attempt locator 都没反应：dialog 不开、URL 只多出 `#/attempt/@xxxx`，控制台一行
`[niceeval view] failed to open attempt "@1s0uzmvo": HTTP 404`。同一份产物在本地
`niceeval view` 里一切正常。当时的第一反应是「`--out` 和本地 server 不是一条代码路径」——不是。

复现（2026-07-25 线上）：

```
GET /showcase/memory                              → 200   ← index.html 就服务在这个无斜杠路径
GET /showcase/memory/                             → 308 → /showcase/memory   ← 尾斜杠被规范化掉
GET /showcase/memory/attempt/%401s0uzmvo.html     → 200   ← 文件在，内容完好
GET /showcase/attempt/%401s0uzmvo.html            → 404   ← 浏览器实际请求的地址
```

## 根因

与产物无关，是**文档 URL 的目录**问题。导出的 HTML 一律用相对引用（`attempt/<locator>.html`、
`assets/`、`artifact/`），浏览器按当前文档 URL 的目录解析：文档在 `/showcase/memory` 时目录是
`/showcase/`，所有相对引用少一层。本地 server 的地址是 `http://127.0.0.1:PORT/`，**带尾斜杠**，
目录就是站点根，所以本地怎么点都对——两个宿主共用 `src/view/site.ts` 的同一条管线，差别只在
托管路径的形态。`src/view/app/App.tsx` 的 `openAttempt` 拿到 404 后只 `console.warn`，不开空
dialog，于是失败表现为「点了没反应」，比报错更难定位。

顺带：无 JavaScript 时那些 `<a href="attempt/...">`、以及「新标签页打开」，在这种托管下同样 404。

## 修法

`src/view/site.ts` 的 `SITE_BASE_SCRIPT`：`index.html` 按构造恒是站点根，在 `<head>` 里任何相对
引用之前落一段引导脚本，按 `location.pathname` 推出站点根并 `appendChild` 一个 `<base>`——已是
目录形态不插入，末段带扩展名（`/out/index.html`、`file://` 直接打开）取其目录，其余补一层斜杠。
契约在 `docs/feature/reports/view.md`「静态导出」，覆盖类别在
`docs/engineering/testing/unit/reports.md`「站点根归一」。

配套：`App.tsx` 的 `selectTab` 原来 `history.replaceState(null, "", hashForTab(value))` 传裸 hash，
有 `<base>` 时裸相对 URL 按 base 解析（`pushState`/`replaceState` 用的是文档 base URL，不是当前
URL），切页会顺手把地址栏路径改写成目录形态，所以显式拼上 `location.pathname + search`。

同类陷阱没修的一处：`src/view/app/lib/attempt-dialog.ts` 的 `ATTEMPT_HREF_PATTERN` 只认
`attempt/<x>.html`，而 attempt 文档内部的兄弟链接是 `data.ts` 的 `SIBLING_ATTEMPT_HREF`
（`<x>.html`，不带目录前缀）。dialog 里再点下一个 attempt 不会被拦截，会原地导航到站点根下的
`@<locator>.html` → 404。当前的 attempt page 不产出兄弟链接，所以还没暴露。

## 教训

导出站点的正确性不只取决于产物，还取决于**索引文档被暴露成什么形状的 URL**。静态托管的
cleanUrls 会把目录索引变成无尾斜杠路径，并且常常把带斜杠形态 308 回去，这一格用本地 server
（永远带斜杠）和 `file://`（永远带文件名）都测不出来。
