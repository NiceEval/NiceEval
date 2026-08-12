# PLAN-5 Lifecycle

## Attempt capture 与发布

1. Coordinator 为 planned Attempt 创建 scoped capture context，绑定 exact Attempt owner 与 frozen Run
   draft identity。
2. 在每次 `send` 前 coordinator mint versioned send anchor，并通过 branded context 同时传给 Adapter event
   collector 与已启用的 OTel collector。各 collector mint 自己的 local entity identities。
3. Command collector 与 Assertion collector 分别在事件发生处 mint command/assertion identities。
   Verdict fold 与 Score evaluator 只保存收到的 assertion anchor references，不重新 mint identity。
4. Attempt 主体结束后等待所有 producer 和 finalizer 停稳。Interruption 仍沿 Effect Cause 传播，同时进入
   统一 finalization；不发布半封口 package。
5. 每个事实权威独立执行 redaction、bounds、exact validation 与 collection folding，再 seal 自己的 package。
   能安全保留子集时写 partial + limitations；无法构成 exact safe package 时 seal failure。
6. Coordinator 根据实际启用能力最后 seal Attempt Capture Receipt。Expectation 只有 sealed、unsupported、
   not-enabled；Receipt 不复制 package collection state。
7. Aggregate contract 验证 receipt inventory、未双写 representation、anchor issuer mint registry 和所有
   sealed expectations。同一 anchor 的跨包 references 是合法传播；只有重复 origin mint 才阻止发布。
   Cross-package target 或 cardinality 不在这里验证，否则 read-time dangling 无法作为 relation state 保留。
8. 验证后的 typed writes 交给 generic Record writer。任一 write/flush failure 保持 typed Effect failure。
9. Run 的所有 Attempts、Run-owned producers 与 Run Capture Receipt 同样停稳和验证后，writer 最后创建
   `complete`。它仍是唯一 Run publish signal。

## 特殊路径

| 现场 | 结果 |
|---|---|
| Adapter 不支持 OTel | Receipt 写 unsupported；不要求 OTel package |
| 用户未启用 OTel | Receipt 写 not-enabled；不要求 OTel package |
| OTel 截断但仍有安全 facts | Receipt 写 sealed；OTel package 自己写 partial + limitations |
| OTel 无法形成 exact safe package | package seal failure；Run 不发布 |
| Receipt seal/aggregate validation 失败 | Run 不发布 |
| generic package write 或 flush 失败 | Run 不发布；保留 typed I/O failure |
| interruption | finalizers 逆序执行；没有完整 aggregate 就不创建 `complete` |
| reference Member | 不复制 Attempt packages；沿 exact Attempt ref 使用 origin owner 的 Receipt/profile |

## 读取

Report definition 在 I/O 前闭合 Receipt、physical 与 legacy 的静态有限分支。Host 先读 owner Receipt：

- available receipt 激活且只激活其声明的 physical representation，unsupported/not-enabled
  作为 capture expectation 结果保留；
- receipt unavailable 表示 legacy/third-party owner，激活 legacy branch；
- receipt old/unsupported/invalid 不 fallback，形成 representation-unavailable；
- 未激活 branch 不读取，也不贡献 problem 或 raw snapshot budget。

Receipt 是 authoritative：reader 不为寻找历史或第三方双写而检查未选 family 是否存在。新 Run 的
official aggregate validator 必须在 publish 前拒绝双写。

Sample selection 先于这一步完成，因此每次 package projection 都已绑定 exact selected/origin owner 与同一
frozen view。Projection 完成后，Relations 才按 logical slots 和 typed anchors 组合 local views。
