# 错误助手 —— CLI

领域 contribution 把失败交给同一个人读错误交付入口。反馈按“原因 → 归属与位置 → 下一步”排序；
迁移错误在位置之后附对应英文 Markdown 正文。重试期间的诊断与终局错误沿原有反馈次序交付，不重复冒充终局。

## 人读反馈

普通错误的建议来自所属功能的证据，不自动生成 shell 修复命令。已知模型 key 缺失可以点名需要设置的变量，
但不得显示变量值、完整请求头、原始配置对象或用户源文件片段。

```text
error: Judge credentials are unavailable.
Code: judge-key-unresolved
Source: evals/quality.eval.ts:8:10
Set TYPESAFE_API_KEY before running this evaluation.
```

字段没有可靠值时明确显示 `Source location: unknown`。仅源码定位超出增强预算时补充
`Source details omitted: diagnostic budget exhausted.`，不能把未知位置显示成第 1 行。

## 迁移反馈

```text
error: This Judge configuration requires migration.
Code: migration-required
Guide: judge-provider
Source: niceeval.config.ts:6:17
Subject: defineConfig.judgeRuntime

# Use an explicit Judge provider

...the complete bundled English Markdown guide...
```

示例中的省略号只表示文档示意；实际反馈交付整篇随包指南。不同位置共用同一 guide 时先列全部已收集位置，
再显示一次正文。终端可以复用现有缩进与 panel 能力，但不能静默截断迁移步骤。

## 同类错误的首次提示与终局摘要

一次命令或 Invocation 内，每个已知组的首条失败会显示完整的原因、owner、位置与下一步。
后续同组失败不重复长说明，但仍保留事实并计入数量。
终局摘要按组列出 count、最多 32 个 affected objects 和 32 个 source locations，以及各自未展开的数量。

同一 guide ID 在这个交付范围内只输出一次完整 Markdown。
即使该 guide 出现在多个 repair target 或多个分组中，也只重用已显示的指南并在摘要中关联各组。
未知错误不仅因 message 相同就合并；它们各自显示有界安全摘要。

模块加载、定义或规划阶段的迁移错误使 CLI 非零退出，且没有 Invocation receipt。
运行中遇到的错误遵守原 Run / Attempt 失败边界；错误助手不改变这些退出规则。
迁移助手不自动改源文件、不执行兼容模式，也不修改旧结果文件。

## 机器输出

`--json`、NDJSON、JUnit 与固定 query 继续遵守各自的公开 envelope，不在 stdout 混入 Markdown 或 ANSI。
迁移字段由对应错误 envelope 的 owner 正式声明；不能向严格 schema 临时添加字段。
人读指南写到 stderr，Library 消费者取得结构化 code、guide ID 与 occurrence；指南读取不改变机器终态。

同一失败只在负责该终态的边界输出一次。stderr 不可写或 renderer 自身失败时，保持原失败状态，
仅尝试现有最小安全错误交付，不重入增强流程或产生递归错误风暴。
