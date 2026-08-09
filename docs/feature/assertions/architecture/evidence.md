# Assertion 证据与完整性

每条 Assertion 在采集前声明需要哪些 Attempt channel。collector 使用这些声明决定缺少数据时写 <code>failed</code>、<code>passed</code> 还是 <code>unavailable</code>；它从不把“没有读到”解释为“没有发生”。

## 两条完整度轴

channel descriptor 的 <code>coverage</code> 说明持久采集的数据集合是 complete、partial 还是 unavailable。reader 的 <code>ChannelRead</code> 另行说明本次解码是 complete、partial、unsupported 还是 invalid。

两条轴不能合并：

- 已采集的 JSONL 可能因未知 event 只得到 partial 解码。
- 未采集和不适用是 <code>unavailable</code>，不是空数组。
- 读取到损坏或缺失 channel 文件是 <code>invalid</code>。
- 旧 reader 不支持某个 channel 是 <code>unsupported</code>。

被请求的 invalid channel 使该读取失败。未请求的 channel 不影响其它 Assertion、Sample 或 Report。

## 需求类型

| 需求 | 使用者 | 通道不能交付时 |
|---|---|---|
| required | 非 optional Assertion | 写 <code>outcome: "unavailable"</code>；Verdict 按规则处理。 |
| optional | 带 <code>.optional()</code> 的 Assertion | 写 <code>outcome: "unavailable"</code>；不单独改变 Verdict。 |
| supplemental | 只供详情或 Report 使用的数据 | 写具名 diagnostic；不伪造 Assertion 数据。 |

同一通道同时被 required 与 optional 使用时，按 required 处理。一次采集成功后，所有消费者读取同一份 Attempt-owned 数据。

## 判定规则

正向检查在 partial 数据中找到明确匹配时可以通过，因为已读到的材料足以证明该事实。负向检查、上限检查和“没有发生”类检查需要完整材料；材料不完整时写 <code>unavailable</code>。

值 matcher 消费显式传入的值。Sandbox、usage、diff、conversation、tool 和 telemetry 断言消费已经规范化的 channel 数据。Judge 消费默认材料或 <code>{ on }</code> 指定的材料。

Runner 在收尾前读取 collector 的需求清单。采集失败只影响登记了该 channel 的消费者；它不会替换已写入的 assertion、verdict、usage 或 diff。

## 相关阅读

- [Assertions 架构](../architecture.md)
- [Record Library · ChannelRead](../../record/library.md#channelread)
- [Verdict 规则](../../verdict/architecture.md)
- [Adapter 证据](../../adapters/architecture/evidence.md)
