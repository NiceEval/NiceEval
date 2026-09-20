---
format: concord.document/v1
id: showcase-subpath-no-trailing-slash-breaks-artifact-fetch
title: showcase 子路径无尾斜杠托管时前端 artifact fetch 全 404
createdAt: 2026-07-16T18:48:51+08:00
createdAtSource:
  kind: first-recorded
  path: memory/showcase-subpath-no-trailing-slash-breaks-artifact-fetch.md
  commit: f3dcb393b786dcf9f98075f2fe81efa85582002a
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: '- 已修 [showcase-subpath-no-trailing-slash-breaks-artifact-fetch](showcase-subpath-no-trailing-slash-breaks-artifact-fetch.md) — 导出站挂在无尾斜杠子路径(反代 rewrite)时前端相对路径 fetch 打到上一级目录全 404,源码/trace 显示"artifact 缺失"但文件其实都在;修为 `artifactUrl` 以页面 pathname 自算目录基底(`src/view/app/lib/artifact-url.ts`)'
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# showcase 子路径无尾斜杠托管时前端 artifact fetch 全 404

## 现象

niceeval.com/showcase/memory（vercel.json rewrite 到 coding-agent-memory-evals 部署）上打开 attempt 详情，源码视图报「此 run 捕获过源码，但当前部署里缺少它的 artifact 文件」，trace 同样取不到。但导出站本身是完整的：`/showcase/memory/artifact/<base>/sources.json` 直接访问 200 且内容齐全。本地 `niceeval view`（页面挂在 `/`）一切正常，容易误判成「导出没带源码」。

## 根因

前端 `artifactUrl()` 返回相对路径 `artifact/<rel>`，交给浏览器按文档 URL 相对解析。反代 rewrite / cleanUrls 会把 `<dir>/index.html` 服务在**无尾斜杠**的 `<dir>` 路径上（`/showcase/memory` 200 直出，`/showcase/memory/` 反而被平台 308 回无斜杠形态），此时文档基底目录是 `/showcase/`，fetch 打到 `/showcase/artifact/...` → 404 → 前端如实显示「artifact 缺失」。与 static-site-export-drops-sources（文件没导出）、sources 引用格式直拷（导出了但格式不对）是同一症状的第三种根因：文件在、格式对、URL 错。

排查时的两条弯路：npm 发版时间线（0.7.0 发布晚于对方 push 24 分钟，构建装到 0.6.2）是真事实但不是根因——该 bug 在所有版本都在；给 niceeval.com 加「补尾斜杠 redirect」不可行，平台的 trailing-slash 归一化会 308 弹回来形成重定向环。

## 修法

`src/view/app/lib/artifact-url.ts`：不再依赖浏览器相对解析，自己算基底——pathname 末段带 `.` 视为文件名去掉（直接打开 `.../index.html`），否则整个 pathname 就是页面目录（覆盖无尾斜杠形态），`artifact/<rel>` 拼在该目录下。前提是 `artifact/` 恒为 `index.html` 同级（导出布局保证）。契约声明补进 docs/feature/reports/view.md「静态导出」；回归测试在 src/view/artifact-serving.test.ts。适用场景：任何把导出站挂在子路径、且入口 URL 不带尾斜杠的托管。
