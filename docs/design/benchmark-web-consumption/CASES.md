**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [DECISION](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| W1 | 怎样完全自定义网页 | 一个非 React 页面、自写 DOM / CSS 与任意图表库 | 用户能控制全部标记、样式和交互，同时读取完整 Analysis 语义。 |
| W2 | 怎样最短接入 React / Astro | 一个已有 design system 的 Astro + React 项目 | 最小页面能显示比较、missing、loading、问题与 Evidence，不接管用户 route / theme。 |
| W3 | 怎样做静态部署 | 受信任 build 进程可读 Record，浏览器与部署 host 不可读 | 静态站文件可离线部署，浏览器没有 Record / Host capability；更新与旧静态站身份清楚。 |
| W4 | 怎样做鉴权动态页面 | 用户 server 按 tenant 和 route 控制访问 | 权限在 server 生效；浏览器只取得获准的关闭内容，缓存不会跨 tenant 或 revision 污染。 |
| W5 | 怎样处理更新一致性 | 页面同时请求摘要、比较与一个详情 | 页面不会把不同 Record view 或 revision 的值拼在一起；失败有明确恢复路径。 |
| W6 | 怎样呈现 Evidence 与大型材料 | Partial frame、unknown schema、trace、diff 与大 artifact | 状态不被折成空值；按需策略、budget、unsupported 与 corruption 都可观察。 |
| W7 | 怎样满足产品体验 | 自定义主题、键盘、屏幕阅读器、en / zh-CN 与 SSR | 候选说明哪些由 NiceEval 保证、哪些由用户负责，并提供可验收边界。 |
| W8 | 怎样迁移 framework | 同一网站从 React 迁到 Vue 或 server-rendered HTML | 明确哪些 NiceEval ABI 可复用、哪些代码必须重写，以及迁移是否触碰 Analysis 定义。 |
| W9 | 怎样升级与恢复 | NiceEval、数据 schema 或组件 major 不匹配，另有损坏输入 | 不兼容与 corruption 分开；旧页面、旧数据或旧组件的回退和重新生成路径清楚。 |
