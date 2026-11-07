# 设计裁决:外壳第三方脚本走结构化 head 通道,不给 ReportAsset 加 attrs

- **裁决**(2026-07-16):`defineReport` 外壳新增 `head?: HeadTag[]` 通道——`{ tag, attrs?, children? }`,tag 白名单 `meta`/`link`/`script`/`style`。GA4、data-* 驱动的 tracker、SEO meta、favicon、字体、JSON-LD 全走它,新第三方接入零契约变更。`ReportAsset` 保持 `{src 本地} | {inline}` 原样,`{src}` 声明外链装载报错并指引改写成 head 条目(增强层与第三方注入的职责切开:scripts/styles 是宿主管线接管的增强层资产,head 是"声明什么标签出什么标签"的注入口)。
- **起因**:下游 `coding-agent-memory-evals` 接 GA4 时发现 `ReportAsset` 表达不了 `<script async src=外链>` 与 `data-*` 属性,只能手写 `document.createElement` 自举样板——契约声明的目标用例(shell.md 明写"给站点分析与埋点留的口子")和类型能表达的东西不一致。
- **曾选方案与否决理由**:
  1. `ReportAsset` 加 `attrs` + `src` 收外链(第一轮提案)——用户以"未来场景可能不一样"推翻:场景有标签类型/来源/属性/位置四条变化轴,该方案只修来源与属性两轴,下一个要 og:image / favicon 的用户又得改契约。
  2. JSX 直给 `<script>`(Next `<Script>` / React 19 原生 hoisting 形态)——撞两条承重契约:外壳声明经序列化边界(ReactNode 过不去,与 `ReportLink.icon` 不收组件同一条理由)、报告树禁 HTML intrinsic。且组件形态在 Next/React 承载的是 hydration 时序与 SPA 路由语义,niceeval 无客户端 React runtime,组件形态等于"用组件语法写数据"。
  3. raw HTML 字符串直贴 vendor snippet——宿主失明(本地资产管线无法识别、保留键没法校验)、`</script>` 出现在内联内容即截断、契约从"脚本资产"扩成"任意 HTML 注入"。
- **生态印证**:无 runtime、产静态 HTML 的工具收敛在同一形态——Docusaurus `headTags` + `scripts`/`stylesheets` 双通道、Nuxt `useHead` 对象描述符;Next `<Script>` 拆掉 JSX 皮也是属性描述符。
- **落点**:契约 `docs/feature/reports/library/shell.md`;实现 `src/report/report.ts`(类型+装载校验)、`src/show/report-host.ts`(透传)、`src/view/data.ts`(本地 src/href 解析)、`src/view/site.ts`(assets/<sha256> 物化+渲染);测试 `src/report/shell-head.test.ts`、`src/view/site-head.test.ts`。顺带把 `readSiteFile` 改为原字节读取(head 资产可为二进制 favicon/字体)。
