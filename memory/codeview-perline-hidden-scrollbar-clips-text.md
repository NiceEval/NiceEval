---
format: concord.document/v1
id: codeview-perline-hidden-scrollbar-clips-text
title: codeview-perline-hidden-scrollbar-clips-text
createdAt: 2026-07-11T18:37:33+08:00
createdAtSource:
  kind: first-recorded
  path: memory/codeview-perline-hidden-scrollbar-clips-text.md
  commit: 4543d9f0edcda0e7dcc2243c7f7a8cbc7d5dc599
description: AttemptModal 的 CodeView 长代码行/长 t.send prompt 被静默裁掉,读不全也无法滚动看到
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
    statement: "- 已修 [codeview-perline-hidden-scrollbar-clips-text](codeview-perline-hidden-scrollbar-clips-text.md) — AttemptModal 代码视图长行(尤其 t.send prompt)被裁断且无滚动条提示,根因是横向滚动挂在每行自己身上还把滚动条砍成 0;改为整块 `.code-lines` 统一滚动(修在 `src/view/styles.css`,`d0b6718` 重构带入,记得改完要 `pnpm run view:build`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**:`niceeval view` 的证据室 attempt 详情弹窗(`AttemptModal` → `CodeView`,
`src/view/app/components/CodeView.tsx`)里,长源码行(尤其是 `t.send("...")` 里的多行
拼接 prompt 字符串)在弹窗右边缘被硬裁断,行尾的回复/断言徽章(`.reply-hint` /
`.abadge`)贴着裁断处,视觉上像文字被徽章"吃掉"一截,且没有任何横向滚动条提示还有更多内容。

**根因**:`src/view/styles.css` 里 `.ctext { overflow-x: auto }` + `.ctext::-webkit-scrollbar
{ height: 0 }`——横向滚动是挂在**每一行自己**的 `<code class="ctext">` 上,还把滚动条宽度砍成
0(想去掉视觉噪音),结果是每行各滚各的、且滚动条完全不可见,用户唯一能看到的就是文字被截断,
无从得知也无法操作滚动。这是 `d0b6718`(2026-07-10 的 report/view 大重构)带进来的组件与样式,
连同 `AttemptModal` 弹窗定宽 960px 一起,是「详情弹窗看起来坏了」这个用户反馈的直接根因之一
(另一半是同一次重构把旧的手写 `ExperimentTable`/`CostScoreChart` 页面整个删除、把
`defaultReport`(`src/report/`组件树)设为 `niceeval view` 裸跑恒定填充,视觉打磨程度不如旧页面)。

**修法**:横向滚动收整到 `.code-lines`(一个源码文件的整个代码块)上,不再挂在单行:
`.code-lines { overflow-x: auto }` + 可见的细滚动条(`::-webkit-scrollbar` 加回 8px 高度、
用 `var(--line-strong)` 上色,不再砍成 0);`.code-line` 加 `width: max-content; min-width:
100%`,让每行按自身内容撑宽(短行仍填满可见区域),配合父容器的滚动条整块横向滚动、gutter 与
badge 跟着走,不再各行分裂滚动。`.ctext` 去掉自己的 `overflow-x`/隐藏滚动条规则,交给父容器统一
处理。顺带把 `DialogContent`(`src/view/app/components/ui/dialog.tsx`)定宽从 960px 松到
1120px,减少常见行长度下需要滚动的比例。改的是 `src/view/styles.css` 源文件,`niceeval view`
的 dev server 读的是构建产物 `src/view/client-dist/app.css`(由 `pnpm run view:build`,即
`vite build --config src/view/app/vite.config.ts` 生成)——改完样式源文件必须重跑这个构建,
否则本地验证会看到"改了但没变化"的假象(浏览器加载的是旧的 client-dist 产物,不是热重载)。

**验证方式**:本地没有现成的 schemaVersion 4 fixture 可以直接起 `niceeval view` 冒烟,临时
写结果 fixture 时踩了两个格式坑值得记录:`snapshot.json` 的 `format` 字段必须精确等于
`"niceeval.results"`(`RESULTS_FORMAT`,点分隔,不是连字符);`hasSources` / `hasEvents` 必须
显式写在 attempt 的 `result.json` 里(不是"文件存在就自动为真"),否则 `AttemptModal` 直接走
"源码未捕获"分支、根本不会 fetch `sources.json`/`events.json`。
