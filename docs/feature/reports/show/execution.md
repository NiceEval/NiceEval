# `--execution`：看一次 Attempt 做了什么

`--execution` 是 Attempt detail 的 Conversation target。
它在 Plan 中声明对话、命令与关联时间 evidence 的 Projector，并以相同 ReportData 服务 text、web 与 JSON。

```sh
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --execution
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --execution --expand t2.c3
niceeval show --exp compare/candidate --execution --grep 'memory_search'
```

## 显示

对话按已建立的 Turn 与卡片顺序显示。
命令是独立的 lifecycle evidence，不伪装为 Agent 消息；状态、exit code、敏感值替换和关联 timing 全由 Projector 提供。

`--expand` 与 `--grep` 只改变同一份 ConversationProjection 的显示密度和筛选范围。
它们不能读取更长的源数据、绕过脱敏或在卡片外新增 Projector request。

## 证据状态

没有关联的 telemetry、缺少 transcript、截断内容或不能验证的 capability 都以 EvidenceValue 表达。
renderer 不按文本猜事件类别、凭据或父子关系；limited 和 unverified 状态原样显示。

## 边界

- 多 Attempt 范围逐个使用 Plan 已枚举的 instance，不重新扫描 Store。
- `--json` 输出同一 Projection 的结构化值；它与 `--expand` 互斥。
- 源 Record 中已有的 evidence 不能导出时，artifact export 失败，不能在执行面伪装成不在源 Record。

## 相关阅读

- [`--timing`](timing.md) —— 时间树 target。
- [`--source`](eval-source.md) —— 源码 target。
- [`--json`](json.md) —— 结构化形态。
