# Inspection 用例

Inspection 的命令与输出契约单源始终在 [CLI](../cli.md)，读取语义单源始终在
[Architecture](../architecture.md)。这些用例只说明怎样组合固定 operation 完成一个问题。

- [核对数据完整度](inspection-check-completeness.md)：发现可问问题，再审计一个有界结果的完整性。
- [比较质量与成本](inspection-compare-quality-cost.md)：以固定 comparison mode 比较两组持续可读 Run。
- [弄清一条结果为什么是这个判定](inspection-explain-verdict.md)：按作用读断言明细，分清质量门、计分项与仅观察项。
- [找出分不出好坏的判据](inspection-find-flat-criteria.md)：把几个 Experiment 的判据排成矩阵，决定哪些题该换。
- [配置变了以后看上一次的成绩](inspection-results-after-identity-change.md)：读参照结果与逐项差异，再决定是否重跑。
- [把终端里看到的结果交给脚本](inspection-show-as-json.md)：在 `show` 后加 `-o json`，取得与 `query run` 逐字相同的 document。

需要在浏览器审阅同一已发布事实时，进入 [Insight](../../insight/README.md)。Insight 经
sqlite-wasm 在固定 `PublicationCutoff` 上运行相同的 query definition；UI 只呈现其 result，不读取 CLI protocol document。
