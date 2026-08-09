# Reports 参考方案

Reports 的参考分成两组：

- [报告作者 API](authoring.md) —— 指标、声明式依赖、双面 renderer 与嵌入边界。
- 本页说明 Reports 对这些先例的共同取舍。

## Rich 与 Sphinx

Rich 和 Sphinx 都证明同一语义树可以有多个 renderer。
NiceEval 进一步要求 text 与 web 共享同一个已生成 ReportNode，并要求扩展同时实现两面。

## Storybook

Storybook 的 fixture 模式支持让组件脱离真实数据验收。
NiceEval 的 fixture 是 ReportData 或 ReportNode；视觉测试不打开 Record、执行 Projector 或运行 Calculation。

## 预览服务器

现代构建工具把依赖执行放在浏览器之前。
NiceEval 采用相同方向：冻结输入，运行 plan/executor，向浏览器交付静态值，而不是把数据权限交给 renderer。

## 不采用的方向

- 不把终端画面远程投影到浏览器；web 面需要真实 DOM。
- 不引入 Dashboard JSON、模板变量或字符串查询语言。
- 不让 renderer 读取 Store、网络或 page context。
- 不允许普通页面在异步阶段任意追加 Projector request。

## 相关阅读

- [Architecture](../architecture.md)
- [Library](../library.md)
- [组件目录](../components/README.md)
