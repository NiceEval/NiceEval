# Record → Analysis → Report —— Use Case

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与
[RecordAttachment 作者 API](../../record-attachment-authoring/library.md)。本目录只展示不同领域事实怎样组合这些
契约，不重新定义 writer。

- [断言与证据](断言与证据.md) —— bounded snapshot、Assertions 自有 blob 与 sealed Assertion 怎样共用一个
  official Attachment write。
- [文件差异](文件差异.md) —— frozen workspace diff 怎样同时服务 Assertion evaluator 与独立
  `niceeval.diff` Attachment。
- [第三方事实扩展](第三方事实扩展.md) —— `com.example.*` definition 怎样通过公开 facade 进入同一个 command
  kernel，并验证官方事实没有特权 bypass。

三篇用例共同核对以下证明：

| 可核对项 | 期望 |
|---|---|
| domain schema / owner / adapter | 可以不同，由领域 owner 决定 |
| definition authority | official 私有，第三方 public；不能互相冒充 |
| admission、reservation、plain-data snapshot | 相同 |
| blob closure、tracked command、poison | 相同 |
| generic sink 与 publication | 相同 |
| read state、Projection 与 Report problem handling | 相同 |
| migration 与 reuse policy | 各领域显式声明；writer 不猜 |
