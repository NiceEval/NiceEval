# 裁决:src-grep 的 CSS 类名对齐守护整体删除,样式验收归 e2e 真实产物

- **裁决**(2026-07-28):删除 `test/unit/report-css-contract.test.ts` 与台账
  `test/unit/report-css-orphans.json`,不再以「grep 源码类名 ↔ CSS 规则」的文本代理
  守护类名对齐。样式是否真的生效,由 e2e 报告域对导出站的计算样式与几何断言验收,
  候选写法定稿在 `docs/roadmap/e2e-acceptance-dsl/use-case/html-export.md`
  「样式脱对齐类缺陷」一节;DSL 落地前这类缺陷靠真机手测与既有 Playwright 断言接住。
- **曾选方案**:正则扫 `src/report/**`/`src/view/**` 源码文本提取 `niceeval-*`
  类名,与 styles.css 选择器双向比对,配孤儿台账与「纯挂钩豁免」两本手维护清单。
  动机是 2026-07 SourceView 换原语时 CSS 停在旧类名、组件发新类名,整块样式失效
  而 typecheck 全绿(见 attempt-detail-components-shipped-without-styles)。
- **否决理由**:三条。①观察面错——它证明的是「两段文本对得上」,不是「样式作用
  到了元素」,规则打中元素但视觉仍坏(层级、覆盖、容器查询)它照样绿,正是单元层
  「渲染缺陷只有真实产物能拦」结论的反面教材;②它就是 unit/README.md 自己列的
  反模式「grep 局部源码文本」,靠仓库守护名义豁免;③类名面密集重构期每改必红,
  两本台账逐条手更,变更预算税远超它拦截面的价值。
- **删除时同步**:`docs/feature/reports/components/attempt-detail/presentation.md`
  的守护引用改指 e2e 验收;`DESIGN.md` 守护表移除该行并声明「不设 src 层守护」;
  CLAUDE.md 升格一句长期规则(渲染面不做 src-grep 守护)。
