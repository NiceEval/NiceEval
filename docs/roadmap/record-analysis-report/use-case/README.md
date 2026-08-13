# Use Case

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md)、[Lifecycle](../lifecycle.md) 与 [CLI](../cli.md)。
本目录按用户目标展示完整搭配，不重新定义类型。

## 官方能力

- [官方 OTel Timing](官方OTelTiming.md) —— 普通作者配置 tracing，Analysis 与 Report 使用官方 duration / TTFT fields。
- [断言、Evidence 与外部 SQL Score](断言与证据.md) —— 用户代码运行 SQL，保存材料并产生 typed Score。
- [文件差异](文件差异.md) —— File Diff 由官方 Capture 保存，Analysis 与 Report 只消费 fields。

## 第三方扩展

- [GPU Energy](第三方事实扩展.md) —— 领域 SDK 定义 Metric、Producer、Plugin、Analysis Measure 与 Report 图表。

## 读取与维护

- [写后读取与显式迁移](宿主写后读取与显式迁移.md) —— fresh snapshot、旧事实重分析、unknown envelope 保留与 fail-closed
  migration。

五篇共同证明同一条依赖方向：

```text
领域 API / typed Capture
  → internal fixed envelope
  → Analysis fields
  → aggregate()
  → terminal / Web / static
```

任何用例都不会让普通作者看到 Record writer、schema version、converter、installation 或 projection。
