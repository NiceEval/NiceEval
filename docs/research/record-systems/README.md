# Record 相似系统研究

> 观察日期：2026-08-09
>
> 观察对象：LLM eval 与 tracing 产品、事件历史系统、内容寻址对象库、attestation、透明日志和 snapshot table
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究判断

没有一个外部系统与 NiceEval Record 完全同构。
最接近的领域产品保存 trace、feedback、dataset 和 experiment，却通常不承诺不可变 revision、离线证明或 unknown payload 的完整复制。
Git、OCI、Datomic、Certificate Transparency 和 Iceberg 等基础系统解决了后一组问题，但不理解 Eval 的 Observation、Claim 和 Projection。

Record 实际组合了四类成熟机制：

| 问题 | 最接近的外部系统 | NiceEval 多承担的责任 |
|---|---|---|
| 捕获执行并附加评价 | MLflow、Weave、LangSmith、Phoenix、Braintrust | 把 Observation、Claim、Provenance 和 Projection 设为不同信息所有者 |
| 保存不可漂移的历史并重建读面 | Datomic、KurrentDB、Temporal、OpenTelemetry | 固定完整 `RecordGraphRef`，并自动追踪 Projection 的依据 |
| 让对象和 schema 独立演进 | Git、OCI、IPLD/IPFS、in-toto | 把 opaque payload 与可通用遍历的 strong edge 分开 |
| 验证追加、提交并保留快照 | Certificate Transparency、Rekor、Iceberg、etcd | 同时承担 evidence proof、Record revision、mirror 与本地 Store 生命周期 |

因此，Record v2 的合理承诺不是“以后不改 schema”。
可信承诺是让大多数业务扩展只增加 typed payload 或 Projector，并让历史 revision 保持原字节和原身份。
当身份、依赖、canonical bytes 或安全解释变化时，core 仍然必须升版。

## NiceEval 要解决的七个问题

本研究只把真正命中以下问题的软件列为对照，不因产品也有 JSON、trace 或 hash 就判为相似：

1. 一份 Record 跨多次 Invocation 和 Run 长期追加，同时允许读者固定旧 revision。
2. Observation 表达实际发生的内容，Claim 表达 evaluator 当时依据什么作出什么判断。
3. Projection 可以从固定事实重建，不能反向成为事实真源。
4. 新 payload 出现后，旧实现即使不能解释它，也能保留、复制和验证完整依赖闭包。
5. 多 writer、崩溃、迟到事实和镜像不能让已经返回的 revision 漂移。
6. Sample 或 Report 只携带所用证据时，接收方仍能验证 source graph identity 和包含关系。
7. 普通 Eval 作者不需要理解 Node、edge、sequence、Claim identity、proof 或 CAS。

## 跨系统研究判断

### Observation 与 Claim 的区分有同业依据

LLM 平台普遍把执行 trace 与 assessment、feedback、annotation 或 score 分开。
这证明“发生了什么”和“如何评价它”是两个真实的产品问题，不是 NiceEval 独有的术语游戏。

差异在于，多数平台把评价附在 trace 或 span 上，并允许后补、原地替换或删除。
它们的公开 API 通常不要求 evaluator 身份、版本和完整 evidence basis 共同形成不可变 Claim。
NiceEval Claim 更接近“评估 annotation 加上 in-toto attestation”的组合，而不是普通 span attribute。

### schema 只会被隔离，不会消失

外部系统都保留某种稳定 envelope，同时让领域内容继续升版。
OCI 使用 Descriptor 和 media type，OpenTelemetry 使用 schema URL，Iceberg 使用 format version 与 field ID，in-toto 使用 versioned Statement 和 `predicateType`。

这些系统也展示了隔离的边界。
Git 增加 hash transition 和 repository format，OpenTelemetry 限制可自动转换的变化，Iceberg 发布新的 table format，OCI 仍会发布新 manifest 或 artifact schema。
稳定外壳能降低升级频率，却不能证明外壳永远足够。

### strong edge 是 Record 最不寻常也最有价值的差异

OCI 和 IPLD 的引用通常位于已知 payload schema 或 codec 中。
reader 不认识该 schema 时，未必知道哪些字段是必须复制的依赖。

Record 把 strong dependency 提升到通用 Graph node 外壳。
这让 generic walker 不理解领域 payload 也能复制闭包，是比“每个对象都有 digest”更强的承诺。
代价是每次写入要额外生成 Node、edge page 和索引 revision。

### proof、事务和 GC 解决的是三种不同故障

Certificate Transparency 的 inclusion proof 证明 leaf 位于某棵已签名树，consistency proof 证明两棵树之间只发生追加。
Iceberg 的 optimistic commit 解决并发 writer 如何发布新 snapshot。
etcd 的 transaction 和 lease 解决线性条件更新与过期 owner。

三者不能互相替代。
NiceEval 同时采用它们的思想，是因为 Record 同时承担证据交付、revision 提交和对象回收。
本地单 writer implementation 不一定需要分布式系统的全部运行成本，但公开 Store 契约不能把这些故障混成一个宽泛错误。

### 永久历史与删除存在真实冲突

Git、KurrentDB 和 Iceberg 都允许 unreachable object、过期事件或旧 snapshot 最终被回收。
透明日志则以不可删除换取公开审计。

Record 若永久保护所有 committed roots，GC 主要只能删除 staging 和 orphan，不能控制已提交历史的长期增长。
redaction marker 也不能擦除已经复制的原始 bytes。
保留多久、谁能删除、receipt 失效后如何反馈，是独立的产品裁决，不能由内容寻址自动解决。

## 对上层 API 的判断

同类 LLM 产品最一致的做法是让 instrumentation 或 adapter 自动捕获 trace，并为评价提供具名领域动作。
它们不会要求每个应用作者手工建立通用 object graph。

NiceEval 应保留 Observation 和 Claim 作为存储模型，但按使用者分层：

| 使用者 | 主路径 | 不应手写 |
|---|---|---|
| Eval 作者 | `assertThat(...)`、`judge(...)` 与领域结果 | `observe()`、`claim()`、Node、edge |
| Adapter 作者 | 已绑定的 typed event emitter | binding、sequence、scope、stream identity |
| Assertion/Judge 实现 | `recordAssertion(...)`、`recordVerdict(...)` 等领域动作 | Claim id、evaluator identity、`producedAt`、tracked basis |
| 协议扩展作者 | 明确标为 advanced 的底层入口 | frozen core 或未登记的任意 JSON |

这不是要删除底层原语。
底层原语仍是框架实现和第三方协议扩展的必要边界，只是不应成为普通作者的默认心智。

## 研究正文

- [LLM eval 与 tracing 产品](llm-eval-tracing.md)：trace、assessment、feedback、annotation、score 与 dataset lineage。
- [事件历史、判断与读模型](event-history.md)：Datomic、KurrentDB、Temporal、Flink 与 OpenTelemetry。
- [内容寻址、schema 与 attestation](content-addressing.md)：Git、OCI、IPLD/IPFS、Software Heritage 与 in-toto。
- [证明、并发提交与保留](proofs-and-storage.md)：Certificate Transparency、Rekor、Iceberg 与 etcd。

## 证据纪律

正文只把官方规范、官方文档、官方仓库和作者论文作为产品事实材料。
SaaS 产品没有公开存储格式或稳定性保证时，正文只描述公开 API 能观察到的行为。
“未看到不可变 revision 或 proof 契约”不等于证明内部一定没有该机制。

跨产品归纳和 NiceEval 建议统一标为研究判断。
它们需要进入 Feature、Roadmap 或 Design 并完成独立裁决后，才会成为产品契约。
