---
name: attempt-detail-components-shipped-without-styles
description: AttemptDetail 切换时既漏迁官方 CSS，也漏迁 CodeView 的语法高亮、状态色与行内展开
metadata:
  type: project
---

**现象**：`niceeval view` 打开 `#/attempt/@<locator>` 后，dialog 外框、遮罩和滚动条正常，
但内部身份摘要变成纵向裸 `<dl>`，源码每行显示原生 `<details>` 三角且行号紧贴代码，usage、
conversation、trace、diff 全部失去卡片、网格与层级。数据和路由都正常，像是“只爆了详情内容”。

**根因与引入提交**：`4e45185`（`feat(report): add attempt-detail component family (Phase C)`）
新增 11 个叶子组件及 `nre-attempt-*` / `nre-source-*` / `nre-conv-*` 等稳定语义 class，但没有
同步给 `src/report/assets/styles.css` 增加任何对应规则。这个遗漏当时没有立即影响 view，因为 view
仍使用旧的客户端 `AttemptModal` / `CodeView` / `Transcript` 组件树和 `src/view/styles.css`。
`421474f`（`feat(view): replace client-side attempt fetch/render with dialog over the static document`）
把 dialog 内容切换成独立 attempt 文档的 server-rendered `AttemptDetail`，同时删除旧组件树和约
805 行旧 view 样式及 `CodeView` 的 loc 归并交互；从这个提交开始，缺少官方组件 CSS 的问题直接成为用户可见回归，并且源码的语法高亮、send/assertion 整行状态色、点击展开回复也一起消失。因此
`4e45185` 是遗漏源头，`421474f` 是首个真正把页面搞坏的提交。

浏览器 CSSOM 证据也排除了“整份 CSS 没加载”：页面有 3 份 stylesheet，`.nre-col` 与
`.nre-verdict-pill` 规则存在并生效；`.nre-attempt-summary-head`、
`.nre-attempt-summary-kpis`、`.nre-attempt-source-lines`、`.nre-source-line`、
`.nre-attempt-conversation`、`.nre-attempt-usage` 均不存在。computed style 因而分别退化成
`block` / 不滚动 / UA details，而不是预期的 flex、grid 与统一源码块。

**为什么测试全绿**：Phase C 的渲染矩阵只证明每个 web face 能输出字段，独立 attempt 文档测试
只证明完整证据都在初始 HTML，dialog 测试只证明它与独立文档取的是同一片段。三者都没有把
“组件 HTML + 官方 stylesheet”组合起来观察；旧测试里 `expect(html).toContain("nre-")` 甚至
只证明某处有 class 文本，不能证明 stylesheet 为它提供了规则。

**第一次修法为什么不够**：只补组件族的 panel/grid/source 基础 CSS 能把裸排版恢复成结构化页面，却不能恢复旧 `CodeView` 已经删除的数据投影与交互。若只看 summary/grid 的 computed style，会错误地把“样式修好”当作整个回归已经修好。

**第二次视觉复核**：功能迁回后不能凭新组件名重新设计一套卡片。旧 `CodeView` 的源码区没有逐行
`border-bottom`，行网格固定为 `46px 22px minmax(0,1fr) auto`，字号/行高为 `12.5px/1.7`；
展开回复用一层 `.line-detail` 直接接在源码行下（`padding:10px 16px 12px 60px`），不显示 turn
头、不重复 sent prompt，也不再套带 margin/border/radius 的二级卡片。迁移交互时必须一并保留这些密度约束。
Landing page 的 `site/components/site-home-setup.tsx` / `site/app/globals.css` 是当前品牌视觉的另一份
权威参考：send 行是蓝色 8% 底 + 蓝色 2px 左缘 + MessageCircle，断言行是绿色 8% 底，右侧只放
分数与 chevron，不展示内部 `s1/t1` 标签；展开 note 直接接行下。默认 AttemptDetail 有 source 时
回复已经在源码行内，必须省略后面的独立 `round 1`，无 source 时才保留 Conversation fallback。

**修法**：在 `src/report/assets/styles.css` 为 AttemptSummary / Error / Assertions / Source /
FixPrompt / Timeline / Diagnostics / Usage / Conversation / Trace / Diff 补齐统一的 panel、网格、
源码横向滚动、原生 details 层级和响应式规则。`src/view` 仍只负责 dialog 摆放，不复制 report
组件规则。同时让 `attemptSourceData` 把标准事件流按 `loc` 投影到 send 行，公开 `AttemptSource`
恢复轻量 TypeScript token、蓝/绿/红/黄整行状态与原生 `<details>` 行内回复/断言展开。
`src/view/view-report.test.ts` 在完整证据的独立 attempt 文档边界用 JSDOM 读取真实
内联官方 stylesheet，守护少量代表性 computed layout；不锁颜色、像素或完整 selector 清单。

**验证**：相关回归 `pnpm test src/report/components/attempt-detail/attempt-components.test.tsx
src/view/view-report.test.ts src/show/show.test.ts`（3 files / 122 tests）、`pnpm run typecheck`、
`pnpm run build:report`、`pnpm run view:build`。完整测试在最终变更前的最后一轮仅剩
`show.test.ts` 的 `--execution` 入口失败；补入口后对应 122 项均通过，但环境随后因额度限制拒绝
再次启动需要本机端口权限的完整测试，不能把它记成已重跑通过。真实浏览器此前重新打开原始深链后，源码中检出
115 个 keyword token、77 个 string token、1 条 send 行、43 条 passed assertion 行；点击 send
行后 `<details>` 进入 open，行内显示 7 条 assistant 回复与 53 条 tool 回复。普通源码行没有状态
标记或展开入口，长代码仍由整个源码块统一横向滚动。
