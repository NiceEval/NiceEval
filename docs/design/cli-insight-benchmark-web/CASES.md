**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [DECISION](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | Agent 怎样发现可比较能力 | 一个包含内建与自定义 descriptor 的项目 | Agent 只读 discovery 就取得 schema、identity、类型、单位、alignment、关系和最小请求。 |
| C2 | 跨 Run 与 Experiment 自由比较 | 两个成员集合不同的选择 | side-by-side 显示各自分母；未声明 alignment 时失败；不能自动产出 delta 或排名。 |
| C3 | 精确或配对比较 | 一对 exact 同总体选择，另有具名 Relation 的 paired 选择 | exact 与 paired 各自产出机器可审计资格；paired 保留两侧分母、pair 分母与 unmatched。 |
| C4 | 终端快速查看一次失败 | 一个 exact Attempt locator | `show` 给出人读诊断和下一步，不加载网页，也不产生第二个 JSON schema。 |
| C5 | 在 Insight 深挖 trace 与 diff | 一个已封口选择，Record 后续又发布新 Run | 当前 InsightRevision 持续读旧 Sample；新结果只触发提示，用户刷新后原子切换。 |
| C6 | 构建完全自定义的 Astro benchmark 站 | 用户自己的路由、CSS 与图表库 | 构建先 materialize immutable Bundle；页面直接消费数据，不依赖 NiceEval server 或 Report shell。 |
| C7 | 在用户服务器动态生成 benchmark | 私有服务器可访问 Record，浏览器只访问用户 route | 服务器完整 materialize 新 Bundle；URL 锚定 BundleIdentity，不在旧 Bundle 上懒补资源。 |
| C8 | 使用可选 React 便利层 | 用户自己的 `.tsx` island wrapper 与 `.astro` 页面 | wrapper 在客户端构造 BundleHandle；React adapter 不 fetch、不路由、不画图，hydration directive 由用户声明。 |
| C9 | 分享大型 Evidence | 一个 frame、一个 DomainView 与一个大 artifact | frame/domain 各自单文件，artifact 显式成为 blob；超预算失败，不截断 rows、issues 或 bytes。 |
| C10 | 读取未知或损坏 Bundle | 未知 manifest major、未知 resource schema、digest mismatch 各一份 | major 整体拒绝；未知 resource 局部 unsupported；digest mismatch 明确判为 corruption。 |
| C11 | 参数化生成详情数据 | 带 locator parameter schema 的有限 Definition | 每组 canonical parameters 形成独立完整 Bundle；静态实例显式列举，不运行 `enumerate(sample)` callback。 |
| C12 | 用户改用任意图表库 | 同一 frame 分别交给 ECharts、Vega 或自写 SVG | 三者读取同一 `MetricValue`、comparability、coverage 与 Evidence，不依赖 NiceEval React 组件。 |
