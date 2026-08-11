# 证明、并发提交与保留

> 观察日期：2026-08-09
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究判断

NiceEval Record 把三类经常被混称为“可验证存储”的机制放在一起：

1. Merkle proof 证明某份证据属于固定 revision。
2. CAS 和 fencing 决定哪个 writer 可以发布下一 revision。
3. retention root 和 GC barrier 决定哪些 object 可以删除。

Certificate Transparency、Iceberg 和 etcd 分别说明了这三类故障为何真实存在。
它们也说明默认 implementation 不应把所有场景都按公开分布式日志的最高成本实现。

## 一手材料

- [RFC 9162: Certificate Transparency Version 2.0](https://www.rfc-editor.org/rfc/rfc9162.html)
- [Trillian: Verifiable Data Structures](https://github.com/google/trillian/blob/master/docs/papers/VerifiableDataStructures.pdf)
- [Trillian repository](https://github.com/google/trillian)
- [Sigstore Rekor overview](https://docs.sigstore.dev/logging/overview/)
- [Sigstore security model](https://docs.sigstore.dev/about/security/)
- [Sigstore bundle format](https://github.com/sigstore/protobuf-specs/blob/main/protos/sigstore_bundle.proto)
- [Apache Iceberg specification](https://iceberg.apache.org/spec/)
- [Apache Iceberg reliability](https://iceberg.apache.org/docs/latest/reliability/)
- [Apache Iceberg maintenance](https://iceberg.apache.org/docs/latest/maintenance/)
- [Apache Iceberg branching and tagging](https://iceberg.apache.org/docs/latest/branching/)
- [Apache Iceberg schemas](https://iceberg.apache.org/docs/latest/schemas/)
- [etcd API guarantees](https://etcd.io/docs/v3.6/learning/api_guarantees/)
- [etcd transactions](https://etcd.io/docs/v3.6/learning/api/)
- [etcd leases](https://etcd.io/docs/v3.6/learning/api/#lease-api)
- [etcd maintenance and snapshots](https://etcd.io/docs/v3.6/op-guide/maintenance/)
- [The Chubby lock service](https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/)

## 机制不能互相替代

| 机制 | 回答的问题 | 不回答的问题 |
|---|---|---|
| inclusion proof | 某 leaf 是否属于这棵固定树 | leaf 是否真实、完整或由诚实 producer 生成 |
| consistency proof | 后一棵树是否只在前一棵后追加 | writer 是否经过业务授权 |
| signed checkpoint | 谁为某个 tree root 与 size 签名 | signer 是否向所有读者展示同一视图 |
| expected-revision CAS | 当前 head 仍是 writer 开始时看到的版本吗 | object closure 是否完整 |
| fencing token | 旧 lease owner 是否永远失去写权 | 新 owner 的内容是否正确 |
| GC root/barrier | sweep 使用的可达性边界是否与写入串行 | 已提交历史应该保留多久 |

Record 同时使用这些概念，不代表它们是一套算法。
实现和错误模型应继续把 proof failure、head conflict、lease loss、missing object 和 retention failure 分开。

## Certificate Transparency：证明包含与只追加

RFC 9162 的 Merkle inclusion proof 让 verifier 用 leaf、audit path、tree size 和 root 验证包含关系。
consistency proof 则证明两个 tree head 之间保持 append-only。
signed tree head 提供 log 对某个 root 和 tree size 的承诺。

这给 NiceEval evidence export 三个直接先例：

- proof 可以只携带目标 leaf 到 root 的 sibling hash，不复制无关 payload。
- proof 必须绑定明确 tree size 或 revision，不能验证一个会漂移的 latest。
- 验证包含与信任 producer 是两个步骤。

CT 的目标仍比 Record 窄。
它证明证书 leaf 被纳入一条公共追加日志，不证明任意业务 query 的结果完整，也不证明 evaluator 的判断正确。
NiceEval 若声称某个 Report 指标基于全部匹配事件，还要证明 selector、stream commitment 和分母。

CT 也比 Record 多一项紧凑证明。
consistency proof 可以直接证明两个 tree head 之间保持同一前缀。
Record committed-root membership 与 `subject.previous` 谱系需要读者拥有可信 GraphRef 或沿完整 revision chain 验证，不是两个任意 head 之间的 CT consistency proof。

Merkle membership 还不能阻止 source Store 向不同接收方提供互相冲突的 Layout。
只有威胁模型要求抵抗 Store equivocation 时，才需要另加 signed checkpoint、consistency proof 和 witness/gossip。

RFC 9162 还明确暴露隐私成本。
client 直接向 log 请求某证书的 inclusion proof，会向 log 泄漏它正在访问哪个 TLS server。
NiceEval 把 proof 与 Report 或 SampleBundle 一起交付，可以避免接收方回查 source Store，但导出方仍会看到选择范围。

## Trillian 与 Rekor：透明不等于真实性

Trillian 提供可验证日志和 map 的基础结构。
它把 storage transaction、tree sequencing、signing 和 client verification 分开，而不是让 Merkle tree 代替数据库一致性。

Rekor 用透明日志登记软件供应链签名和 attestation metadata，并提供查询与 inclusion proof。
Sigstore security model 对它的能力给出更窄的描述：一条 entry 是单方 attestation，证明某份数据不晚于某时已经存在。

因此，Rekor 的先例支持把 Claim、signature 和 proof 分层：

```text
Claim bytes
  └─ producer signature
       └─ transparency-log inclusion
```

三层分别回答内容、签名者和公开登记。
即使三层都通过，verifier 仍要用 policy 判断签名者是否可信、predicate 是否适合本次决策。

公开透明日志还与删除存在结构性冲突。
敏感 input、prompt、用户标识或完整 transcript 不适合直接进入 Rekor 式公共日志。
NiceEval proof 可以留在私有或定向交付的 Store，不应把“可验证”默认等同于“公开”。

## Iceberg：最接近 Record revision 的存储先例

Iceberg table metadata 指向 current snapshot。
snapshot 通过 manifest list 引用 manifests，manifest 再引用 data 和 delete files。
新 commit 创建新的 metadata 和 snapshot，并复用未变化的 files。

这与 Record 很相似：

- current metadata 类似 Layout head。
- snapshot 类似 immutable Record revision。
- manifest list 和 manifests 类似分页 catalog 与 strong closure。
- data files 类似 immutable payload objects。
- optimistic concurrency 类似 expected-head CAS。

Iceberg writer 基于一个 base metadata 准备改动，再原子交换 catalog 中的 metadata pointer。
冲突后，安全的 append 可以重新应用到新 base；冲突的 delete 或 rewrite 需要重新验证。

NiceEval 的选择更保守。
Record writer 遇到 head conflict 后重建领域 revision，不允许 Store 自动合并 Graph。
这避免 infrastructure 在不了解 Claim、Contribution 或 Attempt 语义时作出合并判断。

Iceberg schema evolution 也提供重要先例。
field identity 使用不会复用的 ID，因此 rename 不会被误解成 delete 加 add。
但 Iceberg 仍有 format version 和 metadata schema；stable ID 没有让 schema upgrade 消失。

## Iceberg retention 揭示永久 committed root 的代价

Iceberg 支持 snapshot expiration、branch/tag retention 和 orphan file removal。
旧 snapshot 不再被任何 ref 保留后，其独占 data file 才能回收。

Record 当前让 committed root history 永久保留。
这会得到强于 Iceberg 的 receipt 可重开保证，也意味着 GC 不能靠“旧 revision 已过期”回收已提交 graph。

真正能删除的通常只剩：

- CAS loser 或崩溃留下的 staging object；
- 从未被任何 committed root、pin 或 read lease 引用的 orphan；
- 明确属于临时导入并已解除 pin 的 object。

如果产品以后需要有界保存或隐私删除，必须裁决 receipt 和历史 GraphRef 如何失效。
GC 算法本身不能同时兑现“永久可重开”和“彻底删除”。

## etcd：CAS、revision 与 lease 是提交原语

etcd transaction 可以先比较 key 的 version、create revision、mod revision 或 value，再原子执行 success 或 failure 分支。
线性一致 read 与 transaction 为 expected-head CAS 提供了成熟先例。

lease 为 key 提供有界生存期，但 lease expiry 不是完整 fencing 方案。
外部资源若不在同一个 etcd transaction 内，旧 owner 可能在暂停后继续向该资源写入。
安全实现仍要把单调 token 交给受保护资源，并要求它拒绝旧 token。

Chubby 的 sequencer 正是这个模型。
它包含 lock name、mode 与单调 generation，由真正的资源服务器校验。
如果 blob Store 或其它最终写入点不检查 token，metadata service 的 lease 只能保护 head，不能阻止旧 writer 继续污染 staging namespace。

这支持 Record backend 的纪律：

- expected head 防止 lost update；
- lease 决定 owner 当前是否活跃；
- fencing token 防止旧 owner 恢复写权；
- commit 在同一线性点更新 head 和 committed-root index。

etcd snapshot 是成员后端的运维备份，不等于 NiceEval typed mirror snapshot。
它不表达 Record 的 graph identity、业务 lineage 或 target-first idempotence。

## 哪些复杂度在什么条件下成立

| 条件 | 必要机制 | 可以延后或简化的部分 |
|---|---|---|
| 本地、单进程、单 writer | 原子 metadata replace、crash-safe journal、staging | 分布式 lease 服务、跨节点 fencing |
| 本地多进程 writer | file lock、expected-head CAS、失活 owner 防护 | 公开 transparency log |
| 远端 object Store 多 writer | 线性 CAS 或 serializable metadata transaction、fencing | 若不导出证据，可不生成 proof |
| 交付完整 Record mirror | 固定 snapshot、完整 closure、target 原子安装 | leaf-level selective proof |
| 只交付 Sample 或 Report 证据 | fixed revision、membership/query proof、离线 verifier | 完整历史镜像 |
| 公开透明审计 | signed checkpoint、gossip/monitor policy | 不应默认用于敏感 Record |

这张表是研究建议，不改变 Record Feature 的目标契约。
它说明实现顺序可以按部署能力分层，而不必让本地作者先承担远端共识系统的配置成本。

## 值得吸收

1. proof 永远绑定明确 root 和 tree size，不验证 latest。
2. 像 CT 一样把 inclusion、consistency、signature 和 local policy 分开。
3. 像 Iceberg 一样让 immutable metadata tree 复用未变化 object，并以 pointer CAS 发布。
4. 像 etcd 一样让冲突返回 actual revision，不静默替换或按时间猜 winner。
5. 把 staging cleanup、snapshot expiration 和已提交历史 retention 视为不同政策。
6. 对本地与远端 backend 使用相同可观察错误，但允许不同复杂度的内部实现。

## 不应复制

- 不把公开日志当成敏感 Eval 事实的默认交付方式。
- 不用 inclusion proof 推导 producer 诚实、query 完整或 evaluator 正确。
- 不把 lease expiry 单独称为 fencing。
- 不让 generic Store 像 Iceberg operation rebase 一样自动合并领域 revision。
- 不用 object mtime 或 eventual listing 判断 orphan 是否安全删除。
- 不承诺永久 GraphRef，同时又把过期 committed history 当普通 GC 候选。
