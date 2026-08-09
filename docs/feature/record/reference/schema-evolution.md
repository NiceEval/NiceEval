# Schema 演进防火墙

本页给 Record v2 一个可证伪的承诺：

> 只要新能力能表示成有限、不可变 typed payload，并显式列出全部 strong dependency，它就不改变 frozen core。

目标不是让所有 reader 都理解未来业务，而是让不知道新 payload 的 reader 仍能验证、保留和原字节复制完整闭包。

## frozen core 的边界

v2 冻结以下语义：

1. `LayoutV2` 原子指向 current head 与 append-only committed-root tree。
2. `DescriptorV1` 由 mediaType、digest、size 共同组成 typed reference。
3. `GraphNodeV1` 把 opaque payload 与可分页 strong edge 分开。
4. `GraphRootV1` 只锚定 subject，不表达领域完整性。
5. `CommittedRootPageV1` 是 append-only committed-root Patricia radix 的 typed bootstrap page，
   leaf 保存完整 GraphRootRef。
6. core JSON 的 JCS、整数、UTF-8、unknown field 与 path validation 规则固定。
7. generic walker 对 unknown payload 仍能遍历完整 strong closure。

Record、Run、Attempt、Stream、Contribution、Claim、Report、SampleBundle、wrapper 和 attestation 都位于 core 之外。

## 普通变化的归属

| 需求 | 表达方式 | 改 frozen core |
|---|---|---|
| 增加 Agent 行为事件 | 新 event name 与 body schema | 否 |
| 增加首 token 延迟 | 新 Observation 或已有事件上的独立 payload | 否 |
| 增加 trace attribute | 新 telemetry payload 或 Projector version | 否 |
| 修改成本算法 | 新 Claim evaluator / Projector identity | 否 |
| 增加源码、diff 或 HTTP archive | 新 payload、chunk index 与 strong edge | 否 |
| 增加 Report 页面或图表 | 新 Report definition 与 Projector request | 否 |
| 增加签名或 timestamp | 引用 fixed GraphRef 的 attestation payload | 否 |
| 增加加密 recipient | 新 encryption wrapper 与 key-envelope node | 否 |
| 增加 digest 算法 | 新 format/core 版本；v1 writer 仍只写 SHA-256 | 是 |
| 增加 carry / accept 依据 | 新 Claim 与 Contribution revision | 否 |
| 迟到事实 | 新 supplemental stream、Attempt 与 Contribution revision | 否 |
| 选择性披露 | 目标 Store 中的新 proof wrapper | 否 |
| 完整备份 | typed snapshot 固定边界；mirror 全部 committed roots 与 strong closure | 否 |

只有 core 的安全解释本身无法继续时，才进入容器升版讨论。

## payload 演进

同一 media type 可以增加可选字段，但必须同时满足：

- 字段语义独立；
- 缺失时含义明确；
- 不参与既有对象的身份、依赖、权限或判断正确性；
- reader 忽略该字段后，已有字段仍保持原义。

以下变化必须发布新的 media type：

- 字段改名、删除或改类型；
- 缺失从一种语义变成另一种语义；
- 单位、排序或唯一性改变；
- identity、membership、strong dependency 或权限语义改变；
- state 词表或 Claim evaluator 含义改变。

已发布 media type 不能被另一种含义复用。
unknown payload 必须保留原始 bytes；parse 后重新序列化不符合 round-trip 契约。

## 红队回放

| 场景 | v2 的反馈或表达 | 需要 v3 |
|---|---|---|
| gzip、zstd、多层 codec | wrapper payload 强边到 encoded object | 否 |
| 加密与多个 recipient | encryption payload 强边到密文与 key envelope | 否 |
| 单文件过大 | segment、chunk index 与分页 | 否 |
| catalog 极大 | Merkle radix branch 分页 | 否 |
| 多 writer 同时提交 | fencing + expected-head CAS；冲突方重建 | 否 |
| writer 在 put 后崩溃 | durable staging；grace 后由 barrier GC | 否 |
| GC snapshot 后出现新写 | GC 全程持 Store barrier，写操作被阻塞 | 否 |
| 旧 receipt 指向历史 root | append-only committed-root tree 永久保留 | 否 |
| partial clone 缺对象 | missing-object，不改成 not-recorded | 否 |
| unknown digest 算法 | unsupported-digest，访问路径前拒绝 | 否 |
| 相同 digest、不同 media type | typed ref 全字段参与 identity | 否 |
| 恶意深图或重复边 | visited set 与资源预算 | 否 |
| Claim 引用同一 Graph digest | source-local target，GraphRef 只在外部 proof | 否 |
| 单事件选择性证明 | catalog proof + stream commitment + `RecordEvidenceProofV1` | 否 |
| 查询没有 authenticated index | 完整 committed prefix 进入 basis | 否 |
| completed Attempt 收到迟到 telemetry | 新 supplemental binding 与线性 revision | 否 |
| Sample 子集交付 | SampleBundleSubject，保留 source identity 与分母 | 否 |
| capture unbound、closed 或无权 source | `RecordMirrorSnapshotError` 的 source discriminant | 否 |
| 语法合法但不在 source 谱系的镜像令牌 | `mirror-snapshot-not-committed` | 否 |
| mirror 最终首次绑定遇到并发 writer | `mirror-target-initialize-conflict { expected: null, actual }` | 否 |
| mutable URL 成为事实 identity | 违反内容寻址与 immutable payload 前提 | 可能 |
| object-ID 信任算法整体失效 | 评估 core identity 是否仍安全 | 可能 |

## 版本升级防火墙

任何 v3 提案必须逐项回答：

