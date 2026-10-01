**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Limits

## L1: 不恢复 renderer 作者面

[CLI Insight 裁决](../cli-insight/DECISION.md)与
[restore-show-as-fixed-inspection-renderer](../../../memory/restore-show-as-fixed-inspection-renderer.md)
规定 `show` 只格式化具名 Inspection result，不恢复 Page、theme、component 或 renderer 作者面。
新的运行后问题只能新增具名 operation 或扩展穷尽 union。推翻它需要在本决策中给出翻案理由。

## L2: 历史 operation 不依赖项目

[Inspection Architecture](../../feature/inspection/architecture.md#results比较与-attempt) 规定固定历史 operation
在源码删除、定义求值失败或本机没有项目时仍可读取。Snapshot 可以交给另一台机器的兼容 NiceEval runtime 打开。

## L3: recordTrace 的现有契约

[保存通用执行轨迹](../../feature/adapters/library.md#保存通用执行轨迹)已定下列规则：

- 快照是封闭 envelope，payload 是有限 plain JSON，summary 最多 512 字节。
- 每 Attempt 最多 32 份快照、100,000 个事件、64 MiB；每事件 payload 最多 16 KiB。
- 非法输入拒绝整份快照；同 `traceId` 的规范化快照相同才幂等。
- `evidence` 只引用同 Attempt 已接纳的 JSON 附件。

## L4: Record 内容边界

[Observability](../../observability.md) 规定 Record 只保存已解释、脱敏的事实；raw provider frame、hidden chain of thought、
secret 与未解释私有帧不能进入。存储层 sanitization 不等同于业务脱敏。

## L5: 文案语言边界

CLI 文案只有英语，View 自带中英 catalog。应用事件的文本是数据，不是 NiceEval 文案，不经过翻译。

## L6: View 不提供作者组件层

[Architecture](../../architecture.md#哪些层稳定哪些层允许变化) 规定 Insight 不形成 Page、component、theme、route 或 renderer ABI。

## L7: Agent 专用投影

`niceeval.agent-turns`、`niceeval.turn-contexts` 与 `niceeval.sandbox-commands` 已有 conversation、tool occurrence 与 command 专用投影。
它们的稳定 selector 是 `itemId`、`toolOccurrenceId` 与 `commandId`，现有 E2E 依赖这些 selector。

## L8: 版本兼容

NiceEval 是 beta，不为旧调用保留兼容层；但新 reader 必须读取当前支持格式的既有 Record，
旧 Record 缺少新字段时按 not-recorded 处理，不补值。

## L9: 附件

`ctx.attach` 接纳任意 bytes 与 `mediaType` 标签，归档不解码内容。View 已能经 Inspection 读取 Attempt 附件与 Judge 封存图片。

### 候选清单

- [PLAN-1：写入时展示](plans/plan-1/README.md) —— Adapter 在 `recordTrace` 时为事件附加封闭展示词汇，随事件封存。
- [PLAN-2：读取时 formatter](plans/plan-2/README.md) —— Adapter 声明按事件类型的 formatter，`show` / View 读取时加载项目执行。
