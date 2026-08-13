# 自定义持久事实：边界裁决

早期方案计划公开 `niceeval/record`、raw Attachment definition / projector、blob writer 与
migration registry。当前 roadmap 不包含这套方案。

Record reader、writer、family、payload/blob capability、physical layout、converter 与 migration
registry 永久属于内部持久化实现。应用只能把 Record 目录当作 opaque 产品资产，并通过
CLI 与 `niceeval/report` 观察结果。

未来若需要 Plugin、Eval 或 Experiment 保存自定义事实，必须先设计独立的高层 opaque
context capability。该能力只能表达所属领域允许的声明与值，不能重新导出 `niceeval/record`，
不能让作者注册 raw family / migration，不能接收 Record path，也不能提供通用读写器。

因此当前没有自定义持久事实作者 API；不要从本页推导尚未设计的函数、类型或配置字段。
