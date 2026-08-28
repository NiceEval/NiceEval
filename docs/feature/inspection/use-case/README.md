# Inspection 用例

Inspection 的命令与输出契约单源始终在 [CLI](../cli.md)，读取语义单源始终在
[Architecture](../architecture.md)。这些用例只说明怎样组合固定 operation 完成一个问题。

- [核对数据完整度](核对数据完整度.md)：发现可问问题，再审计一个有界结果的完整性。
- [比较质量与成本](比较质量与成本.md)：以固定 comparison mode 比较两组持续可读 Run。

需要在浏览器审阅同一已发布事实时，进入 [Insight](../../insight/README.md)。Insight 经
sqlite-wasm 在固定 `PublicationCutoff` 上运行相同的 query definition；UI 只呈现其 result，不读取 CLI protocol document。
