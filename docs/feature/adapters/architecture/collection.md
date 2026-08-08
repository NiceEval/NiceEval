# 行为与 Trace 采集

Adapter 从外部对象采集两条独立数据轨：行为轨支撑断言，时间轨支撑瀑布图。

```text
行为轨  SDK / structured output / transcript ─► StreamEvent[] ─► assertions
时间轨  OTLP spans                            ─► canonical mapper ─► trace view
```

OTel 内容可能关闭或脱敏，因此 span 不补写行为事件。
行为轨缺失会影响判定可信度；时间轨缺失只使报告降级。

## 行为轨通道

按优先级选择：

1. **官方 SDK 事件或完整结构化结果**：用独立转换器直接归一。
2. **CLI 结构化 stdout**：捕获 raw string 后交给纯 parser。
3. **CLI transcript / tape**：读取 CLI 为 resume 保存的完整侧写。
4. **无结构化出处**：返回空事件并明确负断言不可信，不从最终文本猜测工具行为。

采集层负责取得 raw string/frame；转换层只处理数据。
Parser 不读 Sandbox，`send` 不内联供应商状态机。

## 时间轨通道

Agent 通过 env、配置文件或请求 headers 将 OTLP span 发给运行器接收器。
每个方言由薄 mapper 标记 canonical GenAI 语义；无法映射的 span仍可作为原始 trace 证据保留。

没有原生 trace 的 CLI 可以从带时间戳的完整 transcript 合成 span，或者跳过时间轨。

## 接入决策树

```text
有官方 SDK / 完整结构化响应？
├─ 是 → 官方转换器
└─ 否 → CLI 有结构化输出？
        ├─ 是 → stdout parser
        └─ 否 → 有完整 resume transcript？
                ├─ 是 → transcript parser
                └─ 否 → events: []，限制负断言

trace 另算：能发 OTLP → tracing + mapper；不能 → transcript 合成或跳过
```

## Parser 验收

每个新方言必须用 fixture 回答：call ID 是否显式、并发是否安全、失败/拒绝怎样表达、usage 和实际模型从哪里取得、异常终止是否仍完整、多个采集源怎样避免重复。

各对象的具体采集面见对应 [`sdk/`](../sdk/README.md) 页面；通用完整性规则见 [断言证据](evidence.md)。
