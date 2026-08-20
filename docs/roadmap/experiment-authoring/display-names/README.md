# Experiment 展示名称

## 要解决的 Frog / DX 摩擦

Experiment ID 必须稳定、可选择和可审计，因此常常包含路径、模型和配置段。
人类列表、dry 计划、运行中反馈和 Report 标题直接显示完整 ID 时难以扫读。
把短名称当成选择键或 identity 又会让改文案触发误选、冲突或结果携带变化。

## 核心心智

`experimentId` 是路径和具名族 key 形成的稳定身份。
`displayName` 是一行的人类展示值。
`description` 是作者写给读者的较长说明。

三者彼此独立：

- `experimentId` 参与 discovery、选择、Run 归属、reuse 和审计。
- `displayName` 只用于人类展示与机器输出中的展示字段。
- `description` 只用于定义发现页的补充说明。

缺少 `displayName` 时，规范化后的展示值恒为完整 `experimentId`。
系统不截短、不用最后一个路径段，也不从 description 或其他 Experiment 猜名称。

## 范围

本方向包含：

- `defineExperiment()` 与 `defineExperiments()` 成员的可选 `displayName`；
- 当前定义的列表和 dry 展示；
- 新 Run 固定保存其规范化后的展示值；
- exp plan、progress/result、Run-owned presentation Attachment、`show` 与 `view` summary 中同时输出 ID 与展示名称；
- 人类完成摘要在 terminal JSON receipt 前显示名称、ID 与 Run ID 的映射。

本方向不包含：

- 按名称、description 或其它展示／历史线索选择 Experiment 或 Run；
- 展示名称唯一性、别名、重命名命令、短 ID 或 name-to-ID registry；
- 让展示名称进入 input identity、config identity、reuse policy、budget、并发或 Sandbox 生命周期；
- 新的 Eval Assertion。

## owner 与公开验收

Experiment definition 拥有作者写下的 `displayName` 与 `description`。
discovery 拥有规范化后的展示值。
Run 拥有自己不可变的展示快照；Record Core 仍是唯一 identity owner。

本方向不新增 Eval Assertion。
公开行为由真实 `niceeval exp list`、`niceeval exp --dry`、`niceeval exp`、`niceeval show` 与 `niceeval view` 旅程验收。
CLI-only 行为使用真实 CLI/E2E 入口，不以内部 Assertion 代替。

## 入口

- [Library](library.md) —— 作者输入、规范化输出与 Run 快照形状。
- [CLI](cli.md) —— 列表、选择、dry、运行反馈、show/view 和 JSON。
- [Architecture](architecture.md) —— identity 隔离、持久快照、并发、失败与删除路径。
