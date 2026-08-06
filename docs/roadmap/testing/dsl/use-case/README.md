# E2E 验收 DSL —— Use Cases

这里按公开观察媒介给出完整目标测试文件。契约单源在 [Library](../library.md) 与
[Architecture](../architecture.md)；用例只组合 Behavior、World reader、Domain View 和 matcher。

- [终端 Report 结构](render-structure.md) —— stdout 断语义结构，PTY 断屏幕排版。
- [Show 读回与 locator 往返](readback.md) —— history、stats、公开 locator 与完整证据切片使用同一身份；完整切片 Behavior 见[测试方案](../../e2e/use-case/evidence-slices-roundtrip.md)。
- [JSON、NDJSON 与 JUnit](machine-exports.md) —— 机器出口按结构比较，短文本才使用 golden。
- [静态 HTML](html-export.md) —— 禁用 JavaScript 的真实 Chromium 读取参数化文档与可访问语义，不冒充点击行为。
- [浏览器交互](browser-interaction.md) —— target 下钻、过滤、tooltip，以及按 drive API 展开源码行内返回。
- [适配器事实读回](adapter-readback.md) —— 真实 CLI 只读调用身份、入参与 tracing 事实。
- [候选包消费边界](package-consumer.md) —— 外部 cwd 与三种 JSX 配置共享只读 world。

Recipe、执行登记和资源调度的完整组合见
[测试方案 Use Cases](../../e2e/use-case/README.md)。
