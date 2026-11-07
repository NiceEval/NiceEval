# 设计裁决:报告壳品牌位 / title 落点 / 散点轴向(2026-07-16,看真实站点后第六批)

用户看部署后的 view 页面提出三条,当场裁决:

- **页头品牌位恒为 NiceEval,`title` 落点改为 hero 与浏览器标题**。曾选方案(第三轮定稿):title 同时驱动页头品牌与 hero。否决理由:左上是产品品牌位(与 Powered by 行同族),站点标识不该被报告定义顶掉;用户自己的标题住在页面主视觉(原先写死「Eval 运行结果」的 hero)。回退链终点随之从 `"NiceEval"` 改为内置文案「Eval 运行结果 / Eval Results」——NiceEval 只是品牌字标,不再是标题回退值。
- **`ReportLink.icon` 允许,但只收内联 SVG 字符串(`{ svg }`),不收组件**。理由:view 导航壳由前端 bundle 渲染,外壳声明经 viewData JSON 序列化过边界,ReactNode 过不去;可序列化本就是外壳契约。内容作者义务同 scripts,宿主不校验。
- **散点轴方向跟随指标 `better`,「更好」恒指向右上**(翻案第三轮的「成本正向、越靠左上越好」文案修正——那次只修了提示文字,这次改机制)。`better:"lower"` 的轴反向渲染(左贵右便宜),刻度显示真实值;未声明 better 的轴正向且整图不出方向提示,组件不猜方向;text/web 两面同规则。

定稿落 `docs/feature/reports/library/{shell,layout,metric-views}.md`、`view.md`、`show/default-report.md`,场景行同批登记。