1. 需求能否表示成有限、不可变 typed payload？
2. 它的全部容器依赖能否写成 strong edge？
3. generic walker 能否在不解码 payload 的前提下验证和复制？
4. wrapper、attestation、分页、bundle 或新 Projector 是否已经隔离新语义？
5. 新 reader 读取缺少该 payload 的 Record 时，能否局部返回 unavailable？
6. 提案是否保持 typed reference、Graph root、committed-root history 与 JCS 解释不变？
7. unsupported、permission-denied、missing、corrupt、resource-limit 与 not-recorded 是否仍可区分？

前六项全部回答“能”却仍要求改 core，提案缺少隔离设计。
第七项无法保持时，必须先证明问题位于 core，而不是某个 payload decoder。

只有以下情况允许继续讨论 v3：

- Layout 与 committed-root page 的规范字节无法继续安全读取；
- mediaType、digest、size 不再足以形成 typed reference；
- 未来权威内容无法表示成 immutable payload 与显式 strong dependency；
- Graph root 到 subject 的信任锚必须改变；
- core parser、canonicalization 或 object-ID 信任存在无法用 wrapper 隔离的安全缺陷。

新增业务实体、状态、Report、Projector 或 evidence 种类不属于这些情况。

## 必须持续成立的性质

### core 与复制

1. unknown node 引用 unknown child 时，generic copier 复制完整强闭包，并保持 bytes、digest 与 size。
2. 相同 digest、不同 media type 的 descriptor 不得在 visited set、cache 或 EvidenceRef 中混同。
3. duplicate key、非法 UTF-8、`-0`、超安全整数和非规范 JCS 在 core decoder 处被拒绝。
4. 未知算法、大小写混杂、超长 digest 与 path traversal 在文件访问前被拒绝。
5. segment 或 chunk 边界变化不改变 logical event commitment 与 Projector 结果。

### commit 与 retention

1. 同时提交的两个 writer 只有一个 expected-head CAS 成功。
2. 成功 root 与新的 committed-root tree 在同一次 layout generation 出现。
3. next subject.previous 正好指 expected head subject；不能跳过或分叉。
4. CAS 失败产生的对象只由 staging 保护，不进入 committed root history。
5. 任何已返回 receipt 的 GraphRef 在该 Store 中都能重开。
6. mirror 复制并登记所有 committed roots，不只复制 current head。

### GC

1. GC barrier 获取后，put、commit、lease、pin 与对象删除都不能越过 snapshot。
2. putObject 不能出现“对象可见但 staging pin 不可见”的中间状态。
3. shared node 仍被任一 committed root、staging、lease 或 pin 标记时不得删除。
4. recovery 与 GC 不使用 mtime 判断对象是否安全。

### 领域 revision

1. Attempt originRunId 在所有 revision 中不变。
2. locator 是 attemptId 的完整 26 字符编码，reservation 发生在外部副作用前。
3. Contribution previous/supersedes 形成严格线性链，membership slot 在 Run 内唯一。
4. adopted 只能推进到同一 Attempt 的后继 revision。
5. 历史 GraphRef 仍读取历史 Run、Contribution 与 Attempt，不跟随 catalog current 项漂移。
6. closed 或 abandoned stream 不能重开；迟到事实使用新 supplemental binding。

### Evidence 与 Projector

1. Record 内 Claim target 不包含同一 GraphRef，因此不存在内容哈希自引用。
2. `RecordEvidenceProofV1` 从 source GraphRoot、catalog、stream commitment 一直验证到 event bytes。
3. proof 不泄漏无关 sibling payload，也不把 source GraphNode 变成 target Store 活动节点。
4. Projector 不能绕过 ProjectionReadContext 读取事实或手写 basedOn。
5. nested Projector、失败读取、absence proof 与 query proof 都进入 trace。
6. memo identity 同时包含完整 RecordGraphRef、attemptId、adopted node 与 normalized parameters。
7. truncated、redacted、incomplete、missing 与 corrupt 不会折成同一个 null。
8. Projector 作者只返回 `T`；EvidenceValue、unavailable 与 basedOn 只由框架构造。
9. dependency 是冻结的 Projector object 数组，省略时等于空数组；其 graph 不能有 cycle。

### mirror

1. capture 与 parse 只抛 `RecordMirrorSnapshotError`；mirror 只抛 `RecordMirrorError`。
2. typed snapshot 是 mirror 唯一输入边界，mirror 不会重新 parse 它。
3. target 已相等时只验证 target；target 损坏不允许回退读取 source。
4. source/target 的 corrupt、closed、permission、unavailable、IO、resource-limit 与 unsupported 保持互斥 code。
   两端的 resource-limit 都带 phase、统一 walker limit 与 observed。
5. copy/bind 的 target 问题保留 phase；不得以 `*-failed` 或 unknown cause 抹平。
6. 首次 expected:null CAS conflict 不重选 head，也不改写现有 target。

### receipt 与交付物

1. identity 已 durable 而 terminal commit 失败时返回 partial 与 last durable GraphRef。
2. not-recorded 绝不携带伪造 GraphRef。
3. 早期 AttemptReceiptSnapshot 与最终 InvocationReceipt 可以绑定祖先和后继 Graph，但各自承诺不漂移。
4. SampleBundle 保存 source identity、已经确定的成员、分母与 coverage，不能被 openRecord。
5. Report plan 不读 Projection value、网络或任意 Store；每页 render 一次。
6. 导出期间缺少已引用依据时整次失败，不能改写成 not-recorded。
7. disposed child 的 pending terminal intent 由活着的直接 parent reconcile；只有该 parent close/dispose 能丢弃它。

这些性质把扩展承诺限制在可检查边界内。
实现可以选择文件、数据库或远端对象服务，但不能改变这些公开可观察结果。
