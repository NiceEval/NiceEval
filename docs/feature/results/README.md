# Results —— `.niceeval/` 运行产物

Results 指一次或多次实验运行后保存在结果根目录中的结构化数据。默认结果根是项目下的 `.niceeval/`；`niceeval exp` 写入它，`niceeval show`、`niceeval view` 和 `niceeval/report` 读取它。

```text
.niceeval/
└── <experiment>/
    └── <snapshot>/
        ├── snapshot.json
        └── <eval-id>/a0/
            ├── result.json
            ├── events.json
            ├── sources.json
            ├── trace.json
            ├── o11y.json
            └── diff.json
```

这里的 `results` 指持久化事实，不指终端输出或网页报告。判定、结构化执行错误、去重后的 diagnostics 与轻量摘要在 JSON 主记录中；瞬时 progress 不落盘；体积较大、按需读取的对话、源码、trace 和 diff 拆成 attempt artifact。完整字段、可选文件和版本规则见 [Architecture](architecture.md)。

用户通常不需要手工拼路径：用 [`niceeval/results`](library.md) 打开结果根、选择快照、读取 attempt artifact，或把一组快照复制到发布目录。

## 它负责什么

`niceeval/results` 拥有:

- **格式与版本：** 哪些文件存在、字段怎样解释、旧快照能否读取。
- **写入：** 创建快照，逐 attempt 写主记录与 artifact，完成时封口。
- **读取：** 扫描结果根，按 experiment / snapshot / eval / attempt 导航，并按需加载大文件。
- **选择与搬运：** 选择当前快照、报告覆盖风险、复制或瘦身一组快照。
- **身份：** 为 attempt 生成稳定 locator，保证报告里的数字能回到证据。

它不负责指标、聚合、图表或终端排版；这些“看法”归 [Reports](../reports/README.md)。它也不负责执行 eval。

## 常见用途

| 用途 | API / 命令 |
|---|---|---|
| 调试最近一次运行 | `niceeval show` / `niceeval view` |
| 在脚本中统计结果 | `openResults()` + `results.latest()` |
| 读取对话、源码或 diff | `AttemptHandle.events()` / `sources()` / `diff()` |
| 发布精简结果集 | `copySnapshots()` |
| 导入第三方运行结果 | `createResultsWriter()` |

## 相关阅读

- [Library](library.md) —— `niceeval/results` 的 TS 读写 API。
- [Architecture](architecture.md) —— 磁盘上的格式规范。
- [Reports](../reports/README.md) —— 建立在这些事实之上的终端、网页和自定义报告。
- [Experiments](../experiments/README.md) —— experimentId 与可对比组从哪来。
