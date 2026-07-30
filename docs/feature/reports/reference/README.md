# Reports 参考方案

Reports 的参考分成两组：

- [报告作者 API](authoring.md) —— Rill、Evidence、Observable Framework、 Malloy、Lightdash、Cube、Braintrust 与 Metabase。
- 本页记录双面 renderer 的边界来源。

## Rich

Rich 证明同一次语义渲染可以导出终端与 HTML，但它共享的是已经确定字符宽度的 Segment 流。
NiceEval 只共享节点顺序、字段终值、分组和降级不变量； text 与 web 分别使用终端显示列和 CSS 容器宽度排版。

## Sphinx

Sphinx 的多 builder 说明语义树可以由多个原生 renderer 消费。
第三方 directive 经常只实现 HTML 面，暴露了双面扩展的固有失败模式。
NiceEval 因此要求自定义 renderer 同时实现 text 与 web，并只消费同一份已经计算好的普通值。

## Storybook

Storybook 的 fixture 模式说明组件应能脱离真实数据独立验收。
NiceEval 的普通 Result 可直接保存为 JSON fixture，再同时喂给 text 与 web renderer；视觉测试不运行 Eval，也不打开 Record。

## Remix 与 RSC

Remix loader 和 RSC server/client 边界支持把读取与显示分开。
NiceEval 把所有异步留在 page render， `niceeval/report/react` 只接可序列化结果值，不包含 Sample、Record 或 page runtime。

## 不采用的方向

- 不把终端画面远程投影到浏览器；web 面需要真实 DOM。
- 不引入 Dashboard JSON、模板变量或字符串查询语言。
- 不让 renderer 读取 artifact、网络或 page context。
- 不要求作者注册计算协议；普通函数就是组合与复用单位。

## 相关阅读

- [Architecture](../architecture.md)
- [Library](../library.md)
- [组件目录](../components/README.md)
